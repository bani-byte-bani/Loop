'use strict';
// 重ね録りの整列。
//
// 他トラックが再生中のときは「その周回頭」から録音を始める、と UI が案内する。
// 以前はこの案内に反して直近の小節頭で始まっており、2 小節ループに対して
// 1 小節ぶんずれた位置から録れていた(待ち時間 0.68 秒 = ループ途中の小節頭)。
// 正しく整列していれば、待ち時間は参照ループの周期に届くまで伸びる。

const { openApp, connectApp, recordTrack, SIGNALS } = require('../lib/harness');

const durationOf = (page, id) =>
  page.$eval(`.track-row[data-track="${id}"] .track-dur`, (el) => el.textContent.trim());

module.exports = {
  name: '参照トラックの周回頭への整列',
  async run(ctx) {
    const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.tone() });
    await connectApp(page, { bpm: 300 });   // 1小節 = 0.8 秒

    // TRACK A を 2 小節(1.6 秒)録音して再生させる
    await recordTrack(page, 'A', 2);
    const durA = await durationOf(page, 'A');
    ctx.info(`TRACK A (2小節) = ${durA}`);

    // A の再生中に TRACK B を 1 小節で録音 → A の 1.6 秒周期の頭を待つはず
    await page.click('.track-row[data-track="B"]');
    await page.click('#barsSelect button[data-bars="1"]');
    const t0 = Date.now();
    await page.click('#btnRec');
    const armed = await page.$eval('#stateLine', (el) => el.textContent.trim());
    await page.waitForFunction(
      () => document.querySelector('.track-row[data-track="B"] .track-state-dot.rec') !== null,
      { timeout: 20000 }
    );
    const waited = (Date.now() - t0) / 1000;
    await page.waitForFunction(
      () => document.querySelector('.track-row[data-track="B"] .track-state-dot.play') !== null,
      { timeout: 20000 }
    );
    const durB = await durationOf(page, 'B');

    ctx.info(`待機中の案内: "${armed}"`);
    ctx.info(`録音開始までの待ち時間 ${waited.toFixed(2)} 秒 / TRACK B = ${durB}`);
    ctx.check('案内どおり参照トラックの周回頭を待つ',
      armed.includes('周回頭') && durA === '0:01:60' && durB === '0:00:80',
      `A=${durA} B=${durB} 待ち=${waited.toFixed(2)}秒`);

    await page.close();
  },
};
