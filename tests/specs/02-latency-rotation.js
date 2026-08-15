'use strict';
// 録音補正が「意図した量だけ」バッファを回転させているかを確かめる。
//
// 補正は切り出したバッファを左回転して位相を合わせる方式なので、
// 回転量ぶんの位置に波形の継ぎ目(不連続点)ができる。
// その位置に継ぎ目があることを見れば、回転量を外から検証できる。
//
// 検証用の信号について(SIGNALS.spliceProbe):
//  ・440Hz は使えない。2 秒バッファに 880 周期ちょうど収まるため、回転しても
//    波形が連続のままで継ぎ目が出ない。非整数周期になる周波数を使う。
//  ・周波数の違う 2 音を足している。単一の正弦波だと継ぎ目前後の位相が
//    たまたま近いときに段差が消え、判定が運任せになる。
//
// 判定について:
//  ・「全体で最大の段差」を探してはいけない。テスト側の合成音は MediaStream の
//    10ms フレームで運ばれ、負荷が高いとフレームごと飛ばされる。飛んだ箇所にも
//    不連続ができるので、全体最大はそちらを拾うことがある(実際に -20908 サンプル
//    ずれた位置を拾って落ちた)。期待位置の近傍だけを見る。
//  ・クリーンな信号が取りうる隣接サンプル差には上限(各成分の最大傾きの和)が
//    あるので、それを超えていればそこに不連続があると断定できる。

const { openApp, connectApp, recordTrack, markBuffers, latestRecordedBuffer,
        jumpNear, SIGNALS } = require('../lib/harness');

// index.html の CAPTURE_GUARD_SEC と揃える(取りこぼし防止の先読み。回転で相殺される)
const CAPTURE_GUARD_SEC = 0.6;

module.exports = {
  name: 'レイテンシ補正の回転量',
  async run(ctx) {
    for (const offsetMs of [0, 100, 200]) {
      const page = await openApp(ctx.browser, ctx.baseUrl, {
        signal: SIGNALS.spliceProbe(), captureBuffers: true,
      });
      await connectApp(page, { bpm: 120 });
      await page.fill('#latencyInput', String(offsetMs));
      await page.dispatchEvent('#latencyInput', 'change');
      await markBuffers(page);
      await recordTrack(page, 'A', 1);   // 1小節 @120BPM = 2秒

      const buf = await latestRecordedBuffer(page);
      const guard = Math.round(CAPTURE_GUARD_SEC * buf.sampleRate);
      const expectedRotation = guard + Math.round(offsetMs / 1000 * buf.sampleRate);
      const expectedSplice = buf.length - expectedRotation;

      const near = await jumpNear(page, expectedSplice, 512);
      const maxSlope = SIGNALS.spliceProbeMaxSlope(buf.sampleRate);
      const ratio = near.jump / maxSlope;
      const diff = near.at - expectedSplice;

      ctx.info(`補正 ${offsetMs}ms: 期待位置 ${expectedSplice} の近傍で ` +
               `継ぎ目 ${near.at} (ずれ ${diff}) / 段差 ${near.jump.toFixed(3)} ` +
               `= 連続な信号の上限の ${ratio.toFixed(1)}倍`);
      ctx.check(
        `補正 ${offsetMs}ms で意図した量だけ回転している`,
        ratio > 2 && Math.abs(diff) <= 512,
        `段差比 ${ratio.toFixed(1)}倍 / ずれ ${diff} サンプル`
      );
      await page.close();
    }
  },
};
