// One vehicle: a dynamic Rapier body driven by an arcade model (yaw-only rotation, flat world).
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GR_VEHICLE, Physics } from '../physics/Physics';
import { VehicleVisual, buildVehicle } from '../render/VehicleModel';
import { clamp, damp, fwdX, fwdZ, leftX, leftZ } from '../core/util';
import { groundHeight } from '../world/layout';
import { VEHICLES, VehicleSpec, VehicleType } from './specs';

export type DriverKind = 'player' | 'ai' | null;
export interface DriverAI {
  mode: 'traffic' | 'pursue' | 'flee' | 'stop';
  a: number; b: number; // road-graph edge currently being driven
  cruise: number; stuck: number; reverse: number; token: number; panic: number;
  route: number[]; routeTimer: number;
  next?: number; // junction exit chosen in advance, so the driver can slow down for a turn
  why?: string; // debugging aid: what the driver is currently waiting for
  jam?: number; wait?: number; push?: number; // patience: after waiting too long behind something, edge past it
}
let NEXT_ID = 1;

export class Vehicle {
  id = NEXT_ID++;
  spec: VehicleSpec;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  visual: VehicleVisual;
  health: number;
  driver: DriverKind = null;
  ai: DriverAI | null = null;
  // control inputs (-1..1)
  throttle = 0; steer = 0; handbrake = false;
  // cached state, refreshed after each physics step
  x = 0; z = 0; yaw = 0; speed = 0; lateral = 0;
  siren = false; owned = false; crew = 0; missionTag = ''; locked = false; permitted = false; stolen = false;
  hazard = 0;
  private setVx = 0; private setVz = 0; private driven = false;
  private gy = 0; private wheelSpin = 0; private steerVis = 0; private hitAcc = 0; private hitT = 0;
  impact = 0; // strength of the collision detected this step (0 = none)
  onDestroyed: (() => void) | null = null;

  constructor(public type: VehicleType, private phys: Physics, scene: THREE.Scene, x: number, z: number, yaw: number, colour?: number) {
    const s = (this.spec = VEHICLES[type]);
    this.health = s.health;
    const R = phys.R;
    this.body = phys.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, s.h / 2 + 0.02, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .enabledRotations(false, true, false).enabledTranslations(true, false, true).setLinearDamping(1.2).setAngularDamping(3).setCcdEnabled(true));
    this.collider = phys.world.createCollider(R.ColliderDesc.cuboid(s.w / 2, s.h / 2, s.l / 2).setCollisionGroups(GR_VEHICLE).setDensity(type === 'bus' ? 90 : 70).setFriction(0.25).setRestitution(0.15), this.body);
    this.visual = buildVehicle(type, colour ?? s.colours[Math.floor(Math.random() * s.colours.length)]);
    scene.add(this.visual.group);
    this.x = x; this.z = z; this.yaw = yaw; this.gy = groundHeight(x, z);
    this.syncVisual(0);
  }
  get dead(): boolean { return this.health <= 0; }
  get moving(): boolean { return Math.abs(this.speed) > 0.3 || Math.abs(this.lateral) > 0.3; }

  setDriver(d: DriverKind): void {
    this.driver = d;
    this.body.setLinearDamping(d ? 0 : 1.2); this.body.setAngularDamping(d ? 0 : 3);
    if (!d) { this.throttle = 0; this.steer = 0; this.handbrake = false; }
    this.body.wakeUp();
  }
  place(x: number, z: number, yaw: number): void {
    this.body.setTranslation({ x, y: this.spec.h / 2 + 0.02, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.x = x; this.z = z; this.yaw = yaw; this.speed = 0;
  }

  /** Arcade drive model. Called before the physics step. */
  update(dt: number): void {
    this.driven = false;
    if (!this.driver) return; // undriven cars are left to physics + damping
    const s = this.spec, v = this.body.linvel();
    const fx = fwdX(this.yaw), fz = fwdZ(this.yaw), lx = leftX(this.yaw), lz = leftZ(this.yaw);
    let vf = v.x * fx + v.z * fz, vl = v.x * lx + v.z * lz;
    const power = this.dead ? 0 : this.health < s.health * 0.25 ? 0.6 : 1;
    const th = clamp(this.throttle, -1, 1);
    if (th > 0) vf += vf < -0.5 ? s.brake * dt : s.accel * th * power * Math.max(0, 1 - vf / s.maxSpeed) * dt;
    else if (th < 0) vf += vf > 0.5 ? s.brake * th * dt : s.accel * 0.6 * th * power * Math.max(0, 1 + vf / (s.maxSpeed * 0.35)) * dt;
    else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
    vf -= vf * 0.012 * dt * Math.abs(vf); // air drag
    let grip = s.grip;
    if (this.handbrake) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 13 * dt); grip = 1.5; }
    vl *= Math.exp(-grip * dt);
    const steerFactor = clamp(vf / 5, -1, 1) / (1 + Math.abs(vf) / 34);
    const yawRate = clamp(this.steer, -1, 1) * s.steer * steerFactor * (this.handbrake ? 1.45 : 1);
    this.setVx = fx * vf + lx * vl; this.setVz = fz * vf + lz * vl;
    this.body.setLinvel({ x: this.setVx, y: 0, z: this.setVz }, true);
    this.body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);
    this.driven = true;
  }

  /** Read back the solver result; a big unexplained change in velocity is a collision. */
  postStep(dt: number): void {
    const t = this.body.translation(), q = this.body.rotation(), v = this.body.linvel();
    this.x = t.x; this.z = t.z; this.yaw = 2 * Math.atan2(q.y, q.w);
    this.speed = v.x * fwdX(this.yaw) + v.z * fwdZ(this.yaw);
    this.lateral = v.x * leftX(this.yaw) + v.z * leftZ(this.yaw);
    this.impact = 0;
    if (this.driven) {
      // The solver may spread one crash over a few steps, so add up the unexplained change in
      // velocity for the whole contact and report it once when the contact ends.
      const dv = Math.hypot(v.x - this.setVx, v.z - this.setVz);
      if (dv > 0.3) { this.hitAcc += dv; this.hitT = 0.1; }
      else if (this.hitAcc > 0 && (this.hitT -= dt) <= 0) { if (this.hitAcc > 3.5) this.impact = this.hitAcc; this.hitAcc = 0; }
    } else this.hitAcc = 0;
    if (this.hazard > 0) this.hazard -= dt;
    this.syncVisual(dt);
  }

  damage(amount: number): void {
    if (this.dead) return;
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; this.siren = false; this.onDestroyed?.(); }
  }
  repair(): void { this.health = this.spec.health; this.visual.smoke.visible = false; }

  private syncVisual(dt: number): void {
    const g = this.visual.group;
    this.gy = dt > 0 ? damp(this.gy, groundHeight(this.x, this.z), 14, dt) : this.gy;
    g.position.set(this.x, this.spec.h / 2 + 0.02 + this.gy, this.z);
    g.rotation.y = this.yaw;
    this.wheelSpin += this.speed * dt * 2.9;
    this.steerVis = damp(this.steerVis, this.steer * 0.45, 10, dt || 0.016);
    this.visual.wheels.forEach((w, i) => { w.rotation.x = this.wheelSpin; w.rotation.y = i % 2 === 1 ? this.steerVis : 0; });
    const now = performance.now();
    const braking = !!this.driver && (this.handbrake || (this.throttle < 0 && this.speed > 0.5) || (this.throttle === 0 && Math.abs(this.speed) < 0.4));
    const flash = this.hazard > 0 && Math.floor(now / 350) % 2 === 0;
    this.visual.tail.emissiveIntensity = flash ? 3 : braking ? 2.6 : 0.8;
    this.visual.head.emissiveIntensity = this.dead ? 0 : flash ? 3 : 1.6;
    if (this.visual.bar) { const on = this.siren && !this.dead; const ph = Math.floor(now / 140) % 2; this.visual.bar[0].emissiveIntensity = on && ph ? 6 : 0; this.visual.bar[1].emissiveIntensity = on && !ph ? 6 : 0; }
    if (this.visual.sign) this.visual.sign.emissiveIntensity = this.driver === 'player' ? 0.2 : 1.2;
    this.visual.beam.visible = !!this.driver && !this.dead;
    this.visual.tailGlow.opacity = this.dead ? 0 : flash ? 0.7 : braking ? 0.6 : this.driver ? 0.22 : 0.06;
    if (this.visual.barGlow) this.visual.barGlow.opacity = this.siren && !this.dead ? 0.35 + 0.45 * (Math.floor(now / 140) % 2) : 0;
    const smoking = this.health < this.spec.health * 0.3;
    this.visual.smoke.visible = smoking;
    if (smoking) { const k = (now / 700) % 1; this.visual.smoke.scale.setScalar(0.5 + k * 1.6); this.visual.smoke.position.y = this.spec.h / 2 + k * 1.6; (this.visual.smoke.material as THREE.MeshBasicMaterial).opacity = (this.dead ? 0.75 : 0.5) * (1 - k); }
  }

  /** World position beside a door: side = +1 driver's side (right-hand drive => right of the car), -1 the kerb side. */
  doorPos(side: number, out = 1.5): { x: number; z: number } {
    return { x: this.x - leftX(this.yaw) * side * (this.spec.w / 2 + out * 0.6), z: this.z - leftZ(this.yaw) * side * (this.spec.w / 2 + out * 0.6) };
  }
  dispose(scene: THREE.Scene): void {
    scene.remove(this.visual.group);
    this.phys.world.removeRigidBody(this.body);
  }
}
