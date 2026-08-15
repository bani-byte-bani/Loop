'use strict';
// 外部クロックのテンポ推定と BPM 表示の安定性。
//
// MIDI クロックは USB フレームに量子化されるうえ、メインスレッドが詰まっていれば
// ハンドラの実行はさらに遅れる。以前は「直近48点の平均間隔」でテンポを出していたが、
// 差分の総和は途中の項が打ち消し合うため、実質は両端2点の差でしかなく、
// 到着のばらつきがそのまま乗って表示が 119.9 / 120.0 と往復していた。
//
// ここでは「配達は遅らせるが、メッセージ自身のタイムスタンプは正確な格子」という
// 実機どおりの条件を作り、表示が動かないことを確かめる。

const { openApp, connectApp, SIGNALS } = require('../lib/harness');

// ページ内で外部クロックを流しながら BPM 表示を採取する
async function driveClock(page, { bpm, seconds, useTimeStamp, jitterMs }) {
  return page.evaluate(async (o) => {
    const PPQ = 24;
    const period = 60000 / o.bpm / PPQ;
    const count = Math.round(o.seconds * 1000 / period);
    const t0 = performance.now();
    const samples = [];
    let lastSampleAt = 0;
    for (let i = 0; i < count; i++) {
      const ideal = t0 + i * period;
      // 配達だけを遅らせる(ハンドラが遅れて呼ばれる状況の再現)
      const wait = ideal + Math.random() * o.jitterMs - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const msg = { data: [0xF8] };
      if (o.useTimeStamp) msg.timeStamp = ideal;
      window.__midiInputs.stub.onmidimessage(msg);
      const now = performance.now();
      if (now - lastSampleAt > 100) {
        lastSampleAt = now;
        samples.push(document.getElementById('bpmNum').textContent);
      }
    }
    return samples;
  }, { bpm, seconds, useTimeStamp, jitterMs });
}

// 推定が落ち着いてからのぶんだけ見る(窓が埋まるまで1小節ぶんかかる)
function settled(samples) {
  return samples.slice(30).filter((s) => /^[0-9.]+$/.test(s));
}

module.exports = {
  name: '外部クロックのテンポ推定 / BPM表示の安定性',
  async run(ctx) {
    const page = await openApp(ctx.browser, ctx.baseUrl, {
      signal: SIGNALS.tone(),
      midiInputs: [{ id: 'stub', name: 'STUB MIDI' }],
    });
    await connectApp(page, { mode: 'external', midiInput: 'stub' });

    // --- 出力経路 ---
    // MediaStream → <audio> を挟むと数十msの固定遅れが乗るので、
    // 出力先を指定していないときは必ず直結でなければならない。
    const direct = page.consoleLogs.some((l) => l.includes('Output path: direct'));
    ctx.info(`出力経路: ${page.consoleLogs.filter((l) => l.includes('Output path')).join(' / ') || '(ログなし)'}`);
    ctx.check('出力先未指定なら AudioContext.destination へ直結する', direct);

    // --- 再生補正の自動追従 ---
    // outputLatency は音が流れ始めるまで確定しないので、少し待ってから見る
    {
      await page.waitForTimeout(1500);
      const st = await page.evaluate(() => ({
        auto: document.getElementById('playbackAutoToggle').checked,
        offset: parseFloat(document.getElementById('playbackInput').value),
        note: document.getElementById('outLatencyNote').textContent,
      }));
      const measured = parseFloat((st.note.match(/(\d+)ms/) || [])[1]);
      ctx.info(`自動=${st.auto ? 'ON' : 'OFF'} / 再生補正=${st.offset}ms / 表示="${st.note}"`);
      ctx.check('実測の出力レイテンシを画面に出す', /実測 \d+ms/.test(st.note), st.note);
      ctx.check('自動追従がONなら再生補正が実測値に一致する',
        st.auto && isFinite(measured) && Math.abs(st.offset - measured) < 2,
        `補正${st.offset}ms / 実測${measured}ms`);

      // 手で数値を変えたら自動はオフになり、その値が守られる
      await page.fill('#playbackInput', '77');
      await page.dispatchEvent('#playbackInput', 'change');
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => ({
        auto: document.getElementById('playbackAutoToggle').checked,
        offset: parseFloat(document.getElementById('playbackInput').value),
      }));
      ctx.info(`手動入力後: 自動=${after.auto ? 'ON' : 'OFF'} / 再生補正=${after.offset}ms`);
      ctx.check('手で入れた値は自動追従に上書きされない',
        after.auto === false && after.offset === 77, `自動=${after.auto} / ${after.offset}ms`);
    }

    // --- タイムスタンプありの本来の経路 ---
    {
      const samples = driveClock(page, { bpm: 120, seconds: 6, useTimeStamp: true, jitterMs: 8 });
      const values = settled(await samples).map(parseFloat);
      const worst = values.reduce((a, v) => Math.max(a, Math.abs(v - 120)), 0);
      const distinct = [...new Set(values.map((v) => v.toFixed(1)))];
      ctx.info(`配達ジッタ8ms: ${values.length}回採取 / 表示値 ${distinct.join(',')} / 最大誤差 ${worst.toFixed(2)}BPM`);
      ctx.check('テンポ推定が配達の遅れに引きずられない',
        values.length > 10 && worst < 0.3, `最大誤差 ${worst.toFixed(2)}BPM`);
      ctx.check('BPM表示がちらつかない(表示は2種類まで)',
        distinct.length <= 2, distinct.join(','));
    }

    // --- タイムスタンプが無い実装へのフォールバック ---
    // 精度は落ちるが、桁が暴れるほど不安定になってはいけない
    {
      await page.waitForTimeout(1700);   // 一度クロック断にして推定を捨てさせる
      const values = settled(await driveClock(page, {
        bpm: 96, seconds: 6, useTimeStamp: false, jitterMs: 8,
      })).map(parseFloat);
      const worst = values.reduce((a, v) => Math.max(a, Math.abs(v - 96)), 0);
      const distinct = [...new Set(values.map((v) => v.toFixed(1)))];
      ctx.info(`timeStamp無し・96BPM: 表示値 ${distinct.join(',')} / 最大誤差 ${worst.toFixed(2)}BPM`);
      ctx.check('timeStampが無くても実用範囲に収まる',
        values.length > 10 && worst < 1.5, `最大誤差 ${worst.toFixed(2)}BPM`);
    }

    ctx.check('page error なし', page.pageErrors.length === 0, page.pageErrors.join(' / '));
    await page.close();
  },
};
