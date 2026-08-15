'use strict';
// 録音直後の 1 周目が「正確な時刻に予約されている」ことを確かめる。
//
// 以前は src.start() を引数なし(=即時)で呼んでいたため、クロック検出の
// ジッタとバッファ組み立ての時間ぶん 1 周目だけ遅れて始まっていた。
// さらに sliceCapture がチャンクごとに getChannelData() を呼んでおり、
// 8 秒のループでは組み立てだけで約 888ms かかっていた。
//
// start(when) に渡した時刻が呼び出し時点より未来なら、締切に間に合っている。

const { openApp, connectApp, recordTrack, SIGNALS } = require('../lib/harness');

async function leadFor(ctx, { bpm, bars, autoAdjust, playbackMs }) {
  const page = await openApp(ctx.browser, ctx.baseUrl, {
    signal: SIGNALS.tone(), captureStarts: true,
  });
  await connectApp(page, { bpm });
  if (autoAdjust) await page.click('#autoAdjustToggle');
  if (playbackMs != null) {
    await page.fill('#playbackInput', String(playbackMs));
    await page.dispatchEvent('#playbackInput', 'change');
  }
  await recordTrack(page, 'A', bars);
  await page.waitForTimeout(150);
  const last = await page.evaluate(() => window.__starts[window.__starts.length - 1] || null);
  await page.close();
  if (!last || last.when == null) return null;
  return (last.when - last.now) * 1000;
}

module.exports = {
  name: '1周目の再生スケジュール',
  async run(ctx) {
    const cases = [
      { bpm: 120, bars: 4, autoAdjust: false },
      { bpm: 120, bars: 4, autoAdjust: true },
      { bpm: 300, bars: 1, autoAdjust: false, playbackMs: 300 },
    ];
    for (const c of cases) {
      const lead = await leadFor(ctx, c);
      const label = `${c.bpm}BPM/${c.bars}小節` +
        (c.autoAdjust ? '・オートアジャストON' : '') +
        (c.playbackMs != null ? `・再生補正${c.playbackMs}ms` : '');
      ctx.info(`${label}: 余裕 ${lead == null ? '(時刻指定なし)' : lead.toFixed(1) + 'ms'}`);
      ctx.check(`${label} で締切に間に合っている`, lead != null && lead > 0,
        lead == null ? 'start() に時刻が渡っていない' : `${lead.toFixed(1)}ms`);
    }
  },
};
