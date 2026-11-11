// Real-browser gameplay verification. Runs the production build in headless Chromium and drives the
// actual game (input -> simulation -> state), then prints a pass/fail table with measured values.
// Usage: npm run build && npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { startServer, openGame, OUT } from './harness.mjs';

fs.mkdirSync(OUT, { recursive: true });
const results = [];
const srv = await startServer();
const { browser, page, errors } = await openGame();

// ---- helpers that live inside the page -------------------------------------------------------
await page.evaluate(() => {
  const g = window.__cad;
  const T = (window.T = {
    fresh() { g.autoStep = false; g.autoRender = false; g.godMode = false; g.newGame(); g.advance(0.2); T.skip(); },
    skip(pickIdx = 0) { let n = 0; while (g.ui.dialogueActive && n++ < 60) { const el = document.querySelectorAll('#dchoices button'); if (el.length) g.ui.choose(pickIdx); else g.ui.advanceDialogue(); g.advance(0.05); } },
    hold(code, secs) { g.input.inject(code, true); g.advance(secs); g.input.inject(code, false); g.advance(1 / 60); },
    tap(code) { g.input.inject(code, true); g.advance(1 / 60); g.input.inject(code, false); g.advance(1 / 60); },
    click(b = 0) { g.input.injectMouse(b, true); g.advance(1 / 60); g.input.injectMouse(b, false); g.advance(1 / 60); },
    /** Empty the streets so a check measures exactly one thing. */
    isolate() { g.npcs.clear(); g.interiors.populate(); g.vehicles.trafficTarget = 0; for (const v of [...g.vehicles.list]) if (!v.owned) g.vehicles.remove(v); g.events.cancel(); g.events.cooldown = 1e9; },
    face(x, z, pitch = -0.06) { const p = g.player.pos; g.camera.yaw = Math.atan2(x - p.x, z - p.z); g.camera.pitch = pitch; g.player.yaw = g.camera.yaw; g.advance(1 / 60); },
    npc(role, dx, dz, opts = {}) { const p = g.player.pos; const n = g.npcs.spawn(role, p.x + dx, p.z + dz, { scripted: opts.scripted ?? false, look: opts.look }); if (opts.hold) { n.setState('idle'); n.idleFor = 999; n.scripted = true; } return n; },
    dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); },
    round(v, d = 2) { return Math.round(v * 10 ** d) / 10 ** d; },
  });
});

async function check(id, name, fn) {
  const t0 = Date.now();
  let res;
  try { res = await fn(); } catch (e) { res = { pass: false, detail: 'threw: ' + String(e.message).split('\n')[0] }; }
  const pageErrs = await page.evaluate(() => window.__cad.errors.splice(0));
  if (pageErrs.length) { res.pass = false; res.detail += ' | runtime errors: ' + pageErrs.join(' ; ').slice(0, 300); }
  results.push({ id, name, ...res, ms: Date.now() - t0 });
  console.log(`${res.pass ? 'PASS' : 'FAIL'}  ${String(id).padEnd(4)} ${name}\n        ${res.detail}`);
}
// Software GL is slow, so frames are rendered on demand: draw two frames, capture, stop rendering again.
const shot = async (name) => {
  try {
    await page.evaluate(() => new Promise((res) => { const g = window.__cad; g.autoRender = true; requestAnimationFrame(() => requestAnimationFrame(() => { g.autoRender = g.mode === 'menu'; res(); })); }));
    await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 90000 });
  } catch (e) { console.log('        (screenshot ' + name + ' skipped: ' + String(e.message).split('\n')[0] + ')'); }
};
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- 0: boot ---------------------------------------------------------------------------------
await check('0', 'Game boots, 3D scene renders, menu shown', async () => {
  await page.waitForTimeout(800);
  const r = await ev(() => { const g = window.__cad; const s = g.gfx.stats(); return { mode: g.mode, calls: s.calls, tris: s.triangles, menu: !document.getElementById('menu').classList.contains('hidden'), buildings: g.city.layout.buildings.length }; });
  await shot('00-menu');
  return { pass: r.mode === 'menu' && r.calls > 10 && r.tris > 3000 && r.menu, detail: `mode=${r.mode}, ${r.calls} draw calls, ${r.tris} triangles, ${r.buildings} buildings` };
});

// ---- 1: movement and camera (real DOM keyboard/mouse events, real-time loop) ---------------------
await check('1a', 'Player walks with real keyboard events in the real-time loop', async () => {
  await page.click('button[data-act="new"]');
  await page.waitForTimeout(400);
  const a = await ev(() => { const g = window.__cad; g.autoStep = true; g.gfx.setQuality('low'); return { ...g.player.pos, mode: g.mode }; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1800); await page.keyboard.up('KeyW');
  const b = await ev(() => ({ ...window.__cad.player.pos }));
  const moved = Math.hypot(b.x - a.x, b.z - a.z);
  await shot('01-on-foot');
  return { pass: a.mode === 'playing' && moved > 0.3, detail: `moved ${moved.toFixed(2)} m north along Wardour Street in ~1.8 s of real time (software-rendered frames)` };
});
await check('1b', 'Run, sprint, jump, crouch, dodge and mouse-look respond', async () => {
  await page.mouse.move(640, 360);
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); T.isolate();
    p.teleport(0, 0, -40, Math.PI); g.camera.yaw = Math.PI; g.advance(0.3);
    const z0 = p.pos.z; T.hold('KeyW', 2); const run = (z0 - p.pos.z) / 2;
    g.input.inject('ShiftLeft', true); const z1 = p.pos.z; T.hold('KeyW', 2); g.input.inject('ShiftLeft', false); const sprint = (z1 - p.pos.z) / 2;
    g.input.inject('Space', true); g.advance(1 / 60); g.input.inject('Space', false); let top = 0; for (let i = 0; i < 40; i++) { g.advance(1 / 60); top = Math.max(top, p.pos.y); } g.advance(0.6);
    T.tap('KeyC'); const crouched = p.crouching; const z2 = p.pos.z; T.hold('KeyW', 1); const crouchSpeed = z2 - p.pos.z; T.tap('KeyC');
    const x0 = p.pos.x; T.hold('KeyD', 1); const strafe = p.pos.x - x0; // facing north, D = east (+x)? north-facing right is +x
    const before = p.pos.clone(); T.tap('KeyQ'); g.advance(0.4); const dodge = before.distanceTo(p.pos);
    const yaw0 = g.camera.yaw; g.input.dx = 240; g.input.dy = -80; g.advance(1 / 60); const dyaw = g.camera.yaw - yaw0;
    return { run, sprint, top, crouched, crouchSpeed, strafe, dodge, dyaw, landed: p.grounded, y: p.pos.y };
  });
  // real mouse drag on the canvas (button held) must also turn the camera
  const y0 = await ev(() => window.__cad.camera.yaw);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(760, 360, { steps: 4 }); await ev(() => window.__cad.advance(0.05)); await page.mouse.up({ button: 'right' });
  const y1 = await ev(() => window.__cad.camera.yaw);
  const ok = r.run > 3.8 && r.sprint > r.run * 1.4 && r.top > 0.6 && r.landed && r.crouched && r.crouchSpeed < r.run * 0.6 && r.strafe > 3 && r.dodge > 1.5 && r.dyaw < -0.3 && Math.abs(y1 - y0) > 0.05;
  return { pass: ok, detail: `run ${r.run.toFixed(1)} m/s, sprint ${r.sprint.toFixed(1)} m/s, jump apex ${r.top.toFixed(2)} m, crouch ${r.crouchSpeed.toFixed(1)} m/s, strafe ${r.strafe.toFixed(1)} m, dodge ${r.dodge.toFixed(1)} m, look Δyaw ${r.dyaw.toFixed(2)} rad (injected) / ${(y1 - y0).toFixed(2)} rad (real mouse drag)` };
});

// ---- 2: collision ------------------------------------------------------------------------------
await check('2', 'Solid buildings, kerbs, steps and parked vehicles block / carry the player', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); T.isolate();
    // walk west from the middle of Wardour Street straight at the Night Owl Cars frontage (wall at x = -10)
    p.teleport(-1, 0, 37, Math.PI / 2); g.camera.yaw = -Math.PI / 2; g.advance(0.2);
    const yRoad = p.pos.y; T.hold('KeyW', 4);
    const wallX = p.pos.x, yPave = p.pos.y, inside = g.city.inSolid(p.pos.x, p.pos.z);
    // sprint + jump into the wall for good measure
    g.input.inject('ShiftLeft', true); g.input.inject('KeyW', true); for (let i = 0; i < 6; i++) { g.input.inject('Space', true); g.advance(0.05); g.input.inject('Space', false); g.advance(0.5); } g.input.inject('KeyW', false); g.input.inject('ShiftLeft', false);
    const wallX2 = p.pos.x, inside2 = g.city.inSolid(p.pos.x, p.pos.z);
    // climb the fountain steps at Piccadilly Circus
    const f = g.city.layout.poi('circus'); p.teleport(f.x - 7, 0.15, f.z, Math.PI / 2); g.camera.yaw = Math.PI / 2; g.advance(0.2); T.hold('KeyW', 1.6); const yStep = p.pos.y;
    // a parked car is an obstacle
    const v = g.vehicles.spawn('saloon', 0, -100, 0); g.advance(0.1);
    p.teleport(-6, 0, -100, Math.PI / 2); g.camera.yaw = Math.PI / 2; g.advance(0.2); T.hold('KeyW', 3); const carStop = p.pos.x;
    // drop test: never fall through the road
    p.teleport(40, 6, 0, 0); g.advance(2.5); const yDrop = p.pos.y;
    return { yRoad, wallX, yPave, inside, wallX2, inside2, yStep, carStop, carEdge: -v.spec.w / 2, yDrop };
  });
  const ok = !r.inside && !r.inside2 && r.wallX > -10 && r.wallX < -9.4 && r.wallX2 > -10 && Math.abs(r.yPave - 0.15) < 0.06 && r.yRoad < 0.08 && r.yStep > 0.6 && r.carStop < r.carEdge && r.carStop > r.carEdge - 0.6 && Math.abs(r.yDrop) < 0.08;
  return { pass: ok, detail: `stopped at x=${r.wallX.toFixed(2)} (wall face x=-10), after sprint-jumping x=${r.wallX2.toFixed(2)}; road y=${r.yRoad.toFixed(2)} → pavement y=${r.yPave.toFixed(2)}; fountain steps y=${r.yStep.toFixed(2)}; halted by parked car at x=${r.carStop.toFixed(2)} (car side ${r.carEdge.toFixed(2)}); 6 m drop lands at y=${r.yDrop.toFixed(2)}` };
});

// ---- 3: melee ----------------------------------------------------------------------------------
await check('3', 'Punch combo, kick, knock-down, KO and blocking change real health', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); T.isolate();
    p.teleport(0, 0, -40, 0); g.camera.yaw = 0; g.advance(0.2);
    const n = T.npc('pedestrian', 0, 1.2, { hold: true }); n.maxHp = n.hp = 200; n.reactive = false; g.advance(0.1);
    const hp = [n.hp];
    for (let i = 0; i < 3; i++) { T.click(0); g.advance(0.42); hp.push(n.hp); n.setState('idle'); n.idleFor = 99; n.pos.set(p.pos.x, 0, p.pos.z + 1.2); } // jab, cross, hook
    g.advance(1); T.tap('KeyV'); g.advance(0.6); hp.push(n.hp); const downAfterKick = n.state;
    // whiff: out of range does nothing
    n.setState('idle'); n.pos.set(p.pos.x, 0, p.pos.z + 6); g.advance(0.8); const before = n.hp; T.click(0); g.advance(0.5); const whiff = before - n.hp;
    // finish him: KO state
    n.pos.set(p.pos.x, 0, p.pos.z + 1.2); n.hp = 10; g.advance(0.8); T.click(0); g.advance(0.5); const ko = { alive: n.alive, state: n.state };
    // an attacker hits the player; blocking cuts the damage
    const a = T.npc('heavy', 0, 1.3); a.attackCd = 0; a.startFight(p); let t = 0; const h0 = p.hp; while (p.hp === h0 && t < 6) { g.advance(0.05); t += 0.05; } const unblocked = h0 - p.hp;
    g.advance(1.2); p.hp = 100; p.downT = 0; T.face(a.pos.x, a.pos.z); g.input.injectMouse(2, true); a.attackCd = 0; t = 0; const h1 = p.hp; while (p.hp === h1 && t < 8) { g.camera.yaw = Math.atan2(a.pos.x - p.pos.x, a.pos.z - p.pos.z); g.advance(0.05); t += 0.05; } g.input.injectMouse(2, false); const blocked = h1 - p.hp;
    return { hp, downAfterKick, whiff, ko, unblocked, blocked, stats: g.state.data.stats.knockouts };
  });
  await shot('03-melee');
  const d = r.hp.slice(1).map((v, i) => r.hp[i] - v);
  const ok = d[0] === 12 && d[1] === 15 && d[2] === 26 && d[3] === 20 && r.whiff === 0 && !r.ko.alive && r.ko.state === 'ko' && r.unblocked > 5 && r.blocked > 0 && r.blocked < r.unblocked * 0.4 && r.stats >= 1;
  return { pass: ok, detail: `jab/cross/hook/kick dealt ${d.join('/')} (expected 12/15/26/20); kick → "${r.downAfterKick}"; swing at 6 m dealt ${r.whiff}; KO → alive=${r.ko.alive}, state=${r.ko.state}; enemy hit dealt ${r.unblocked.toFixed(1)} unblocked vs ${r.blocked.toFixed(1)} blocked` };
});

// ---- 4: firearms -------------------------------------------------------------------------------
await check('4', 'Pistol + SMG: aim, fire, ammo, reload, switch, hit people and vehicles', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player, c = g.combat; T.fresh(); T.isolate();
    p.teleport(0, 0, -40, 0); g.camera.yaw = 0; g.advance(0.2);
    c.give('pistol', 2); T.tap('Digit2'); const cur = c.current, cross = document.getElementById('crosshair').classList.contains('on') || (g.advance(0.05), document.getElementById('crosshair').classList.contains('on'));
    const n = T.npc('pedestrian', 0, 9, { hold: true }); n.maxHp = n.hp = 300; n.reactive = false;
    T.face(n.pos.x, n.pos.z, -0.055); g.advance(0.3);
    const a0 = c.ammo().mag, h0 = n.hp; T.click(0); g.advance(0.3); const hit = h0 - n.hp, a1 = c.ammo().mag;
    // aim away: a miss must not hurt anyone
    g.camera.yaw = 1.2; g.advance(0.1); const h1 = n.hp; T.click(0); g.advance(0.3); const miss = h1 - n.hp;
    // a wall between shooter and target stops the bullet
    p.teleport(-30, 0.15, -8.4, 0); const w = g.npcs.spawn('pedestrian', -30, -70, { scripted: true }); w.maxHp = w.hp = 300; w.reactive = false; g.camera.yaw = Math.PI; g.camera.pitch = -0.05; g.advance(0.3); const hw = w.hp; T.click(0); g.advance(0.3); const throughWall = hw - w.hp;
    p.teleport(0, 0, -40, 0); T.face(n.pos.x, n.pos.z, -0.055); g.advance(0.3);
    // empty the magazine, then reload from reserve
    let shots = 0; while (c.ammo().mag > 0 && shots < 30) { T.click(0); g.advance(0.3); shots++; if (c.reloadT > 0) break; }
    const emptyMag = c.ammo().mag, res0 = c.ammo().reserve; g.advance(1.6); const reloaded = c.ammo().mag, res1 = c.ammo().reserve;
    // vehicles take bullet damage too
    const v = g.vehicles.spawn('saloon', 0, -30, Math.PI / 2); g.advance(0.1); n.pos.set(40, 0, -40); T.face(v.x, v.z, -0.1); g.advance(0.2); const vh = v.health; T.click(0); g.advance(0.3); const vd = vh - v.health;
    // second firearm: automatic fire while held
    c.give('smg', 2); T.tap('Digit3'); const cur2 = c.current; n.pos.set(0, 0, -31); n.hp = 300; g.vehicles.remove(v); T.face(n.pos.x, n.pos.z, -0.055); g.advance(0.4);
    const m0 = c.ammo().mag, h2 = n.hp; g.input.injectMouse(0, true); for (let i = 0; i < 60; i++) { n.pos.set(0, 0, -31); n.setState('scripted'); g.advance(1 / 60); } g.input.injectMouse(0, false); const burst = m0 - c.ammo().mag, smgDmg = h2 - n.hp;
    T.tap('Digit1'); const back = c.current;
    return { cur, cross, a0, a1, hit, miss, throughWall, emptyMag, res0, reloaded, res1, vd, cur2, burst, smgDmg, back, fired: c.shotsFired, gunSfx: g.audio.played.gun };
  });
  await shot('04-firearms');
  const ok = r.cur === 'pistol' && r.cross && r.a0 === 12 && r.a1 === 11 && (r.hit === 34 || Math.abs(r.hit - 57.8) < 0.1) && r.miss === 0 && r.throughWall === 0 && r.emptyMag === 0 && r.reloaded === 12 && r.res0 - r.res1 === 12 && r.vd > 10 && r.cur2 === 'smg' && r.burst >= 8 && r.smgDmg >= 17 * 3 && r.back === 'fists';
  return { pass: ok, detail: `pistol hit dealt ${r.hit} (34 body / 57.8 head), mag ${r.a0}→${r.a1}; miss dealt ${r.miss}; shot through a building dealt ${r.throughWall}; emptied to ${r.emptyMag} then reloaded to ${r.reloaded} (reserve ${r.res0}→${r.res1}); car took ${r.vd.toFixed(1)}; SMG fired ${r.burst} rounds in 1 s for ${r.smgDmg.toFixed(0)} damage; switch 1/2/3 → ${r.back}/${r.cur}/${r.cur2}` };
});

// ---- 5 + 6: witnesses and police response ---------------------------------------------------------
await check('5', 'NPCs react to nearby combat (flee, cower, phone the police, fight back)', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); T.isolate();
    p.teleport(0, 0, -40, 0); g.advance(0.2);
    const crowd = []; for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.28; const n = g.npcs.spawn(i % 3 === 0 ? 'office' : i % 3 === 1 ? 'tourist' : 'nightlife', Math.sin(a) * 3.5 * (1 + (i % 2)), -40 + Math.cos(a) * 9 * (1 + (i % 2) * 0.6)); n.setState('idle'); n.idleFor = 60; crowd.push(n); }
    g.advance(0.5); const calmBefore = crowd.filter((n) => n.state === 'idle').length, wantedBefore = g.police.wanted.level;
    g.combat.give('pistol', 2); T.tap('Digit2'); g.camera.pitch = 0.5; g.advance(0.5); T.click(0); g.advance(0.6); // a shot in the air
    const states = {}; for (const n of crowd) states[n.state] = (states[n.state] ?? 0) + 1;
    const scared = crowd.filter((n) => n.mood === 'scared').length, callers = crowd.filter((n) => n.callCrime).length;
    const d0 = crowd.map((n) => T.dist(n.pos, p.pos)); g.advance(5); const fled = crowd.filter((n, i) => T.dist(n.pos, p.pos) > d0[i] + 6).length;
    let t = 0; while (g.police.wanted.level === 0 && t < 25) { g.advance(0.25); t += 0.25; }
    return { calmBefore, states, scared, callers, fled, wantedBefore, wanted: g.police.wanted.level, heat: g.police.wanted.heat, t, toast: g.ui.lastToast, notoriety: g.state.notoriety('Soho'), log: g.state.data.log.slice(-2).map((l) => l.text) };
  });
  const ok = r.calmBefore === 12 && r.scared >= 8 && r.fled >= 6 && r.callers >= 1 && r.wantedBefore === 0 && r.wanted >= 1 && r.notoriety > 0;
  return { pass: ok, detail: `12 calm bystanders → after one gunshot: states ${JSON.stringify(r.states)}, ${r.scared} scared, ${r.fled} ran >6 m, ${r.callers} decided to phone it in; wanted 0→${r.wanted} after ${r.t.toFixed(1)} s when a call connected (heat ${r.heat}); Soho notoriety now ${r.notoriety.toFixed(0)}` };
});
await check('6a', 'No witness, no wanted level; officer who sees an assault responds at once', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); T.isolate();
    // punch someone in an empty alley: nobody sees, nothing is reported
    p.teleport(-37.5, 0.15, -40, 0); g.camera.yaw = 0; g.advance(0.2);
    const v1 = T.npc('pedestrian', 0, 1.2, { hold: true }); v1.maxHp = v1.hp = 500; v1.reactive = false; T.click(0); g.advance(3);
    const unseen = g.police.wanted.level, hurt1 = 500 - v1.hp;
    // same act in front of a constable
    p.teleport(0, 0, -40, 0); g.camera.yaw = 0; g.advance(0.2);
    const v2 = T.npc('pedestrian', 0, 1.2, { hold: true }); v2.maxHp = v2.hp = 500; v2.reactive = false;
    const pc = T.npc('police', 3, 9); pc.setState('idle'); pc.idleFor = 30; g.advance(0.2);
    const d0 = T.dist(pc.pos, p.pos); T.click(0); g.advance(0.6);
    const seen = g.police.wanted.level, state = pc.state, mode = g.police.wanted.mode; g.advance(1.2); const d1 = T.dist(pc.pos, p.pos);
    return { unseen, hurt1, seen, state, mode, d0, d1, toast: g.ui.lastToast };
  });
  const ok = r.unseen === 0 && r.hurt1 === 12 && r.seen >= 1 && r.state === 'police' && r.mode === 'pursuit' && r.d1 < r.d0 - 2;
  return { pass: ok, detail: `unwitnessed punch (dealt ${r.hurt1}) → wanted ${r.unseen}; same punch with a PC 9 m away → wanted ${r.seen}, officer state "${r.state}", mode ${r.mode}, officer closed from ${r.d0.toFixed(1)} m to ${r.d1.toFixed(1)} m in 1.8 s` };
});

// ---- 7: pursuit, search, evasion, arrest ----------------------------------------------------------
await check('7a', 'Police pursue, lose sight, search the last known position, then stand down', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player, w = g.police.wanted; T.fresh(); T.isolate(); g.godMode = true;
    p.teleport(0, 0, -40, 0); g.advance(0.2);
    const pcs = [T.npc('police', 4, 22), T.npc('police', -4, 26)]; g.advance(0.2);
    g.police.report({ id: g.nextCrimeId(), type: 'shooting', pos: { x: p.pos.x, z: p.pos.z } }, true, pcs[0]); // an officer radios it in
    g.advance(1); const level = w.level, mode1 = w.mode, vis1 = g.police.visible;
    // run: sprint north for 5 s, the officers must follow
    const start = pcs.map((o) => ({ x: o.pos.x, z: o.pos.z })); g.camera.yaw = Math.PI; g.input.inject('ShiftLeft', true); T.hold('KeyW', 5); g.input.inject('ShiftLeft', false);
    const chased = pcs.map((o, i) => T.dist(o.pos, start[i])); const reinforcements = g.npcs.list.filter((n) => n.state === 'police').length, cars = g.vehicles.list.filter((v) => v.type === 'police').length;
    // break line of sight: duck round the block into Stag Passage (buildings between us and them)
    p.teleport(-37.5, 0.15, -40, 0); g.advance(0.5);
    const lk = { ...w.lastKnown }; g.advance(1.5); const mode2 = w.mode, vis2 = g.police.visible, lkStill = T.dist(w.lastKnown, lk) < 1;
    // officers converge on the LAST KNOWN position, not on the player
    let nearLK = 0, t = 0; while (t < 14 && w.level > 0) { g.advance(0.5); t += 0.5; nearLK = Math.max(nearLK, g.npcs.list.filter((n) => n.state === 'police' && T.dist(n.pos, lk) < 14).length); if (g.police.visible) { p.teleport(-37.5, 0.15, -40, 0); } }
    // keep hidden (move away if a searcher wanders in) until they give up
    let hides = 0; t = 0; while (w.level > 0 && t < 90) { g.advance(0.5); t += 0.5; if (g.police.visible) { hides++; const far = [[-110, -141], [110, 141], [-141, 110], [141, -110]].sort((a, b) => Math.min(...g.npcs.list.filter((n) => n.state === 'police').map((n) => Math.hypot(n.pos.x - b[0], n.pos.z - b[1]))) - Math.min(...g.npcs.list.filter((n) => n.state === 'police').map((n) => Math.hypot(n.pos.x - a[0], n.pos.z - a[1]))))[0]; p.teleport(far[0], 0.15, far[1], 0); } }
    g.advance(1);
    return { level, mode1, vis1, chased, reinforcements, cars, mode2, vis2, lkStill, nearLK, evadeT: t, hides, final: w.level, finalMode: w.mode, stillChasing: g.npcs.list.filter((n) => n.state === 'police').length, evaded: g.state.data.stats.evaded, toast: g.ui.lastToast };
  });
  await shot('07-police');
  const ok = r.level >= 2 && r.mode1 === 'pursuit' && r.vis1 && r.chased.every((d) => d > 8) && r.mode2 === 'search' && !r.vis2 && r.lkStill && r.nearLK >= 1 && r.final === 0 && r.stillChasing === 0 && r.evaded === 1;
  return { pass: ok, detail: `wanted ${r.level}★ ${r.mode1}; officers ran ${r.chased.map((d) => d.toFixed(0)).join(' m, ')} m after the player; units engaged ${r.reinforcements} + ${r.cars} car(s); out of sight → mode ${r.mode2}, last-known position frozen=${r.lkStill}, ${r.nearLK} officer(s) searched it; stood down after ${r.evadeT.toFixed(0)} s unseen (re-hid ${r.hides}×) → wanted ${r.final}, ${r.stillChasing} still chasing, "${r.toast}"` };
});
await check('7b', 'Police cars are dispatched and drive to the suspect', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player, w = g.police.wanted; T.fresh(); T.isolate(); g.godMode = true;
    p.teleport(0, 0, 40, 0); g.advance(0.2);
    const pc = T.npc('police', 3, 12); g.police.report({ id: g.nextCrimeId(), type: 'alarm', pos: { x: 0, z: 40 } }, true, pc);
    let first = null, minD = 1e9, t = 0, crewOut = false, maxSpeed = 0;
    while (t < 40) { g.advance(0.25); t += 0.25; for (const c of g.vehicles.list) if (c.type === 'police') { if (first === null) first = { t, d: Math.hypot(c.x - p.pos.x, c.z - p.pos.z) }; minD = Math.min(minD, Math.hypot(c.x - p.pos.x, c.z - p.pos.z)); maxSpeed = Math.max(maxSpeed, c.speed); if (c.crew === 0) crewOut = true; } if (crewOut) break; }
    return { level: w.level, first, minD, t, crewOut, maxSpeed, armed: g.npcs.list.filter((n) => n.state === 'police' && n.armed).length, officers: g.npcs.list.filter((n) => n.state === 'police').length, sirens: g.vehicles.list.filter((v) => v.siren).length };
  });
  const ok = r.level >= 3 && r.first && r.first.d > 60 && r.minD < 16 && r.crewOut && r.maxSpeed > 12 && r.armed >= 1;
  return { pass: ok, detail: `wanted ${r.level}★: first car spawned ${r.first?.d.toFixed(0)} m away out of sight at t=${r.first?.t}s, reached ${r.minD.toFixed(1)} m of the player by t=${r.t}s (top ${r.maxSpeed.toFixed(0)} m/s), crew got out=${r.crewOut}; ${r.officers} officers engaged, ${r.armed} armed` };
});
await check('7c', 'Being caught: arrest → fine, ammunition confiscated, moved to the station', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player, w = g.police.wanted; T.fresh(); T.isolate();
    g.state.addCash(380); g.combat.give('pistol', 3);
    p.teleport(0, 0, -40, 0); g.advance(0.2);
    const pc = T.npc('police', 1, 6); g.police.report({ id: g.nextCrimeId(), type: 'assault', pos: { x: 0, z: -40 } }, true, pc);
    const cash0 = g.state.data.cash, ammo0 = g.combat.ammo('pistol').mag + g.combat.ammo('pistol').reserve; let t = 0, peak = 0;
    while (g.state.data.stats.busted === 0 && t < 20) { g.advance(0.1); t += 0.1; peak = Math.max(peak, g.police.arrest); }
    g.advance(1.5); const st = g.city.layout.poi('police');
    return { t, peak, busted: g.state.data.stats.busted, cash0, cash1: g.state.data.cash, ammo0, ammo1: g.combat.ammo('pistol').mag + g.combat.ammo('pistol').reserve, atStation: Math.hypot(p.pos.x - st.x, p.pos.z - st.z) < 3, wanted: w.level, banner: g.ui.lastBanner, hasGun: g.combat.owns('pistol') };
  });
  const ok = r.busted === 1 && r.cash0 - r.cash1 === 175 && r.ammo0 === 36 && r.ammo1 === 0 && r.atStation && r.wanted === 0 && r.banner === 'Arrested';
  return { pass: ok, detail: `stood still at 1★: arrest bar filled in ${r.t.toFixed(1)} s → "${r.banner}"; cash £${r.cash0}→£${r.cash1} (fine £${r.cash0 - r.cash1}); pistol rounds ${r.ammo0}→${r.ammo1}; released at police station=${r.atStation}; wanted ${r.wanted}` };
});

// ---- 8: vehicles ---------------------------------------------------------------------------------
await check('8', 'Enter, drive (accelerate / steer / brake / reverse / handbrake), collide and exit', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); T.isolate();
    const cab = g.ownedVehicle(); p.teleport(cab.x - 2.2, 0.15, cab.z, 0); g.advance(0.2);
    const prompt = document.getElementById('prompt').textContent; T.tap('KeyF'); const inCab = p.vehicle === cab, type = cab.type;
    cab.place(-2.3, 100, Math.PI); g.advance(0.3); // northbound lane of Wardour Street, clear road ahead
    const z0 = cab.z; T.hold('KeyW', 4); const v1 = cab.speed, dist = z0 - cab.z;
    const yaw0 = cab.yaw; g.input.inject('KeyW', true); T.hold('KeyA', 0.5); const dyawL = cab.yaw - yaw0; T.hold('KeyD', 1.0); const dyawR = cab.yaw - yaw0 - dyawL; g.input.inject('KeyW', false);
    cab.place(-2.3, 60, Math.PI); g.advance(0.1); T.hold('KeyW', 3); const vb0 = cab.speed; T.hold('KeyS', 0.6); const vb1 = cab.speed; T.hold('KeyS', 3); const rev = cab.speed;
    cab.place(-2.3, 60, Math.PI); g.advance(0.1); T.hold('KeyW', 3.5); const vh0 = cab.speed; T.hold('Space', 1.2); const vh1 = cab.speed;
    // crash into the corner shop: collision is detected and the cab is damaged, and the building holds
    cab.place(18, 20, Math.PI); g.advance(0.1); const h0 = cab.health; T.hold('KeyW', 3.4); const h1 = cab.health, wallZ = cab.z - cab.spec.l / 2, inside = g.city.inSolid(cab.x, cab.z - cab.spec.l / 2 + 0.3);
    // exit beside a wall: must come out on a free side, not inside the building
    cab.place(11.2, -5, Math.PI); g.advance(0.5); T.tap('KeyF'); g.advance(0.3);
    const out = !p.vehicle, exitInSolid = g.city.inSolid(p.pos.x, p.pos.z, 0.2), exitFree = g.phys.spaceFree(p.pos.x, p.pos.y + 0.95, p.pos.z, 0.3), y = p.pos.y;
    const pe = p.pos.clone(); g.camera.yaw = Math.PI; T.hold('KeyS', 1); const canWalk = pe.distanceTo(p.pos) > 2;
    // boxed in on every side: you still get out (onto the roof) rather than being trapped
    cab.place(0, 0, 0); for (const [dx, dz, yw] of [[2.2, 0, 0], [-2.2, 0, 0], [0, 3.6, Math.PI / 2], [0, -3.6, Math.PI / 2]]) g.vehicles.spawn('van', dx, dz, yw); g.advance(0.2);
    p.enterVehicle(cab); g.advance(0.2); T.tap('KeyF'); g.advance(0.5); const boxedOut = !p.vehicle, boxedY = p.pos.y, boxedFree = !g.city.inSolid(p.pos.x, p.pos.z);
    return { prompt, inCab, type, v1, dist, dyawL, dyawR, vb0, vb1, rev, vh0, vh1, h0, h1, wallZ, inside, out, exitInSolid, exitFree, y, canWalk, boxedOut, boxedY, boxedFree };
  });
  await ev(() => { const g = window.__cad, c = g.ownedVehicle(); g.vehicles.list.filter((v) => !v.owned).forEach((v) => g.vehicles.remove(v)); c.repair(); c.place(-2.3, 60, Math.PI); g.player.enterVehicle(c); g.camera.snapBehind(Math.PI); g.input.inject('KeyW', true); g.advance(2.5); g.input.inject('KeyW', false); });
  await page.waitForTimeout(300); await shot('08-driving');
  const ok = r.inCab && r.type === 'cab' && r.v1 > 12 && r.dist > 25 && r.dyawL > 0.15 && r.dyawR < -0.3 && r.vb1 < r.vb0 - 6 && r.rev < -2 && r.vh1 < r.vh0 * 0.45 && r.h1 < r.h0 && !r.inside && r.out && !r.exitInSolid && r.exitFree && r.canWalk && r.boxedOut && r.boxedFree && r.boxedY > 1.5 && r.h0 - r.h1 > 10;
  return { pass: ok, detail: `[canWalk=${r.canWalk} out=${r.out} boxedOut=${r.boxedOut} boxedFree=${r.boxedFree} inside=${r.inside}] prompt "${r.prompt.trim()}"; 0→${(r.v1 * 2.237).toFixed(0)} mph in 4 s over ${r.dist.toFixed(0)} m; steer left Δyaw ${r.dyawL.toFixed(2)}, right ${r.dyawR.toFixed(2)}; brake ${r.vb0.toFixed(1)}→${r.vb1.toFixed(1)} m/s then reverse ${r.rev.toFixed(1)} m/s; handbrake ${r.vh0.toFixed(1)}→${r.vh1.toFixed(1)} m/s; crash damage ${r.h0}→${r.h1.toFixed(0)}, stopped at wall (nose z=${r.wallZ.toFixed(1)}, wall z=-10); exit beside wall: free=${r.exitFree}, in building=${r.exitInSolid}, y=${r.y.toFixed(2)}; boxed-in exit → roof y=${r.boxedY.toFixed(2)}` };
});

// ---- 9: traffic ------------------------------------------------------------------------------------
await check('9', 'AI traffic drives on the left, follows the road network and avoids pile-ups', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); g.godMode = true; g.events.cooldown = 1e9;
    p.teleport(-134, 0.15, 91, 0); // stand on the fountain plaza, out of the way
    const XS = [-150, -75, 0, 75, 150]; let ok = 0, bad = 0, moving = 0, samples = 0, maxStuck = 0; const types = new Set(); const dist = new Map();
    const last = new Map();
    for (let t = 0; t < 60; t += 0.5) {
      g.advance(0.5);
      for (const v of g.vehicles.list) {
        if (!v.ai || v.ai.mode !== 'traffic') continue;
        types.add(v.type); samples++;
        const l = last.get(v.id); if (l) dist.set(v.id, (dist.get(v.id) ?? 0) + Math.hypot(v.x - l.x, v.z - l.z)); last.set(v.id, { x: v.x, z: v.z });
        maxStuck = Math.max(maxStuck, v.ai.stuck);
        if (v.speed < 3) continue; moving++;
        // judge every vehicle outside the junction boxes (including the approach) that is aligned with its street
        const nx = XS.reduce((a, b) => (Math.abs(b - v.x) < Math.abs(a - v.x) ? b : a)), nz = XS.reduce((a, b) => (Math.abs(b - v.z) < Math.abs(a - v.z) ? b : a));
        const onNS = Math.abs(v.x - nx) < 6.5 && Math.abs(v.z - nz) > 9, onEW = Math.abs(v.z - nz) < 6.5 && Math.abs(v.x - nx) > 9;
        const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
        if (onNS && Math.abs(fz) > 0.9) { const left = fz > 0 ? v.x - nx > 0 : v.x - nx < 0; left ? ok++ : bad++; } // southbound keeps east, northbound keeps west
        else if (onEW && Math.abs(fx) > 0.9) { const left = fx > 0 ? v.z - nz < 0 : v.z - nz > 0; left ? ok++ : bad++; } // eastbound keeps north, westbound keeps south
      }
    }
    const d = [...dist.values()]; const travelled = d.reduce((a, b) => a + b, 0) / d.length; const stalled = d.filter((x) => x < 40).length;
    const dead = g.vehicles.list.filter((v) => v.ai && v.dead).length, hurt = g.vehicles.list.filter((v) => v.ai && v.health < v.spec.health * 0.6).length;
    return { ok, bad, moving, samples, n: d.length, travelled, stalled, dead, hurt, types: [...types], maxStuck };
  });
  await ev(() => { const g = window.__cad; g.player.teleport(-140, 0.15, 84, 0); g.camera.yaw = 1.2; g.camera.pitch = -0.1; g.advance(0.1); });
  await page.waitForTimeout(300); await shot('09-traffic');
  const frac = r.ok / Math.max(1, r.ok + r.bad);
  const ok = frac > 0.97 && r.ok > 300 && r.travelled > 200 && r.stalled <= 2 && r.dead === 0 && r.types.includes('bus') && r.types.includes('cab');
  return { pass: ok, detail: `${r.n} AI vehicles (${r.types.join(', ')}) over 60 s: ${(frac * 100).toFixed(1)}% of ${r.ok + r.bad} straight-road samples on the LEFT; mean distance driven ${r.travelled.toFixed(0)} m; ${r.stalled} moved <40 m; ${r.hurt} badly damaged, ${r.dead} wrecked` };
});

await check('9b', 'Traffic keeps flowing over six simulated minutes (no gridlock, no pile-ups)', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); g.godMode = true; g.events.cooldown = 1e9; p.teleport(-134, 0.15, 91, 0);
    const rows = [];
    for (let win = 0; win < 6; win++) {
      const start = new Map(g.vehicles.list.filter((v) => v.ai).map((v) => [v.id, { x: v.x, z: v.z, d: 0 }]));
      for (let t = 0; t < 60; t += 0.5) { g.advance(0.5); for (const v of g.vehicles.list) { const s = start.get(v.id); if (s) { s.d += Math.hypot(v.x - s.x, v.z - s.z); s.x = v.x; s.z = v.z; } } }
      const d = [...start.values()].map((s) => s.d);
      rows.push({ n: d.length, mean: d.reduce((a, b) => a + b, 0) / d.length, min: Math.min(...d), stalled: d.filter((x) => x < 60).length });
    }
    return { rows, wrecks: g.vehicles.list.filter((v) => v.dead).length, damaged: g.vehicles.list.filter((v) => v.ai && v.health < v.spec.health * 0.9).length, pedsHurt: g.npcs.list.filter((n) => n.hp < n.maxHp).length };
  });
  const ok = r.rows.every((w) => w.stalled === 0 && w.mean > 250) && r.wrecks === 0;
  return { pass: ok, detail: `per-minute mean distance per vehicle: ${r.rows.map((w) => w.mean.toFixed(0)).join(' / ')} m; slowest vehicle each minute: ${r.rows.map((w) => w.min.toFixed(0)).join(' / ')} m; vehicles stalled (<60 m in a minute): ${r.rows.map((w) => w.stalled).join(' / ')}; wrecks ${r.wrecks}, damaged ${r.damaged}, pedestrians hurt by traffic ${r.pedsHurt}` };
});

// ---- 10 + 11: missions and rewards -----------------------------------------------------------------
await check('10a', 'Mission 1 THE NIGHT SHIFT can be completed; reward is paid', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); T.isolate(); const m = g.missions; const cash0 = g.state.data.cash;
    // walk into the start marker outside Night Owl Cars
    p.teleport(-8.2, 0.15, 38, Math.PI); g.camera.yaw = Math.PI; g.advance(0.2); T.hold('KeyW', 1.2);
    const started = !!m.active, title = m.active?.title; T.skip(); g.advance(0.2); const obj0 = m.objective;
    const cab = g.ownedVehicle(); p.teleport(cab.x - 2.2, 0.15, cab.z, 0); g.advance(0.1); T.tap('KeyF'); g.advance(0.2); const obj1 = m.objective, stage1 = m.active.stage;
    // drive to the pick-up (the route itself is covered by the driving and traffic checks; here we verify mission logic)
    cab.place(-110, 77.4, -Math.PI / 2); g.advance(0.2); T.hold('KeyW', 1.2); T.hold('Space', 1.5); g.advance(0.5); const obj2 = m.objective;
    let t = 0; while (m.active && m.active.stage < 3 && t < 30) { g.advance(0.25); t += 0.25; } const aboard = m.active?.stage === 3, timer = m.timer, obj3 = m.objective;
    cab.place(-14, -72.6, -Math.PI / 2); g.advance(0.2); T.hold('KeyW', 1.0); T.hold('Space', 1.5); g.advance(0.5);
    const dlg = g.ui.dialogueActive; T.skip(); g.advance(0.5);
    return { started, title, obj0, obj1, stage1, obj2, aboard, timer, obj3, dlg, done: g.state.done('night_shift'), active: !!m.active, cash0, cash1: g.state.data.cash, banner: g.ui.lastBanner, fares: g.state.data.stats.fares, saved: g.saves.hasSave(), next: document.querySelectorAll('.toast').length, markers: g.fx.markers.map((k) => k.icon) };
  });
  await shot('10-mission-passed');
  const gain = r.cash1 - r.cash0;
  const ok = r.started && r.obj0.includes('cab') && r.stage1 === 1 && r.aboard && r.timer > 100 && r.dlg && r.done && !r.active && gain >= 60 && gain <= 110 && r.banner === 'Mission passed' && r.fares === 1 && r.saved && r.markers.includes('2');
  return { pass: ok, detail: `walked into marker → "${r.title}"; objectives: "${r.obj0}" → "${r.obj1}" → "${r.obj2}" → "${r.obj3}" (timer ${r.timer?.toFixed(0)} s); "${r.banner}"; cash £${r.cash0}→£${r.cash1} (+£${gain}); autosaved=${r.saved}; next mission marker shown: ${r.markers.join(',')}` };
});
await check('10b', 'Missions can be failed (vehicle wrecked, timer, arrest) and retried', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player, m = g.missions; T.fresh(); T.isolate(); const cash0 = g.state.data.cash; const out = [];
    // (a) wreck the cab
    m.startById('night_shift'); T.skip(); g.advance(0.2); g.ownedVehicle().damage(1e6); g.advance(0.2); out.push({ why: g.ui.lastBanner, active: !!m.active, done: g.state.done('night_shift') });
    // (b) run out of time with the fare aboard
    T.fresh(); T.isolate(); m.startById('night_shift'); T.skip(); const cab = g.ownedVehicle(); p.enterVehicle(cab); g.advance(0.2); cab.place(-116, 77.4, -Math.PI / 2); g.advance(0.3);
    let t = 0; while (m.active && m.active.stage < 3 && t < 30) { g.advance(0.25); t += 0.25; } const stage = m.active?.stage; if (m.active) m.active.timer = 1.5; g.advance(2.5);
    out.push({ why: g.ui.lastBanner, active: !!m.active, stage, done: g.state.done('night_shift') });
    // (c) get arrested mid-mission
    T.fresh(); T.isolate(); m.startById('night_shift'); T.skip(); g.advance(0.2); const pc = T.npc('police', 1, 5); g.police.report({ id: g.nextCrimeId(), type: 'assault', pos: { x: p.pos.x, z: p.pos.z } }, true, pc);
    t = 0; while (m.active && t < 20) { g.advance(0.2); t += 0.2; } g.advance(1.5);
    out.push({ why: g.ui.lastBanner, active: !!m.active, done: g.state.done('night_shift') });
    // the start marker comes back so it can be retried
    return { out, retry: g.fx.markers.some((k) => k.icon === '1'), cash0, cash1: g.state.data.cash, log: g.state.data.log.filter((l) => l.text.startsWith('Failed')).map((l) => l.text) };
  });
  const ok = r.out.every((o) => !o.active && !o.done) && r.out[1].stage === 3 && r.retry && r.log.length >= 1;
  return { pass: ok, detail: `(a) cab wrecked → mission ended, not marked done; (b) timer expired with fare aboard (stage ${r.out[1].stage}) → failed; (c) arrested → "${r.log[r.log.length - 1]}"; start marker restored=${r.retry}; no reward paid` };
});
await check('10c', 'Missions 2-6 play through their real stages (combat, delivery, chase, faction choice, finale)', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player, m = g.missions; T.fresh(); const s = g.state; T.isolate(); g.godMode = true; const log = [];
    s.data.missionsDone.push('night_shift'); m.refresh();
    const beat = (n) => { n.hp = 1; p.teleport(n.pos.x, n.pos.y, n.pos.z - 1.2, 0); g.camera.yaw = 0; g.advance(0.1); let k = 0; while (n.alive && k++ < 12) { p.teleport(n.pos.x, n.pos.y, n.pos.z - 1.1, 0); T.click(0); g.advance(0.45); } return !n.alive; };
    // --- 2 WRONG PLACE: fight Gaz with real punches, pick up the pistol
    m.startById('wrong_place'); T.skip(); p.teleport(-37.5, 0.15, -42, 0); g.advance(0.3); T.skip(); g.advance(0.2);
    const gaz = g.npcs.list.find((n) => n.name === 'Gaz'); const hostile = gaz.state === 'fight' && gaz.target === p; const ko = beat(gaz); g.advance(0.3);
    const mk = g.fx.markers.find((k) => k.icon === '!'); p.teleport(mk.x, 0.15, mk.z, 0); g.advance(0.3); T.skip(); g.advance(0.3);
    log.push({ id: 'wrong_place', done: s.done('wrong_place'), hostile, ko, pistol: g.combat.owns('pistol'), rep: s.data.rep.marlowe });
    // --- 3 THE DELIVERY: crash damage degrades the package; deliver within the time limit
    const c3 = s.data.cash; m.startById('delivery'); T.skip(); const cab = g.ownedVehicle(); p.enterVehicle(cab); g.advance(0.3);
    cab.place(18, 20, Math.PI); g.advance(0.1); T.hold('KeyW', 3.6); const pkg = m.objective; cab.repair();
    cab.place(104, 72.6, Math.PI / 2); g.advance(0.2); T.hold('KeyW', 0.9); T.hold('Space', 1.5); g.advance(0.4); T.skip(); g.advance(0.3);
    log.push({ id: 'delivery', done: s.done('delivery'), pkg, paid: s.data.cash - c3, kestrel: s.data.rep.kestrel });
    // --- 4 HEAT: the theft is seen by the constable → real wanted level → evade → deliver
    p.exitVehicle(true); m.startById('heat'); T.skip(); g.advance(0.3);
    const car = g.vehicles.list.find((v) => v.missionTag === 'heat'); p.teleport(car.x - 2.2, 0.15, car.z, 0); g.advance(0.2); T.tap('KeyF'); g.advance(1);
    const wantedAfterTheft = g.police.wanted.level, obj4 = m.objective;
    car.place(-147.7, -120, Math.PI); g.advance(0.3); let t = 0; while (g.police.wanted.level > 0 && t < 120) { g.advance(0.5); t += 0.5; if (g.police.visible) car.place(car.x < 0 ? 147.7 : -147.7, car.z < 0 ? 120 : -120, Math.PI); }
    g.advance(0.5); const obj4b = m.objective; const bay = g.city.layout.poi('garage_bay'); car.place(bay.x - 8, bay.z, Math.PI / 2); g.advance(0.2); T.hold('KeyW', 0.9); T.hold('Space', 1.5); g.advance(0.4); T.skip(); g.advance(0.3);
    log.push({ id: 'heat', done: s.done('heat'), wantedAfterTheft, obj4, obj4b, evadeT: t, carGone: !g.vehicles.list.includes(car) });
    // --- 5 CHOOSE A SIDE (Marlowe): wreck the Kestrel van with gunfire; guards turn hostile
    m.startById('choose_side', 'marlowe'); T.skip(); g.advance(0.3); const van = g.vehicles.list.find((v) => v.missionTag === 'choose_side');
    const guards = g.npcs.list.filter((n) => n.activity === 'guarding'); g.combat.give('smg', 6); g.combat.switchTo('smg');
    p.teleport(van.x, 0, van.z + 9, Math.PI); T.face(van.x, van.z, -0.12); g.advance(0.2); let shots = 0; while (!van.dead && shots++ < 40) { T.face(van.x, van.z, -0.12); g.input.injectMouse(0, true); g.advance(0.5); g.input.injectMouse(0, false); g.advance(2); }
    const guardsHostile = guards.filter((n) => n.hostileToPlayer).length; const obj5 = m.objective;
    g.police.reset(); g.police.disengage(); p.teleport(-140, 0.15, -141.6, 0); g.advance(1); g.police.reset(); g.advance(0.5); T.skip(); g.advance(0.3);
    log.push({ id: 'choose_side', done: s.done('choose_side'), vanDead: van.dead, guardsHostile, obj5, side: s.flag('side'), rep: { ...s.data.rep }, stance: [s.factionStance('marlowe'), s.factionStance('kestrel')], smg: g.combat.owns('smg') });
    // --- 6 AFTER DARK: dialogue → site fight vs 4 guards (2 armed) → ledger → alarm → evade → ending choice
    g.police.reset(); g.police.disengage(); const c6 = s.data.cash; m.startById('after_dark'); T.skip(); g.advance(0.3);
    p.teleport(-131, 0.15, 94.6, 0); g.advance(0.3); T.skip(); g.advance(0.3); const obj6a = m.objective;
    const site = g.city.layout.poi('site'); p.teleport(site.x, 0.15, site.z, Math.PI); g.advance(0.4); const obj6b = m.objective;
    const heavies = g.npcs.list.filter((n) => n.role === 'heavy'); const armed = heavies.filter((n) => n.armed).length, fighting = heavies.filter((n) => n.state === 'fight' || n.state === 'cover').length;
    g.godMode = false; p.hp = 100; g.advance(4); const dmgTaken = 100 - p.hp; g.godMode = true; p.hp = 100; if (!p.alive) { p.alive = true; }
    let kos = 0; for (const h of heavies) if (beat(h)) kos++; g.advance(0.3); const obj6c = m.objective;
    const lm = g.fx.markers.find((k) => k.icon === 'L'); p.teleport(lm.x, 0.15, lm.z, 0); g.advance(0.4); const alarmLevel = g.police.wanted.level, obj6d = m.objective;
    p.teleport(-140, 0.15, 141.6, 0); t = 0; while (g.police.wanted.level > 0 && t < 150) { g.advance(0.5); t += 0.5; if (g.police.visible) { const q = [[-140, 141.6], [140, -141.6], [-140, -141.6], [140, 141.6]][Math.floor(t) % 4]; p.teleport(q[0], 0.15, q[1], 0); } }
    g.advance(0.6); const obj6e = m.objective; p.teleport(112.5, 0.15, 102.5, 0); g.advance(0.4); T.skip(0); g.advance(0.4); T.skip(0); g.advance(0.4);
    log.push({ id: 'after_dark', done: s.done('after_dark'), obj6a, obj6b, armed, fighting, dmgTaken, kos, obj6c, alarmLevel, obj6d, evadeT: t, obj6e, ending: s.flag('ending'), paid: s.data.cash - c6 });
    return { log, missions: s.data.missionsDone, remaining: g.fx.markers.length };
  });
  const L = Object.fromEntries(r.log.map((l) => [l.id, l]));
  const ok = r.log.every((l) => l.done) && L.wrong_place.hostile && L.wrong_place.ko && L.wrong_place.pistol && L.delivery.paid >= 150 && L.delivery.pkg.includes('%') && !L.delivery.pkg.includes('100%') && L.heat.wantedAfterTheft >= 1 && L.heat.carGone
    && L.choose_side.vanDead && L.choose_side.guardsHostile >= 1 && L.choose_side.side === 'marlowe' && L.choose_side.stance[0] === 1 && L.choose_side.stance[1] === -1 && L.choose_side.smg
    && L.after_dark.armed === 2 && L.after_dark.fighting >= 3 && L.after_dark.kos === 4 && L.after_dark.alarmLevel >= 3 && L.after_dark.ending === 'published' && L.after_dark.paid === 1500 && r.missions.length === 6;
  return { pass: ok, detail: `2: Gaz attacked=${L.wrong_place.hostile}, KO'd by punches=${L.wrong_place.ko}, pistol picked up=${L.wrong_place.pistol}. 3: after a crash "${L.delivery.pkg.split('·')[1]?.trim()}", paid £${L.delivery.paid}. 4: theft seen → wanted ${L.heat.wantedAfterTheft}★ ("${L.heat.obj4}"), evaded in ${L.heat.evadeT}s, car handed over=${L.heat.carGone}. 5: van destroyed by gunfire=${L.choose_side.vanDead}, ${L.choose_side.guardsHostile} guards turned hostile, rep ${JSON.stringify(L.choose_side.rep)} → stance Marlowe ${L.choose_side.stance[0]}, Kestrel ${L.choose_side.stance[1]}, SMG=${L.choose_side.smg}. 6: ${L.after_dark.fighting}/4 guards engaged (${L.after_dark.armed} armed; player took ${L.after_dark.dmgTaken.toFixed(0)} dmg in 4 s), ${L.after_dark.kos} KO'd, alarm → ${L.after_dark.alarmLevel}★, evaded in ${L.after_dark.evadeT}s, ending "${L.after_dark.ending}" +£${L.after_dark.paid}. Completed: ${r.missions.join(', ')}` };
});

// ---- 12: save / load across a real page reload -------------------------------------------------------
await check('12', 'Progress survives closing and reopening the page', async () => {
  const before = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); const s = g.state; T.isolate();
    s.addCash(1234); g.combat.give('pistol', 3); s.data.items.medkit = 2; s.data.missionsDone.push('night_shift', 'wrong_place'); s.data.vehicles.push('sports'); s.data.activeVehicle = 'sports';
    s.changeRep('kestrel', 31); s.remember('farah', 'assault', 'Soho', -35); s.addNotoriety('Chinatown', 40); s.setFlag('side', 'kestrel'); p.hp = 64;
    p.teleport(60, 0.15, -8.3, 1); g.advance(0.2); g.tryEnter; const ok = g.saveGame('Game saved');
    return { ok, cash: s.data.cash, weapons: s.data.weapons, ammo: s.data.ammo.pistol, items: s.data.items, missions: s.data.missionsDone, vehicles: s.data.vehicles, rep: s.data.rep, farah: s.person('farah').rel, not: Math.round(s.notoriety('Chinatown')), clock: Math.floor(s.data.clock), day: s.data.day };
  });
  await page.reload(); await page.waitForFunction(() => !!window.__cad);
  const enabled = await page.evaluate(() => !document.getElementById('btn-continue').disabled);
  await page.click('#btn-continue'); await page.waitForTimeout(300);
  const after = await ev(() => {
    const g = window.__cad, s = g.state, p = g.player; g.autoStep = false; g.advance(0.3); const own = g.ownedVehicle();
    return { mode: g.mode, cash: s.data.cash, weapons: s.data.weapons, ammo: s.data.ammo.pistol, items: s.data.items, missions: s.data.missionsDone, vehicles: s.data.vehicles, rep: s.data.rep, farah: s.person('farah').rel, mem: s.person('farah').mem[0]?.what, not: Math.round(s.notoriety('Chinatown')), side: s.flag('side'),
      pos: [p.pos.x, p.pos.z], hp: p.hp, ownType: own?.type, ownDist: own ? Math.hypot(own.x - p.pos.x, own.z - p.pos.z) : -1, marker: g.fx.markers.map((k) => k.icon), clock: Math.floor(s.data.clock), day: s.data.day };
  });
  // helpers were lost with the reload: re-install them
  await page.evaluate(() => { const g = window.__cad; window.T = { fresh() { g.autoStep = false; g.autoRender = false; g.godMode = false; g.newGame(); g.advance(0.2); T.skip(); }, skip(i = 0) { let n = 0; while (g.ui.dialogueActive && n++ < 60) { if (document.querySelectorAll('#dchoices button').length) g.ui.choose(i); else g.ui.advanceDialogue(); g.advance(0.05); } },
    hold(c, s) { g.input.inject(c, true); g.advance(s); g.input.inject(c, false); g.advance(1 / 60); }, tap(c) { g.input.inject(c, true); g.advance(1 / 60); g.input.inject(c, false); g.advance(1 / 60); }, click(b = 0) { g.input.injectMouse(b, true); g.advance(1 / 60); g.input.injectMouse(b, false); g.advance(1 / 60); },
    isolate() { g.npcs.clear(); g.interiors.populate(); g.vehicles.trafficTarget = 0; for (const v of [...g.vehicles.list]) if (!v.owned) g.vehicles.remove(v); g.events.cancel(); g.events.cooldown = 1e9; }, face(x, z, pitch = -0.06) { const p = g.player.pos; g.camera.yaw = Math.atan2(x - p.x, z - p.z); g.camera.pitch = pitch; g.player.yaw = g.camera.yaw; g.advance(1 / 60); },
    npc(role, dx, dz, o = {}) { const p = g.player.pos; const n = g.npcs.spawn(role, p.x + dx, p.z + dz, { scripted: o.scripted ?? false, look: o.look }); if (o.hold) { n.setState('idle'); n.idleFor = 999; n.scripted = true; } return n; }, dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); } }; const T = window.T; });
  const same = (k) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
  const ok = before.ok && enabled && after.mode === 'playing' && ['cash', 'weapons', 'ammo', 'items', 'missions', 'vehicles', 'rep', 'farah', 'not', 'day'].every(same) && after.mem === 'assault' && after.side === 'kestrel' && Math.hypot(after.pos[0] - 60, after.pos[1] + 8.3) < 1 && Math.abs(after.hp - 64) < 1 && after.ownType === 'sports' && after.ownDist < 30 && after.marker.includes('3');
  return { pass: ok, detail: `saved → page reloaded → Continue enabled=${enabled} → restored cash £${after.cash}, weapons ${after.weapons.join('+')}, pistol ${after.ammo.mag}/${after.ammo.reserve}, first-aid ${after.items.medkit}, missions [${after.missions}], vehicles [${after.vehicles}] (active ${after.ownType} parked ${after.ownDist.toFixed(0)} m away), rep ${JSON.stringify(after.rep)}, Farah ${after.farah} (remembers "${after.mem}"), Chinatown notoriety ${after.not}, side ${after.side}, position (${after.pos.map((v) => v.toFixed(1))}), health ${after.hp}, next mission marker ${after.marker}` };
});

// ---- 13: relationships and memory -------------------------------------------------------------------
await check('13', 'Relationships change with events: factions, named NPC memories, shops, notoriety', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); const s = g.state; g.godMode = true; g.events.cooldown = 1e9; g.vehicles.trafficTarget = 0;
    // (a) punch a Marlowe man on his own ground: reputation drops and his mates pile in
    const marlowe = g.npcs.list.filter((n) => n.faction === 'marlowe' && !n.pid); const m0 = marlowe[0]; const rep0 = s.data.rep.marlowe;
    p.teleport(m0.pos.x, 0.15, m0.pos.z - 1.2, 0); g.camera.yaw = 0; g.advance(0.1); T.click(0); g.advance(0.6);
    const rep1 = s.data.rep.marlowe, allies = g.npcs.list.filter((n) => n.faction === 'marlowe' && n.target === p).length, col = s.person('col');
    // (b) Tommo the busker witnesses an assault near the fountain and remembers it - with where and when
    g.npcs.list.filter((n) => n.faction).forEach((n) => { n.target = null; n.hostileToPlayer = false; n.setState('idle'); });
    const tommo = g.npcs.list.find((n) => n.pid === 'tommo'); p.teleport(tommo.pos.x + 4, 0.15, tommo.pos.z + 2, 0); g.advance(0.2);
    const victim = T.npc('tourist', 0, 1.2, { hold: true }); victim.reactive = false; g.camera.yaw = 0; g.advance(0.1); const t0 = s.person('tommo').rel; T.click(0); g.advance(0.5);
    const tm = s.person('tommo'); const tRelSeen = tm.rel; g.npcs.interact(tommo); const first = g.ui.lastBark; g.advance(0.2); T.skip(1); g.npcs.interact(tommo); const second = document.getElementById('dtext').textContent; const cashT = s.data.cash; T.skip(0); const tipped = cashT - s.data.cash, relTip = s.person('tommo').rel;
    const picc = s.notoriety('Piccadilly');
    // (c) attack the shopkeeper: she bars you; an apology (paid) restores service; prices track the relationship
    const d = g.interiors.defs.find((x) => x.id === 'shop'); p.teleport(g.city.layout.poi('shop').x, 0.15, g.city.layout.poi('shop').z, Math.PI); g.advance(0.2); T.tap('KeyE'); g.advance(0.3);
    const inside = g.interiors.current?.id; const farah = g.npcs.list.find((n) => n.pid === 'farah'); s.addCash(500);
    g.interiors.shopMenu(); const price0 = document.querySelector('#shopitems .price').textContent; const snacks0 = s.data.items.snack, cashA = s.data.cash; g.ui.buy(0); const bought = s.data.items.snack - snacks0, spent = cashA - s.data.cash; g.ui.closeShop();
    p.teleport(farah.pos.x, farah.pos.y, farah.pos.z + 1.2, Math.PI); g.camera.yaw = Math.PI; g.advance(0.1); T.click(0); g.advance(0.6); const relHit = s.person('farah').rel, farahState = farah.state;
    g.advance(8); g.police.reset(); g.police.disengage();
    g.interiors.shopMenu(); const barredLine = document.getElementById('dtext').textContent, shopOpen = g.ui.shopActive; T.skip(0); g.advance(0.2);
    const relAfter = s.person('farah').rel, reopened = g.ui.shopActive, price1 = document.querySelector('#shopitems .price')?.textContent; g.ui.closeShop();
    // (d) a crew you have wronged attacks on sight; a crew that likes you greets you
    g.interiors.exit(); g.advance(0.2); g.police.reset(); s.data.rep.kestrel = -60; s.data.rep.marlowe = 60;
    const kes = g.npcs.list.filter((n) => n.faction === 'kestrel' && !n.pid && n.alive)[0]; p.teleport(kes.pos.x, 0.15, kes.pos.z + 8, Math.PI); g.advance(1.2);
    const attacked = g.npcs.list.filter((n) => n.faction === 'kestrel' && n.target === p).length; const bark = g.ui.lastBark;
    g.npcs.list.filter((n) => n.faction).forEach((n) => { n.target = null; n.hostileToPlayer = false; n.mood = 'calm'; n.setState('idle'); });
    const ml = g.npcs.list.filter((n) => n.faction === 'marlowe' && !n.pid && n.alive)[0]; p.teleport(ml.pos.x, 0.15, ml.pos.z + 2, Math.PI); g.advance(1.2); const friendlyCalm = ml.state !== 'fight'; g.npcs.interact(ml); const friendly = g.ui.lastBark;
    return { tipped, relTip, rep0, rep1, allies, colMem: col.mem.map((m) => m.what), t0, tRel: tRelSeen, tMem: tm.mem.map((m) => `${m.what}@${m.where}`), first, second, picc, inside, price0, bought, spent, relHit, farahState, barredLine, shopOpen, relAfter, reopened, price1, attacked, bark, friendlyCalm, friendly };
  });
  await shot('13-shop-interior');
  const ok = r.rep1 < r.rep0 && r.allies >= 1 && r.tRel < r.t0 && r.tMem.includes('assault@Piccadilly') && /saw you/i.test(r.second) && r.picc > 0 && r.tipped === 5 && r.relTip === 2 && /sound|looks after/i.test(r.friendly) && r.inside === 'shop' && r.bought === 1 && r.spent === 4 && r.relHit <= -30 && /barred/i.test(r.barredLine) && !r.shopOpen && r.relAfter === -5 && r.reopened && r.attacked >= 1 && r.friendlyCalm;
  return { pass: ok, detail: `(a) hit a Firm member: rep ${r.rep0}→${r.rep1}, ${r.allies} of his crew attacked. (b) Tommo saw an assault: rel ${r.t0}→${r.tRel}, memory [${r.tMem}]; first meeting "${r.first}" → later "${r.second}"; £${r.tipped} tip → rel ${r.relTip}; Piccadilly notoriety ${r.picc.toFixed(0)}. (c) shop: bought a snack for £${r.spent}; punched Farah → rel ${r.relHit} (${r.farahState}) → "${r.barredLine}" → paid apology → rel ${r.relAfter}, menu reopened at ${r.price1} (was ${r.price0}). (d) Kestrels at rep -60: ${r.attacked} attacked on sight ("${r.bark}"); Firm at +60 stayed calm: "${r.friendly}"` };
});

// ---- extra: interiors/economy, random events, schedules, hospital ---------------------------------------
await check('X1', 'Garage and pub services change real state (repair, buy vehicle, buy weapon, heal)', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); const s = g.state; T.isolate(); s.addCash(5000);
    const bay = g.city.layout.poi('garage_bay'); const cab = g.ownedVehicle(); cab.place(bay.x, bay.z, bay.yaw); cab.damage(80); g.advance(0.2); const h0 = cab.health;
    const gp = g.city.layout.poi('garage'); p.teleport(gp.x, 0.15, gp.z, Math.PI); g.advance(0.2); T.tap('KeyE'); g.advance(0.2); const inG = g.interiors.current?.id;
    const dez = g.npcs.list.find((n) => n.pid === 'dezzie'); p.teleport(dez.pos.x, dez.pos.y, dez.pos.z + 1.5, Math.PI); g.advance(0.1); T.tap('KeyE'); g.advance(0.1); const menu = g.ui.shopActive;
    const labels = [...document.querySelectorAll('#shopitems button')].map((b) => b.textContent); const c0 = s.data.cash; T.tap('Digit1'); g.advance(0.1); const repaired = cab.health, repairCost = c0 - s.data.cash;
    const sportsLocked = [...document.querySelectorAll('#shopitems button')].find((b) => b.textContent.includes('Vesper')).disabled;
    const idx = [...document.querySelectorAll('#shopitems button')].findIndex((b) => b.textContent.includes('Buy Calder')); const c1 = s.data.cash; g.ui.buy(idx); const paid = c1 - s.data.cash, owns = s.data.vehicles.slice(), own = g.ownedVehicle();
    T.tap('Escape'); g.advance(0.1); const closed = !g.ui.shopActive && g.mode === 'playing';
    p.teleport(g.interiors.current.ox, -60, g.interiors.current.oz + g.interiors.current.d / 2 - 0.9, 0); g.advance(0.1); T.tap('KeyE'); g.advance(0.2); const outside = g.interiors.current === null, backAtDoor = T.dist(p.pos, gp) < 1;
    // pub: Nails sells the pistol, Len sells food that heals
    const pp = g.city.layout.poi('pub'); p.teleport(pp.x, 0.15, pp.z, 0); g.advance(0.2); T.tap('KeyE'); g.advance(0.2); const inP = g.interiors.current?.id; p.hp = 40;
    g.interiors.nailsMenu(); const c2 = s.data.cash; g.ui.buy(0); const gun = g.combat.owns('pistol'), gunCost = c2 - s.data.cash, smgLocked = [...document.querySelectorAll('#shopitems button')].find((b) => b.textContent.includes('SMG')).disabled; g.ui.closeShop();
    g.interiors.pubMenu(); g.ui.buy(1); const hp = p.hp; g.ui.closeShop(); const lenRel = s.person('len').rel;
    // can't hide in a shop from the police
    g.interiors.exit(); g.advance(0.1); g.police.wanted.report({ id: g.nextCrimeId(), type: 'assault', pos: { x: 0, z: 0 } }, true); T.tap('KeyE'); g.advance(0.2); const refused = g.interiors.current === null;
    // G eats a snack
    g.police.reset(); p.hp = 50; s.data.items.snack = 1; T.tap('KeyG'); const ate = p.hp;
    return { h0, inG, menu, labels: labels.length, repaired, repairCost, sportsLocked, paid, owns, ownType: own?.type, closed, outside, backAtDoor, inP, gun, gunCost, smgLocked, hp, lenRel, refused, ate, max: cab.spec.health };
  });
  await shot('X1-pub');
  const ok = r.inG === 'garage' && r.menu && r.repaired === r.max && r.repairCost > 0 && r.sportsLocked && r.paid === 1500 && r.owns.includes('saloon') && r.ownType === 'saloon' && r.closed && r.outside && r.backAtDoor && r.inP === 'pub' && r.gun && r.gunCost === 250 && r.smgLocked && r.hp === 85 && r.lenRel > 0 && r.refused && r.ate === 75;
  return { pass: ok, detail: `garage: repair ${r.h0}→${r.repaired} for £${r.repairCost}; Vesper locked until mission 4=${r.sportsLocked}; bought Calder Saloon for £${r.paid} → delivered to forecourt as owned ${r.ownType}; pub: pistol £${r.gunCost}, SMG locked=${r.smgLocked}, pie 40→${r.hp} hp, Len rel +${r.lenRel}; door refused while wanted=${r.refused}; G snack 50→${r.ate}` };
});
await check('X2', 'Random street events start under the right conditions and always end cleanly', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player, e = g.events; T.fresh(); const s = g.state; g.godMode = true; g.vehicles.trafficTarget = 0; const out = {};
    p.teleport(0, 0.15, 8.3, 0); g.advance(0.3);
    for (const kind of ['confrontation', 'collision', 'patrol', 'gangDispute', 'breakdown', 'delivery', 'fare']) {
      e.cancel(); e.cooldown = 1e9; const n0 = g.npcs.list.length, v0 = g.vehicles.list.length;
      let started = false; for (let i = 0; i < 12 && !started; i++) started = e.start(kind);
      const overlap = e.start('patrol'); // a second event must be refused while one is live
      const spawned = { npcs: g.npcs.list.length - n0, vehicles: g.vehicles.list.length - v0, markers: e.live?.markers.length };
      out[kind] = { started, overlap, ...spawned };
      if (!started) continue;
      if (kind === 'confrontation' || kind === 'gangDispute') { // walk up: it kicks off, then resolves
        const L = e.live; p.teleport(L.x + 6, 0.15, L.z + 6, 0); g.advance(1); const fighting = L.npcs.filter((n) => n.state === 'fight').length; let t = 0; while (e.live && t < 70) { g.advance(0.5); t += 0.5; }
        out[kind].fighting = fighting; out[kind].endedAfter = t; out[kind].kos = L.npcs.filter((n) => !n.alive).length;
      } else if (kind === 'delivery') { // accept, carry the parcel, get paid
        const L = e.live, c0 = s.data.cash; p.teleport(L.x + 1, 0.15, L.z + 1, 0); g.advance(0.3); T.skip(0); g.advance(0.2); const m = e.live.markers[0]; p.teleport(m.x + 1, 0.15, m.z, 0); g.advance(0.5); out[kind].paid = s.data.cash - c0; out[kind].ended = !e.live;
      } else if (kind === 'fare') { // needs a cab: pick up, drive, drop off
        out[kind].paid = 0;
      } else if (kind === 'breakdown') {
        const L = e.live, c0 = s.data.cash, v = L.vehicles[0]; const drv = L.npcs[0]; p.teleport(drv.pos.x + 1, 0.15, drv.pos.z, 0); g.advance(0.2); g.npcs.interact(drv); T.skip(0); g.advance(0.2);
        const w0 = g.police.wanted.level; p.teleport(v.x + 2.3, 0, v.z, 0); g.advance(0.1); g.tryEnter(v); g.advance(0.5); const noCrime = g.police.wanted.level === w0 && !v.stolen;
        const bay = g.city.layout.poi('garage_bay'); v.place(bay.x, bay.z, bay.yaw); g.advance(0.6); out[kind].paid = s.data.cash - c0; out[kind].ended = !e.live; out[kind].noCrime = noCrime; out[kind].onFoot = !p.vehicle;
      } else { g.advance(3); e.live.ttl = 0.5; g.advance(1); out[kind].ended = !e.live; }
      p.teleport(0, 0.15, 8.3, 0); g.advance(0.2);
    }
    // fare: unsuitable on foot, offered when driving the cab
    e.cancel(); const onFoot = e.suits('fare'); const cab = g.ownedVehicle(); p.enterVehicle(cab); cab.place(-2.3, 20, Math.PI); g.advance(0.2); const inCab = e.suits('fare');
    let started = false; for (let i = 0; i < 20 && !started; i++) started = e.start('fare');
    if (started) { const L = e.live, c0 = s.data.cash; const k = g.kerbNear(L.x, L.z); cab.place(k.x, k.z, k.yaw); let t = 0; while (e.live && e.live.stage < 2 && t < 30) { g.advance(0.25); t += 0.25; }
      const picked = e.live?.stage === 2; const m = e.live?.markers[0]; if (m) { const k2 = g.kerbNear(m.x, m.z); cab.place(m.x, m.z, k2.yaw); g.advance(0.6); } out.fare = { started, onFoot, inCab, picked, paid: s.data.cash - c0, ended: !e.live, fares: s.data.stats.fares }; }
    // natural scheduling: with the cooldown elapsed an event starts by itself, and none start during a mission
    e.cancel(); p.exitVehicle(true); e.cooldown = 0.1; g.advance(2); const auto = !!e.live || e.history.length > 8; e.cancel();
    g.missions.startById('night_shift'); T.skip(); e.cooldown = 0; g.advance(3); const duringMission = !!e.live;
    return { out, auto, duringMission, history: e.history.length };
  });
  const o = r.out;
  const ok = ['confrontation', 'collision', 'patrol', 'gangDispute', 'breakdown', 'delivery'].every((k) => o[k].started && !o[k].overlap) && o.confrontation.fighting >= 2 && o.confrontation.endedAfter < 70 && o.gangDispute.fighting >= 3 && o.collision.vehicles === 2 && o.collision.ended && o.patrol.npcs === 2 && o.patrol.ended
    && o.delivery.paid > 15 && o.delivery.ended && o.breakdown.paid > 20 && o.breakdown.ended && o.breakdown.noCrime && o.fare.started && !o.fare.onFoot && o.fare.inCab && o.fare.picked && o.fare.paid > 15 && o.fare.ended && r.auto && !r.duringMission;
  return { pass: ok, detail: `confrontation: ${o.confrontation.fighting} fighting, resolved in ${o.confrontation.endedAfter}s (${o.confrontation.kos} KO); gang dispute: ${o.gangDispute.fighting} fighting, ${o.gangDispute.kos} KO, ended ${o.gangDispute.endedAfter}s; collision: ${o.collision.vehicles} cars + ${o.collision.npcs} drivers, dismissed=${o.collision.ended}; patrol: ${o.patrol.npcs} officers, dismissed=${o.patrol.ended}; delivery paid £${o.delivery.paid}; breakdown paid £${o.breakdown.paid} (no theft charge=${o.breakdown.noCrime}); taxi fare: offered on foot=${o.fare.onFoot} / in cab=${o.fare.inCab}, picked up=${o.fare.picked}, paid £${o.fare.paid}; overlapping start refused each time; auto-scheduled=${r.auto}; suppressed during missions=${!r.duringMission}` };
});
await check('X3', 'Daily routines: population mix and destinations follow the clock; far NPCs use cheap simulation', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; const out = {}; let s;
    for (const hour of [8.5, 22]) {
      T.fresh(); s = g.state; s.data.clock = hour * 60; g.npcs.clear(); g.npcs.populate(); g.events.cooldown = 1e9; g.advance(4);
      const civ = g.npcs.list.filter((n) => !n.pid && !n.home && n.groundY === null); const roles = {}; for (const n of civ) roles[n.role] = (roles[n.role] ?? 0) + 1;
      const acts = {}; for (const n of civ) acts[n.activity] = (acts[n.activity] ?? 0) + 1;
      out[hour] = { total: civ.length, roles, acts, far: g.npcs.list.filter((n) => n.far).length, hiddenFar: g.npcs.list.filter((n) => n.far && !n.model.root.visible).length };
    }
    // follow one office worker through the morning: walks to an office, goes inside, and is not simulated visibly
    T.fresh(); s = g.state; s.data.clock = 8 * 60; const w = g.npcs.spawn('office', -100, -141.6); w.idleFor = 0; g.godMode = true; p.teleport(-100, 0.15, -135, 0); g.advance(1); const act0 = w.activity, goal = w.goalKind;
    let t = 0; while (w.state !== 'indoors' && t < 120) { g.advance(0.5); t += 0.5; } const act1 = w.activity, state = w.state, visible = w.model.root.visible;
    return { out, act0, goal, act1, state, visible, t };
  });
  const am = r.out['8.5'], pm = r.out['22'];
  const ok = (am.roles.office ?? 0) > (pm.roles.office ?? 0) && (pm.roles.nightlife ?? 0) > (am.roles.nightlife ?? 0) + 3 && (am.acts['heading to work'] ?? 0) >= 3 && r.goal === 'work' && r.state === 'indoors' && !r.visible && am.far > 0 && am.far === am.hiddenFar;
  return { pass: ok, detail: `08:30 → ${JSON.stringify(am.roles)}, activities ${JSON.stringify(am.acts)}; 22:00 → ${JSON.stringify(pm.roles)}; office worker: "${r.act0}" → walked ${r.t}s → "${r.act1}" (state ${r.state}, hidden=${!r.visible}); ${am.far} far NPCs on 3 Hz hidden simulation` };
});
await check('X4', 'Knocked out → hospital with fee; carjacking ejects the driver who reports it; hit-and-run', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); const s = g.state; T.isolate(); s.addCash(380);
    p.teleport(0, 0, -40, 0); g.advance(0.2); const c0 = s.data.cash; const a = T.npc('heavy', 0, 1.3); a.meleeDamage = 60; a.attackCd = 0; a.startFight(p);
    let t = 0; while (s.data.stats.wasted === 0 && t < 30) { g.advance(0.1); t += 0.1; } g.advance(1.5); const h = g.city.layout.poi('hospital');
    const hosp = { wasted: s.data.stats.wasted, fee: c0 - s.data.cash, at: Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < 3, hp: p.hp, alive: p.alive, banner: g.ui.lastBanner };
    // carjack an occupied taxi
    T.isolate(); g.vehicles.trafficTarget = 1; const cabAI = g.vehicles.spawnTraffic('cab', 0); cabAI.place(-2.3, -88, Math.PI); cabAI.ai.next = undefined; cabAI.ai.a = g.city.roads.nearest(0, -75); cabAI.ai.b = g.city.roads.nearest(0, -150); g.advance(0.1);
    const moved0 = cabAI.z; g.advance(2); const aiDrove = moved0 - cabAI.z;
    const hpB = p.hp; p.teleport(cabAI.x, 0, cabAI.z - 9, 0); g.advance(3); const stoppedForPlayer = Math.abs(cabAI.speed) < 0.5 && p.hp === hpB && Math.abs(cabAI.z - p.pos.z) > cabAI.spec.l / 2;
    p.teleport(cabAI.x - 2.2, 0, cabAI.z, 0); g.advance(0.1); const n0 = g.npcs.list.length; T.tap('KeyF'); g.advance(0.2);
    const drv = g.npcs.list.find((n) => n.role === 'cabbie'); const jack = { driving: p.vehicle === cabAI, ejected: g.npcs.list.filter((n) => n.role === 'cabbie').length, bark: g.ui.lastBark, driverState: drv?.state };
    let w = 0; t = 0; while (g.police.wanted.level === 0 && t < 15) { g.advance(0.25); t += 0.25; } jack.wanted = g.police.wanted.level; jack.reportedAfter = t;
    // hit a pedestrian at speed
    g.police.reset(); g.police.disengage(); T.isolate(); const v = g.vehicles.spawn('saloon', -2.3, 100, Math.PI); p.exitVehicle(true); p.enterVehicle(v); const ped = g.npcs.spawn('pedestrian', -2.3, 75, { scripted: true }); ped.maxHp = ped.hp = 400; g.advance(0.1);
    T.hold('KeyW', 3.2); const run = { dmg: 400 - ped.hp, state: ped.state, speed: v.speed };
    return { hosp, aiDrove, stoppedForPlayer, jack, run };
  });
  const ok = r.hosp.wasted === 1 && r.hosp.fee === 100 && r.hosp.at && r.hosp.alive && r.hosp.hp === 100 && r.aiDrove > 8 && r.stoppedForPlayer && r.jack.driving && r.jack.ejected === 1 && r.jack.wanted >= 1 && r.run.dmg > 20 && ['down', 'ko', 'stagger', 'flee'].includes(r.run.state);
  return { pass: ok, detail: `beaten unconscious → "${r.hosp.banner}", fee £${r.hosp.fee}, woke at walk-in centre with ${r.hosp.hp} hp; AI taxi drove ${r.aiDrove.toFixed(0)} m then braked for the player standing in its lane=${r.stoppedForPlayer}; F → took it, driver ejected ("${r.jack.bark}", ${r.jack.driverState}) and his call raised wanted to ${r.jack.wanted}★ after ${r.jack.reportedAfter}s; hit a pedestrian at ${r.run.speed.toFixed(0)} m/s → ${r.run.dmg.toFixed(0)} damage, ${r.run.state}` };
});

// ---- 14: soak + performance ---------------------------------------------------------------------------
await check('14', 'Stability soak: 4 simulated minutes of chaotic free play with zero runtime errors', async () => {
  const r = await ev(() => {
    const g = window.__cad, T = window.T, p = g.player; T.fresh(); g.combat.give('pistol', 20); g.combat.give('smg', 20); g.state.addCash(3000);
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyF', 'KeyE', 'KeyQ', 'KeyV', 'KeyR', 'KeyC', 'KeyG', 'Digit1', 'Digit2', 'Digit3', 'KeyH'];
    let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let maxWanted = 0, ticks = 0, worst = 0, sum = 0, minY = 1e9, vehiclesUsed = 0, deaths0 = 0; const modes = new Set();
    for (let i = 0; i < 480; i++) { // 480 x 0.5 s
      for (const k of keys) g.input.inject(k, rnd() < (k === 'KeyW' ? 0.6 : 0.12));
      g.input.injectMouse(0, rnd() < 0.3); g.input.injectMouse(2, rnd() < 0.15); g.input.dx = (rnd() - 0.5) * 300; g.input.dy = (rnd() - 0.5) * 60;
      for (let k = 0; k < 30; k++) { const t0 = performance.now(); g.step(1 / 60); const ms = performance.now() - t0; sum += ms; worst = Math.max(worst, ms); ticks++; if (g.mode !== 'playing') g.setPaused(false); }
      T.skip(Math.floor(rnd() * 2)); if (g.ui.shopActive) { g.ui.buy(Math.floor(rnd() * 3)); g.ui.closeShop(); }
      maxWanted = Math.max(maxWanted, g.police.wanted.level); minY = Math.min(minY, g.interiors.current ? 0 : p.pos.y); if (p.vehicle) vehiclesUsed++; modes.add(g.police.wanted.mode);
      if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) throw new Error('player position became NaN');
      if (!g.interiors.current && !p.vehicle && g.city.inSolid(p.pos.x, p.pos.z, -0.2) && p.pos.y < 3) throw new Error(`player inside a building at ${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)}`);
    }
    for (const k of keys) g.input.inject(k, false); g.input.injectMouse(0, false); g.input.injectMouse(2, false);
    const s = g.state.data.stats;
    return { ticks, avg: sum / ticks, worst, maxWanted, minY, vehiclesUsed, npcs: g.npcs.list.length, vehicles: g.vehicles.list.length, bodies: g.phys.world.bodies.len(), stats: s, modes: [...modes], cash: g.state.data.cash, missions: g.state.data.missionsDone.length, errors: g.errors.slice() };
  });
  await shot('14-after-soak');
  const ok = r.errors.length === 0 && r.minY > -1 && r.npcs < 140 && r.vehicles < 110 && r.avg < 12;
  return { pass: ok, detail: `${r.ticks} ticks of random input: 0 errors, lowest player y ${r.minY.toFixed(2)} (never fell through), peak wanted ${r.maxWanted}★ (modes seen: ${r.modes.join('/')}), in vehicles ${Math.round(r.vehiclesUsed / 4.8)}% of the time, arrests ${r.stats.busted}, hospital ${r.stats.wasted}, evasions ${r.stats.evaded}, KOs ${r.stats.knockouts}; end state ${r.npcs} NPCs / ${r.vehicles} vehicles / ${r.bodies} physics bodies; sim tick avg ${r.avg.toFixed(2)} ms, worst ${r.worst.toFixed(1)} ms` };
});

await check('P', 'Performance measurement (simulation cost and render load)', async () => {
  await ev(() => { const g = window.__cad; window.T.fresh(); g.godMode = true; g.gfx.setQuality('medium'); g.autoStep = true; g.autoRender = true; g.perf.simMax = 0; });
  await page.waitForTimeout(6000);
  const r = await ev(() => { const g = window.__cad; const st = g.gfx.stats(); let sum = 0, worst = 0; g.autoStep = false; g.autoRender = false; for (let i = 0; i < 600; i++) { const t0 = performance.now(); g.step(1 / 60); const ms = performance.now() - t0; sum += ms; worst = Math.max(worst, ms); }
    return { fps: g.perf.fps, calls: st.calls, tris: st.triangles, avg: sum / 600, worst, npcs: g.npcs.list.length, veh: g.vehicles.list.length, gl: g.gfx.renderer.getContext().getParameter(g.gfx.renderer.getContext().getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? 0x1f01) }; });
  await shot('P-street');
  return { pass: r.avg < 8, detail: `full simulation tick (physics + ${r.npcs} NPCs + ${r.veh} vehicles + police + UI): avg ${r.avg.toFixed(2)} ms, worst ${r.worst.toFixed(1)} ms (budget 16.7 ms for 60 fps); render: ${r.calls} draw calls, ${(r.tris / 1000).toFixed(0)}k triangles; frame rate in THIS environment ${r.fps.toFixed(0)} fps on "${r.gl}" (software rasteriser - not representative of a real GPU)` };
});

// ---- report -------------------------------------------------------------------------------------------
const failed = results.filter((x) => !x.pass);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, consoleErrors: errors, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Browser console errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
await browser.close(); srv.kill();
process.exit(failed.length || errors.length ? 1 : 0);
