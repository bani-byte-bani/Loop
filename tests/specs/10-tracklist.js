'use strict';
// TRACKS の固定長表示と再生ヘッド。
//
// ミニ波形は「常に最大小節数(8小節)ぶんの物差し」で描き、短いループは
// その枠内で繰り返される。2 小節なら 4 回、4 小節なら 2 回。
// ループの切れ目には枠線が入り、その間隔が --loop-pct に出る。

const { openApp, connectApp, recordTrack, SIGNALS } = require('../lib/harness');

module.exports = {
  name: 'TRACKS の固定長表示 / 再生ヘッド',
  async run(ctx) {
    const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.quarterPattern() });
    await connectApp(page, { bpm: 240 });

    await recordTrack(page, 'A', 2);   // 2小節 → 8小節の枠に 4 回
    await recordTrack(page, 'B', 4);   // 4小節 → 2 回

    const rows = await page.evaluate(() => {
      const out = {};
      for (const id of ['A', 'B', 'C']) {
        const el = document.querySelector(`.track-row[data-track="${id}"] .track-mini-bars`);
        const segs = el.querySelectorAll('span:not(.track-playhead)').length;
        out[id] = { segs, loopPct: parseFloat(el.style.getPropertyValue('--loop-pct')) };
      }
      return out;
    });
    ctx.info(`A: ${rows.A.segs}セグメント / ループ幅 ${rows.A.loopPct}%  (2小節→4回)`);
    ctx.info(`B: ${rows.B.segs}セグメント / ループ幅 ${rows.B.loopPct}%  (4小節→2回)`);
    ctx.check('2小節はループ幅25%(8小節に4回)', Math.abs(rows.A.loopPct - 25) < 0.01, `${rows.A.loopPct}%`);
    ctx.check('4小節はループ幅50%(8小節に2回)', Math.abs(rows.B.loopPct - 50) < 0.01, `${rows.B.loopPct}%`);
    ctx.check('波形は8分音符の粒度(64セグメント)', rows.A.segs === 64, `${rows.A.segs}`);

    // 再生ヘッドが表示され、位置が動くこと
    const samples = await page.evaluate(() => new Promise((res) => {
      const out = [];
      const t = setInterval(() => {
        const el = document.querySelector('.track-row[data-track="A"] .track-playhead');
        out.push({ on: el.classList.contains('on'), left: el.style.left });
        if (out.length >= 6) { clearInterval(t); res(out); }
      }, 200);
    }));
    const positions = new Set(samples.map((s) => s.left));
    ctx.info(`再生ヘッド: ${samples.map((s) => (s.on ? '' : 'off ') + s.left).join(' | ')}`);
    ctx.check('再生中に表示され位置が動く',
      samples.every((s) => s.on) && positions.size > 3, `${positions.size} 通りの位置`);

    await page.close();
  },
};
