'use strict';
// 切り出したバッファに欠落(無音の穴)が無いことを確かめる。
//
// 途切れない正弦波を入力しているので、取り込めていない箇所だけが
// 厳密にゼロとして残る。補正を大きくしても埋まっているか、
// つまり先読み(ガード)が足りているかの検証でもある。
//
// 判定の考え方:
//  ・先頭と末尾は厳密に見る。先読み不足や回転のずれは必ずここに大きく出る
//  ・中央の散発的な数ms は許容する。テスト側の合成音声は
//    「別の AudioContext → MediaStream → アプリ」という実時間経路を通るため、
//    headless では稀に途切れる。実機のマイク入力はこの経路を通らない。
//    構造的な穴なら無音の総量が跳ね上がるので、割合で判定すれば取りこぼさない。

const { openApp, connectApp, recordTrack, markBuffers, latestRecordedBuffer, SIGNALS } = require('../lib/harness');

module.exports = {
  name: '取り込みの欠落',
  async run(ctx) {
    // 録音補正・再生補正それぞれの最大付近まで振って確かめる
    for (const [recMs, playMs, bars] of [[0, 0, 4], [100, 0, 1], [500, 300, 4]]) {
      const page = await openApp(ctx.browser, ctx.baseUrl, {
        signal: SIGNALS.tone(443.3, 1.0), captureBuffers: true,
      });
      await connectApp(page, { bpm: 120 });
      await page.fill('#latencyInput', String(recMs));
      await page.dispatchEvent('#latencyInput', 'change');
      await page.fill('#playbackInput', String(playMs));
      await page.dispatchEvent('#playbackInput', 'change');
      await markBuffers(page);
      await recordTrack(page, 'A', bars);

      const buf = await latestRecordedBuffer(page);
      const expected = Math.round(bars * 4 * 60 / 120 * buf.sampleRate);
      const silentPct = buf.silentSamples / buf.length * 100;
      const maxGapMs = buf.maxGapRun / buf.sampleRate * 1000;
      ctx.info(`録音補正${recMs}ms / 再生補正${playMs}ms / ${bars}小節: 長さ${buf.length} ` +
               `先頭ゼロ${buf.leadingZeros} 末尾ゼロ${buf.trailingZeros} ` +
               `無音${silentPct.toFixed(3)}% (最長${maxGapMs.toFixed(1)}ms / ${buf.gapRuns}箇所)`);
      ctx.check(
        `録音補正${recMs}ms・再生補正${playMs}ms で構造的な欠落なし・長さも正確`,
        buf.length === expected &&
        buf.leadingZeros < 256 && buf.trailingZeros < 256 &&
        silentPct < 0.5 && maxGapMs < 50,
        `長さ誤差 ${buf.length - expected} / 無音 ${silentPct.toFixed(3)}% / 最長 ${maxGapMs.toFixed(1)}ms`
      );
      await page.close();
    }
  },
};
