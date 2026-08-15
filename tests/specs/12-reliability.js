'use strict';
// ステージでの堅牢性。実際に異常を起こして復帰・検出を確かめる。
//
// ・外部クロックのケーブルが抜けた状況(パルスが来なくなるだけ)を検出できるか
// ・AudioContext が止められたときに自動で復帰するか
// ・MIDI の権限プロンプトが放置されても設定画面から進めるか

const { openApp, connectApp, SIGNALS } = require('../lib/harness');

module.exports = {
  name: 'クロック断 / AudioContext復帰 / MIDIタイムアウト',
  async run(ctx) {
    // --- MIDI 権限が解決しないケース ---
    {
      const page = await openApp(ctx.browser, ctx.baseUrl, { midiHang: true });
      await page.click('#syncModeToggle button[data-mode="standalone"]');
      const t0 = Date.now();
      await page.click('#btnGrant');
      let advanced = true;
      try { await page.waitForSelector('#btnConnect:not(.hidden)', { timeout: 15000 }); }
      catch (e) { advanced = false; }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const msg = await page.$eval('#errorLine', (el) => el.textContent.trim()).catch(() => '');
      ctx.info(`権限プロンプト放置: ${advanced ? `${secs}秒で先へ進めた` : '進めないまま'} / "${msg}"`);
      ctx.check('MIDI権限が返らなくても設定画面で止まらない', advanced && msg.includes('MIDI'), `${secs}秒`);
      await page.close();
    }

    // --- 外部クロックの断線 / AudioContext の復帰 ---
    {
      const page = await openApp(ctx.browser, ctx.baseUrl, {
        signal: SIGNALS.tone(),
        midiInputs: [{ id: 'stub', name: 'STUB MIDI' }],
        exposeCtx: true,
      });
      await connectApp(page, { mode: 'external', midiInput: 'stub' });

      // クロックを流して running にする
      await page.evaluate(async () => {
        for (let i = 0; i < 120; i++) {
          window.__midiInputs.stub.onmidimessage({ data: [0xF8] });
          await new Promise((r) => setTimeout(r, 5));
        }
      });
      const ledWhileRunning = await page.$eval('#syncLed', (el) => el.classList.contains('on'));
      // 供給を止めて放置(= ケーブルが抜けた状態)
      await page.waitForTimeout(2200);
      const ledAfter = await page.$eval('#syncLed', (el) => el.classList.contains('on'));
      const line = await page.$eval('#stateLine', (el) => el.textContent.trim());
      ctx.info(`クロック供給中LED=${ledWhileRunning ? '点灯' : '消灯'} → 停止2.2秒後=${ledAfter ? '点灯' : '消灯'} / "${line}"`);
      ctx.check('クロック断を検出して知らせる',
        ledWhileRunning && !ledAfter && line.includes('途切れ'), line);

      // AudioContext を止めて自動復帰するか
      await page.evaluate(() => window.__ctx.suspend());
      await page.waitForTimeout(1200);
      const state = await page.evaluate(() => window.__ctx.state);
      ctx.info(`AudioContext suspend 後の状態: ${state}`);
      ctx.check('AudioContext が自動で復帰する', state === 'running', state);
      await page.close();
    }
  },
};
