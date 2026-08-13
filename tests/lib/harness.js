'use strict';
// LOOP CONSOLE の E2E テスト共通処理。
// 実際にブラウザでアプリを動かし、合成した音を録音させて結果を数値で確かめる。

const fs = require('fs');
const { chromium } = require('playwright');

// フェイクの音声デバイスを使い、自動再生の制限も外す
const LAUNCH_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

// Chromium の場所は環境によって違う。指定 → 既定 → 既知のパス の順に試す
const FALLBACK_CHROMIUM = ['/opt/pw-browsers/chromium'];

async function launchBrowser() {
  const explicit = process.env.LOOP_TEST_CHROMIUM;
  if (explicit) return chromium.launch({ args: LAUNCH_ARGS, executablePath: explicit });
  try {
    return await chromium.launch({ args: LAUNCH_ARGS });
  } catch (err) {
    for (const p of FALLBACK_CHROMIUM) {
      if (fs.existsSync(p)) return chromium.launch({ args: LAUNCH_ARGS, executablePath: p });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 入力信号。getUserMedia を差し替えて、検証したい性質を持つ音をアプリに流し込む。
// ページ側で評価される関数なので、外の変数は引数経由でしか渡せない点に注意。
// ---------------------------------------------------------------------------
const SIGNALS = {
  // 途切れない正弦波。取り込みの欠落があれば厳密にゼロの区間として現れる
  tone(freq = 330, gain = 0.4) {
    return { kind: 'tone', freq, gain };
  },
  // バッファ長と非整数周期になる正弦波。
  // 440Hz は 2 秒バッファに 880 周期ちょうど収まってしまい、回転させても
  // 波形が連続のままで継ぎ目を検出できない。
  spliceProbe() {
    return { kind: 'tone', freq: 443.3, gain: 1.0 };
  },
  // 立ち上がりの鋭いバーストを一定間隔で。オンセット検出の確認に使う
  burstTrain(periodSec = 0.5, burstSec = 0.02, freq = 880) {
    return { kind: 'burst', periodSec, burstSec, freq };
  },
  // 1 周を「強→弱→中→無音」に分けた信号。波形表示の繰り返しが目で追える
  quarterPattern(periodSec = 0.5, freq = 300) {
    return { kind: 'quarters', periodSec, freq };
  },
  // L だけに音を入れる。入力チャンネル選択が効いているかの確認に使う
  leftOnly(freq = 440) {
    return { kind: 'leftOnly', freq };
  },
};

function installSignal(spec) {
  // ページ内で実行される。spec は構造化クローンで渡る
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const sr = ctx.sampleRate;

    if (spec.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.frequency.value = spec.freq;
      const g = ctx.createGain();
      g.gain.value = spec.gain;
      osc.connect(g); g.connect(dest); osc.start();
    } else if (spec.kind === 'leftOnly') {
      const osc = ctx.createOscillator();
      osc.frequency.value = spec.freq;
      const merger = ctx.createChannelMerger(2);
      const silent = ctx.createGain(); silent.gain.value = 0;
      const other = ctx.createOscillator(); other.frequency.value = 100;
      other.connect(silent);
      osc.connect(merger, 0, 0);
      silent.connect(merger, 0, 1);
      merger.connect(dest);
      osc.start(); other.start();
    } else if (spec.kind === 'burst' || spec.kind === 'quarters') {
      const period = Math.round(sr * spec.periodSec);
      const buf = ctx.createBuffer(1, period, sr);
      const d = buf.getChannelData(0);
      if (spec.kind === 'burst') {
        const burst = Math.round(sr * spec.burstSec);
        for (let i = 0; i < burst; i++) {
          d[i] = Math.sin(2 * Math.PI * spec.freq * i / sr) * (1 - i / burst);
        }
      } else {
        const amps = [1.0, 0.35, 0.65, 0.0];
        for (let k = 0; k < 4; k++) {
          const s0 = Math.floor(period * k / 4), s1 = Math.floor(period * (k + 1) / 4);
          for (let i = s0; i < s1; i++) d[i] = Math.sin(2 * Math.PI * spec.freq * i / sr) * amps[k];
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.connect(dest); src.start();
    }
    return dest.stream;
  };
}

// ---------------------------------------------------------------------------
// ページの用意
// ---------------------------------------------------------------------------

/**
 * アプリを開く。接続はまだ行わない。
 * opts.signal     : SIGNALS.* の戻り値。省略時はブラウザのフェイクデバイス
 * opts.midiInputs : [{ id, name }] を渡すと、その MIDI 入力があるように見せる
 * opts.midiHang   : true で requestMIDIAccess が永久に解決しなくなる
 * opts.captureBuffers : createBuffer を記録して window.__bufs に貯める
 * opts.captureStarts  : ループ再生の start(when) を window.__starts に貯める
 * opts.captureOsc     : クリック音などの OscillatorNode.start を window.__osc に貯める
 * opts.exposeCtx      : 生成された AudioContext を window.__ctx に置く
 */
async function openApp(browser, baseUrl, opts = {}) {
  const page = await browser.newPage(
    opts.viewport ? { viewport: opts.viewport } : {}
  );
  const pageErrors = [];
  const logs = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => logs.push(m.text()));

  await page.addInitScript((o) => {
    // Web MIDI は headless では権限プロンプトが解決しないため常に差し替える
    if (o.midiHang) {
      navigator.requestMIDIAccess = () => new Promise(() => {});
    } else {
      const inputs = new Map();
      for (const spec of (o.midiInputs || [])) {
        const input = { id: spec.id, name: spec.name, onmidimessage: null };
        inputs.set(spec.id, input);
        window.__midiInputs = window.__midiInputs || {};
        window.__midiInputs[spec.id] = input;
      }
      navigator.requestMIDIAccess = () => Promise.resolve({ inputs });
    }

    if (o.signal) {
      // installSignal の本体を文字列で受け取って復元する
      (new Function('spec', o.installSignalSrc))(o.signal);
    }

    if (o.captureBuffers) {
      window.__bufs = [];
      const orig = AudioContext.prototype.createBuffer;
      AudioContext.prototype.createBuffer = function (...a) {
        const b = orig.apply(this, a);
        window.__bufs.push(b);
        return b;
      };
    }
    if (o.captureStarts) {
      window.__starts = [];
      const orig = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when) {
        if (this.buffer && this.loop) {
          window.__starts.push({ when, now: this.context.currentTime });
        }
        return orig.apply(this, arguments);
      };
    }
    if (o.captureOsc) {
      window.__osc = [];
      const orig = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (when) {
        window.__osc.push({ when, freq: this.frequency.value, now: this.context.currentTime });
        return orig.apply(this, arguments);
      };
    }
    if (o.exposeCtx) {
      const Orig = window.AudioContext;
      window.AudioContext = function (...a) { const c = new Orig(...a); window.__ctx = c; return c; };
      window.AudioContext.prototype = Orig.prototype;
    }
  }, {
    ...opts,
    installSignalSrc: opts.signal
      ? installSignal.toString().replace(/^function installSignal\(spec\)\s*\{/, '').replace(/\}\s*$/, '')
      : null,
  });

  await page.goto(baseUrl + '/index.html');
  await page.waitForTimeout(250);
  page.pageErrors = pageErrors;
  page.consoleLogs = logs;
  return page;
}

/** 設定画面で同期モード等を選び、パフォーマンス画面まで進める */
async function connectApp(page, opts = {}) {
  const mode = opts.mode || 'standalone';
  await page.click(`#syncModeToggle button[data-mode="${mode}"]`);
  if (mode === 'standalone') await page.fill('#bpmSetupInput', String(opts.bpm || 120));
  await page.click('#btnGrant');
  await page.waitForSelector('#btnConnect:not(.hidden)', { timeout: 20000 });
  if (opts.inputChannel) await page.selectOption('#inputChannelSelect', opts.inputChannel);
  if (opts.midiInput) await page.selectOption('#midiSelect', opts.midiInput);
  await page.click('#btnConnect');
  await page.waitForSelector('#performPanel:not(.hidden)', { timeout: 20000 });
}

/** 録音して再生が始まるまで待つ */
async function recordTrack(page, id = 'A', bars = null, timeout = 40000) {
  await page.click(`.track-row[data-track="${id}"]`);
  if (bars) await page.click(`#barsSelect button[data-bars="${bars}"]`);
  await page.click('#btnRec');
  await page.waitForFunction(
    (t) => document.querySelector(`.track-row[data-track="${t}"] .track-state-dot.play`) !== null,
    id, { timeout }
  );
}

/** 録音で新しく作られたバッファのうち、最後の(=全処理を終えた)ものを取る */
async function markBuffers(page) {
  await page.evaluate(() => { window.__mark = window.__bufs.length; });
}
async function latestRecordedBuffer(page) {
  return page.evaluate(() => {
    const added = window.__bufs.slice(window.__mark);
    if (!added.length) return null;
    const maxLen = Math.max(...added.map((b) => b.length));
    // 回転前と回転後で同じ長さのものが並ぶので、最後のものを採る
    const buf = added.filter((b) => b.length === maxLen).pop();
    const d = buf.getChannelData(0);
    let leadingZeros = 0;
    while (leadingZeros < d.length && d[leadingZeros] === 0) leadingZeros++;
    let trailingZeros = 0;
    for (let i = d.length - 1; i >= 0 && d[i] === 0; i--) trailingZeros++;
    // 無音の総量と最長の連続無音。構造的な穴(先読み不足・回転ずれ)はここに大きく出る
    let gapRuns = 0, run = 0, silentSamples = 0, maxGapRun = 0;
    for (let i = 0; i < d.length; i++) {
      if (d[i] === 0) { run++; }
      else {
        if (run > 64) { gapRuns++; silentSamples += run; if (run > maxGapRun) maxGapRun = run; }
        run = 0;
      }
    }
    if (run > 64) { gapRuns++; silentSamples += run; if (run > maxGapRun) maxGapRun = run; }
    let worstJump = 0, spliceAt = -1;
    for (let i = 1; i < d.length; i++) {
      const j = Math.abs(d[i] - d[i - 1]);
      if (j > worstJump) { worstJump = j; spliceAt = i; }
    }
    return { length: d.length, sampleRate: buf.sampleRate, leadingZeros, trailingZeros,
             gapRuns, silentSamples, maxGapRun, worstJump, spliceAt };
  });
}

module.exports = {
  launchBrowser, openApp, connectApp, recordTrack,
  markBuffers, latestRecordedBuffer, SIGNALS,
};
