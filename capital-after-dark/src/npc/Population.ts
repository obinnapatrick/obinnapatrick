// Spawns, schedules and culls the population; routes crimes to witnesses; level-of-detail for far NPCs.
import type { Game, Crime } from '../core/Game';
import { dist2, mulberry32, pick, rand, yawTo } from '../core/util';
import { districtAt, groundHeight } from '../world/layout';
import { CRIME_HEAT } from '../police/WantedSystem';
import { Npc, Role } from './Npc';
import { barkFor } from './dialogue';

const FIRST = ['Sam', 'Aisha', 'Tom', 'Priya', 'Kwame', 'Elena', 'Jack', 'Mei', 'Callum', 'Zara', 'Luca', 'Hannah', 'Dev', 'Rosie', 'Omar', 'Niamh', 'Felix', 'Chloe', 'Marcus', 'Yuki'];
const LAST = ['Bennett', 'Okafor', 'Hughes', 'Sharma', 'Clarke', 'Novak', 'Reid', 'Tanaka', 'Murphy', 'Ali', 'Rossi', 'Wright', 'Mensah', 'Doyle', 'Khan', 'Fletcher'];
const LOD_DIST = 95;

/** Share of each civilian role by hour of day - this is the "daily routine" of the district. */
export function roleMix(hour: number): Record<'office' | 'tourist' | 'nightlife' | 'pedestrian', number> {
  const work = hour >= 7 && hour < 19, evening = hour >= 19 || hour < 4;
  return { office: work ? 0.38 : evening ? 0.08 : 0.03, tourist: hour >= 9 && hour < 23 ? 0.24 : 0.04, nightlife: evening ? 0.42 : 0.03, pedestrian: 0.28 };
}
export function populationTarget(hour: number): number { return hour >= 3 && hour < 6 ? 16 : hour >= 19 || hour < 2 ? 38 : 30; }
/** Where a role wants to be at a given hour (POI kind). */
export function goalKindFor(role: Role, hour: number, r: number): 'work' | 'cafe' | 'tube' | 'pub' | 'landmark' | 'corner' {
  switch (role) {
    case 'office':
      if (hour >= 7 && hour < 12) return 'work';
      if (hour >= 12 && hour < 14) return r < 0.7 ? 'cafe' : 'work';
      if (hour >= 14 && hour < 17) return 'work';
      if (hour >= 17 && hour < 20) return r < 0.3 ? 'pub' : 'tube';
      return r < 0.4 ? 'pub' : 'tube';
    case 'tourist': return hour >= 9 && hour < 23 ? (r < 0.75 ? 'landmark' : 'cafe') : 'tube';
    case 'nightlife': return hour >= 19 || hour < 4 ? (r < 0.35 ? 'pub' : r < 0.7 ? 'landmark' : r < 0.85 ? 'cafe' : 'corner') : 'tube';
    default: return r < 0.15 ? 'tube' : 'corner';
  }
}

export class Population {
  list: Npc[] = [];
  private rnd = mulberry32(777);
  private tick = 0;
  private seenCrimes = new Set<number>();
  private posts: { role: Role; x: number; z: number; npc: Npc | null; cd: number }[] = [];
  constructor(private g: Game) { Npc.game = g; }

  spawn(role: Role, x: number, z: number, o: { name?: string; look?: string; scripted?: boolean; pid?: string; yaw?: number; groundY?: number } = {}): Npc {
    const n = new Npc(role, o.look ?? role);
    n.name = o.name ?? (role === 'police' || role === 'armed' ? 'PC ' + pick(LAST, this.rnd) : `${pick(FIRST, this.rnd)} ${pick(LAST, this.rnd)}`);
    n.groundY = o.groundY ?? null;
    n.pos.set(x, n.groundY ?? groundHeight(x, z), z); n.yaw = o.yaw ?? this.rnd() * 6.28;
    n.scripted = !!o.scripted; n.pid = o.pid ?? null; n.persistent = !!o.pid;
    if (n.scripted) n.setState('scripted');
    this.g.gfx.scene.add(n.model.root);
    n.model.root.position.copy(n.pos); n.model.root.rotation.y = n.yaw;
    this.list.push(n);
    return n;
  }
  despawn(n: Npc): void { const i = this.list.indexOf(n); if (i >= 0) this.list.splice(i, 1); n.dispose(this.g.gfx.scene); for (const p of this.posts) if (p.npc === n) p.npc = null; }
  clear(): void { for (const n of [...this.list]) n.dispose(this.g.gfx.scene); this.list = []; this.posts.forEach((p) => (p.npc = null)); }

  populate(): void {
    const L = this.g.city.layout, hour = this.g.state.hour;
    for (let i = 0; i < populationTarget(hour); i++) this.spawnCivilian(20);
    // crews hold fixed posts on their own ground; beat officers patrol
    this.posts = [
      { role: 'marlowe', x: -16.5, z: -67.2, npc: null, cd: 0 }, { role: 'marlowe', x: -37.5, z: -67, npc: null, cd: 0 }, { role: 'marlowe', x: -52, z: -8.3, npc: null, cd: 0 },
      { role: 'kestrel', x: 106, z: 67.2, npc: null, cd: 0 }, { role: 'kestrel', x: 119, z: 67.4, npc: null, cd: 0 }, { role: 'kestrel', x: 30, z: 37.5, npc: null, cd: 0 },
      { role: 'police', x: 60, z: -8.3, npc: null, cd: 0 }, { role: 'police', x: -130, z: 70, npc: null, cd: 0 },
    ];
    this.refillPosts(true);
    // named street characters with persistent memories
    const P = (pid: string, name: string, role: Role, look: string, x: number, z: number, yaw: number, scripted = true) => {
      const n = this.spawn(role, x, z, { name, look, pid, yaw, scripted }); n.home = { x, z }; n.maxHp = n.hp = 120; return n;
    };
    const tommo = P('tommo', 'Tommo', 'contact', 'nightlife', -120.5, 94, -2.2); tommo.activity = 'busking'; tommo.pose = 'talk';
    tommo.talk = (g) => {
      const rec = g.state.person('tommo');
      if (rec.met && rec.rel < 30 && g.state.data.cash >= 5 && !g.missions.active) {
        g.ui.dialogue([{ who: 'Tommo', text: barkFor(tommo, g) }, { who: 'You', text: '', choices: [{ label: 'Drop £5 in the case', pick: () => { if (g.state.spend(5, 'busker')) { g.state.adjustRel('tommo', 12); g.ui.toast('Tommo will remember that. (+relationship)'); g.audio.play('cash'); } } }, { label: 'Keep walking', pick: () => {} }] }]);
        return true;
      }
      return false;
    };
    const bell = P('pc_bell', 'PC Bell', 'police', 'police', -20, 8.3, 0, false); bell.home = null;
    P('col', 'Col Hartigan', 'marlowe', 'marlowe', -26.5, -67.3, Math.PI).activity = 'having a smoke';
    P('kes', 'Tobias “Kes” Reeve', 'kestrel', 'kestrel', 112.5, 66.2, 0).activity = 'watching the square';
    P('ines', 'Ines Duarte', 'kestrel', 'kestrel', 115.5, 66.4, -0.4).activity = 'checking a manifest';
    L.pois.length; // (layout already holds every POI the schedules use)
  }

  private refillPosts(initial = false): void {
    const p = this.g.player.pos;
    for (const post of this.posts) {
      if (post.npc && post.npc.alive && !post.npc.remove) continue;
      if (post.npc && !post.npc.alive) { post.cd = 60; post.npc = null; }
      if (!initial && (dist2(p.x, p.z, post.x, post.z) < 70 || post.cd > 0)) continue;
      const n = this.spawn(post.role, post.x, post.z);
      n.home = { x: post.x, z: post.z }; n.activity = post.role === 'police' ? 'on patrol' : 'keeping watch'; n.idleFor = rand(4, 10);
      if (post.role !== 'police' && this.rnd() < 0.34) n.setArmed(true, 8);
      post.npc = n;
    }
  }

  /** Add one civilian whose role fits the current hour, away from the player. */
  spawnCivilian(minDist: number): Npc | null {
    const g = this.g, mix = roleMix(g.state.hour), p = g.player.pos;
    let r = this.rnd() * (mix.office + mix.tourist + mix.nightlife + mix.pedestrian), role: Role = 'pedestrian';
    for (const k of ['office', 'tourist', 'nightlife', 'pedestrian'] as const) { if (r < mix[k]) { role = k; break; } r -= mix[k]; }
    for (let i = 0; i < 12; i++) {
      const tube = this.rnd() < 0.2 ? g.city.layout.poi(this.rnd() < 0.5 ? 'tube_picc' : 'tube_leic') : null;
      const c = tube ?? g.city.nav.randomCorner(this.rnd);
      const d = dist2(c.x, c.z, p.x, p.z);
      if (d < minDist || d > 135) continue;
      const n = this.spawn(role, c.x + (this.rnd() - 0.5) * 2, c.z + (this.rnd() - 0.5) * 2);
      n.idleFor = this.rnd() * 3;
      return n;
    }
    return null;
  }

  /** Give an NPC its next destination according to role and time of day. */
  plan(n: Npc): void {
    const g = this.g, L = g.city.layout, nav = g.city.nav, hour = g.state.hour;
    if (n.home) { // post-holders loiter around their spot
      if (n.role === 'police') { const c = nav.randomCorner(this.rnd); if (dist2(c.x, c.z, n.home.x, n.home.z) < 130) { n.goalKind = null; n.goTo(g, c.x, c.z); } else n.idleFor = 2; return; }
      const a = this.rnd() * 6.28, x = n.home.x + Math.sin(a) * 3, z = n.home.z + Math.cos(a) * 3;
      if (!g.city.inSolid(x, z, 0.5) && this.rnd() < 0.5) { n.goalKind = null; n.goTo(g, x, z, true); } else { n.idleFor = rand(4, 12); n.activity = this.rnd() < 0.4 ? 'chatting' : 'keeping watch'; }
      return;
    }
    if (n.role === 'police') { const c = nav.randomCorner(this.rnd); n.goalKind = null; n.goTo(g, c.x, c.z); return; }
    const kind = goalKindFor(n.role, hour, this.rnd());
    let dest: { x: number; z: number; id?: string };
    if (kind === 'corner') { const c = nav.randomCorner(this.rnd); dest = { x: c.x, z: c.z }; }
    else {
      const want = kind === 'landmark' ? ['circus', 'square', 'gate'] : L.pois.filter((q) => q.kind === kind).map((q) => q.id);
      const id = pick(want, this.rnd); const q = L.poi(id);
      dest = { x: (q.nx ?? q.x) + (this.rnd() - 0.5) * (kind === 'landmark' ? 9 : 1.5), z: (q.nz ?? q.z) + (this.rnd() - 0.5) * (kind === 'landmark' ? 9 : 1.5), id };
      if (g.city.inSolid(dest.x, dest.z, 0.6)) dest = { x: q.nx ?? q.x, z: q.nz ?? q.z, id };
    }
    n.goalKind = kind === 'corner' ? null : kind === 'landmark' ? 'landmark' : kind;
    n.goal = dest.id ?? null;
    n.activity = kind === 'work' ? 'heading to work' : kind === 'tube' ? 'heading home' : kind === 'cafe' ? 'going for food' : kind === 'pub' ? 'off to the pub' : n.role === 'tourist' ? 'sightseeing' : 'walking';
    n.goTo(g, dest.x, dest.z);
    n.mood = n.mood === 'scared' ? 'wary' : n.mood === 'angry' ? 'calm' : n.mood;
  }

  /** Tell everyone in range about a crime. Returns the number of people who actually SAW it. */
  broadcast(c: Crime): number {
    const g = this.g, serious = c.type === 'gunfire' || c.type === 'shooting';
    const radius = serious ? 55 : 24;
    const inside = g.interiors.current !== null;
    let saw = 0;
    for (const n of this.list) {
      if (n.far || (n.groundY !== null) !== inside) continue;
      const d = dist2(n.pos.x, n.pos.z, c.pos.x, c.pos.z);
      if (d > radius) continue;
      const sees = d < (serious ? 45 : 24) && (inside || g.city.los(n.pos.x, n.pos.z, c.pos.x, c.pos.z)) && n.alive && n.state !== 'indoors' && n.state !== 'down';
      if (!sees && !serious) continue;
      if (sees) saw++;
      n.witness(g, c, d, sees);
    }
    if (saw > 0 && !this.seenCrimes.has(c.id)) { // the district itself remembers, once per incident
      this.seenCrimes.add(c.id);
      const where = districtAt(c.pos.x, c.pos.z);
      g.state.addNotoriety(where, CRIME_HEAT[c.type] * 4);
      g.state.log(c.type, where, `Witnessed: ${c.type}`);
    }
    return saw;
  }

  /** Skilled opponents sometimes get their guard up when they see a swing coming. */
  onPlayerSwing(): void {
    const p = this.g.player;
    for (const n of this.list) if (n.state === 'fight' && n.target === p && !n.armed && !n.swing && dist2(n.pos.x, n.pos.z, p.pos.x, p.pos.z) < 2.6 && Math.random() < n.skill * 0.7) n.blockT = 0.55;
  }

  nearestTalkable(max = 2.6): Npc | null {
    const p = this.g.player; let best: Npc | null = null, bd = max;
    for (const n of this.list) {
      if (!n.alive || n.far || n.state === 'indoors' || n.state === 'down' || Math.abs(n.pos.y - p.pos.y) > 1.5) continue;
      const d = dist2(n.pos.x, n.pos.z, p.pos.x, p.pos.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  interact(n: Npc): void {
    const g = this.g, p = g.player;
    n.yaw = yawTo(p.pos.x - n.pos.x, p.pos.z - n.pos.z);
    if (n.talk && n.talk(g)) return;
    if (n.state === 'walk') { n.setState('idle'); n.idleFor = 3; n.activity = 'talking to you'; }
    g.ui.bark(n, barkFor(n, g));
  }

  update(dt: number): void {
    const g = this.g, p = g.player;
    for (const n of this.list) {
      const d = dist2(n.pos.x, n.pos.z, p.pos.x, p.pos.z);
      n.far = d > LOD_DIST && !n.scripted && n.state !== 'police';
      if (n.far) { // simplified background simulation: 3 Hz, no animation, no senses
        n.lodAcc += dt;
        if (n.lodAcc < 0.33) continue;
        n.update(g, n.lodAcc); n.lodAcc = 0;
      } else {
        n.update(g, dt);
        // people get out of the way rather than blocking the player like bollards
        if (d < 0.66 && !p.vehicle && Math.abs(n.pos.y - p.pos.y) < 1.2 && n.state !== 'ko' && n.state !== 'down') {
          const k = (0.66 - d) / (d || 1); n.pos.x += (n.pos.x - p.pos.x) * k; n.pos.z += (n.pos.z - p.pos.z) * k;
          if (n.groundY === null) g.city.resolve(n.pos, 0.35);
        }
      }
    }
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 1;
    for (const post of this.posts) post.cd -= 1;
    let civilians = 0;
    for (const n of [...this.list]) {
      const d = dist2(n.pos.x, n.pos.z, p.pos.x, p.pos.z);
      const generic = !n.scripted && !n.persistent && !n.home;
      if (generic && !n.responder) civilians++;
      if (n.remove || (generic && d > 150 && n.state !== 'police') || (n.state === 'ko' && (!n.scripted || n.persistent) && ((n.koT > 30 && d > 45) || n.koT > 80))) {
        if (n.persistent && n.state === 'ko') { // named characters recover and come back to their post later
          if (d > 60) { n.alive = true; n.hp = n.maxHp; n.mood = 'wary'; n.setState(n.home ? 'scripted' : 'idle'); if (n.home) n.pos.set(n.home.x, 0, n.home.z); }
          continue;
        }
        this.despawn(n);
      }
    }
    if (civilians < populationTarget(g.state.hour) && g.interiors.current === null) this.spawnCivilian(48);
    this.refillPosts();
  }
}
