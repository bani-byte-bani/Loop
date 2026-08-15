'use strict';
// 切り出したバッファに欠落(無音の穴)が無いことを確かめる。
//
// 途切れない正弦波を入力しているので、取り込めていない箇所だけが
// 厳密にゼロとして残る。補正を大きくしても埋まっているか、
// つまり先読み(ガード)が足りているかの検証でもある。
//
// 判定の考え方:
//  ・先頭と末尾は厳密に見る。先読み不足や回転のずれは必ずここに大きく出る
//  ・中央の散発的な欠落は許容する。テスト側の合成音声は
//    「別の AudioContext → MediaStream → getUserMedia → アプリ」という
//    実時間経路を通るため、負荷が高いと取りこぼす。実機のマイク入力は
//    オーディオデバイスから直接ワークレットへ入るので、この経路を通らない。
//
//    テスト環境由来であることは実測で確認済み:
//      ・欠落の最長が毎回きっちり 10.0ms。これは MediaStream の音声フレーム長
//        そのもので、フレーム単位で丸ごと落ちていることを意味する
//      ・単独実行では 0.000%(3回とも)。全スイート同時実行時のみ出る
//
//  ・そこで「1回の欠落の長さ」を主判定にする。先読み不足のような構造的な穴は
//    数百ms規模の連続した無音になるので、フレーム 3 つぶん(30ms)を超えない
//    ことを見れば確実に区別できる。総量の割合は補助的な上限として残す。

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
        maxGapMs < 30 && silentPct < 2,
        `長さ誤差 ${buf.length - expected} / 無音 ${silentPct.toFixed(3)}% / 最長 ${maxGapMs.toFixed(1)}ms`
      );
      await page.close();
    }
  },
};
