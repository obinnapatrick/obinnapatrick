// Builds side-by-side BEFORE / AFTER sheets from docs/screenshots/before/*.jpg and docs/screenshots/*.jpg.
// Usage: node tests/e2e/compare.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './harness.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIR = path.join(ROOT, 'docs/screenshots');
const names = fs.readdirSync(path.join(DIR, 'before')).filter((f) => f.endsWith('.jpg') && fs.existsSync(path.join(DIR, f)));
const b64 = (p) => 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 500 }, deviceScaleFactor: 1 });
for (const f of names) {
  await page.setContent(`<body style="margin:0;background:#0a0a0c;font:700 20px Arial;color:#fff"><div style="display:flex;gap:8px;padding:8px">
    ${[['BEFORE (v0.4)', path.join(DIR, 'before', f)], ['AFTER (visual overhaul)', path.join(DIR, f)]].map(([t, p]) => `<div style="position:relative"><img src="${b64(p)}" style="width:788px;display:block"><span style="position:absolute;left:10px;top:8px;background:#000c;padding:4px 10px">${t}</span></div>`).join('')}</div></body>`);
  await page.waitForTimeout(200);
  const el = await page.$('body > div');
  await el.screenshot({ path: path.join(DIR, 'compare-' + f), type: 'jpeg', quality: 84 });
  console.log('wrote compare-' + f);
}
await browser.close();
