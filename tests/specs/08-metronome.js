'use strict';
// フラッシュメトロノームとカウント音源。
//
// ・4 つのランプが拍ごとに順に光り、1 拍目だけ赤くなること
// ・カウントはスタンドアロン時に自動でオンになり、最初の録音が終わると自動でオフ
// ・手動でオンにしたときは、拍の途中ではなく必ず小節の 1 拍目から鳴り始めること
//   (ループと頭を揃えるため)

const { openApp, connectApp, recordTrack, SIGNALS } = require('../lib/harness');

module.exports = {
  name: 'メトロノーム / カウント音源',
  async run(ctx) {
    // --- ランプの点灯順 ---
    {
      const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.tone() });
      await connectApp(page, { bpm: 240 });
      const seen = await page.evaluate(() => new Promise((res) => {
        const out = []; let last = -1;
        const lamps = [...document.querySelectorAll('.metro-lamp')];
        const t = setInterval(() => {
          const i = lamps.findIndex((l) => l.classList.contains('on'));
          if (i >= 0 && i !== last) { out.push({ i, accent: lamps[i].classList.contains('accent') }); last = i; }
          if (out.length >= 9) { clearInterval(t); res(out); }
        }, 15);
        setTimeout(() => { clearInterval(t); res(out); }, 9000);
      }));
      const order = seen.map((s) => s.i);
      let sequential = order.length >= 8;
      for (let k = 1; k < order.length; k++) if (order[k] !== (order[k - 1] + 1) % 4) sequential = false;
      const accentOk = seen.every((s) => s.accent === (s.i === 0));
      ctx.info(`点灯順: ${seen.map((s) => s.i + (s.accent ? '(赤)' : '')).join(' → ')}`);
      ctx.check('4拍を順に点灯し1拍目だけ赤い', sequential && accentOk, order.join(','));
      await page.close();
    }

    // --- 自動オン → 初回録音で自動オフ → 手動で再開 ---
    {
      const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.tone(), captureOsc: true });
      await connectApp(page, { bpm: 180 });
      const initial = await page.$eval('#countToggle', (el) => el.checked);
      const before = await page.evaluate(() => window.__osc.length);
      await page.waitForTimeout(1200);
      const during = await page.evaluate(() => window.__osc.length);
      const freqs = await page.evaluate(() => [...new Set(window.__osc.map((c) => c.freq))].sort((a, b) => a - b));

      await recordTrack(page, 'A', 1);
      await page.waitForTimeout(200);
      const switchAfter = await page.$eval('#countToggle', (el) => el.checked);
      const c1 = await page.evaluate(() => window.__osc.length);
      await page.waitForTimeout(1200);
      const c2 = await page.evaluate(() => window.__osc.length);

      await page.click('#countToggle');
      const e1 = await page.evaluate(() => window.__osc.length);
      await page.waitForTimeout(3000);   // 小節頭を待つ仕様のため 1 小節ぶん以上待つ
      const e2 = await page.evaluate(() => window.__osc.length);

      ctx.info(`接続時=${initial ? 'ON' : 'OFF'} / 録音前 ${before}→${during} 件 / 周波数 ${freqs.join(',')}Hz`);
      ctx.info(`初回録音後: スイッチ=${switchAfter ? 'ON' : 'OFF'} / ${c1}→${c2} 件 / 手動ON後 ${e1}→${e2} 件`);
      ctx.check('スタンドアロンでは接続時にオン', initial === true);
      ctx.check('録音前は鳴っている', during > before, `${during - before} 件`);
      ctx.check('初回録音の完了で自動オフ', switchAfter === false && c2 === c1);
      ctx.check('手動でオンにすると再開する', e2 > e1, `${e2 - e1} 件`);
      await page.close();
    }

    // --- 手動オンは必ず 1 拍目から ---
    {
      const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.tone(), captureOsc: true });
      await connectApp(page, { bpm: 240 });
      await page.click('#countToggle');            // いったんオフ
      await page.waitForTimeout(300);
      const firsts = [];
      for (let trial = 0; trial < 4; trial++) {
        await page.waitForTimeout(130 + trial * 70);   // 小節頭からずれた位置で入れる
        await page.evaluate(() => { window.__osc = []; });
        await page.click('#countToggle');           // ON
        await page.waitForTimeout(1400);
        const clicks = await page.evaluate(() => window.__osc.map((c) => c.freq));
        await page.click('#countToggle');           // OFF
        await page.waitForTimeout(150);
        firsts.push(clicks.length ? clicks[0] : 0);
      }
      ctx.info(`オン直後の1発目: ${firsts.map((f) => (f === 1600 ? '1拍目' : `${f}Hz`)).join(' / ')}`);
      ctx.check('手動オンは必ず小節の1拍目から始まる', firsts.every((f) => f === 1600), firsts.join(','));
      await page.close();
    }
  },
};
