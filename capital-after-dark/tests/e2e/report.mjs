// Turns tests/e2e/out/results.json into docs/TEST_RESULTS.md (run after `npm run test:e2e`).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, ROOT } from './harness.mjs';
const r = JSON.parse(fs.readFileSync(path.join(OUT, 'results.json'), 'utf8'));
const lines = [`# Browser gameplay verification`, '', `Run: ${r.when} · headless Chromium (software WebGL) driving the production build`, '',
  `**${r.passed} / ${r.passed + r.failed} checks passed** · browser console errors: ${r.consoleErrors.length}`, '',
  'Each row is a behaviour exercised in the running game; the "measured" column is what the game actually did.', '', '| # | Check | Result | Measured |', '| --- | --- | --- | --- |'];
for (const c of r.results) lines.push(`| ${c.id} | ${c.name} | ${c.pass ? 'PASS' : '**FAIL**'} | ${c.detail.replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/TEST_RESULTS.md'), lines.join('\n') + '\n');
console.log(`wrote docs/TEST_RESULTS.md (${r.passed}/${r.passed + r.failed})`);
