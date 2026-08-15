'use strict';
// ミキサー(音量 / ミュート)、CLEAR の取り消し、入力レベルメーター、
// 重ね録り、WAV 書き出し。

const { openApp, connectApp, recordTrack, SIGNALS } = require('../lib/harness');

module.exports = {
  name: 'ミキサー / CLEAR取消 / 重ね録り / 書き出し',
  async run(ctx) {
    const page = await openApp(ctx.browser, ctx.baseUrl, {
      signal: SIGNALS.tone(330, 0.4), captureBuffers: true, viewport: { width: 1400, height: 1000 },
    });
    await connectApp(page, { bpm: 240 });
    await recordTrack(page, 'A', 1);

    // --- 音量 / ミュート。ミキサー操作でトラック選択が飛ばないこと ---
    await page.click('.track-row[data-track="B"]');            // いったん B を選択
    await page.$eval('.track-row[data-track="A"] .track-vol', (el) => {
      el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('.track-row[data-track="A"] .track-mute');
    await page.waitForTimeout(200);
    const mix = await page.evaluate(() => ({
      muted: document.querySelector('.track-row[data-track="A"] .track-mute').classList.contains('on'),
      vol: document.querySelector('.track-row[data-track="A"] .track-vol').value,
      selected: document.querySelector('.track-row.selected').dataset.track,
    }));
    ctx.info(`音量=${mix.vol}% / ミュート=${mix.muted ? 'ON' : 'OFF'} / 選択トラック=${mix.selected}`);
    ctx.check('音量とミュートが操作できる', mix.muted && mix.vol === '40');
    ctx.check('ミキサー操作でトラック選択が飛ばない', mix.selected === 'B', `選択=${mix.selected}`);
    await page.click('.track-row[data-track="A"] .track-mute');   // 解除

    // --- 入力レベルメーター ---
    await page.waitForTimeout(400);
    const meter = parseFloat(await page.$eval('#inMeterFill', (el) => el.style.width)) || 0;
    ctx.info(`入力メーター幅 ${meter}%`);
    ctx.check('入力レベルを表示している', meter > 5, `${meter}%`);

    // --- CLEAR の取り消し ---
    await page.click('.track-row[data-track="A"] .track-letter');
    const undoBefore = await page.$eval('#btnUndoClear', (el) => el.disabled);
    await page.click('#btnClear');
    await page.waitForTimeout(200);
    const cleared = await page.evaluate(() => ({
      empty: document.querySelector('.track-row[data-track="A"] .track-meta span').textContent.includes('EMPTY'),
      undoEnabled: !document.getElementById('btnUndoClear').disabled,
    }));
    await page.click('#btnUndoClear');
    await page.waitForTimeout(200);
    const restored = await page.evaluate(() => ({
      back: !document.querySelector('.track-row[data-track="A"] .track-meta span').textContent.includes('EMPTY'),
      undoEnabled: !document.getElementById('btnUndoClear').disabled,
    }));
    ctx.info(`消去前ボタン=${undoBefore ? '無効' : '有効'} / 消去後=${cleared.empty ? 'EMPTY' : '?'} / 復元=${restored.back ? '成功' : '失敗'}`);
    ctx.check('CLEARを取り消して復元できる',
      undoBefore && cleared.empty && cleared.undoEnabled && restored.back && !restored.undoEnabled);

    // --- 重ね録り。既存ループと同じ長さのまま合成されること ---
    await page.click('#btnPlay');
    await page.waitForFunction(
      () => document.querySelector('.track-row[data-track="A"] .track-state-dot.play') !== null,
      { timeout: 20000 }
    );
    const durBefore = await page.$eval('.track-row[data-track="A"] .track-dur', (el) => el.textContent.trim());
    const logMark = page.consoleLogs.length;
    await page.click('#btnRec');                       // 再生中の REC = 重ね録り
    await page.waitForFunction(() => document.getElementById('lcdTag').textContent === 'OVER', { timeout: 20000 });
    const overLine = await page.$eval('#stateLine', (el) => el.textContent.trim());
    await page.waitForFunction(() => document.getElementById('lcdTag').textContent === 'PLAY', { timeout: 25000 });
    await page.waitForTimeout(250);
    const durAfter = await page.$eval('.track-row[data-track="A"] .track-dur', (el) => el.textContent.trim());
    const mergedLog = page.consoleLogs.slice(logMark).some((l) => l.includes('Overdub merged'));
    ctx.info(`重ね録り: "${overLine}" / 長さ ${durBefore} → ${durAfter} / 合成ログ=${mergedLog ? 'あり' : 'なし'}`);
    ctx.check('重ね録りが元と同じ長さのまま合成される',
      mergedLog && durBefore === durAfter && overLine.includes('重ね録り'),
      `${durBefore} → ${durAfter}`);

    // --- WAV 書き出し ---
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.click('#btnExportWav');
    const file = await dl;
    ctx.info(`WAV: ${file ? file.suggestedFilename() : '(ダウンロードされず)'}`);
    ctx.check('WAVで書き出せる', !!file && /\.wav$/.test(file.suggestedFilename()));

    ctx.check('page error なし', page.pageErrors.length === 0, page.pageErrors.join(' / '));
    await page.close();
  },
};
