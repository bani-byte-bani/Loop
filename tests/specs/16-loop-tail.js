'use strict';
// ループの末尾に「録音開始より前の音」が混ざっていないこと。
//
// 1周目の再生を締切ちょうどに始めるため、バッファは締切より前に組み立てる。
// そのとき末尾のごく一部はまだ取り込めていないので、以前は先読みガード
// (0.6秒)ぶん切り出し窓を過去へずらして埋めていた。演奏中の素材なら
// 1周期前と同じ音なので繋がるが、録音開始と同時に演奏を始めた場合、
// そこは演奏前の無音になる。実機で「録音の最後のほうが無音」と報告された。
//
// 検出方法:
//   周波数が上がり続ける掃引音を入れる。周波数がそのまま「いつの音か」を
//   表すので、末尾がすり替わっていれば末尾の周波数が先頭より低くなる。
//   正常なら末尾は先頭より高い。符号が反転するので判定は決定的。

const { openApp, connectApp, recordTrack, markBuffers, segmentFreq,
        SIGNALS } = require('../lib/harness');

const RATE = 100;   // Hz/秒

module.exports = {
  name: 'ループ末尾に録音開始前の音が混ざらない',
  async run(ctx) {
    for (const [bpm, bars] of [[120, 1], [240, 2]]) {
      const page = await openApp(ctx.browser, ctx.baseUrl, {
        signal: SIGNALS.risingChirp(200, RATE), captureBuffers: true,
      });
      await connectApp(page, { bpm });
      await markBuffers(page);
      await recordTrack(page, 'A', bars);
      // 末尾の差し替えが終わるのを待つ
      await page.waitForTimeout(500);

      const loopSec = bars * 4 * 60 / bpm;
      const segs = await segmentFreq(page, 10);
      const first = segs[0], last = segs[segs.length - 1];
      // 先頭から末尾までに上がるはずの量(区間の中心どうしの差)
      const expectedRise = RATE * loopSec * 0.9;
      const rise = last - first;

      ctx.info(`${bpm}BPM/${bars}小節 (${loopSec.toFixed(1)}秒): ` +
               `先頭 ${first.toFixed(0)}Hz → 末尾 ${last.toFixed(0)}Hz ` +
               `(上昇 ${rise.toFixed(0)}Hz / 期待 ${expectedRise.toFixed(0)}Hz)`);
      ctx.info(`  区間ごと: ${segs.map((f) => f.toFixed(0)).join(' ')}`);

      // 末尾がすり替わっていれば rise は負になる。正常なら期待値の8割以上。
      ctx.check(
        `${bpm}BPM/${bars}小節 の末尾が録音開始前の音になっていない`,
        rise > expectedRise * 0.8,
        `上昇 ${rise.toFixed(0)}Hz / 期待 ${expectedRise.toFixed(0)}Hz`
      );

      // 周波数が単調に上がっていること(途中に過去の音が挟まっていない)
      let monotonic = true;
      for (let i = 1; i < segs.length; i++) if (segs[i] < segs[i - 1] - 5) monotonic = false;
      ctx.check(`${bpm}BPM/${bars}小節 で周波数が単調に上がる`, monotonic,
                segs.map((f) => f.toFixed(0)).join(' '));
      await page.close();
    }
  },
};
