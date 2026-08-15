'use strict';
// オートアジャスト: しきい値を超えた最初の音を小節頭に揃える機能。
//
// 立ち上がりの鋭いバーストを一定間隔で流し、録音後に
// 「バッファ先頭からの最初の立ち上がり」がどこにあるかで確かめる。
// OFF なら入力の位相しだいでずれ、ON なら 0 サンプル付近に来るはず。

const { openApp, connectApp, recordTrack, markBuffers, SIGNALS } = require('../lib/harness');

async function onsetPosition(ctx, enabled) {
  const page = await openApp(ctx.browser, ctx.baseUrl, {
    signal: SIGNALS.burstTrain(), captureBuffers: true,
  });
  await connectApp(page, { bpm: 120 });
  await page.fill('#latencyInput', '0');
  await page.dispatchEvent('#latencyInput', 'change');
  if (enabled) {
    await page.click('#autoAdjustToggle');
    await page.fill('#autoAdjustThreshold', '20');
    await page.dispatchEvent('#autoAdjustThreshold', 'change');
  }
  await markBuffers(page);
  await recordTrack(page, 'A', 1);   // 1小節 @120BPM = 2 秒
  const res = await page.evaluate(() => {
    const added = window.__bufs.slice(window.__mark);
    const maxLen = Math.max(...added.map((b) => b.length));
    const buf = added.filter((b) => b.length === maxLen).pop();
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    const th = peak * 0.2;
    let onset = -1;
    for (let i = 0; i < d.length; i++) { if (Math.abs(d[i]) >= th) { onset = i; break; } }
    return { onset, sr: buf.sampleRate };
  });
  const line = await page.$eval('#stateLine', (el) => el.textContent.trim());
  await page.close();
  return { ...res, line };
}

module.exports = {
  name: 'オートアジャスト',
  async run(ctx) {
    const off = await onsetPosition(ctx, false);
    const on = await onsetPosition(ctx, true);
    ctx.info(`OFF: 最初の立ち上がり ${off.onset} サンプル (${(off.onset / off.sr * 1000).toFixed(1)}ms)`);
    ctx.info(`ON : 最初の立ち上がり ${on.onset} サンプル / ステータス "${on.line}"`);
    ctx.check('ONで音の頭がバッファ先頭に揃う', on.onset >= 0 && on.onset <= 64, `${on.onset} サンプル`);
    ctx.check('シフト量がステータス行に出る', /オートアジャスト/.test(on.line), on.line);
  },
};
