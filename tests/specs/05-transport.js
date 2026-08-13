'use strict';
// 録音まわりの基本動作。
//
// ・録音中に別トラックを選んでもループが尻切れにならないこと
//   (取り込み判定が「選択中トラック」基準だった頃は 0.8 秒のループが
//    0.05 秒しか録れていなかった)
// ・録音バッファは全トラック共有なので、同時録音を拒否して理由を表示すること

const { openApp, connectApp, SIGNALS } = require('../lib/harness');

const durationOf = (page, id) =>
  page.$eval(`.track-row[data-track="${id}"] .track-dur`, (el) => el.textContent.trim());

const toSeconds = (text) => {
  const m = text.match(/^(\d+):(\d+):(\d+)$/);
  return m ? (+m[1]) * 60 + (+m[2]) + (+m[3]) / 100 : 0;
};

module.exports = {
  name: '録音の尻切れ / 同時録音ガード',
  async run(ctx) {
    const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.tone() });
    await connectApp(page, { bpm: 300 });   // 1小節 = 0.8 秒

    await page.click('#barsSelect button[data-bars="1"]');
    await page.click('#btnRec');
    await page.waitForFunction(
      () => document.querySelector('.track-row[data-track="A"] .track-state-dot.rec') !== null,
      { timeout: 20000 }
    );
    // ★ 録音中に別トラックへ切り替える(これで取り込みが止まっていた)
    await page.click('.track-row[data-track="B"]');
    await page.waitForFunction(
      () => document.querySelector('.track-row[data-track="A"] .track-state-dot.play') !== null,
      { timeout: 20000 }
    );

    const dur = toSeconds(await durationOf(page, 'A'));
    ctx.info(`録音中にトラック切替 → TRACK A の長さ ${dur} 秒 (理論値 0.80 秒)`);
    ctx.check('録音中にトラックを切り替えても尻切れしない', dur >= 0.75 && dur <= 0.85, `${dur} 秒`);

    // 同時録音の拒否
    await page.click('.track-row[data-track="B"]');
    await page.click('#btnRec');                       // B を録音待機に
    await page.click('.track-row[data-track="C"]');
    await page.click('#btnRec');                       // C は断られるはず
    const line = await page.$eval('#stateLine', (el) => el.textContent.trim());
    ctx.info(`2本目のREC時のメッセージ: "${line}"`);
    ctx.check('同時録音を拒否して理由が画面に出る', line.includes('録音中/録音待機中'), line);

    ctx.check('page error なし', page.pageErrors.length === 0, page.pageErrors.join(' / '));
    await page.close();
  },
};
