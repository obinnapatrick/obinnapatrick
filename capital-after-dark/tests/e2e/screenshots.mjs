// Captures documentation screenshots from the real game (medium quality, rendered on demand).
// Usage: npm run build && node tests/e2e/screenshots.mjs
import path from 'node:path';
import { startServer, openGame, ROOT } from './harness.mjs';

const DIR = path.join(ROOT, 'docs/screenshots');
const ONLY = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const srv = await startServer();
const { browser, page, errors } = await openGame();
const snap = async (name) => {
  if (ONLY && !ONLY.includes(name)) return;
  await page.evaluate(() => new Promise((res) => { const g = window.__cad; g.autoRender = true; requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { g.autoRender = false; res(); }))); }));
  await page.screenshot({ path: path.join(DIR, name + '.jpg'), type: 'jpeg', quality: 82, timeout: 120000 });
  console.log('saved', name);
};
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(DIR, 'menu.jpg'), type: 'jpeg', quality: 82, timeout: 120000 });
await page.evaluate(() => {
  const g = window.__cad; g.autoStep = false; g.autoRender = false; g.newGame(); g.gfx.setQuality('medium'); g.godMode = true; g.events.cooldown = 1e9; g.advance(6);
  document.getElementById('banner').classList.add('hidden'); document.getElementById('toasts').innerHTML = '';
  window.S = { at(x, z, yaw, pitch = -0.1, adv = 0.4) { g.player.teleport(x, 0.15, z, yaw); g.camera.yaw = yaw; g.camera.pitch = pitch; g.advance(adv); document.getElementById('toasts').innerHTML = ''; document.getElementById('banner').classList.add('hidden'); } };
});
// 1 Piccadilly Circus on foot
await page.evaluate(() => window.S.at(-152, 96, 2.55, 0.06, 2)); await snap('piccadilly');
// 2 Chinatown gate
await page.evaluate(() => window.S.at(3, 37.5, Math.PI / 2, 0.03, 1)); await snap('chinatown');
// 3 driving the cab up Shaftesbury Avenue in traffic
await page.evaluate(() => { const g = window.__cad, c = g.ownedVehicle(); c.place(-60, -2.3, Math.PI / 2); g.player.enterVehicle(c); g.camera.snapBehind(Math.PI / 2); g.input.inject('KeyW', true); g.advance(2.2); g.input.inject('KeyW', false); document.getElementById('toasts').innerHTML = ''; });
await snap('driving');
// 4 street fight outside the pub
await page.evaluate(() => { const g = window.__cad; g.player.exitVehicle(true); window.S.at(-22, -68.5, 0, -0.12, 0.2); const p = g.player; const n = g.npcs.spawn('heavy', p.pos.x + 0.3, p.pos.z + 1.3); n.maxHp = n.hp = 300; n.startFight(p); g.advance(0.5); g.input.injectMouse(0, true); g.advance(1 / 60); g.input.injectMouse(0, false); g.advance(0.14); document.getElementById('toasts').innerHTML = ''; });
await snap('melee');
// 5 armed and wanted: police response
await page.evaluate(() => { const g = window.__cad; g.npcs.list.filter((n) => n.role === 'heavy').forEach((n) => g.npcs.despawn(n)); window.S.at(0, 20, Math.PI, -0.08, 0.2); g.combat.give('pistol', 4); g.combat.switchTo('pistol'); const pc = g.npcs.spawn('police', 2, 4); g.npcs.spawn('police', -3, 2);
  g.police.report({ id: g.nextCrimeId(), type: 'alarm', pos: { x: 0, z: 20 } }, true, pc); g.input.injectMouse(2, true); g.advance(9); g.camera.yaw = Math.PI; g.camera.pitch = -0.05; g.advance(0.3); document.getElementById('toasts').innerHTML = ''; });
await snap('police'); await page.evaluate(() => { window.__cad.input.injectMouse(2, false); });
// 6 inside the pub
await page.evaluate(() => { const g = window.__cad; g.police.reset(); g.police.disengage(); const q = g.city.layout.poi('pub'); window.S.at(q.x, q.z, 0, -0.1, 0.2); g.interiors.enter(g.interiors.defs[0]); g.advance(0.5); g.camera.yaw = Math.PI - 0.5; g.camera.pitch = -0.12; g.advance(0.5); document.getElementById('toasts').innerHTML = ''; });
await snap('pub');
// 7 vehicle line-up at dusk, so the silhouettes can be judged
await page.evaluate(() => { const g = window.__cad; g.interiors.exit(); g.events.cancel(); for (const v of [...g.vehicles.list]) if (!v.owned) g.vehicles.remove(v); g.vehicles.trafficTarget = 0; g.npcs.clear(); g.ownedVehicle().place(140, 140, 0);
  g.state.data.clock = 18.3 * 60; g.gfx.rainAmount = 0.2;
  ['cab', 'police', 'saloon', 'sports', 'van', 'bus'].forEach((t, i) => { const v = g.vehicles.spawn(t, 101 + i * 3.9 + (t === 'bus' ? 3.4 : 0), 96 - (t === 'bus' ? 3.5 : 0), 0.55); if (t === 'police') v.siren = true; if (t !== 'bus') v.setDriver('ai'); });
  window.S.at(111.5, 105.5, Math.PI - 0.1, -0.08, 1.0); g.player.model.root.visible = false; g.camera.shoulder = 0; g.advance(0.3); document.getElementById('toasts').innerHTML = ''; });
await snap('vehicles');
// 8 a line-up of the people you meet
await page.evaluate(() => { const g = window.__cad; g.player.model.root.visible = true; for (const v of [...g.vehicles.list]) if (!v.owned) g.vehicles.remove(v);
  ['police', 'armed', 'office', 'tourist', 'nightlife', 'marlowe', 'kestrel', 'heavy', 'cabbie', 'pedestrian'].forEach((r, i) => { const n = g.npcs.spawn(r, -98 + i * 0.95, 82.2, { scripted: true, yaw: Math.PI }); n.pose = i === 4 ? 'talk' : i === 2 ? 'phone' : 'none'; });
  g.state.data.clock = 21.9 * 60; g.gfx.rainAmount = 1; window.S.at(-93.7, 77.4, 0, -0.03, 0.8); g.player.model.root.visible = false; g.camera.shoulder = 0; g.advance(0.6); document.getElementById('toasts').innerHTML = ''; });
await snap('people');
console.log('errors', errors, await page.evaluate(() => window.__cad.errors));
await browser.close(); srv.kill(); process.exit(0);
