'use strict';
// MIDIトランスポート(Start / Continue / Stop)への追従。
//
// 以前はクロック(0xF8)だけを見ており、Stop は running を倒すだけ、
// Start は pulseCount を0に戻すだけだった。そのため
//  ・マスターを止めてもループが鳴り続ける
//  ・Start しても各トラックの基準パルスが取り残され、録音の整列がずれる
// という状態だった。ここでは実際に再生が止まる/戻ることを状態から確かめる。

const { openApp, connectApp, SIGNALS } = require('../lib/harness');

// 外部クロックを一定量流す。テンポ推定の窓(1小節=96)を埋めるためにも使う
async function pulses(page, count, bpm = 240) {
  await page.evaluate(async (o) => {
    const period = 60000 / o.bpm / 24;
    for (let i = 0; i < o.count; i++) {
      window.__midiInputs.stub.onmidimessage({ data: [0xF8], timeStamp: performance.now() });
      await new Promise((r) => setTimeout(r, period));
    }
  }, { count, bpm });
}

const send = (page, byte) =>
  page.evaluate((b) => window.__midiInputs.stub.onmidimessage({ data: [b] }), byte);

// トラックの見た目の状態(再生中かどうか)は状態ドットで判る
function trackStates(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.track-row').forEach((row) => {
      const dot = row.querySelector('.track-state-dot');
      out[row.dataset.track] = dot ? dot.className.replace('track-state-dot', '').trim() : '';
    });
    return out;
  });
}

module.exports = {
  name: 'MIDIのStart/Stopで再生が同期する',
  async run(ctx) {
    const page = await openApp(ctx.browser, ctx.baseUrl, {
      signal: SIGNALS.tone(220, 0.5),
      midiInputs: [{ id: 'stub', name: 'STUB MIDI' }],
      exposeCtx: true,
    });
    await connectApp(page, { mode: 'external', midiInput: 'stub' });

    // クロックを流してテンポを確定させ、1小節ぶん録る
    await send(page, 0xFA);
    await pulses(page, 120, 240);
    await page.click('.track-row[data-track="A"]');
    await page.click('#barsSelect button[data-bars="1"]');
    await page.click('#btnRec');
    // 240BPM/1小節 = 1秒。待機ぶんを含めて余裕をもってクロックを供給する
    await pulses(page, 240, 240);

    const playing = await trackStates(page);
    ctx.info(`録音後の状態: A=${playing.A}`);
    ctx.check('録音後はループ再生に入っている', playing.A === 'play', playing.A);

    // --- Stop で止まること ---
    await send(page, 0xFC);
    await page.waitForTimeout(200);
    const stopped = await trackStates(page);
    const ledAfterStop = await page.$eval('#syncLed', (el) => el.classList.contains('on'));
    ctx.info(`Stop後: A=${stopped.A} / SYNC LED=${ledAfterStop ? '点灯' : '消灯'}`);
    ctx.check('MIDI Stop で再生が止まる', stopped.A !== 'play', stopped.A);
    ctx.check('MIDI Stop で同期表示も落ちる', ledAfterStop === false);

    // --- Continue で戻ること ---
    await send(page, 0xFB);
    await page.waitForTimeout(200);
    const resumed = await trackStates(page);
    ctx.info(`Continue後: A=${resumed.A}`);
    ctx.check('MIDI Continue で再生が戻る', resumed.A === 'play', resumed.A);

    // --- Start は小節の基準を先頭に戻すこと ---
    await pulses(page, 50, 240);
    await send(page, 0xFA);
    await page.waitForTimeout(200);
    const afterStart = await trackStates(page);
    ctx.info(`Start後: A=${afterStart.A}`);
    ctx.check('MIDI Start でも再生が続く', afterStart.A === 'play', afterStart.A);

    ctx.check('page error なし', page.pageErrors.length === 0, page.pageErrors.join(' / '));
    await page.close();
  },
};
