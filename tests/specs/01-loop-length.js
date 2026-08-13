'use strict';
// ループ長がテンポから算出した理論値と 1 サンプルも違わないことを確かめる。
//
// 以前はメインスレッドに届いたチャンクの個数でループ長が決まっていたため、
// 実測で -41ms〜+4ms のバラつきがあった。src.loop = true で再生するので
// この誤差は 1 周ごとに積み重なり、やがて小節頭がずれる。

const { openApp, connectApp, recordTrack, markBuffers, latestRecordedBuffer, SIGNALS } = require('../lib/harness');

async function measure(ctx, bpm, bars, takes) {
  const page = await openApp(ctx.browser, ctx.baseUrl, {
    signal: SIGNALS.tone(), captureBuffers: true,
  });
  await connectApp(page, { bpm });
  const ids = ['A', 'B', 'C', 'D'];
  const seen = [];
  for (let i = 0; i < takes; i++) {
    const id = ids[i % 4];
    await markBuffers(page);
    await recordTrack(page, id, bars);
    const buf = await latestRecordedBuffer(page);
    const expected = bars * 4 * 60 / bpm * buf.sampleRate;
    seen.push({ id, len: buf.length, expected, err: buf.length - expected, sr: buf.sampleRate });
    await page.click('#btnStop');
    await page.waitForTimeout(200);
  }
  await page.close();
  return seen;
}

module.exports = {
  name: 'ループ長の厳密さ',
  async run(ctx) {
    for (const [bpm, bars, takes] of [[120, 4, 3], [300, 1, 2]]) {
      const seen = await measure(ctx, bpm, bars, takes);
      const expected = seen[0].expected;
      ctx.info(`${bpm}BPM / ${bars}小節 → 理論値 ${expected} サンプル`);
      for (const s of seen) {
        ctx.info(`TRACK ${s.id}: ${s.len} サンプル (誤差 ${s.err >= 0 ? '+' : ''}${s.err})`);
      }
      ctx.check(
        `${bpm}BPM / ${bars}小節 が毎回ちょうど理論値`,
        seen.every((s) => s.err === 0),
        seen.map((s) => s.err).join(', ')
      );
    }
  },
};
