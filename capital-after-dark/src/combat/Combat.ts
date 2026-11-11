// Player combat: melee combos, kicks, blocking, firearms (hitscan), ammo and reloading.
// A hit is only ever "real" because it calls takeDamage()/damage() on the target's actual state.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Npc } from '../npc/Npc';
import { angleDiff, dist2, fwdX, fwdZ, yawTo } from '../core/util';
import { Combatant, WEAPONS, WeaponDef } from './types';

const COMBO: { kind: 'jab' | 'cross' | 'hook'; dur: number; dmg: number; heavy: boolean }[] = [
  { kind: 'jab', dur: 0.3, dmg: 12, heavy: false }, { kind: 'cross', dur: 0.34, dmg: 15, heavy: false }, { kind: 'hook', dur: 0.48, dmg: 26, heavy: true }];

export class Combat {
  current = 'fists';
  private cd = 0; reloadT = 0; private comboStep = 0; private comboTimer = 0;
  private a = new THREE.Vector3(); private b = new THREE.Vector3();
  shotsFired = 0; hitsLanded = 0; // stats (also used by tests)
  constructor(private g: Game) {}
  get weapon(): WeaponDef { return WEAPONS[this.current]; }
  ammo(id = this.current): { mag: number; reserve: number } { return (this.g.state.data.ammo[id] ??= { mag: 0, reserve: 0 }); }
  owns(id: string): boolean { return this.g.state.data.weapons.includes(id); }

  /** Add a weapon (first time: loaded magazine) and/or spare magazines. */
  give(id: string, mags = 1): void {
    const d = this.g.state.data, w = WEAPONS[id];
    if (!d.weapons.includes(id)) { d.weapons.push(id); this.ammo(id).mag = w.mag; mags = Math.max(0, mags - 1); }
    this.ammo(id).reserve += w.mag * mags;
  }
  switchTo(id: string): void {
    if (!this.owns(id) || id === this.current) return;
    this.current = id; this.reloadT = 0; this.cd = 0.25;
    this.g.player.gunOut = !WEAPONS[id].melee;
    this.g.player.model.setGun(!WEAPONS[id].melee, id === 'smg');
    this.g.audio.play('ui');
  }
  reload(): void {
    const w = this.weapon, a = this.ammo();
    if (w.melee || this.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return;
    this.reloadT = w.reload; this.g.audio.play('reload');
  }

  update(dt: number): void {
    const g = this.g, p = g.player, inp = g.input;
    this.cd -= dt; this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.comboStep = 0;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const w = this.weapon, a = this.ammo(), n = Math.min(w.mag - a.mag, a.reserve); a.mag += n; a.reserve -= n; }
    }
    if (!this.owns(this.current)) this.switchTo('fists');
    p.gunOut = !this.weapon.melee;
    if (p.vehicle || !p.alive || p.downT > 0 || p.frozen) { p.aiming = false; p.blocking = false; this.resolveMelee(); return; }
    // weapon selection
    const owned = g.state.data.weapons;
    ['Digit1', 'Digit2', 'Digit3'].forEach((k, i) => { if (inp.hit(k) && owned[i]) this.switchTo(owned[i]); });
    if (inp.wheel) this.switchTo(owned[(owned.indexOf(this.current) + Math.sign(inp.wheel) + owned.length) % owned.length]);
    if (inp.hit('KeyR')) this.reload();

    const armed = !this.weapon.melee;
    p.aiming = armed && inp.mouse(2);
    p.blocking = !armed && inp.mouse(2) && !p.attack;
    if (inp.hit('KeyV') && !p.attack && this.cd <= 0) this.startMelee('kick', 0.52, 20, true, 2.1);
    if (armed) {
      const trigger = this.weapon.auto ? inp.mouse(0) : inp.mouseHit(0);
      if (trigger && this.cd <= 0 && this.reloadT <= 0) this.fire();
    } else if (inp.mouseHit(0) && !p.blocking && this.cd <= 0 && (!p.attack || p.attack.t > p.attack.dur * 0.6)) {
      const c = COMBO[this.comboStep % 3];
      this.startMelee(c.kind, c.dur, c.dmg, c.heavy, 1.8);
      this.comboStep++; this.comboTimer = c.dur + 0.5;
    }
    this.resolveMelee();
  }

  private startMelee(kind: 'jab' | 'cross' | 'hook' | 'kick', dur: number, damage: number, heavy: boolean, range: number): void {
    const p = this.g.player;
    // soft lock: turn to the nearest person roughly in front of the camera
    let best: Npc | null = null, bd = 3;
    for (const n of this.g.npcs.list) {
      if (n.far || !n.alive || n.state === 'indoors') continue;
      const d = dist2(p.pos.x, p.pos.z, n.pos.x, n.pos.z);
      if (d < bd && Math.abs(n.pos.y - p.pos.y) < 1.5 && Math.abs(angleDiff(this.g.camera.yaw, yawTo(n.pos.x - p.pos.x, n.pos.z - p.pos.z))) < 1.5) { bd = d; best = n; }
    }
    p.yaw = best ? yawTo(best.pos.x - p.pos.x, best.pos.z - p.pos.z) : this.g.camera.yaw;
    p.attack = { kind, t: 0, dur, done: false, damage, range, heavy };
    this.cd = dur * 0.55;
    this.g.audio.play('whoosh');
    this.g.npcs.onPlayerSwing();
  }

  /** At the contact frame, apply damage to whoever is actually in reach. */
  private resolveMelee(): void {
    const g = this.g, p = g.player, a = p.attack;
    if (!a || a.done || a.t < a.dur * 0.42) return;
    a.done = true;
    let landed = false;
    for (const n of g.npcs.list) {
      if (n.far || n.state === 'indoors' || n.state === 'ko') continue;
      const dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > a.range || Math.abs(n.pos.y - p.pos.y) > 1.4 || Math.abs(angleDiff(p.yaw, yawTo(dx, dz))) > 1.0) continue;
      n.takeDamage(a.damage, p, 'melee', dx / (d || 1), dz / (d || 1), a.heavy);
      g.fx.burst(n.pos.x, n.pos.y + 1.3, n.pos.z, 0xffffff, 3, 0.4);
      landed = true; this.hitsLanded++;
    }
    if (!landed) { // punching a car does (a little) real damage too
      const v = g.vehicles.nearest(p.pos.x + fwdX(p.yaw), p.pos.z + fwdZ(p.yaw), 1.4);
      if (v) { v.damage(a.kind === 'kick' ? 5 : 2); g.audio.play('thud'); landed = true; if (v.driver === 'ai') g.vehicles.scare(v); }
    }
    if (landed) { g.audio.play(a.heavy ? 'hit' : 'punch'); g.camera.kick(a.heavy ? 0.25 : 0.12); p.lastCombat = g.time; }
  }

  private fire(): void {
    const g = this.g, p = g.player, w = this.weapon, am = this.ammo();
    if (am.mag <= 0) { g.audio.play('empty'); this.cd = 0.25; this.reload(); return; }
    am.mag--; this.cd = w.rate; this.shotsFired++;
    p.fireAnim = 0.5; p.lastCombat = g.time;
    const cam = g.gfx.camera, dir = this.a.copy(g.camera.aimDir);
    const spread = w.spread * (p.aiming ? 0.45 : 1.6) * (p.planarSpeed > 3 ? 1.6 : 1);
    dir.x += (Math.random() - 0.5) * spread * 2; dir.y += (Math.random() - 0.5) * spread * 2; dir.z += (Math.random() - 0.5) * spread * 2; dir.normalize();
    const o = cam.position, skip = dist2(o.x, o.z, p.pos.x, p.pos.z) + 0.2;
    const res = this.hitscan(o.x, o.y, o.z, dir.x, dir.y, dir.z, w.range, skip, p);
    const muzzle = this.b.set(p.pos.x + fwdX(p.yaw) * 0.6, p.pos.y + 1.4, p.pos.z + fwdZ(p.yaw) * 0.6);
    const end = new THREE.Vector3(o.x + dir.x * res.dist, o.y + dir.y * res.dist, o.z + dir.z * res.dist);
    g.fx.tracer(muzzle, end); g.fx.muzzle(muzzle);
    g.audio.play(w.id === 'smg' ? 'smg' : 'gun'); g.camera.kick(w.id === 'smg' ? 0.08 : 0.16);
    g.crime('gunfire', { x: p.pos.x, z: p.pos.z });
    if (res.npc) {
      const head = end.y > res.npc.pos.y + 1.5;
      const wasHostile = res.npc.hostileToPlayer;
      res.npc.takeDamage(w.damage * (head ? 1.7 : 1), p, 'bullet', dir.x, dir.z);
      g.fx.burst(end.x, end.y, end.z, 0xffffff, 4, 0.4); this.hitsLanded++;
      if (!wasHostile) g.crime('shooting', { x: res.npc.pos.x, z: res.npc.pos.z }, res.npc);
    } else if (res.vehicle) {
      res.vehicle.damage(w.damage * 0.55); g.fx.burst(end.x, end.y, end.z, 0xffc060, 5, 0.3); this.hitsLanded++;
      if (res.vehicle.driver === 'ai') { g.vehicles.scare(res.vehicle); g.crime(res.vehicle.type === 'police' ? 'assaultOfficer' : 'vandalism', { x: res.vehicle.x, z: res.vehicle.z }); }
      g.bus.emit({ type: 'vehicleShot', vehicle: res.vehicle });
    } else if (res.dist < w.range) g.fx.burst(end.x, end.y, end.z, 0xffc060, 3, 0.25);
    if (am.mag <= 0 && am.reserve > 0) this.reload();
  }

  /** Ray against world geometry, vehicles and people. Returns the first thing hit. */
  hitscan(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, skip: number, shooter: Combatant | null) {
    const g = this.g;
    const wh = g.phys.raycast(ox, oy, oz, dx, dy, dz, range, undefined, g.player.vehicle?.body);
    let dist = wh ? wh.dist : range;
    let npc: Npc | null = null;
    const flat = Math.hypot(dx, dz);
    if (flat > 1e-4) for (const n of g.npcs.list) {
      if (n === shooter || n.far || n.state === 'indoors' || n.state === 'ko') continue;
      // ray vs vertical cylinder (radius 0.42)
      const px = n.pos.x - ox, pz = n.pos.z - oz;
      const tca = (px * dx + pz * dz) / (flat * flat);
      if (tca < 0) continue;
      const cx = px - dx * tca, cz = pz - dz * tca, d2 = cx * cx + cz * cz, r = 0.42;
      if (d2 > r * r) continue;
      const t = tca - Math.sqrt(r * r - d2) / flat;
      if (t < skip / Math.max(flat, 0.2) || t > dist) continue;
      const y = oy + dy * t, top = n.pos.y + (n.state === 'down' ? 0.7 : 1.85);
      if (y < n.pos.y || y > top) continue;
      dist = t; npc = n;
    }
    const vehicle = !npc && wh ? g.vehicles.fromCollider(wh.collider.handle) ?? null : null;
    return { dist, npc, vehicle };
  }

  /** An NPC shoots at a target. Accuracy falls with range; cover and vehicles really block shots. */
  npcFire(n: Npc, target: Combatant, damage: number): void {
    const g = this.g, pl = g.player;
    const ox = n.pos.x, oy = n.pos.y + 1.4, oz = n.pos.z;
    const tx = target.pos.x, ty = target.pos.y + 1.1, tz = target.pos.z;
    const d = Math.hypot(tx - ox, tz - oz);
    const dToPlayer = dist2(ox, oz, pl.pos.x, pl.pos.z);
    g.audio.play('gun', dToPlayer);
    let chance = Math.max(0.12, 0.72 - d * 0.014);
    if (target === pl) { if (pl.planarSpeed > 5 || (pl.vehicle && Math.abs(pl.vehicle.speed) > 8)) chance *= 0.55; if (pl.crouching) chance *= 0.75; if (pl.dodgeT > 0) chance = 0; }
    const hit = Math.random() < chance;
    const miss = hit ? 0 : 0.8 + Math.random() * 1.2;
    const ex = tx + (Math.random() - 0.5) * miss * 2, ey = ty + (Math.random() - 0.3) * miss, ez = tz + (Math.random() - 0.5) * miss * 2;
    const dx = ex - ox, dy = ey - oy, dz = ez - oz, len = Math.hypot(dx, dy, dz);
    const block = g.phys.raycast(ox, oy, oz, dx, dy, dz, len, undefined, target === pl ? pl.vehicle?.body : undefined);
    const end = block ? new THREE.Vector3(block.x, block.y, block.z) : new THREE.Vector3(ex, ey, ez);
    g.fx.tracer(this.a.set(ox, oy, oz), end, 0xffb080); g.fx.muzzle(this.a);
    if (block) { const v = g.vehicles.fromCollider(block.collider.handle); if (v) v.damage(damage * 0.4); g.fx.burst(end.x, end.y, end.z, 0xffc060, 3, 0.25); return; }
    if (hit) target.takeDamage(damage, n, 'bullet', dx / len, dz / len);
  }
}
