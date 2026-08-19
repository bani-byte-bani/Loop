'use strict';
// 録音補正が「意図した量だけ」バッファをずらしているかを確かめる。
//
// 1周目は締切より前に組み立てる必要があるため、まだ取り込めていない末尾のぶんだけ
// 切り出し窓を過去へずらし、その量を左回転で戻している。回転させた位置には
// 波形の継ぎ目(不連続点)ができるので、その位置を測ればずらし量を検証できる。
//
// 回転量 = (まだ取り込めていない量) + (録音補正)
// 前者は実行ごとに変わるのでアプリのログから読み取り、後者はテストが指定した値を使う。
// これで「録音補正が意図した量だけ効いているか」を切り分けて確かめられる。
//
// さらに、取り込みが追いついた後の差し替えで継ぎ目が消えることも確認する。
// 差し替え後は回転の要らない窓で切り直すので、ループ内に不連続点は残らない。
//
// 検証用信号について(SIGNALS.spliceProbe):
//  ・440Hz は使えない。2秒バッファに880周期ちょうど収まり、回転しても連続のまま。
//  ・周波数の違う2音を足している。単音だと継ぎ目前後の位相がたまたま近いときに
//    段差が消え、判定が運任せになる。
//  ・継ぎ目は「全体の最大段差」で探してはいけない。MediaStream のフレーム落ちが
//    起きた箇所にも不連続ができるため。期待位置の近傍だけを見る(jumpNear)。

const { openApp, connectApp, recordTrack, markBuffers, latestRecordedBuffer,
        jumpNear, SIGNALS } = require('../lib/harness');

module.exports = {
  name: 'レイテンシ補正のずらし量',
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

      // 差し替えが走る前に、回転済みの1周目を見る
      const buf = await latestRecordedBuffer(page);
      const maxSlope = SIGNALS.spliceProbeMaxSlope(buf.sampleRate);

      // まだ取り込めていなかった量はアプリのログに出る
      const line = page.consoleLogs.find((l) => l.includes('Tail not yet captured'));
      const deficit = parseInt((line || '').match(/captured: (\d+)/)?.[1] ?? '-1', 10);
      const rotation = deficit + Math.round(offsetMs / 1000 * buf.sampleRate);
      const expectedSplice = buf.length - rotation;

      const near = await jumpNear(page, expectedSplice, 512);
      const ratio = near.jump / maxSlope;
      const diff = near.at - expectedSplice;

      ctx.info(`補正 ${offsetMs}ms: 未取り込み ${deficit} + 補正 ${rotation - deficit} = ずらし ${rotation}`);
      ctx.info(`  期待位置 ${expectedSplice} の近傍に継ぎ目 ${near.at} (ずれ ${diff}) / ` +
               `段差は連続な信号の上限の ${ratio.toFixed(1)}倍`);
      ctx.check(
        `補正 ${offsetMs}ms で意図した量だけずれている`,
        deficit > 0 && ratio > 2 && Math.abs(diff) <= 512,
        `段差比 ${ratio.toFixed(1)}倍 / ずれ ${diff} サンプル`
      );

      // 差し替え後は継ぎ目が消えていること
      await page.waitForTimeout(800);
      const repaired = page.consoleLogs.some((l) => l.includes('Loop tail repaired'));
      const after = await jumpNear(page, expectedSplice, 512);
      const afterRatio = after.jump / maxSlope;
      ctx.info(`  差し替え${repaired ? 'あり' : 'なし'} → 同じ位置の段差は上限の ${afterRatio.toFixed(1)}倍`);
      ctx.check(
        `補正 ${offsetMs}ms で差し替え後に継ぎ目が消える`,
        repaired && afterRatio < 2,
        `段差比 ${afterRatio.toFixed(1)}倍`
      );
      await page.close();
    }
  },
};
