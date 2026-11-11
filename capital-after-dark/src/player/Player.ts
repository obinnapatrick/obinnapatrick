// The third-person protagonist: kinematic character controller on foot, plus vehicle occupancy.
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Combatant, DamageKind } from '../combat/types';
import { GR_PLAYER, GR_PLAYER_QUERY } from '../physics/Physics';
import { Action, CharacterModel, lookFor } from '../render/CharacterModel';
import { angleDiff, dampAngle, fwdX, fwdZ, leftX, leftZ, yawTo } from '../core/util';
import { groundHeight } from '../world/layout';
import type { Vehicle } from '../vehicles/Vehicle';

const HALF = 0.5, RAD = 0.32, CENTRE = HALF + RAD;
export interface Attack { kind: Action; t: number; dur: number; done: boolean; damage: number; range: number; heavy: boolean }

export class Player implements Combatant {
  isPlayer = true;
  pos = new THREE.Vector3();
  yaw = 0;
  hp = 100; maxHp = 100; alive = true;
  vy = 0; grounded = true; planarSpeed = 0;
  vehicle: Vehicle | null = null;
  vehCd = 0;
  crouching = false; sprinting = false; blocking = false; aiming = false;
  attack: Attack | null = null;
  dodgeT = 0; dodgeCd = 0; private dodgeX = 0; private dodgeZ = 0;
  hitT = 0; downT = 0;
  lastCombat = -100;
  gunOut = false; fireAnim = 0;
  frozen = false; // dialogue / cut-scene
  model: CharacterModel;
  body: RAPIER.RigidBody; collider: RAPIER.Collider; private cc: RAPIER.KinematicCharacterController;
  private move = { x: 0, y: 0, z: 0 };

  constructor(private g: Game) {
    const R = g.phys.R, w = g.phys.world;
    this.body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CENTRE + 0.2, 0));
    this.collider = w.createCollider(R.ColliderDesc.capsule(HALF, RAD).setCollisionGroups(GR_PLAYER), this.body);
    this.cc = w.createCharacterController(0.03);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableAutostep(0.4, 0.15, false);
    this.cc.enableSnapToGround(0.35);
    this.cc.setMaxSlopeClimbAngle(Math.PI / 3);
    this.cc.setApplyImpulsesToDynamicBodies(false);
    this.model = new CharacterModel(lookFor('player'));
    g.gfx.scene.add(this.model.root);
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    this.body.setTranslation({ x, y: y + CENTRE + 0.02, z }, true);
    this.pos.set(x, y, z); this.yaw = yaw; this.vy = 0;
    this.model.root.position.copy(this.pos); this.model.root.rotation.y = yaw;
  }
  get driving(): boolean { return this.vehicle !== null; }
  get busy(): boolean { return this.downT > 0 || this.hitT > 0.15 || !this.alive; }

  update(dt: number): void {
    const g = this.g, inp = g.input;
    this.vehCd -= dt; this.dodgeCd -= dt; this.fireAnim -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.vehicle) { this.drive(); return; }
    if (this.downT > 0) this.downT -= dt;
    const can = this.alive && this.downT <= 0 && !this.frozen;
    const cam = g.camera.yaw;
    let ix = 0, iz = 0;
    if (can) { ix = inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']); iz = inp.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']); }
    let dx = fwdX(cam) * iz - leftX(cam) * ix, dz = fwdZ(cam) * iz - leftZ(cam) * ix;
    const len = Math.hypot(dx, dz); if (len > 0) { dx /= len; dz /= len; }
    if (can && inp.hit('KeyC')) this.crouching = !this.crouching;
    this.sprinting = can && inp.down('ShiftLeft') && len > 0 && !this.aiming && !this.blocking;
    if (this.sprinting) this.crouching = false;
    let speed = this.sprinting ? 7.4 : this.crouching ? 1.9 : this.aiming || this.blocking ? 2.3 : 4.4;
    if (this.attack) speed *= 0.35;
    if (this.hitT > 0) speed *= 0.4;

    if (can && inp.hit('KeyQ') && this.dodgeCd <= 0 && this.grounded) {
      this.dodgeT = 0.34; this.dodgeCd = 0.9; this.attack = null;
      if (len > 0) { this.dodgeX = dx; this.dodgeZ = dz; } else { this.dodgeX = -fwdX(this.yaw); this.dodgeZ = -fwdZ(this.yaw); }
      g.audio.play('whoosh');
    }
    if (this.dodgeT > 0) { this.dodgeT -= dt; dx = this.dodgeX; dz = this.dodgeZ; speed = 9.5; }
    else if (len === 0) speed = 0;
    if (can && inp.hit('Space') && this.grounded && this.dodgeT <= 0) { this.vy = 5.4; this.grounded = false; this.crouching = false; }
    this.vy -= 18 * dt;
    this.move.x = dx * speed * dt; this.move.z = dz * speed * dt; this.move.y = this.vy * dt;
    this.cc.computeColliderMovement(this.collider, this.move, undefined, GR_PLAYER_QUERY);
    const m = this.cc.computedMovement(), t = this.body.translation();
    this.grounded = this.cc.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = -1;
    this.planarSpeed = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
    let ny = t.y + m.y;
    if (ny < -200) ny = CENTRE + 0.3; // absolute safety net: never fall out of the world
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: ny, z: t.z + m.z });

    // facing
    if (this.alive && this.downT <= 0) {
      if (this.aiming || this.blocking || this.fireAnim > 0) this.yaw = dampAngle(this.yaw, cam, 22, dt);
      else if (this.attack) { /* keep facing chosen at attack start */ }
      else if (len > 0 || this.dodgeT > 0) this.yaw = dampAngle(this.yaw, yawTo(dx, dz), 14, dt);
    }
    if (this.attack) { this.attack.t += dt; if (this.attack.t >= this.attack.dur) this.attack = null; }
    // slow recovery when out of trouble (food and medkits do the real healing)
    if (this.alive && g.time - this.lastCombat > 9 && this.hp < 50) this.hp = Math.min(50, this.hp + 2.5 * dt);
  }

  private drive(): void {
    const v = this.vehicle!, inp = this.g.input;
    const can = this.alive && !this.frozen;
    v.throttle = can ? inp.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) : 0;
    v.steer = can ? inp.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) : 0;
    v.handbrake = can ? inp.down('Space') : true;
    if (can && inp.hit('KeyH')) this.g.audio.play('horn');
  }

  /** After the physics step: read back the resolved position and pose the model. */
  postStep(dt: number): void {
    if (this.vehicle) {
      const v = this.vehicle;
      this.pos.set(v.x, groundHeight(v.x, v.z), v.z); this.yaw = v.yaw;
      this.body.setTranslation({ x: v.x, y: 30, z: v.z }, false);
      return;
    }
    const t = this.body.translation();
    this.pos.set(t.x, t.y - CENTRE, t.z);
    const mdl = this.model;
    mdl.root.position.copy(this.pos); mdl.root.rotation.y = this.yaw;
    let action: Action = 'none', at = 0;
    if (!this.alive || this.downT > 0) action = 'down';
    else if (this.hitT > 0) { action = 'hit'; at = 1 - this.hitT / 0.3; }
    else if (this.dodgeT > 0) action = 'dodge';
    else if (this.attack) { action = this.attack.kind; at = this.attack.t / this.attack.dur; }
    else if (this.blocking) action = 'block';
    else if (this.gunOut && (this.aiming || this.fireAnim > 0)) action = 'aim';
    else if (this.crouching) action = 'crouch';
    mdl.update(dt, { speed: this.planarSpeed, action, t: at, armed: this.gunOut, air: !this.grounded && this.vy > -3 && this.downT <= 0 && this.alive });
  }

  takeDamage(amount: number, attacker: Combatant | null, kind: DamageKind, dx: number, dz: number, heavy = false): void {
    if (!this.alive || this.g.godMode) return;
    if (this.dodgeT > 0 && kind !== 'vehicle') return; // i-frames
    this.lastCombat = this.g.time;
    if (this.vehicle) { if (kind === 'bullet') { this.vehicle.damage(amount * 0.5); amount *= 0.3; } else return; }
    else if (this.blocking && kind === 'melee' && attacker) {
      const facing = Math.abs(angleDiff(this.yaw, yawTo(attacker.pos.x - this.pos.x, attacker.pos.z - this.pos.z))) < 1.3;
      if (facing) { amount *= 0.15; heavy = false; this.g.audio.play('thud'); this.g.bus.emit({ type: 'playerBlocked' }); }
    }
    this.hp -= amount;
    this.hitT = 0.3;
    this.g.ui.damageFlash();
    if (kind === 'melee' && amount > 3) this.g.audio.play('hit');
    if ((kind === 'vehicle' && amount > 10) || (heavy && amount > 8)) { this.downT = 1.2; this.attack = null; this.g.audio.play('thud'); }
    if (kind === 'vehicle' && !this.vehicle) { const t = this.body.translation(); this.body.setTranslation({ x: t.x + dx * 0.5, y: t.y, z: t.z + dz * 0.5 }, true); }
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.attack = null; this.g.bus.emit({ type: 'playerDown', by: attacker }); }
  }
  heal(n: number): void { this.hp = Math.min(this.maxHp, this.hp + n); }

  enterVehicle(v: Vehicle): void {
    this.vehicle = v; v.setDriver('player'); v.ai = null;
    this.collider.setEnabled(false); this.model.root.visible = false;
    this.attack = null; this.aiming = false; this.blocking = false; this.crouching = false; this.dodgeT = 0;
    this.g.audio.play('door');
    this.g.bus.emit({ type: 'enterVehicle', vehicle: v });
  }

  /** Leave the vehicle onto the first genuinely free spot; never inside geometry. */
  exitVehicle(force = false): boolean {
    const v = this.vehicle; if (!v) return false;
    if (!force && Math.abs(v.speed) > 7) { this.g.ui.toast('Slow down before getting out'); return false; }
    const lx = leftX(v.yaw), lz = leftZ(v.yaw), fx = fwdX(v.yaw), fz = fwdZ(v.yaw), hw = v.spec.w / 2, hl = v.spec.l / 2;
    const spots: [number, number][] = [];
    for (const out of [0.75, 1.3]) for (const along of [0.3, -0.8, 1.4, -1.9]) for (const side of [-1, 1]) // right-hand drive: driver's door first
      spots.push([v.x + lx * side * (hw + out) + fx * along, v.z + lz * side * (hw + out) + fz * along]);
    spots.push([v.x - fx * (hl + 1), v.z - fz * (hl + 1)], [v.x + fx * (hl + 1), v.z + fz * (hl + 1)]);
    let place: [number, number, number] | null = null;
    for (const [x, z] of spots) {
      const y = groundHeight(x, z);
      if (!this.g.city.inSolid(x, z, 0.4) && this.g.phys.spaceFree(x, y + CENTRE + 0.12, z)) { place = [x, y, z]; break; }
    }
    if (!place) place = [v.x, v.spec.h + 0.3, v.z]; // boxed in on all sides: climb out onto the roof
    v.setDriver(null);
    this.vehicle = null;
    this.collider.setEnabled(true); this.model.root.visible = true;
    this.teleport(place[0], place[1], place[2], v.yaw);
    this.g.audio.play('door');
    this.g.bus.emit({ type: 'exitVehicle', vehicle: v });
    return true;
  }

  reset(): void {
    if (this.vehicle) { this.vehicle.setDriver(null); this.vehicle = null; }
    this.collider.setEnabled(true); this.model.root.visible = true;
    this.alive = true; this.hp = this.maxHp; this.downT = 0; this.hitT = 0; this.attack = null; this.vy = 0; this.frozen = false; this.dodgeT = 0;
  }
}
