'use strict';
// すべての spec を順に実行して結果をまとめる。
// 録音は実時間で流れるため並列にはせず、逐次で回す。
//
//   node run-all.js                 すべて実行
//   node run-all.js loop-length     名前に一致するものだけ実行

const fs = require('fs');
const path = require('path');
const server = require('./lib/server');
const { launchBrowser } = require('./lib/harness');

const SPEC_DIR = path.join(__dirname, 'specs');
const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  const filter = process.argv[2];
  const specFiles = fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.js')).sort();
  const specs = specFiles
    .map((f) => ({ file: f, mod: require(path.join(SPEC_DIR, f)) }))
    .filter((s) => !filter || s.file.includes(filter) || s.mod.name.includes(filter));

  if (!specs.length) {
    console.error(`該当する spec がありません: ${filter}`);
    process.exit(2);
  }

  const site = await server.start(REPO_ROOT);
  const browser = await launchBrowser();
  const results = [];
  const startedAt = Date.now();

  for (const { file, mod } of specs) {
    console.log(`\n── ${mod.name}  (${file})`);
    const ctx = {
      browser,
      baseUrl: site.baseUrl,
      check(label, ok, detail) {
        results.push({ spec: mod.name, label, ok: !!ok, detail });
        console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
      },
      info(msg) { console.log(`   ·     ${msg}`); },
    };
    try {
      await mod.run(ctx);
    } catch (err) {
      results.push({ spec: mod.name, label: '実行中に例外', ok: false, detail: err.message });
      console.log(`   FAIL  実行中に例外 — ${err.message}`);
    }
  }

  await browser.close();
  await site.close();

  const failed = results.filter((r) => !r.ok);
  const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${results.length} 件中 ${results.length - failed.length} 件 PASS  (${secs} 秒)`);
  if (failed.length) {
    console.log('\n失敗:');
    for (const f of failed) console.log(`  - [${f.spec}] ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
