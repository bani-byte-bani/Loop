'use strict';
// キーマッピング一覧の表示。
//
// 記号キー(" < &)を割り当てると、以前は data-key 属性の中で
// HTML が壊れて " のマッピングが消え、削除ボタンも効かなくなっていた。

const { openApp, connectApp, SIGNALS } = require('../lib/harness');

module.exports = {
  name: '記号キーのマッピング',
  async run(ctx) {
    const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.tone() });
    // 記号キーを含む設定を仕込んでから読み込ませる
    await page.evaluate(() => {
      localStorage.setItem('syncLooperKeyMappings', JSON.stringify({
        '"': 'panic', '<': 'transport:rec:A', '&': 'transport:play:B',
      }));
    });
    await page.reload();
    await page.waitForTimeout(300);
    await connectApp(page, { bpm: 120 });
    await page.evaluate(() => { document.getElementById('keyMappingsCard').open = true; });
    await page.waitForTimeout(150);

    const before = await page.$$eval('#keyMappingsList .mapping-row', (els) => els.length);
    const keys = await page.$$eval('#keyMappingsList .mapping-remove', (els) => els.map((e) => e.dataset.key));
    const symbols = keys.filter((k) => ['"', '<', '&'].includes(k));
    ctx.info(`行数 ${before} / 復元できた記号キー ${JSON.stringify(symbols)}`);
    ctx.check('記号キーが失われず往復する', symbols.length === 3, symbols.join(','));

    await page.click('#keyMappingsList .mapping-remove[data-key="<"]');
    await page.waitForTimeout(200);
    const after = await page.$$eval('#keyMappingsList .mapping-row', (els) => els.length);
    ctx.check('記号キーの削除ボタンが機能する', after === before - 1, `${before} → ${after}`);
    await page.close();
  },
};
