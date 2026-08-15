'use strict';
// チューナーの音程検出と、入力チャンネル選択。
//
// 自己相関は周期の整数倍のラグにもピークが立つため、単純に最大値を採ると
// オクターブ下を誤検出する(実際に 440Hz を 62.8Hz と判定していた)。
// 「最大値の 9 割を超える最初のピーク」を採る実装が効いているかを、
// 既知の周波数を入れて cent 単位の誤差で確かめる。

const { openApp, connectApp, SIGNALS } = require('../lib/harness');

async function detect(ctx, freq, channel) {
  const page = await openApp(ctx.browser, ctx.baseUrl, { signal: SIGNALS.leftOnly(freq) });
  await connectApp(page, { bpm: 120, inputChannel: channel });
  await page.click('#tunerToggle');
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({
    note: document.getElementById('tunerNote').textContent,
    cents: document.getElementById('tunerCents').textContent,
    hz: parseFloat(document.getElementById('tunerHz').textContent) || 0,
  }));
  await page.close();
  return r;
}

module.exports = {
  name: 'チューナー / 入力チャンネル',
  async run(ctx) {
    // ギターの開放弦を中心に、低音から高音まで
    for (const freq of [82.41, 110, 220, 329.63, 440, 659.25]) {
      const r = await detect(ctx, freq, 'stereo');
      const err = r.hz ? 1200 * Math.log2(r.hz / freq) : NaN;
      ctx.info(`${freq}Hz → ${r.note} ${r.cents} / ${r.hz}Hz`);
      ctx.check(`${freq}Hz を誤差15cent以内で検出`, Math.abs(err) < 15,
        isNaN(err) ? '検出なし' : `${err.toFixed(1)} cent`);
    }

    // L だけに音がある信号なので、R を選ぶと検出されないはず
    const left = await detect(ctx, 440, 'left');
    const right = await detect(ctx, 440, 'right');
    const mono = await detect(ctx, 440, 'mono');
    ctx.info(`L=${left.hz}Hz / R=${right.hz}Hz / L+R=${mono.hz}Hz`);
    ctx.check('入力チャンネル選択が効いている(Rは無音なので検出なし)',
      left.hz > 0 && right.hz === 0 && mono.hz > 0,
      `L=${left.hz} R=${right.hz} mono=${mono.hz}`);
  },
};
