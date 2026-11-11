// The hub: owns every system, runs the simulation tick, and implements cross-cutting rules
// (crimes -> witnesses, arrest/hospital consequences, saving, entering vehicles and doors).
import { Physics } from '../physics/Physics';
import { Renderer } from '../render/Renderer';
import { Effects } from '../render/Effects';
import { City } from '../world/City';
import { Interiors } from '../world/Interiors';
import { PARK_OFFSET, districtAt } from '../world/layout';
import { Input } from './Input';
import { GameAudio } from './Audio';
import { EventBus } from './EventBus';
import { V2, clamp, damp, dist2, fmtMoney, fwdX, fwdZ } from './util';
import { WorldState, newSaveData } from '../state/WorldState';
import { SaveSystem, Settings, loadSettings } from '../state/SaveSystem';
import { Player } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { Combat } from '../combat/Combat';
import type { Combatant } from '../combat/types';
import { VehicleManager } from '../vehicles/VehicleManager';
import type { Vehicle } from '../vehicles/Vehicle';
import type { VehicleType } from '../vehicles/specs';
import { Population } from '../npc/Population';
import { PoliceManager } from '../police/PoliceManager';
import type { CrimeType } from '../police/WantedSystem';
import { MissionManager } from '../missions/MissionManager';
import { RandomEvents } from '../events/RandomEvents';
import { UI } from '../ui/UI';

export interface Crime { id: number; type: CrimeType; pos: V2; time: number; victim: Combatant | null }
export type Mode = 'menu' | 'playing' | 'paused';

export class Game {
  phys!: Physics; gfx!: Renderer; fx!: Effects; city!: City; interiors!: Interiors;
  input!: Input; audio = new GameAudio(); bus = new EventBus();
  state = new WorldState(); saves = new SaveSystem(localStorage); settings: Settings = loadSettings(localStorage);
  player!: Player; camera!: CameraRig; combat!: Combat; vehicles!: VehicleManager; npcs!: Population;
  police!: PoliceManager; missions!: MissionManager; events!: RandomEvents; ui!: UI;
  mode: Mode = 'menu';
  time = 0; godMode = false;
  /** Tests switch this off so the simulation only advances when they say so. */
  autoStep = true;
  /** Tests can also switch off continuous rendering (software GL is slow) and render on demand. */
  autoRender = true;
  perf = { fps: 0, simMs: 0, simMax: 0 };
  errors: string[] = [];
  private crimeSeq = 1; private recent = new Map<string, { id: number; time: number; cast: number }>();
  private timers: { t: number; fn: () => void }[] = [];
  private autosave = 90; private weatherT = 0; private rainTarget = 1; private lastFrame = 0; private menuAngle = 0;

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const g = new Game();
    g.phys = await Physics.create();
    g.gfx = new Renderer(canvas);
    g.fx = new Effects(g.gfx.scene);
    g.input = new Input(canvas);
    g.city = new City(g.phys, g.gfx);
    g.player = new Player(g); g.camera = new CameraRig(g); g.combat = new Combat(g);
    g.vehicles = new VehicleManager(g); g.npcs = new Population(g); g.police = new PoliceManager(g);
    g.interiors = new Interiors(g);
    g.ui = new UI(g);
    g.missions = new MissionManager(g); g.events = new RandomEvents(g);
    g.gfx.setQuality(g.settings.quality); g.audio.setVolume(g.settings.volume);
    g.gfx.setTime(22);
    g.bus.on('playerDown', () => g.after(2.3, () => g.wasted()));
    canvas.addEventListener('click', () => { g.audio.start(); if (g.mode === 'playing' && !g.ui.dialogueActive && !g.ui.shopActive) g.input.lock(); });
    // Losing the mouse (Esc in the browser, alt-tab) pauses the game rather than leaving you defenceless.
    let hadLock = false;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (hadLock && !locked && g.mode === 'playing' && g.autoStep && !g.ui.dialogueActive && !g.ui.shopActive) g.setPaused(true);
      hadLock = locked;
    });
    window.addEventListener('blur', () => { if (g.mode === 'playing' && g.autoStep && !g.ui.dialogueActive && !g.ui.shopActive) g.setPaused(true); });
    window.addEventListener('error', (e) => g.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => g.errors.push(String(e.reason)));
    window.addEventListener('beforeunload', () => { if (g.mode !== 'menu' && !g.missions.active && g.player.alive) g.saveGame('Saved', true); });
    g.ui.openMenu('menu-main');
    g.player.model.root.visible = false;
    requestAnimationFrame((t) => g.frame(t));
    return g;
  }

  // ------------------------------------------------------------------ session control
  newGame(): void { this.saves.clear(); this.startSession(new WorldState(newSaveData()), true); }
  continueGame(): boolean { const s = this.saves.load(); if (!s) return false; this.startSession(s, false); this.ui.saveIndicator('Save loaded'); return true; }
  quitToMenu(): void { if (!this.missions.active && this.player.alive) this.saveGame('Saved'); this.mode = 'menu'; this.ui.showHud(false); this.ui.openMenu('menu-main'); this.player.model.root.visible = false; }
  setPaused(p: boolean): void {
    if (this.mode === 'menu') return;
    this.mode = p ? 'paused' : 'playing';
    if (p) this.ui.openMenu('menu-pause'); else { this.ui.closeMenu(); this.input.lock(); }
  }

  private startSession(state: WorldState, fresh: boolean): void {
    this.state = state;
    this.timers = []; this.recent.clear();
    this.events.cancel(); this.missions.reset();
    const d = state.data, p = this.player;
    p.reset(); // must leave any vehicle BEFORE the vehicles (and their physics bodies) are destroyed
    if (this.interiors.current) { this.interiors.current = null; this.gfx.lightOverride = null; }
    this.police.reset(); this.vehicles.clear(); this.npcs.clear();
    p.hp = clamp(d.hp, 10, 100);
    p.teleport(d.pos[0], d.pos[1], d.pos[2], d.yaw); this.camera.snapBehind(d.yaw);
    this.combat.current = 'fists'; p.gunOut = false; p.model.setGun(false);
    this.vehicles.populate();
    if (fresh) this.deliverOwnedVehicle(-5.35, 30, Math.PI); else { const k = this.kerbNear(d.pos[0], d.pos[2]); this.deliverOwnedVehicle(k.x, k.z, k.yaw); }
    this.npcs.populate(); this.interiors.populate();
    this.missions.refresh();
    this.gfx.setTime(state.hour);
    this.mode = 'playing'; this.autosave = 90;
    this.ui.closeMenu(); this.ui.showHud(true); this.ui.fade(false);
    this.input.lock();
    if (fresh) { this.ui.banner('CAPITAL: AFTER DARK', 'Soho, Thursday night. Your shift has just started.'); this.after(3, () => this.ui.toast('Walk to the yellow marker outside Night Owl Cars to start work')); state.log('story', 'Soho', 'Started the night shift'); }
    this.bus.emit({ type: 'sessionStart', fresh });
  }

  saveGame(label = 'Game saved', quiet = false): boolean {
    const d = this.state.data, p = this.player, inside = this.interiors.streetPos();
    d.hp = Math.round(p.hp);
    d.pos = inside ? [inside[0], inside[1], inside[2]] : [p.pos.x, Math.max(0.15, p.pos.y), p.pos.z];
    d.yaw = inside ? inside[3] : p.yaw;
    const ok = this.saves.save(this.state);
    if (!quiet) this.ui.saveIndicator(ok ? label : 'Save failed');
    return ok;
  }
  /** Run something later on simulation time (so it also works when tests fast-forward). */
  after(seconds: number, fn: () => void): void { this.timers.push({ t: seconds, fn }); }

  // ------------------------------------------------------------------ main loop
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    try {
      if (this.mode === 'playing') { if (this.autoStep) this.step(dt); }
      else if (this.mode === 'menu') this.menuScene(dt);
      else { this.ui.modalInput(); if (this.input.rawHit('Escape') || this.input.rawHit('KeyP')) this.setPaused(false); this.input.endTick(); }
      if (this.autoRender) this.gfx.render();
    } catch (e) { const m = String((e as Error)?.stack ?? e); if (this.errors.length < 20) this.errors.push(m); console.error(e); }
  }
  private menuScene(dt: number): void {
    this.menuAngle += dt * 0.05;
    const cam = this.gfx.camera, a = this.menuAngle;
    cam.position.set(-150 + Math.sin(a) * 26, 9 + Math.sin(a * 0.7) * 2, 78 + Math.cos(a) * 26);
    cam.lookAt(-128, 9, 58);
    this.city.update(dt); this.gfx.update(dt, cam.position); this.fx.update(dt, this.time);
    this.input.endTick();
  }

  /** One simulation tick. */
  step(dt: number): void {
    const t0 = performance.now();
    const inp = this.input, p = this.player, ui = this.ui;
    this.time += dt;
    const wasModal = ui.dialogueActive || ui.shopActive; // Esc that closes a panel must not also pause
    ui.modalInput();
    const modal = wasModal || ui.dialogueActive || ui.shopActive;
    inp.enabled = !modal;
    if (!modal && (inp.rawHit('Escape') || inp.rawHit('KeyP'))) { this.setPaused(true); inp.endTick(); return; }
    if (inp.rawHit('F5') && !this.missions.active) this.saveGame();
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    this.state.advanceClock(dt); // one in-game minute per real second
    this.state.decayNotoriety(dt / 60);
    this.weather(dt);

    p.update(dt);
    this.combat.update(dt);
    this.interactions();
    this.vehicles.update(dt);
    this.npcs.update(dt);
    this.police.update(dt);
    this.missions.update(dt);
    this.events.update(dt);
    this.phys.step(dt);
    this.vehicles.postStep(dt);
    p.postStep(dt);
    if (p.vehicle) this.state.data.stats.distance += Math.abs(p.vehicle.speed) * dt;
    this.camera.update(dt);
    this.fx.update(dt, this.time); this.city.update(dt);
    const v = p.vehicle;
    if (v && !v.dead) this.gfx.setHeadlight(true, v.x + fwdX(v.yaw) * v.spec.l * 0.45, p.pos.y + 0.75, v.z + fwdZ(v.yaw) * v.spec.l * 0.45, fwdX(v.yaw), fwdZ(v.yaw)); else this.gfx.setHeadlight(false);
    this.gfx.setTime(this.state.hour); this.gfx.update(dt, p.pos);
    let siren = 0;
    for (const c of this.vehicles.list) if (c.siren) siren = Math.max(siren, 1 - dist2(c.x, c.z, p.pos.x, p.pos.z) / 120);
    this.audio.ambience(dt, { rain: this.gfx.rainAmount, engine: v && !v.dead ? Math.min(1, Math.abs(v.speed) / v.spec.maxSpeed + Math.abs(v.throttle) * 0.15) : -1, siren: Math.max(0, siren), indoors: !!this.interiors.current, night: this.gfx.night });
    ui.update(dt);
    this.autosave -= dt;
    if (this.autosave <= 0) { this.autosave = 90; if (!this.missions.active && this.police.wanted.level === 0 && p.alive && !modal) this.saveGame('Autosaved'); }
    inp.endTick();
    const ms = performance.now() - t0;
    this.perf.simMs = this.perf.simMs * 0.97 + ms * 0.03; this.perf.simMax = Math.max(this.perf.simMax * 0.999, ms);
    ui.noteSim(ms);
  }
  /** Test hook: run the simulation forward without waiting for real time. */
  advance(seconds: number, dt = 1 / 60): void { for (let t = 0; t < seconds && this.mode === 'playing'; t += dt) this.step(dt); }

  private weather(dt: number): void {
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = 150 + Math.random() * 200; this.rainTarget = Math.random() < 0.65 ? 0.6 + Math.random() * 0.4 : 0; }
    this.gfx.rainAmount = damp(this.gfx.rainAmount, this.rainTarget, 0.08, dt);
  }

  // ------------------------------------------------------------------ interactions
  private interactions(): void {
    const p = this.player, inp = this.input, ui = this.ui;
    if (!p.alive || p.frozen) { ui.setPrompt(null); return; }
    if (inp.hit('KeyG')) this.useItem();
    if (p.vehicle) {
      ui.setPrompt(Math.abs(p.vehicle.speed) < 7 ? '<kbd>F</kbd>Get out' : null);
      if (inp.hit('KeyF')) p.exitVehicle();
      return;
    }
    const exit = this.interiors.atExit(), door = this.interiors.doorNearby();
    const n = this.npcs.nearestTalkable();
    const v = this.interiors.current ? null : this.vehicles.nearest(p.pos.x, p.pos.z, 2.6, (c) => c.spec.drivable && !c.locked && !c.dead);
    const parts: string[] = [];
    if (exit) parts.push('<kbd>E</kbd>Leave'); else if (door) parts.push(`<kbd>E</kbd>Enter ${door.name}`); else if (n) parts.push(`<kbd>E</kbd>Talk to ${n.name}`);
    if (v) parts.push(`<kbd>F</kbd>${v.driver === 'ai' ? 'Take the' : v.owned ? 'Get in your' : 'Get in'} ${v.spec.name}`);
    ui.setPrompt(parts.length ? parts.join(' &nbsp; ') : null);
    if (inp.hit('KeyE')) { if (exit) this.interiors.exit(); else if (door) this.interiors.enter(door); else if (n) this.npcs.interact(n); }
    if (inp.hit('KeyF') && v) this.tryEnter(v);
  }
  tryEnter(v: Vehicle): boolean {
    const p = this.player;
    if (v.type === 'police' && v.crew > 0) { this.ui.toast('There are officers in that car'); return false; }
    if (v.driver === 'ai') { // take an occupied vehicle: the driver is turfed out and will report it
      const dp = v.doorPos(1, 1.8);
      const drv = this.npcs.spawn(v.type === 'cab' ? 'cabbie' : 'pedestrian', dp.x, dp.z);
      this.city.resolve(drv.pos, 0.4);
      v.ai = null;
      const c = this.crime('carjack', { x: v.x, z: v.z }, drv);
      drv.callCrime = c; drv.sawPlayer = true; drv.fleeFrom(this, p.pos, 6);
      this.ui.bark(drv, 'Oi! That’s my motor!');
    } else if (!v.owned && !v.permitted && !v.stolen) this.crime('carjack', { x: v.x, z: v.z });
    v.stolen = !v.owned && !v.permitted;
    p.enterVehicle(v);
    return true;
  }
  private useItem(): void {
    const p = this.player, it = this.state.data.items;
    if (p.hp >= p.maxHp) { this.ui.toast('You’re not hurt'); return; }
    if ((p.hp < 45 || it.snack === 0) && it.medkit > 0) { it.medkit--; p.heal(100); this.ui.toast('Used a first-aid kit'); this.audio.play('pickup'); }
    else if (it.snack > 0) { it.snack--; p.heal(25); this.ui.toast('Ate a sausage roll (+25)'); this.audio.play('pickup'); }
    else this.ui.toast('Nothing to eat - try the corner shop');
  }

  // ------------------------------------------------------------------ crime & consequences
  nextCrimeId(): number { return this.crimeSeq++; }
  /**
   * The player has done something illegal. Nothing happens unless somebody witnesses it:
   * nearby NPCs react, some phone it in, officers who see it radio it in themselves.
   */
  crime(type: CrimeType, pos: V2, victim: Combatant | null = null): Crime {
    const key = type + ':' + ((victim as any)?.id ?? '');
    const r = this.recent.get(key);
    const window = type === 'gunfire' ? 3 : 4;
    let id: number;
    if (r && this.time - r.time < window) { id = r.id; r.time = this.time; } // same incident, not a new offence
    else { id = this.crimeSeq++; this.recent.set(key, { id, time: this.time, cast: -10 }); }
    const c: Crime = { id, type, pos: { x: pos.x, z: pos.z }, time: this.time, victim };
    if (type === 'alarm') { this.police.report(c, true, null); return c; } // monitored alarm: no witness needed
    const rec = this.recent.get(key)!;
    if (this.time - rec.cast > 0.8) { rec.cast = this.time; this.npcs.broadcast(c); }
    this.bus.emit({ type: 'crime', crime: c });
    return c;
  }

  /** Arrested: fine, ammunition confiscated, hours lost, active mission failed. */
  busted(): void {
    const p = this.player; if (!p.alive || p.frozen && this.ui.dialogueActive) return;
    const level = this.police.wanted.level;
    this.bus.emit({ type: 'busted' });
    p.frozen = true; this.ui.fade(true);
    this.after(0.7, () => {
      const d = this.state.data, fine = Math.min(d.cash, 100 + 75 * level);
      this.state.addCash(-fine, 'fine');
      for (const k of Object.keys(d.ammo)) d.ammo[k] = { mag: 0, reserve: 0 };
      d.stats.busted++; this.state.advanceClock(180);
      this.state.log('busted', districtAt(p.pos.x, p.pos.z), `Arrested (${level}★). Fined ${fmtMoney(fine)}`);
      this.state.remember('pc_bell', 'arrested', districtAt(p.pos.x, p.pos.z), -5);
      this.relocate('police');
      this.ui.banner('Arrested', `Fined ${fmtMoney(fine)} · ammunition confiscated · released three hours later`, true);
      this.saveGame('Autosaved');
    });
  }
  /** Knocked out: patched up at the walk-in centre for a fee. */
  wasted(): void {
    const p = this.player; if (p.alive) return;
    this.bus.emit({ type: 'wasted' });
    this.ui.fade(true);
    this.after(0.7, () => {
      const d = this.state.data, fee = Math.min(d.cash, 50 + Math.round(d.cash * 0.1));
      this.state.addCash(-fee, 'treatment'); d.stats.wasted++; this.state.advanceClock(240);
      this.state.log('hospital', districtAt(p.pos.x, p.pos.z), `Treated at the walk-in centre (${fmtMoney(fee)})`);
      this.relocate('hospital');
      this.ui.banner('Hospitalised', `Treatment cost ${fmtMoney(fee)} · four hours lost`, true);
    });
  }
  private relocate(poi: string): void {
    const p = this.player, q = this.city.layout.poi(poi);
    if (p.vehicle) p.exitVehicle(true);
    if (this.interiors.current) { this.interiors.current = null; this.gfx.lightOverride = null; }
    this.police.reset(); this.police.disengage();
    p.reset(); p.hp = poi === 'hospital' ? 100 : Math.max(p.hp, 60);
    p.teleport(q.x, 0.15, q.z, q.yaw); this.camera.snapBehind(q.yaw);
    this.ui.fade(false);
    this.ensureOwnedVehicleNear(...this.kerbTuple(q.x, q.z), 80);
  }

  // ------------------------------------------------------------------ owned vehicle helpers
  ownedVehicle(): Vehicle | null { return this.vehicles.list.find((v) => v.owned) ?? null; }
  /** A legal-looking kerbside parking spot near a point. */
  kerbNear(x: number, z: number): { x: number; z: number; yaw: number } {
    const R = this.city.roads, a = R.nearest(x, z);
    let best = { x: R.nodes[a].x, z: R.nodes[a].z, yaw: 0 }, bd = Infinity;
    for (const b of R.nodes[a].links) {
      const hd = R.heading(a, b), len = R.edgeLength(a, b);
      const along = clamp((x - R.nodes[a].x) * fwdX(hd) + (z - R.nodes[a].z) * fwdZ(hd), 16, len - 16);
      for (const [from, to, al] of [[a, b, along], [b, a, len - along]] as const) {
        const pt = R.lanePoint(from, to, al, PARK_OFFSET), d = dist2(pt.x, pt.z, x, z);
        if (d < bd) { bd = d; best = { x: pt.x, z: pt.z, yaw: R.heading(from, to) }; }
      }
    }
    return best;
  }
  private kerbTuple(x: number, z: number): [number, number, number] { const k = this.kerbNear(x, z); return [k.x, k.z, k.yaw]; }
  ensureOwnedVehicleNear(x: number, z: number, yaw: number, maxDist: number): void {
    const v = this.ownedVehicle(), p = this.player;
    if (v && !v.dead && (p.vehicle === v || dist2(v.x, v.z, p.pos.x, p.pos.z) < maxDist)) return;
    this.deliverOwnedVehicle(x, z, yaw);
  }
  /** Spawn the player's selected owned vehicle at a spot (replacing the previous instance). */
  deliverOwnedVehicle(x: number, z: number, yaw: number): Vehicle {
    const old = this.ownedVehicle();
    if (old) this.vehicles.remove(old);
    for (const o of [...this.vehicles.list]) if (!o.driver && !o.missionTag && dist2(o.x, o.z, x, z) < 6.5) this.vehicles.remove(o);
    const type = (this.state.data.vehicles.includes(this.state.data.activeVehicle) ? this.state.data.activeVehicle : 'cab') as VehicleType;
    return this.vehicles.spawn(type, x, z, yaw, { owned: true });
  }
}
