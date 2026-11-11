// Small emergent street events. One at a time, spawned only when conditions suit, and each has
// explicit completion and dismissal logic so nothing piles up or lingers.
import type { Game } from '../core/Game';
import type { Marker } from '../render/Effects';
import type { Npc } from '../npc/Npc';
import type { Vehicle } from '../vehicles/Vehicle';
import { dist2, fmtMoney, mulberry32, pick, rand } from '../core/util';
import { PARK_OFFSET, districtAt, territoryAt } from '../world/layout';

export type EventKind = 'fare' | 'confrontation' | 'collision' | 'patrol' | 'gangDispute' | 'delivery' | 'breakdown';
interface Live { kind: EventKind; ttl: number; npcs: Npc[]; vehicles: Vehicle[]; markers: Marker[]; stage: number; x: number; z: number; data: any; tick(dt: number): void }
const ALL: EventKind[] = ['fare', 'confrontation', 'collision', 'patrol', 'gangDispute', 'delivery', 'breakdown'];
const DESTS = ['pub', 'square', 'circus', 'shop', 'lockup', 'hospital', 'work_a', 'cafe_b'];

export class RandomEvents {
  live: Live | null = null;
  private cooldown = 25;
  private rnd = mulberry32(31337);
  private last: EventKind | null = null;
  history: EventKind[] = [];
  constructor(private g: Game) {}

  update(dt: number): void {
    const g = this.g, p = g.player;
    if (this.live) {
      const e = this.live;
      e.ttl -= dt; e.tick(dt);
      // dismissal: timed out, or the player has wandered far away
      if (this.live === e && (e.ttl <= 0 || dist2(p.pos.x, p.pos.z, e.x, e.z) > 190)) this.end(false);
      return;
    }
    this.cooldown -= dt;
    if (this.cooldown > 0 || g.missions.active || g.interiors.current || g.police.wanted.level > 0 || !p.alive || g.ui.dialogueActive) return;
    const kinds = ALL.filter((k) => k !== this.last && this.suits(k));
    if (!kinds.length) { this.cooldown = 5; return; }
    if (!this.start(pick(kinds, this.rnd))) this.cooldown = 6;
  }
  /** Preconditions per event type. */
  private suits(k: EventKind): boolean {
    const g = this.g, p = g.player, hour = g.state.hour;
    switch (k) {
      case 'fare': return !!p.vehicle && p.vehicle.type === 'cab';
      case 'delivery': return true;
      case 'confrontation': return hour >= 18 || hour < 5;
      case 'gangDispute': return hour >= 20 || hour < 5;
      case 'patrol': return g.police.officers.length < 5;
      default: return g.vehicles.list.length < 60;
    }
  }
  cancel(): void { if (this.live) this.end(false); }
  /** Force an event (also used by tests). */
  start(kind: EventKind): boolean {
    if (this.live) return false;
    const e = this.build(kind);
    if (!e) return false;
    this.live = e; this.last = kind; this.history.push(kind);
    this.g.bus.emit({ type: 'eventStart', kind });
    return true;
  }
  private end(completed: boolean): void {
    const e = this.live; if (!e) return;
    for (const m of e.markers) m.remove();
    for (const n of e.npcs) if (this.g.npcs.list.includes(n)) { n.scripted = false; n.hostileToPlayer = false; n.talk = null; if (n.alive && n.state !== 'fight') { n.setState('idle'); n.idleFor = 0; } }
    for (const v of e.vehicles) { v.missionTag = ''; v.hazard = 0; }
    this.live = null; this.cooldown = completed ? rand(35, 60) : rand(20, 40);
    this.g.bus.emit({ type: 'eventEnd', kind: e.kind, completed });
  }

  /** A pavement spot 35-90 m from the player that they are not currently staring at. */
  private spot(min = 35, max = 90): { x: number; z: number } | null {
    const g = this.g, p = g.player.pos;
    for (let i = 0; i < 25; i++) {
      const c = g.city.nav.randomCorner(this.rnd), d = dist2(c.x, c.z, p.x, p.z);
      if (d >= min && d <= max) return { x: c.x, z: c.z };
    }
    return null;
  }
  /** A kerbside point (and heading) near a pavement corner, clear of other vehicles. */
  private kerb(s: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
    const R = this.g.city.roads, a = R.nearest(s.x, s.z);
    for (const b of R.nodes[a].links) {
      const pt = R.lanePoint(a, b, 24 + this.rnd() * 20, PARK_OFFSET);
      if (!this.g.vehicles.list.some((v) => dist2(v.x, v.z, pt.x, pt.z) < 9)) return { ...pt, yaw: R.heading(a, b) };
    }
    return null;
  }

  private build(kind: EventKind): Live | null {
    const g = this.g, p = g.player;
    const base = (x: number, z: number, ttl: number): Live => ({ kind, ttl, npcs: [], vehicles: [], markers: [], stage: 0, x, z, data: {}, tick: () => {} });
    const npc = (e: Live, role: any, x: number, z: number, look?: string) => { const n = g.npcs.spawn(role, x, z, { scripted: true, look }); e.npcs.push(n); return n; };

    if (kind === 'fare' || kind === 'delivery') {
      const s = this.spot(30, 85); if (!s) return null;
      const destId = pick(DESTS, this.rnd), dq = g.city.layout.poi(destId);
      if (dist2(dq.x, dq.z, s.x, s.z) < 70) return null;
      const e = base(s.x, s.z, 75);
      const who = npc(e, kind === 'fare' ? pick(['office', 'nightlife', 'tourist'], this.rnd) : 'pedestrian', s.x, s.z);
      who.pose = 'phone'; who.activity = kind === 'fare' ? 'hailing a cab' : 'holding a parcel';
      e.markers.push(g.fx.addMarker(s.x, s.z, 3.2, kind === 'fare' ? 0x8dff9a : 0x7df3ff, kind === 'fare' ? '£' : 'P'));
      g.ui.toast(kind === 'fare' ? 'Someone is hailing a cab nearby (green marker)' : 'Someone nearby needs a parcel delivered (blue marker)');
      const pay = Math.round(18 + dist2(dq.x, dq.z, s.x, s.z) * 0.22);
      const drop = () => { e.markers.forEach((m) => m.remove()); e.markers = [g.fx.addMarker(dq.nx ?? dq.x, dq.nz ?? dq.z, 4, 0x8dff9a, 'D')]; e.x = dq.x; e.z = dq.z; e.ttl = 110; e.stage = 2; };
      e.tick = () => {
        const near = dist2(p.pos.x, p.pos.z, s.x, s.z);
        if (!who.alive && e.stage < 2) return this.end(false);
        if (e.stage === 0) {
          if (kind === 'fare' && p.vehicle?.type === 'cab' && near < 6 && Math.abs(p.vehicle.speed) < 1.5) { who.pose = 'none'; who.follow = { pos: p.pos }; who.setState('follow'); e.stage = 1; e.ttl = 30; }
          if (kind === 'delivery' && !p.vehicle && near < 2.4) {
            e.stage = 1; e.ttl = 200;
            g.ui.dialogue([{ who: who.name, text: `You’re a driver, aren’t you? This has to be at ${dq.name} tonight and I can’t leave the stall. ${fmtMoney(pay)} if you run it over.` },
              { who: 'You', text: '', choices: [{ label: `Take the parcel (${fmtMoney(pay)})`, pick: () => { g.audio.play('pickup'); who.pose = 'none'; drop(); g.ui.toast(`Deliver the parcel to ${dq.name}`); } }, { label: 'Not tonight', pick: () => this.end(false) }] }]);
          }
        } else if (e.stage === 1 && kind === 'fare') {
          if (p.vehicle && dist2(who.pos.x, who.pos.z, p.vehicle.x, p.vehicle.z) < 3.2) { g.npcs.despawn(who); e.npcs = []; g.audio.play('door'); g.ui.bark(who.name, `${dq.name}, please.`); drop(); g.ui.toast(`Fare: take them to ${dq.name}`); }
        } else if (e.stage === 2) {
          if (kind === 'fare' && (!p.vehicle || p.vehicle.type !== 'cab')) { e.data.out = (e.data.out ?? 0) + 0.016; if (e.data.out > 12) return this.end(false); }
          const m = e.markers[0];
          if (dist2(p.pos.x, p.pos.z, m.x, m.z) < 5.5 && (!p.vehicle || Math.abs(p.vehicle.speed) < 1.8)) {
            g.state.addCash(pay, kind); g.audio.play('cash'); g.ui.toast(`${kind === 'fare' ? 'Fare' : 'Delivery'} complete: +${fmtMoney(pay)}`);
            if (kind === 'fare') { g.state.data.stats.fares++; const out = g.npcs.spawn('pedestrian', m.x, m.z); out.idleFor = 1; }
            g.state.addNotoriety(districtAt(m.x, m.z), -2);
            this.end(true);
          }
        }
      };
      return e;
    }
    if (kind === 'confrontation' || kind === 'gangDispute') {
      let s = this.spot(30, 80); if (!s) return null;
      if (kind === 'gangDispute') { const border = [{ x: 8.4, z: -8.4 }, { x: 66.6, z: 8.4 }, { x: 8.4, z: 8.4 }]; s = border.find((b) => { const d = dist2(b.x, b.z, p.pos.x, p.pos.z); return d > 25 && d < 110; }) ?? null; if (!s) return null; }
      const e = base(s.x, s.z, 55);
      const sideA = kind === 'gangDispute' ? ['marlowe', 'marlowe'] : ['nightlife'], sideB = kind === 'gangDispute' ? ['kestrel', 'kestrel'] : ['nightlife'];
      const A = sideA.map((r, i) => npc(e, r, s!.x - 1.2, s!.z + i * 1.4)), B = sideB.map((r, i) => npc(e, r, s!.x + 1.2, s!.z + i * 1.4));
      [...A, ...B].forEach((n) => { n.activity = 'arguing'; n.setState('idle'); n.idleFor = 99; n.bravery = 0.9; n.setArmed(false); });
      A.forEach((n) => (n.yaw = Math.PI / 2)); B.forEach((n) => (n.yaw = -Math.PI / 2));
      e.tick = () => {
        if (e.stage === 0 && (e.ttl < 44 || dist2(p.pos.x, p.pos.z, s!.x, s!.z) < 16)) { // it kicks off when you get close
          e.stage = 1; A.forEach((n, i) => n.startFight(B[i % B.length])); B.forEach((n, i) => n.startFight(A[i % A.length]));
          g.ui.bark(A[0], kind === 'gangDispute' ? 'This is Firm ground!' : 'Say that again!');
          g.police.wanted.report({ id: g.nextCrimeId(), type: 'brawl', pos: { x: s!.x, z: s!.z } }, false); // someone calls it in: officers come and look
        }
        if (e.stage === 1) {
          const aUp = A.some((n) => n.alive && n.state !== 'flee'), bUp = B.some((n) => n.alive && n.state !== 'flee');
          if (!aUp || !bUp) {
            if (kind === 'gangDispute') { // the winning crew remembers whose side you took
              const helped = !bUp ? 'marlowe' : 'kestrel';
              if (e.data.playerHit === (helped === 'marlowe' ? 'kestrel' : 'marlowe')) { g.state.changeRep(helped, 6); g.ui.toast(`${helped === 'marlowe' ? 'The Marlowe Firm' : 'The Kestrels'} noticed you backing them (+6)`); }
            }
            this.end(true);
          }
        }
      };
      const off = g.bus.on('npcHit', (ev) => { if (this.live === e && e.npcs.includes(ev.npc)) e.data.playerHit = ev.npc.faction; else if (this.live !== e) off(); });
      return e;
    }
    if (kind === 'patrol') {
      const s = this.spot(40, 90); if (!s) return null;
      const e = base(s.x, s.z, 70);
      const a = g.npcs.spawn('police', s.x, s.z), b = g.npcs.spawn('police', s.x + 1.1, s.z + 0.6);
      e.npcs.push(a, b); a.responder = b.responder = true; b.follow = { pos: a.pos }; b.setState('follow'); a.activity = 'on patrol';
      const not = g.state.notoriety(districtAt(p.pos.x, p.pos.z));
      a.goalKind = null; a.goTo(g, p.pos.x, p.pos.z); a.walkSpeed = 1.7;
      e.tick = () => {
        if (b.state === 'idle' || b.state === 'walk') { b.follow = { pos: a.pos }; b.setState('follow'); }
        if (e.stage === 0 && a.alive && dist2(a.pos.x, a.pos.z, p.pos.x, p.pos.z) < 5 && !p.vehicle) { // stop-and-chat: tone depends on your record in this district
          e.stage = 1; g.ui.bark(a, not > 40 ? 'You. We’ve had complaints about someone matching your description. Behave yourself.' : 'Evening. Quiet night - let’s keep it that way.');
        }
        if (e.ttl < 2) for (const o of [a, b]) if (o.state !== 'police') { o.goalKind = 'tube'; const q = g.city.layout.poi(o.pos.x < 0 ? 'tube_picc' : 'tube_leic'); o.goTo(g, q.x, q.z); }
      };
      return e;
    }
    // collision / breakdown: vehicles stopped at the kerb with hazards on
    const s = this.spot(35, 90); if (!s) return null;
    const k = this.kerb(s); if (!k) return null;
    const e = base(k.x, k.z, 90);
    const v1 = g.vehicles.spawn(pick(['saloon', 'van', 'cab'] as const, this.rnd), k.x, k.z, k.yaw, { tag: 'event' });
    e.vehicles.push(v1); v1.hazard = 1e6;
    if (kind === 'collision') {
      v1.damage(v1.spec.health * 0.55);
      const v2 = g.vehicles.spawn('saloon', k.x - Math.sin(k.yaw) * 4.9 + Math.cos(k.yaw) * 0.7, k.z - Math.cos(k.yaw) * 4.9 - Math.sin(k.yaw) * 0.7, k.yaw + 0.25, { tag: 'event' });
      v2.damage(v2.spec.health * 0.5); v2.hazard = 1e6; e.vehicles.push(v2);
      const d1 = npc(e, 'pedestrian', s.x, s.z), d2 = npc(e, 'office', s.x + 1.3, s.z + 0.4);
      d1.activity = d2.activity = 'arguing about the crash'; d1.setState('idle'); d2.setState('idle'); d1.idleFor = d2.idleFor = 999; d1.yaw = 1.2; d2.yaw = -1.9;
      d1.talk = () => { g.ui.bark(d1, 'He went straight into the back of me! You saw it, didn’t you?'); return true; };
      d2.talk = () => { g.ui.bark(d2, 'She stopped dead in the middle of the road!'); return true; };
      e.tick = () => { if (e.ttl < 20 && e.stage === 0) { e.stage = 1; for (const d of [d1, d2]) { d.activity = 'waiting for recovery'; } } };
      return e;
    }
    v1.damage(v1.spec.health * 0.8);
    const drv = npc(e, 'pedestrian', s.x, s.z); drv.activity = 'on the phone to the breakdown people'; drv.pose = 'phone';
    const bay = g.city.layout.poi('garage_bay');
    const pay = Math.round(25 + dist2(bay.x, bay.z, k.x, k.z) * 0.18);
    e.markers.push(g.fx.addMarker(s.x, s.z, 2.4, 0x7df3ff, '?'));
    drv.talk = () => {
      if (e.stage !== 0) return false;
      g.ui.dialogue([{ who: drv.name, text: `Engine’s gone and recovery say two hours. If you could get it to Brewer Street Motors I’d make it worth your while - ${fmtMoney(pay)}?` },
        { who: 'You', text: '', choices: [{ label: `Drive it to the garage (${fmtMoney(pay)})`, pick: () => { e.stage = 1; e.ttl = 160; v1.permitted = true; e.markers.forEach((m) => m.remove()); e.markers = [g.fx.addMarker(bay.x, bay.z, 4, 0x7df3ff, 'G')]; e.x = bay.x; e.z = bay.z; g.ui.toast('Nurse the car to the garage forecourt - it won’t survive another knock'); } }, { label: 'Sorry, can’t help', pick: () => this.end(false) }] }]);
      return true;
    };
    e.tick = () => {
      if (e.stage === 1) {
        if (v1.dead) { g.ui.toast('The car died on the way'); return this.end(false); }
        if (p.vehicle === v1 && dist2(v1.x, v1.z, bay.x, bay.z) < 5 && Math.abs(v1.speed) < 1.8) {
          p.exitVehicle(true); v1.locked = true;
          g.state.addCash(pay, 'breakdown'); g.audio.play('cash'); g.ui.toast(`Good deed done: +${fmtMoney(pay)}`); g.state.adjustRel('dezzie', 4); g.state.addNotoriety('Soho', -3);
          this.end(true);
        }
      }
    };
    return e;
  }
}
