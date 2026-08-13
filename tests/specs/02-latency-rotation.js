'use strict';
// 録音補正が「意図した量だけ」バッファを回転させているかを確かめる。
//
// 補正は切り出したバッファを左回転して位相を合わせる方式なので、
// 回転量ぶんの位置に波形の継ぎ目(不連続点)ができる。
// その位置を測れば回転量を外から検証できる。
//
// 注意: 検証用の正弦波は 440Hz にしてはいけない。
// 2 秒バッファに 880 周期ちょうど収まってしまい、回転しても波形が連続のままで
// 継ぎ目が出ない。443.3Hz のように非整数周期になる周波数を使う。

const { openApp, connectApp, recordTrack, markBuffers, latestRecordedBuffer, SIGNALS } = require('../lib/harness');

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
      const diff = buf.spliceAt - expectedSplice;

      ctx.info(`補正 ${offsetMs}ms: 継ぎ目 実測 ${buf.spliceAt} / 期待 ${expectedSplice} (段差 ${buf.worstJump.toFixed(2)})`);
      ctx.check(
        `補正 ${offsetMs}ms で意図した量だけ回転している`,
        Math.abs(diff) <= 256 && buf.worstJump > 0.2,
        `差分 ${diff} サンプル`
      );
      await page.close();
    }
  },
};
