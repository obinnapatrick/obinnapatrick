// Fictional London policing: officers notice or are told about offences, pursue, search the last known
// position, try to arrest, escalate with armed response - and stand down once the player is lost.
import type { Game, Crime } from '../core/Game';
import type { Npc } from '../npc/Npc';
import type { Action } from '../render/CharacterModel';
import type { Vehicle } from '../vehicles/Vehicle';
import { dampAngle, dist2, mulberry32, rand, yawTo } from '../core/util';
import { CRIME_LABEL, WantedSystem } from './WantedSystem';

const FOOT = [0, 2, 3, 4, 5, 6], CARS = [0, 1, 1, 2, 3, 4]; // desired units per wanted level
const SIGHT = 55;

export class PoliceManager {
  wanted = new WantedSystem();
  arrest = 0; // 0..1 progress towards being nicked
  visible = false;
  private rnd = mulberry32(999);
  private spawnT = 0; private losT = 0; private resistT = -100;
  private investigator: Npc | null = null;

  constructor(private g: Game) {
    this.wanted.onLevelChange = (l, prev) => {
      g.bus.emit({ type: 'wanted', level: l, prev });
      if (l > prev) { g.audio.play('radio'); g.ui.toast(l === 1 ? 'Police have been alerted' : `Wanted level ${l}`); }
    };
  }
  get officers(): Npc[] { return this.g.npcs.list.filter((n) => (n.role === 'police' || n.role === 'armed') && n.alive); }
  get cars(): Vehicle[] { return this.g.vehicles.list.filter((v) => v.type === 'police' && !v.dead); }

  /** A crime reaches the police: via an officer's own eyes, or a member of the public on the phone. */
  report(c: Crime, identified: boolean, by: Npc | null): void {
    const fresh = this.wanted.report(c, identified);
    if (fresh) {
      this.g.ui.toast(`${by && (by.role === 'police' || by.role === 'armed') ? 'Officer witnessed' : 'Reported to police'}: ${CRIME_LABEL[c.type]}`);
      this.g.state.log('reported', '', CRIME_LABEL[c.type]);
    }
  }
  /** Called when the player strikes an officer or resists. */
  resisted(): void { this.resistT = this.g.time; }

  private canSee(x: number, z: number): boolean {
    const p = this.g.player.pos;
    return dist2(x, z, p.x, p.z) < SIGHT && this.g.city.los(x, z, p.x, p.z);
  }

  update(dt: number): void {
    const g = this.g, p = g.player, w = this.wanted;
    if (g.interiors.current) { // indoors nobody can see you; the search clock keeps running
      this.visible = false;
    } else {
      this.losT -= dt;
      if (this.losT <= 0 || w.level > 0) { // every tick while wanted, so "last known position" is exact
        this.losT = 0.2;
        this.visible = this.officers.some((o) => o.state !== 'down' && !o.far && this.canSee(o.pos.x, o.pos.z)) || this.cars.some((c) => c.crew > 0 && this.canSee(c.x, c.z));
      }
    }
    const res = w.update(dt, this.visible && w.level > 0, { x: p.pos.x, z: p.pos.z });
    if (res === 'evaded') { g.state.data.stats.evaded++; g.ui.toast('You lost the police'); g.audio.play('success'); g.bus.emit({ type: 'evaded' }); this.standDown(); }
    if (w.level === 0) { this.arrest = 0; this.investigate(); return; }

    // engage every officer who can respond
    const officers = this.officers;
    for (const o of officers) if (o.state !== 'police' && o.state !== 'down' && o.state !== 'stagger' && !o.scripted && dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z) < 130) this.engage(o);
    // reinforcements, scaled by wanted level
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 3.5;
      const engaged = officers.filter((o) => o.state === 'police').length;
      const cars = this.cars.filter((c) => c.ai?.mode === 'pursue' && c.crew > 0);
      if (cars.length < CARS[w.level]) this.sendCar();
      else if (engaged + cars.length * 2 < FOOT[w.level]) this.sendFoot();
    }
    this.driveCars(dt);
    this.updateArrest(dt);
  }

  private engage(o: Npc): void {
    o.setState('police'); o.target = this.g.player; o.mood = 'angry'; o.order = null; o.path.length = 0;
    if (this.wanted.level >= 3 && !o.armed) o.setArmed(true, 9);
  }

  /** With no wanted level, one officer walks over to look at an unidentified disturbance. */
  private investigate(): void {
    const inv = this.wanted.investigations[0];
    if (!inv) { if (this.investigator && this.investigator.activity === 'investigating a report') { this.investigator.idleFor = 0; this.investigator = null; } return; }
    if (this.investigator && this.investigator.alive && this.investigator.activity === 'investigating a report') return;
    let best: Npc | null = null, bd = 140;
    for (const o of this.officers) { const d = dist2(o.pos.x, o.pos.z, inv.pos.x, inv.pos.z); if (d < bd && (o.state === 'walk' || o.state === 'idle') && !o.scripted) { bd = d; best = o; } }
    if (!best) return;
    best.goalKind = null; best.goTo(this.g, inv.pos.x, inv.pos.z);
    best.walkSpeed = 3.2; best.activity = 'investigating a report'; this.investigator = best;
    const o = best; o.onArrive = () => { o.walkSpeed = 1.5; o.idleFor = 6; o.activity = 'looking around'; inv.ttl = Math.min(inv.ttl, 6); };
  }

  /** Public stand-down (after an arrest or hospital trip). */
  disengage(): void { this.standDown(); }
  private standDown(): void {
    this.arrest = 0;
    for (const o of this.g.npcs.list) if (o.state === 'police') {
      o.setState('idle'); o.target = null; o.mood = 'calm'; o.hostileToPlayer = false; o.idleFor = rand(1, 4); o.order = null;
      if (o.responder) { o.goalKind = 'tube'; o.goTo(this.g, ...this.exitPoint(o)); } // responders walk off and leave the district
    }
    for (const c of this.cars) if (c.ai) { c.siren = false; if (c.crew > 0) { c.ai.mode = 'traffic'; const R = this.g.city.roads; c.ai.a = R.nearest(c.x, c.z); c.ai.b = R.nodes[c.ai.a].links[0]; c.ai.next = undefined; c.ai.cruise = 9; } else c.ai.mode = 'stop'; }
  }
  private exitPoint(o: Npc): [number, number] { const q = this.g.city.layout.poi(o.pos.x < 0 ? 'tube_picc' : 'tube_leic'); return [q.x, q.z]; }

  private spawnSpot(min: number, max: number): { a: number; b: number; x: number; z: number } | null {
    const R = this.g.city.roads, p = this.g.player.pos;
    for (let i = 0; i < 30; i++) {
      const a = Math.floor(this.rnd() * 25), b = R.nodes[a].links[Math.floor(this.rnd() * R.nodes[a].links.length)], pt = R.lanePoint(a, b, 30);
      const d = dist2(pt.x, pt.z, p.x, p.z);
      if (d < min || d > max || this.g.city.los(pt.x, pt.z, p.x, p.z)) continue;
      if (this.g.vehicles.list.some((v) => dist2(v.x, v.z, pt.x, pt.z) < 12)) continue;
      return { a, b, x: pt.x, z: pt.z };
    }
    return null;
  }
  private sendCar(): void {
    const g = this.g;
    // an existing patrol car answers first
    const patrol = this.cars.find((c) => c.ai && c.ai.mode === 'traffic' && c.crew > 0);
    if (patrol) { patrol.ai!.mode = 'pursue'; patrol.siren = true; return; }
    const s = this.spawnSpot(70, 170); if (!s) return;
    const v = g.vehicles.spawn('police', s.x, s.z, g.city.roads.heading(s.a, s.b));
    v.ai = { mode: 'pursue', a: s.a, b: s.b, cruise: 12, stuck: 0, reverse: 0, token: -1, panic: 0, route: [], routeTimer: 0 };
    v.setDriver('ai'); v.crew = 2; v.siren = true;
  }
  private sendFoot(): void {
    const g = this.g, p = g.player.pos, nav = g.city.nav;
    for (let i = 0; i < 20; i++) {
      const c = nav.randomCorner(this.rnd), d = dist2(c.x, c.z, p.x, p.z);
      if (d < 45 || d > 110 || g.city.los(c.x, c.z, p.x, p.z)) continue;
      const o = g.npcs.spawn(this.wanted.level >= 3 ? 'armed' : 'police', c.x, c.z); o.responder = true;
      this.engage(o); return;
    }
  }

  private driveCars(dt: number): void {
    const g = this.g, p = g.player, w = this.wanted;
    const tgt = this.visible ? p.pos : w.lastKnown ?? p.pos;
    for (const c of this.cars) {
      if (!c.ai || c.ai.mode !== 'pursue' || c.driver !== 'ai') continue;
      const d = dist2(c.x, c.z, tgt.x, tgt.z);
      const onFoot = !p.vehicle;
      g.vehicles.drivePursue(c, dt, tgt.x, tgt.z, onFoot || !this.visible ? 11 : 0);
      // crew bail out to continue on foot once they have boxed the suspect in or reached the scene
      const slowTarget = onFoot || (p.vehicle !== null && Math.abs(p.vehicle.speed) < 2.5);
      if (c.crew > 0 && d < 13 && Math.abs(c.speed) < 3 && (slowTarget || !this.visible)) {
        for (let k = 0; k < c.crew; k++) {
          const dp = c.doorPos(k ? 1 : -1, 1.6);
          const o = g.npcs.spawn(w.level >= 3 ? 'armed' : 'police', dp.x, dp.z); o.responder = true; g.city.resolve(o.pos, 0.4);
          this.engage(o);
        }
        c.crew = 0; c.ai.mode = 'stop'; c.ai.panic = 1e9; c.throttle = 0; c.handbrake = true;
      }
    }
  }

  /** Per-officer behaviour while a wanted level is active. Returns the animation to show. */
  think(o: Npc, dt: number): [Action, number] {
    const g = this.g, p = g.player, w = this.wanted;
    if (w.level === 0) { o.setState('idle'); o.idleFor = 1; return ['none', 0]; }
    const d = dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
    const sees = this.visible && this.canSee(o.pos.x, o.pos.z);
    if (!this.visible || !w.lastKnown) return this.search(o, dt);
    // pursuit: we (or a colleague on the radio) know where the suspect is
    o.order = null;
    const lethal = w.level >= 3 && o.armed;
    if (o.swing) {
      const s = o.swing; s.t += dt; o.speedNow = 0;
      if (!s.struck && s.t >= s.dur * 0.5) {
        s.struck = true;
        if (s.kind === 'aim') g.combat.npcFire(o, p, o.gunDamage);
        else if (d < 2 && !p.vehicle) p.takeDamage(10, o, 'melee', (p.pos.x - o.pos.x) / (d || 1), (p.pos.z - o.pos.z) / (d || 1), Math.random() < 0.3);
      }
      if (s.t >= s.dur) { o.swing = null; o.attackCd = s.kind === 'aim' ? rand(0.8, 1.7) : rand(1, 1.8); }
      return [s.kind, s.t / s.dur];
    }
    if (lethal && sees && d > 5 && d < 34) {
      o.speedNow = 0; o.yaw = dampAngle(o.yaw, yawTo(p.pos.x - o.pos.x, p.pos.z - o.pos.z), 12, dt);
      if (d > 20) o.chase(g, dt, p.pos.x, p.pos.z, o.runSpeed * 0.7, 18);
      if (o.attackCd <= 0) o.swing = { kind: 'aim', t: 0, dur: 0.45, struck: false };
      return ['aim', 0];
    }
    const tx = sees ? p.pos.x : w.lastKnown.x, tz = sees ? p.pos.z : w.lastKnown.z;
    const reach = p.vehicle ? p.vehicle.spec.w / 2 + 1.3 : 1.5;
    const close = o.chase(g, dt, tx, tz, o.runSpeed, reach);
    if (close && sees && !p.vehicle && o.attackCd <= 0 && (g.time - this.resistT < 8 || w.level >= 3)) o.swing = { kind: 'baton', t: 0, dur: 0.6, struck: false };
    return ['none', 0];
  }

  /** Lost sight: go to the last known position, then check nearby street corners. */
  private search(o: Npc, dt: number): [Action, number] {
    const g = this.g, w = this.wanted, lk = w.lastKnown ?? g.player.pos;
    if (!o.order || o.order.t <= 0) {
      const first = !o.order;
      let x = lk.x, z = lk.z;
      if (!first) { const c = g.city.nav.randomCorner(this.rnd); if (dist2(c.x, c.z, lk.x, lk.z) < 75) { x = c.x; z = c.z; } }
      o.order = { kind: 'search', x, z, t: 9 }; o.path.length = 0; o.repath = 0;
    }
    o.order.t -= dt;
    if (o.chase(g, dt, o.order.x, o.order.z, o.runSpeed * 0.75, 2.5)) { o.order.t = Math.min(o.order.t, 1.5); o.yaw += dt * 1.6; } // look around
    return ['none', 0];
  }

  private updateArrest(dt: number): void {
    const g = this.g, p = g.player, w = this.wanted;
    if (!p.alive) return;
    const still = p.vehicle ? Math.abs(p.vehicle.speed) < 2 : true;
    const reach = p.vehicle ? p.vehicle.spec.w / 2 + 2 : 1.9;
    const grabbing = still && this.visible && this.officers.some((o) => o.state === 'police' && !o.swing && dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z) < reach);
    // armed response shoots first; arrests still happen when the suspect is cornered and hurt
    const rate = w.level >= 3 && p.hp > 35 && !p.vehicle ? 0 : p.downT > 0 ? 1.4 : 0.48;
    this.arrest = Math.max(0, Math.min(1, this.arrest + (grabbing ? rate : -0.6) * dt));
    if (this.arrest >= 1) { this.arrest = 0; g.busted(); }
  }

  reset(): void { this.wanted.clear(); this.wanted.investigations = []; this.arrest = 0; this.visible = false; this.investigator = null; }
}
