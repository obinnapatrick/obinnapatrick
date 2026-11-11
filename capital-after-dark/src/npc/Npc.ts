// A single non-player character: role, activity, destination, mood, attitude and combat behaviour.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Combatant, DamageKind } from '../combat/types';
import { Action, CharacterModel, lookFor } from '../render/CharacterModel';
import { V2, angleDiff, dampAngle, dist2, rand, yawTo } from '../core/util';
import { districtAt, groundHeight, PoiKind } from '../world/layout';
import type { FactionId } from '../state/WorldState';
import type { Crime } from '../core/Game';

export type Role = 'pedestrian' | 'office' | 'tourist' | 'nightlife' | 'shopkeeper' | 'publican' | 'mechanic' | 'cabbie' | 'police' | 'armed' | 'marlowe' | 'kestrel' | 'heavy' | 'contact';
export type NState = 'idle' | 'walk' | 'flee' | 'cower' | 'phone' | 'fight' | 'cover' | 'stagger' | 'down' | 'ko' | 'indoors' | 'follow' | 'scripted' | 'police';
export type Mood = 'calm' | 'wary' | 'scared' | 'angry';
const CALL_CHANCE: Partial<Record<Role, number>> = { office: 0.45, shopkeeper: 0.7, tourist: 0.25, nightlife: 0.15, pedestrian: 0.3, cabbie: 0.5, publican: 0.6, mechanic: 0.4, contact: 0 };
const FIGHTERS: Role[] = ['police', 'armed', 'marlowe', 'kestrel', 'heavy'];
let NEXT = 1;

export class Npc implements Combatant {
  id = NEXT++;
  pos = new THREE.Vector3();
  yaw = 0; hp = 60; maxHp = 60; alive = true;
  name = ''; pid: string | null = null; faction: FactionId | null = null;
  state: NState = 'idle'; stateT = 0; mood: Mood = 'calm'; activity = 'standing about';
  path: V2[] = []; goal: string | null = null; goalKind: PoiKind | null = null; idleFor = 2;
  target: Combatant | null = null; hostileToPlayer = false; provoked = false;
  armed = false; gunDamage = 8; meleeDamage = 7; aggression = 0.2; bravery = 0.3; skill = 0.3;
  attackCd = 1; blockT = 0; swing: { kind: Action; t: number; dur: number; struck: boolean } | null = null;
  threat: V2 | null = null; fleeT = 0; callCrime: Crime | null = null; sawPlayer = false; phoneT = 0;
  coverT = 0; coverCd = 0; downT = 0; koT = 0; vehCd = 0; repath = 0; loseT = 0; senseT = Math.random();
  far = false; lodAcc = 0; remove = false;
  scripted = false; persistent = false; invulnerable = false; reactive = true;
  walkSpeed = 1.45; runSpeed = 5; speedNow = 0;
  follow: { pos: THREE.Vector3 } | null = null;
  groundY: number | null = null;
  home: V2 | null = null;
  pose: Action = 'none';
  order: { kind: 'chase' | 'goto' | 'search' | 'arrest'; x: number; z: number; t: number } | null = null; // police
  responder = false;
  model: CharacterModel;
  onDefeated: (() => void) | null = null;
  onArrive: (() => void) | null = null;
  talk: ((g: Game) => boolean) | null = null; // custom interaction; return true if handled

  constructor(public role: Role, lookRole: string = role) {
    this.model = new CharacterModel(lookFor(lookRole));
    const fighter = FIGHTERS.includes(role);
    this.maxHp = this.hp = role === 'heavy' ? 110 : role === 'armed' ? 100 : fighter ? 85 : 55 + Math.random() * 15;
    this.bravery = fighter ? 0.9 : Math.random() * 0.5;
    this.aggression = fighter ? 0.8 : role === 'nightlife' ? Math.random() : Math.random() * 0.5;
    this.skill = role === 'heavy' ? 0.6 : fighter ? 0.45 : 0.15;
    this.meleeDamage = role === 'heavy' ? 13 : fighter ? 9 : 6;
    this.walkSpeed = 1.25 + Math.random() * 0.5;
    this.runSpeed = role === 'police' || role === 'armed' ? 6.2 : 4.6 + Math.random() * 1.2;
    if (role === 'marlowe' || role === 'kestrel') this.faction = role;
    if (role === 'armed') { this.armed = true; this.gunDamage = 9; }
    this.model.setGun(this.armed);
  }
  get isFighter(): boolean { return FIGHTERS.includes(this.role); }
  setState(s: NState): void { this.state = s; this.stateT = 0; if (s !== 'fight' && s !== 'police') this.swing = null; }
  setArmed(a: boolean, dmg = 9): void { this.armed = a; this.gunDamage = dmg; this.model.setGun(a); }

  /** Route across the pavement graph (or straight there when it is in plain sight). */
  goTo(g: Game, x: number, z: number, direct = false): void {
    this.path = direct || (dist2(this.pos.x, this.pos.z, x, z) < 30 && g.city.los(this.pos.x, this.pos.z, x, z)) ? [{ x, z }] : g.city.nav.pathPoints(this.pos.x, this.pos.z, x, z);
    this.setState(this.state === 'flee' || this.state === 'police' || this.state === 'fight' || this.state === 'cover' ? this.state : 'walk');
  }
  /** Step towards a point, sliding along buildings. Returns true when within `arrive` metres. */
  steer(g: Game, dt: number, tx: number, tz: number, speed: number, arrive = 0.5): boolean {
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    if (d <= Math.max(arrive, speed * dt)) { this.speedNow = 0; return true; }
    this.pos.x += (dx / d) * speed * dt; this.pos.z += (dz / d) * speed * dt;
    if (this.groundY === null) g.city.resolve(this.pos, 0.35);
    this.yaw = dampAngle(this.yaw, yawTo(dx, dz), 10, Math.min(dt, 0.1));
    this.speedNow = speed;
    return false;
  }
  followPath(g: Game, dt: number, speed: number): boolean {
    if (!this.path.length) { this.speedNow = 0; return true; }
    if (this.steer(g, dt, this.path[0].x, this.path[0].z, speed, this.path.length > 1 ? 1.1 : 0.5)) this.path.shift();
    return this.path.length === 0;
  }
  /** Close in on a moving target: straight when visible, around the block otherwise. */
  chase(g: Game, dt: number, tx: number, tz: number, speed: number, stop = 1.3): boolean {
    const d = dist2(this.pos.x, this.pos.z, tx, tz);
    if (d < stop) { this.speedNow = 0; this.yaw = dampAngle(this.yaw, yawTo(tx - this.pos.x, tz - this.pos.z), 12, dt); return true; }
    if (this.groundY !== null || g.city.los(this.pos.x, this.pos.z, tx, tz)) { this.path.length = 0; this.steer(g, dt, tx, tz, speed, stop); return false; }
    this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) { this.repath = 1.2; this.path = g.city.nav.pathPoints(this.pos.x, this.pos.z, tx, tz); }
    this.followPath(g, dt, speed);
    return false;
  }

  startFight(t: Combatant): void {
    if (!this.alive || this.state === 'down' || this.state === 'ko') { this.target = t; return; }
    this.target = t; this.mood = 'angry'; this.loseT = 0;
    if (t.isPlayer) this.hostileToPlayer = true;
    if (this.state !== 'police') this.setState('fight');
  }
  fleeFrom(g: Game, pos: V2, time = rand(9, 15)): void {
    this.threat = { x: pos.x, z: pos.z }; this.mood = 'scared'; this.fleeT = time; this.target = null;
    const nav = g.city.nav;
    let best = nav.nearest(this.pos.x, this.pos.z, 64), bs = -Infinity;
    for (let i = 0; i < 10; i++) {
      const n = nav.randomCorner(Math.random), d = dist2(n.x, n.z, this.pos.x, this.pos.z);
      if (d < 30 || d > 120) continue;
      const away = (n.x - this.pos.x) * (this.pos.x - pos.x) + (n.z - this.pos.z) * (this.pos.z - pos.z);
      const s = away / (d + 1) + Math.random() * 3;
      if (s > bs) { bs = s; best = n.id; }
    }
    this.setState('flee');
    const n = nav.nodes[best];
    this.path = this.groundY === null ? nav.pathPoints(this.pos.x, this.pos.z, n.x, n.z) : [];
  }
  calm(g: Game): void { this.target = null; this.mood = 'wary'; if (!this.scripted) this.hostileToPlayer = false; this.setState('idle'); this.idleFor = 1; if (!this.scripted) g.npcs.plan(this); }

  // ------------------------------------------------------------------ reactions
  /** Called for everyone near a crime. `sees` = clear line of sight to it. */
  witness(g: Game, c: Crime, dist: number, sees: boolean): void {
    if (!this.alive || !this.reactive || this.state === 'ko' || this.state === 'down' || this.state === 'indoors' || c.victim === this && this.state === 'fight') return;
    const where = districtAt(c.pos.x, c.pos.z);
    if (sees && this.pid) g.state.remember(this.pid, c.type, where, c.type === 'brawl' ? -3 : -10);
    if (this.role === 'police' || this.role === 'armed') { g.police.report(c, sees, this); return; }
    if (this.target) return;
    const serious = c.type === 'gunfire' || c.type === 'shooting';
    if (this.faction) {
      const stance = g.state.factionStance(this.faction);
      if (sees && c.victim && (c.victim as Npc).faction === this.faction) { this.startFight(g.player); return; }
      if (serious && !this.armed && stance < 1) this.fleeFrom(g, c.pos, 6); else this.mood = 'wary';
      return;
    }
    if (this.role === 'heavy' || this.scripted && !serious) return;
    if (!serious && c.type !== 'assault' && c.type !== 'hitrun' && dist > 7) { // minor trouble: stop and stare
      this.mood = 'wary'; if (this.state === 'walk' || this.state === 'idle') { this.setState('idle'); this.idleFor = 3; this.activity = 'watching the commotion'; this.yaw = yawTo(c.pos.x - this.pos.x, c.pos.z - this.pos.z); }
      if (sees && Math.random() < 0.2) { this.callCrime = c; this.sawPlayer = true; this.setState('phone'); this.phoneT = 3.5; }
      return;
    }
    if (sees && c.type === 'assault' && dist < 9 && this.aggression > 0.8 && c.victim !== this) { g.ui.bark(this, 'Oi! Leave it out!'); this.startFight(g.player); return; }
    if (Math.random() < (CALL_CHANCE[this.role] ?? 0.3)) { this.callCrime = c; this.sawPlayer = sees && dist < 40; }
    if (serious && dist < 7 && Math.random() < 0.3) { this.mood = 'scared'; this.threat = { ...c.pos }; this.setState('cower'); return; }
    if (this.state !== 'flee' && this.state !== 'phone') this.fleeFrom(g, c.pos);
  }

  takeDamage(amount: number, attacker: Combatant | null, kind: DamageKind, dx: number, dz: number, heavy = false): void {
    if (!this.alive || this.invulnerable || this.state === 'indoors') return;
    const g = Npc.game;
    if (this.blockT > 0 && kind === 'melee') { amount *= 0.25; heavy = false; g.audio.play('thud', 0); }
    this.hp -= amount;
    if (kind !== 'bullet' && this.groundY === null) { this.pos.x += dx * 0.3; this.pos.z += dz * 0.3; g.city.resolve(this.pos, 0.35); }
    const byPlayer = !!attacker?.isPlayer;
    if (byPlayer) {
      const selfDefence = this.hostileToPlayer && !this.provoked;
      if (!this.hostileToPlayer) this.provoked = true;
      if (kind === 'melee' && !selfDefence) g.crime(this.role === 'police' || this.role === 'armed' ? 'assaultOfficer' : 'assault', this.pos, this);
      if (kind === 'vehicle') g.crime(this.role === 'police' || this.role === 'armed' ? 'assaultOfficer' : 'hitrun', this.pos, this);
      if (this.pid) g.state.remember(this.pid, 'attacked', districtAt(this.pos.x, this.pos.z), -35);
      if (this.faction && !selfDefence) g.state.changeRep(this.faction, -5, false);
      if (this.faction) for (const o of g.npcs.list) if (o !== this && o.faction === this.faction && o.alive && dist2(o.pos.x, o.pos.z, this.pos.x, this.pos.z) < 28) o.startFight(attacker!);
      g.bus.emit({ type: 'npcHit', npc: this, kind, amount });
    }
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false; this.setState('ko'); this.koT = 0; this.target = null; this.model.setGun(false);
      g.audio.play('thud', dist2(this.pos.x, this.pos.z, g.player.pos.x, g.player.pos.z));
      if (byPlayer) { g.state.data.stats.knockouts++; if (this.role === 'police' || this.role === 'armed') g.crime('assaultOfficer', this.pos, this); }
      g.bus.emit({ type: 'npcKO', npc: this, byPlayer });
      this.onDefeated?.();
      return;
    }
    if (heavy || (kind === 'vehicle' && amount > 9) || (kind === 'melee' && this.hp < this.maxHp * 0.25 && Math.random() < 0.5)) { this.setState('down'); this.downT = rand(1.8, 3.2); }
    else if (this.state !== 'down') { const keep = this.state; this.setState('stagger'); this.resume = keep === 'police' ? 'police' : null; }
    if (attacker) {
      if (this.state === 'police' || this.resume === 'police' || this.role === 'police' || this.role === 'armed') { this.target = attacker; if (byPlayer) this.hostileToPlayer = true; }
      else if (this.isFighter || this.aggression > 0.62 || this.scripted && this.target) { this.target = attacker; this.mood = 'angry'; if (byPlayer) this.hostileToPlayer = true; }
      else { this.target = null; this.threat = { x: attacker.pos.x, z: attacker.pos.z }; this.mood = 'scared'; }
    }
  }
  private resume: NState | null = null;
  static game: Game;

  // ------------------------------------------------------------------ per-tick
  update(g: Game, dt: number): void {
    this.stateT += dt; this.vehCd -= dt; this.attackCd -= dt; this.blockT -= dt; this.coverCd -= dt;
    let action: Action = this.pose, at = 0;
    switch (this.state) {
      case 'idle': {
        this.speedNow = 0;
        if (this.activity.includes('chat') || this.activity.includes('argu')) action = 'talk';
        else if (this.activity.includes('phone')) action = 'phone';
        this.idleFor -= dt;
        if (this.idleFor <= 0 && !this.scripted) g.npcs.plan(this);
        this.sense(g, dt);
        break;
      }
      case 'walk':
        if (this.followPath(g, dt, this.walkSpeed)) this.arrive(g);
        this.sense(g, dt);
        break;
      case 'follow':
        if (this.follow) this.chase(g, dt, this.follow.pos.x, this.follow.pos.z, 3.4, 2);
        break;
      case 'flee': {
        this.fleeT -= dt;
        if (this.followPath(g, dt, this.runSpeed) && this.threat && this.groundY === null) this.fleeFrom(g, this.threat, this.fleeT);
        if (this.groundY !== null && this.threat) { action = 'cower'; this.speedNow = 0; }
        const td = this.threat ? dist2(this.pos.x, this.pos.z, this.threat.x, this.threat.z) : 99;
        if (this.callCrime && (td > 16 || this.stateT > 5)) { this.setState('phone'); this.phoneT = 3.5; this.activity = 'on the phone to the police'; }
        else if (this.fleeT <= 0) { this.threat = null; this.calm(g); }
        break;
      }
      case 'cower':
        action = 'cower'; this.speedNow = 0;
        if (this.stateT > 3.5) { if (this.threat) this.fleeFrom(g, this.threat); else this.calm(g); }
        break;
      case 'phone':
        action = 'phone'; this.speedNow = 0; this.phoneT -= dt;
        if (this.phoneT <= 0) {
          if (this.callCrime) g.police.report(this.callCrime, this.sawPlayer, this);
          this.callCrime = null;
          if (this.threat && this.groundY === null) this.fleeFrom(g, this.threat, 6); else this.calm(g);
        }
        break;
      case 'fight': [action, at] = this.fight(g, dt); break;
      case 'cover':
        if (this.path.length) this.followPath(g, dt, this.runSpeed);
        else { action = 'crouch'; this.speedNow = 0; this.coverT -= dt; if (this.coverT <= 0) this.setState('fight'); }
        if (!this.target?.alive) this.calm(g);
        break;
      case 'stagger':
        action = 'hit'; at = this.stateT / 0.35; this.speedNow = 0;
        if (this.stateT > 0.35) {
          if (this.resume === 'police') this.setState('police');
          else if (this.target) this.setState('fight');
          else if (this.threat) this.fleeFrom(g, this.threat); else this.calm(g);
          this.resume = null;
        }
        break;
      case 'down':
        action = 'down'; this.speedNow = 0; this.downT -= dt;
        if (this.downT <= 0) {
          if (this.role === 'police' || this.role === 'armed') this.setState('police');
          else if (this.target && (this.isFighter || this.hp > this.maxHp * 0.3)) this.setState('fight');
          else this.fleeFrom(g, this.threat ?? g.player.pos);
        }
        break;
      case 'ko': action = 'down'; this.speedNow = 0; this.koT += dt; break;
      case 'indoors':
        this.idleFor -= dt;
        if (this.idleFor <= 0) { this.setState('idle'); this.idleFor = 0; }
        break;
      case 'police': [action, at] = g.police.think(this, dt); break;
      case 'scripted': this.speedNow = 0; break;
    }
    if (this.groundY === null) this.pos.y = groundHeight(this.pos.x, this.pos.z); else this.pos.y = this.groundY;
    const m = this.model.root;
    m.visible = !this.far && this.state !== 'indoors';
    if (m.visible) { m.position.copy(this.pos); m.rotation.y = this.yaw; this.model.update(dt, { speed: this.speedNow, action, t: at, armed: this.armed }); }
  }

  /** Low-frequency awareness: crews defend their turf from people they have a grudge against. */
  private sense(g: Game, dt: number): void {
    this.senseT -= dt; if (this.senseT > 0) return; this.senseT = 0.35;
    const p = g.player; if (!p.alive || this.scripted && !this.hostileToPlayer) return;
    const d = dist2(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
    if (this.faction && !g.interiors.current) {
      const hostile = g.state.factionStance(this.faction) < 0 || this.hostileToPlayer;
      if (hostile && d < 16 && !p.vehicle && g.city.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) { g.ui.bark(this, g.state.factionStance(this.faction) < 0 ? 'That’s them. Thought we told you to stay out.' : 'You again!'); this.startFight(p); }
    } else if (this.hostileToPlayer && d < 14) this.startFight(p);
    else if (!this.faction && !this.isFighter && d < 3 && g.state.notoriety(districtAt(this.pos.x, this.pos.z)) > 55 && this.mood === 'calm' && !this.scripted && this.groundY === null) {
      this.mood = 'wary'; g.ui.bark(this, 'It’s that one off the street… keep walking.'); this.fleeFrom(g, p.pos, 3);
    }
  }

  private arrive(g: Game): void {
    if (this.onArrive) { const f = this.onArrive; this.onArrive = null; this.setState(this.scripted ? 'scripted' : 'idle'); f(); return; }
    if (this.scripted) { this.setState('scripted'); return; }
    const k = this.goalKind;
    if (k === 'tube') { this.remove = true; return; }
    if (k === 'work') { this.setState('indoors'); this.idleFor = rand(40, 110); this.activity = 'at work'; }
    else if (k === 'cafe' || k === 'pub') { this.setState('indoors'); this.idleFor = rand(20, 45); this.activity = k === 'pub' ? 'in the pub' : 'getting something to eat'; }
    else {
      this.setState('idle'); this.idleFor = k === 'landmark' ? rand(8, 20) : rand(2, 7);
      this.activity = this.role === 'tourist' ? 'taking photos' : this.role === 'nightlife' ? (Math.random() < 0.5 ? 'chatting outside' : 'having a smoke') : this.role === 'police' ? 'on patrol' : this.faction ? 'keeping watch' : Math.random() < 0.3 ? 'on the phone' : 'waiting';
    }
  }

  private fight(g: Game, dt: number): [Action, number] {
    const t = this.target;
    if (!t || !t.alive) { this.calm(g); return ['none', 0]; }
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    if (t.isPlayer && (g.interiors.current !== null) !== (this.groundY !== null)) { this.calm(g); return ['none', 0]; }
    if (d > 60) { this.loseT += dt; if (this.loseT > 5) { this.calm(g); return ['none', 0]; } } else this.loseT = 0;
    if (!this.isFighter && this.hp < this.maxHp * (0.5 - this.bravery * 0.5)) { this.fleeFrom(g, { x: t.pos.x, z: t.pos.z }); return ['none', 0]; }
    const los = this.groundY !== null || g.city.los(this.pos.x, this.pos.z, t.pos.x, t.pos.z);
    if (this.armed) {
      if (!los || d > 30) { this.chase(g, dt, t.pos.x, t.pos.z, this.runSpeed, 8); return ['none', 0]; }
      this.speedNow = 0; this.yaw = dampAngle(this.yaw, yawTo(dx, dz), 12, dt);
      if (this.hp < this.maxHp * 0.65 && this.coverCd <= 0 && this.takeCover(g, t)) return ['aim', 0];
      if (this.swing) { this.swing.t += dt; if (this.swing.t >= this.swing.dur) { this.swing = null; g.combat.npcFire(this, t, this.gunDamage); this.attackCd = rand(0.7, 1.6); } }
      else if (this.attackCd <= 0) this.swing = { kind: 'aim', t: 0, dur: 0.4, struck: false };
      return ['aim', 0];
    }
    // melee
    if (this.swing) {
      const s = this.swing; s.t += dt; this.speedNow = 0;
      if (!s.struck && s.t >= s.dur * 0.5) {
        s.struck = true;
        if (d < 1.95 && Math.abs(angleDiff(this.yaw, yawTo(dx, dz))) < 1.1) {
          t.takeDamage(this.meleeDamage * (s.kind === 'hook' ? 1.5 : 1), this, 'melee', dx / (d || 1), dz / (d || 1), s.kind === 'hook' && Math.random() < 0.45);
          if (!t.isPlayer) g.audio.play('punch', dist2(this.pos.x, this.pos.z, g.player.pos.x, g.player.pos.z));
        }
      }
      if (s.t >= s.dur) { this.swing = null; this.attackCd = rand(0.7, 1.5) / (0.7 + this.skill); }
      return [s.kind, s.t / s.dur];
    }
    if (this.blockT > 0) { this.speedNow = 0; return ['block', 0]; }
    if (this.chase(g, dt, t.pos.x, t.pos.z, this.runSpeed, 1.4) && this.attackCd <= 0) this.swing = { kind: Math.random() < 0.3 ? 'hook' : Math.random() < 0.5 ? 'jab' : 'cross', t: 0, dur: 0.62, struck: false };
    return ['none', 0];
  }

  /** Find a nearby spot the target cannot see and run to it. */
  private takeCover(g: Game, t: Combatant): boolean {
    this.coverCd = 6;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 7;
      const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
      if (g.city.inSolid(x, z, 0.5) || !g.city.los(this.pos.x, this.pos.z, x, z) || g.city.los(x, z, t.pos.x, t.pos.z)) continue;
      this.path = [{ x, z }]; this.coverT = rand(1.5, 3); this.setState('cover');
      return true;
    }
    return false;
  }

  dispose(scene: THREE.Scene): void { scene.remove(this.model.root); }
}
