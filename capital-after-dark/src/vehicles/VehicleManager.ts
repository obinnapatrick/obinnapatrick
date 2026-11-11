// Owns every vehicle: traffic AI (left-hand lanes, junction tokens), parked cars, collisions and run-overs.
import type { Game } from '../core/Game';
import { angleDiff, clamp, dist2, fwdX, fwdZ, leftX, leftZ, mulberry32, pointInObb, yawTo } from '../core/util';
import { Vehicle } from './Vehicle';
import { VehicleType } from './specs';

const INSET = 8; // how far from a junction centre the lane "ends"
const TRAFFIC_MIX: VehicleType[] = ['cab', 'cab', 'saloon', 'saloon', 'cab', 'van', 'bus', 'saloon', 'cab', 'sports', 'saloon', 'bus', 'van', 'cab', 'saloon', 'cab'];

export class VehicleManager {
  list: Vehicle[] = [];
  private byCollider = new Map<number, Vehicle>();
  private tokens = new Map<number, { v: number; t: number }>();
  private rnd = mulberry32(4242);
  private upkeep = 2;
  trafficTarget = 16;

  constructor(private g: Game) {}

  spawn(type: VehicleType, x: number, z: number, yaw: number, o: { colour?: number; tag?: string; owned?: boolean } = {}): Vehicle {
    const v = new Vehicle(type, this.g.phys, this.g.gfx.scene, x, z, yaw, o.colour);
    v.missionTag = o.tag ?? ''; v.owned = !!o.owned;
    this.list.push(v); this.byCollider.set(v.collider.handle, v);
    return v;
  }
  remove(v: Vehicle): void {
    const i = this.list.indexOf(v); if (i < 0) return;
    this.list.splice(i, 1); this.byCollider.delete(v.collider.handle);
    for (const [n, t] of this.tokens) if (t.v === v.id) this.tokens.delete(n);
    if (this.g.player.vehicle === v) this.g.player.exitVehicle(true);
    v.dispose(this.g.gfx.scene);
  }
  fromCollider(handle: number): Vehicle | undefined { return this.byCollider.get(handle); }
  tagged(tag: string): Vehicle | undefined { return this.list.find((v) => v.missionTag === tag); }

  /** Initial traffic and kerbside parking. */
  populate(): void {
    const L = this.g.city.layout;
    this.trafficTarget = 16;
    for (let i = 0; i < this.trafficTarget; i++) this.spawnTraffic(TRAFFIC_MIX[i % TRAFFIC_MIX.length], 28);
    const patrol = this.spawnTraffic('police', 60);
    if (patrol) patrol.crew = 2;
    const types: VehicleType[] = ['saloon', 'saloon', 'van', 'saloon', 'sports', 'saloon', 'cab'];
    L.parkSlots.forEach((s, i) => { if (i % 3 === 0) this.spawn(types[Math.floor(this.rnd() * types.length)], s.x, s.z, s.yaw); });
  }

  /** Put an AI-driven vehicle on a free stretch of lane at least `minDist` from the player. */
  spawnTraffic(type: VehicleType, minDist: number): Vehicle | null {
    const R = this.g.city.roads, p = this.g.player.pos;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.floor(this.rnd() * 25), b = R.nodes[a].links[Math.floor(this.rnd() * R.nodes[a].links.length)];
      const along = 18 + this.rnd() * 38, pt = R.lanePoint(a, b, along);
      if (dist2(pt.x, pt.z, p.x, p.z) < minDist) continue;
      if (this.list.some((o) => dist2(o.x, o.z, pt.x, pt.z) < 13)) continue;
      const v = this.spawn(type, pt.x, pt.z, R.heading(a, b));
      v.ai = { mode: 'traffic', a, b, cruise: type === 'bus' ? 7 : 8 + this.rnd() * 3, stuck: 0, reverse: 0, token: -1, panic: 0, route: [], routeTimer: 0 };
      v.setDriver('ai');
      return v;
    }
    return null;
  }

  nearest(x: number, z: number, max: number, filter: (v: Vehicle) => boolean = () => true): Vehicle | null {
    let best: Vehicle | null = null, bd = max;
    for (const v of this.list) { const d = dist2(x, z, v.x, v.z) - v.spec.l * 0.35; if (d < bd && filter(v)) { bd = d; best = v; } }
    return best;
  }

  // ------------------------------------------------------------------ per-tick
  update(dt: number): void {
    const now = this.g.time;
    for (const v of this.list) {
      if (v.ai && v.driver === 'ai' && !v.dead) {
        if (v.ai.mode === 'traffic' || v.ai.mode === 'flee') this.driveTraffic(v, dt, now);
        else if (v.ai.mode === 'stop') { v.throttle = v.speed > 0.5 ? -1 : 0; v.steer = 0; v.handbrake = true; v.ai.panic -= dt; if (v.ai.panic <= 0 && v.crew === 0 && v.type !== 'police') v.ai.mode = 'traffic'; }
      }
      v.update(dt);
    }
    this.upkeep -= dt;
    if (this.upkeep <= 0) { this.upkeep = 3; this.maintain(); }
  }

  private acquire(node: number, v: Vehicle, now: number): boolean {
    const t = this.tokens.get(node);
    if (!t || t.v === v.id || now - t.t > 9) { this.tokens.set(node, { v: v.id, t: t && t.v === v.id ? t.t : now }); return true; }
    return false;
  }

  private driveTraffic(v: Vehicle, dt: number, now: number): void {
    const ai = v.ai!, R = this.g.city.roads, fleeing = ai.mode === 'flee';
    if (fleeing) { ai.panic -= dt; if (ai.panic <= 0) ai.mode = 'traffic'; }
    if (ai.reverse > 0) { ai.reverse -= dt; v.throttle = -0.7; v.steer = -v.steer || 0.4; v.handbrake = false; return; }
    let A = R.nodes[ai.a], B = R.nodes[ai.b], hd = R.heading(ai.a, ai.b), len = R.edgeLength(ai.a, ai.b);
    let s = (v.x - A.x) * fwdX(hd) + (v.z - A.z) * fwdZ(hd);
    const look = 6 + Math.abs(v.speed) * 0.4;
    let desired = fleeing ? v.spec.maxSpeed * 0.7 : ai.cruise;
    const distB = len - s;
    let hold = true;
    ai.why = '';
    if (distB < 28 && !fleeing) {
      // Only the FRONT car of a lane may claim the junction. (If a queued car could claim it, the car in
      // front would wait for the token while the token-holder waits for the car in front: deadlock.)
      const queued = this.list.some((o) => o !== v && o.ai && o.driver === 'ai' && o.ai.a === ai.a && o.ai.b === ai.b && (o.x - A.x) * fwdX(hd) + (o.z - A.z) * fwdZ(hd) > s);
      if (queued) { hold = false; const t = this.tokens.get(ai.b); if (t && t.v === v.id) this.tokens.delete(ai.b); }
      else hold = this.acquire(ai.b, v, now);
      // stop with the NOSE well short of the junction box (and the zebra crossing), whatever the vehicle's length
      if (!hold && distB < 10 + v.spec.l / 2) { desired = 0; ai.why = queued ? 'queue' : 'junction ' + ai.b + ' held by #' + this.tokens.get(ai.b)?.v; } else if (!hold) desired = Math.min(desired, 4.5);
    }
    if (s > 11) { const t = this.tokens.get(ai.a); if (t && t.v === v.id) this.tokens.delete(ai.a); }
    // decide the way out of the junction early and slow down if it is a turn
    if (distB < 30 && ai.next === undefined) ai.next = R.nextNode(ai.a, ai.b, this.rnd);
    if (ai.next !== undefined && distB < 22 && Math.abs(angleDiff(hd, R.heading(ai.b, ai.next))) > 0.1) desired = Math.min(desired, fleeing ? 9 : 5);
    // stay in lane right up to the junction box, then steer for the exit lane (no diagonal corner-cutting)
    if (s > len - INSET + 0.5 && hold) {
      const c = ai.next ?? R.nextNode(ai.a, ai.b, this.rnd);
      ai.next = undefined;
      ai.a = ai.b; ai.b = c;
      A = R.nodes[ai.a]; B = R.nodes[ai.b]; hd = R.heading(ai.a, ai.b); len = R.edgeLength(ai.a, ai.b);
      s = (v.x - A.x) * fwdX(hd) + (v.z - A.z) * fwdZ(hd);
    }
    const tp = R.lanePoint(ai.a, ai.b, clamp(s + look, INSET, len - INSET + 3));
    const err = angleDiff(v.yaw, yawTo(tp.x - v.x, tp.z - v.z));
    v.steer = clamp(err * 2.4, -1, 1);
    if (Math.abs(err) > 0.3) desired = Math.min(desired, fleeing ? 9 : 5);

    // keep a gap to whatever is ahead in our corridor
    if (!fleeing) {
      // Look along the path we intend to drive (towards the lane target), not just where the bonnet points:
      // mid-turn, the bonnet sweeps across cars queuing in other lanes and they must not count as "ahead".
      const tl = Math.hypot(tp.x - v.x, tp.z - v.z) || 1;
      const fx = (tp.x - v.x) / tl, fz = (tp.z - v.z) / tl, lx = fz, lz = -fx;
      const reach = 5 + v.spec.l / 2 + Math.max(0, v.speed) * 0.9;
      let blocked = false;
      ai.push = Math.max(0, (ai.push ?? 0) - dt);
      const check = (ox: number, oz: number, halfL: number, halfW: number, what: string) => {
        const dx = ox - v.x, dz = oz - v.z, f = dx * fx + dz * fz;
        if (f <= 0 || f > reach + halfL) return;
        if (Math.abs(dx * lx + dz * lz) > v.spec.w / 2 + halfW + 0.25) return;
        const gap = f - halfL - v.spec.l / 2;
        if (ai.push! > 0 && gap > 0.9) { desired = Math.min(desired, 2.5); return; } // out of patience: creep round
        if (gap < 3.2) { desired = 0; blocked = true; ai.why = what; } else desired = Math.min(desired, 3.5);
      };
      for (const o of this.list) if (o !== v && Math.abs(o.x - v.x) < 30 && Math.abs(o.z - v.z) < 30) check(o.x, o.z, o.spec.l / 2, Math.abs(angleDiff(o.yaw, v.yaw)) % Math.PI > 0.6 ? o.spec.l / 2 : o.spec.w / 2 - 0.3, o.type + ' #' + o.id + (o.driver ? '' : ' (parked)'));
      const pl = this.g.player;
      if (!pl.vehicle && pl.pos.y > -10) check(pl.pos.x, pl.pos.z, 0.4, 0.5, 'player');
      for (const n of this.g.npcs.list) if (!n.far && n.state !== 'indoors' && n.state !== 'ko' && Math.abs(n.pos.x - v.x) < 22 && Math.abs(n.pos.z - v.z) < 22) check(n.pos.x, n.pos.z, 0.4, 0.45, 'pedestrian ' + n.state);
      ai.wait = blocked ? (ai.wait ?? 0) + dt : Math.max(0, (ai.wait ?? 0) - dt * 3);
      if (ai.wait > 7) { ai.wait = 0; ai.push = 3; }
      // last resort for a genuine jam (two vehicles wedged together): back off, or re-route if nobody is watching
      ai.jam = blocked && Math.abs(v.speed) < 0.3 ? (ai.jam ?? 0) + dt : Math.max(0, (ai.jam ?? 0) - dt);
      if (ai.jam > 18) { ai.jam = 0; if (dist2(v.x, v.z, pl.pos.x, pl.pos.z) > 60 && !v.missionTag) { this.relocate(v); return; } ai.reverse = 1.6; }
    }
    if (desired <= 0.1) { v.throttle = v.speed > 0.6 ? -1 : 0; v.handbrake = v.speed < 0.6; }
    else { v.handbrake = false; v.throttle = v.speed < desired - 0.4 ? (fleeing ? 1 : 0.7) : v.speed > desired + 1.2 ? -0.5 : 0.15; }

    // un-stick: back up briefly, or quietly re-route when nobody is looking
    if (desired > 0.1 && Math.abs(v.speed) < 0.4) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt * 2);
    if (ai.stuck > 4 && ai.stuck < 4.1) ai.reverse = 1.1;
    if (ai.stuck > 12) { ai.stuck = 0; if (dist2(v.x, v.z, this.g.player.pos.x, this.g.player.pos.z) > 55 && !v.missionTag) this.relocate(v); else ai.reverse = 1.4; }
  }

  /** Police pursuit driving: straight at the target when visible, otherwise junction to junction. */
  drivePursue(v: Vehicle, dt: number, tx: number, tz: number, stopDist: number): void {
    const ai = v.ai!, city = this.g.city;
    if (ai.reverse > 0) { ai.reverse -= dt; v.throttle = -1; v.handbrake = false; return; }
    const d = dist2(v.x, v.z, tx, tz);
    let ax = tx, az = tz;
    if (!(d < 75 && city.los(v.x, v.z, tx, tz))) {
      const R = city.roads;
      ai.routeTimer -= dt;
      if (ai.routeTimer <= 0 || !ai.route.length) { ai.routeTimer = 0.5; ai.route = R.route(R.nearest(v.x, v.z), R.nearest(tx, tz)); }
      if (ai.route.length > 1) {
        // head for the junction after the nearest one as soon as we are at it or already on the connecting street
        const n0 = R.nodes[ai.route[0]], n1 = R.nodes[ai.route[1]];
        const next = dist2(v.x, v.z, n0.x, n0.z) < 14 || dist2(v.x, v.z, n1.x, n1.z) < dist2(n0.x, n0.z, n1.x, n1.z);
        const n = next ? n1 : n0;
        ax = n.x; az = n.z;
      }
    }
    const err = angleDiff(v.yaw, yawTo(ax - v.x, az - v.z));
    v.steer = clamp(err * 2.6, -1, 1);
    if (d < stopDist) { v.throttle = v.speed > 1 ? -1 : 0; v.handbrake = true; ai.stuck = 0; return; }
    const desired = clamp(d * 0.8, 7, v.spec.maxSpeed * 0.85) * (1 - Math.min(0.65, Math.abs(err) * 0.7));
    v.handbrake = Math.abs(err) > 1.2 && v.speed > 10;
    v.throttle = v.speed < desired ? 1 : v.speed > desired + 3 ? -0.6 : 0.2;
    if (Math.abs(v.speed) < 0.8) ai.stuck += dt; else ai.stuck = 0;
    if (ai.stuck > 1.6) { ai.stuck = 0; ai.reverse = 1.2; v.steer = -Math.sign(err || 1); }
  }

  private relocate(v: Vehicle): void {
    const R = this.g.city.roads, p = this.g.player.pos;
    for (let i = 0; i < 20; i++) {
      const a = Math.floor(this.rnd() * 25), b = R.nodes[a].links[Math.floor(this.rnd() * R.nodes[a].links.length)], pt = R.lanePoint(a, b, 30);
      if (dist2(pt.x, pt.z, p.x, p.z) < 80 || this.list.some((o) => o !== v && dist2(o.x, o.z, pt.x, pt.z) < 13)) continue;
      v.place(pt.x, pt.z, R.heading(a, b)); v.ai!.a = a; v.ai!.b = b; v.ai!.next = undefined; return;
    }
  }

  private maintain(): void {
    const p = this.g.player.pos;
    // clear away wrecks and abandoned traffic far from the player
    for (const v of [...this.list]) {
      if (v.missionTag || v.owned || v === this.g.player.vehicle) continue;
      const far = dist2(v.x, v.z, p.x, p.z) > 95;
      if (far && (v.dead || (v.type === 'police' && !v.driver && v.crew === 0 && this.g.police.wanted.level === 0))) this.remove(v);
    }
    const traffic = this.list.filter((v) => v.ai && v.ai.mode !== 'pursue' && v.type !== 'police').length;
    if (traffic < this.trafficTarget) this.spawnTraffic(TRAFFIC_MIX[Math.floor(this.rnd() * TRAFFIC_MIX.length)], 85);
  }

  /** A traffic driver reacts to being rammed or shot at. */
  scare(v: Vehicle): void {
    if (!v.ai || v.ai.mode === 'pursue' || v.dead) return;
    if (v.type === 'bus' || this.rnd() < 0.45) { v.ai.mode = 'stop'; v.ai.panic = 7; v.hazard = 7; }
    else { v.ai.mode = 'flee'; v.ai.panic = 9; }
  }

  postStep(dt: number): void {
    const g = this.g, pl = g.player;
    for (const v of this.list) {
      v.postStep(dt);
      if (v.impact > 0) {
        const d = dist2(v.x, v.z, pl.pos.x, pl.pos.z);
        v.damage((v.impact - 3.5) * 2.6);
        if (v.impact > 5) g.audio.play('crash', d);
        g.fx.burst(v.x + fwdX(v.yaw) * v.spec.l * 0.5 * Math.sign(v.speed || 1), 0.8, v.z + fwdZ(v.yaw) * v.spec.l * 0.5 * Math.sign(v.speed || 1), 0xffd080, 4, 0.3);
        const other = this.list.find((o) => o !== v && dist2(o.x, o.z, v.x, v.z) < (o.spec.l + v.spec.l) / 2 + 1.2);
        if (other) {
          other.damage((v.impact - 3.5) * 1.6);
          if (v.driver === 'player') {
            if (other.driver === 'ai') { this.scare(other); if (v.impact > 7) g.crime(other.type === 'police' ? 'assaultOfficer' : 'vandalism', { x: v.x, z: v.z }); }
            other.body.wakeUp();
          }
        }
        if (v.driver === 'player') g.bus.emit({ type: 'playerCrash', impact: v.impact, vehicle: v });
      }
      // run-overs
      if (Math.abs(v.speed) > 3 || Math.abs(v.lateral) > 3) {
        const sp = Math.hypot(v.speed, v.lateral);
        for (const n of g.npcs.list) {
          if (n.far || n.vehCd > 0 || n.state === 'indoors' || Math.abs(n.pos.x - v.x) > 8 || Math.abs(n.pos.z - v.z) > 8 || Math.abs(n.pos.y - 0.1) > 1.5) continue;
          const hit = pointInObb(n.pos.x, n.pos.z, v.x, v.z, v.yaw, v.spec.w / 2, v.spec.l / 2, 0.3);
          if (!hit) continue;
          n.vehCd = 1;
          const side = Math.sign(hit.lx || 1);
          n.pos.x += leftX(v.yaw) * side * 0.9; n.pos.z += leftZ(v.yaw) * side * 0.9;
          n.takeDamage(sp * 2.8, v.driver === 'player' ? pl : null, 'vehicle', leftX(v.yaw) * side, leftZ(v.yaw) * side);
        }
        if (!pl.vehicle && pl.alive && pl.pos.y > -10 && pl.vehCd <= 0 && v.driver !== 'player' && pointInObb(pl.pos.x, pl.pos.z, v.x, v.z, v.yaw, v.spec.w / 2, v.spec.l / 2, 0.25)) {
          pl.vehCd = 1.2;
          pl.takeDamage(sp * 1.6, null, 'vehicle', fwdX(v.yaw), fwdZ(v.yaw));
        }
      }
    }
  }

  /** Remove everything (used when starting or loading a game). */
  clear(): void { for (const v of [...this.list]) { this.list.splice(this.list.indexOf(v), 1); this.byCollider.delete(v.collider.handle); v.dispose(this.g.gfx.scene); } this.tokens.clear(); }
}
