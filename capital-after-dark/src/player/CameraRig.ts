// Third-person camera: a low, slightly off-centre follow shot with lag and collision, an
// over-the-shoulder aim mode, and a chase camera that looks ahead and widens with speed.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import { GR_RAY_WORLD } from '../physics/Physics';
import { clamp, damp, dampAngle, fwdX, fwdZ, leftX, leftZ } from '../core/util';

export class CameraRig {
  yaw = Math.PI; pitch = -0.16;
  /** How far the camera sits to the right of the character on foot (set to 0 for a dead-centre view). */
  shoulder = 0.42;
  private dist = 4.0; private fov = 66; private idle = 0; private shake = 0; private side = 0.42; private bob = 0;
  private target = new THREE.Vector3(); private want = new THREE.Vector3(); private dir = new THREE.Vector3(); private first = true;
  aimDir = new THREE.Vector3(0, 0, 1);
  constructor(private g: Game) {}
  kick(amount: number): void { this.shake = Math.min(0.6, this.shake + amount); }
  snapBehind(yaw: number): void { this.yaw = yaw; this.pitch = -0.16; this.first = true; }

  update(dt: number): void {
    const g = this.g, p = g.player, cam = g.gfx.camera, inp = g.input, sens = 0.0023 * g.settings.sensitivity;
    if (inp.dx || inp.dy) { this.yaw -= inp.dx * sens; this.pitch -= inp.dy * sens * (g.settings.invertY ? -1 : 1); this.idle = 0; } else this.idle += dt;
    this.pitch = clamp(this.pitch, -1.15, 0.75);
    let wantDist = 3.9, wantFov = 66, side = this.shoulder, height = 1.5, lag = 16;
    const v = p.vehicle;
    if (v) {
      const sp = Math.abs(v.speed);
      wantDist = 5.0 + v.spec.l * 0.55 + sp * 0.05; height = v.spec.h * 0.5 + 0.7; wantFov = 62 + Math.min(20, sp * 0.5); side = 0; lag = 9;
      if (this.idle > 0.8 && v.speed > -1.5) { this.yaw = dampAngle(this.yaw, v.yaw - clamp(v.steer, -1, 1) * 0.16 * clamp(sp / 8, 0, 1), 3, dt); this.pitch = damp(this.pitch, -0.14, 2, dt); }
    } else if (p.aiming && p.gunOut) { wantDist = 3.0; wantFov = 52; side = Math.max(0.85, this.shoulder); height = 1.68; lag = 30; }
    else if (g.interiors.current) wantDist = 3.0;
    else if (p.sprinting) { wantFov = 73; wantDist = 4.3; }
    if (p.crouching && !v) height -= 0.35;
    this.fov = damp(this.fov, wantFov, 6, dt);
    this.side = damp(this.side, side, 8, dt);
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.aimDir.copy(this.dir);
    // the point we orbit trails the character slightly (and leads the car), which gives the shot some weight
    const lead = v ? clamp(v.speed * 0.09, -1, 2.4) : 0;
    this.want.set(p.pos.x - leftX(this.yaw) * this.side + (v ? fwdX(v.yaw) * lead : 0), p.pos.y + height, p.pos.z - leftZ(this.yaw) * this.side + (v ? fwdZ(v.yaw) * lead : 0));
    if (this.first || this.want.distanceToSquared(this.target) > 9) { this.target.copy(this.want); this.first = false; }
    else { this.target.x = damp(this.target.x, this.want.x, lag, dt); this.target.z = damp(this.target.z, this.want.z, lag, dt); this.target.y = damp(this.target.y, this.want.y, 10, dt); }
    // pull the camera in when a wall is in the way
    const hit = g.phys.raycast(this.target.x, this.target.y, this.target.z, -this.dir.x, -this.dir.y, -this.dir.z, wantDist + 0.3, GR_RAY_WORLD);
    const allowed = hit ? Math.max(0.5, hit.dist - 0.3) : wantDist;
    this.dist = allowed < this.dist ? allowed : damp(this.dist, allowed, 5, dt);
    cam.position.copy(this.target).addScaledVector(this.dir, -this.dist);
    // footfall bob on foot, engine shudder at speed
    this.bob += dt * (v ? 30 : 3.2 + p.planarSpeed * 1.7);
    cam.position.y += v ? Math.sin(this.bob) * 0.004 * Math.min(1, Math.abs(v.speed) / 20) : Math.abs(Math.sin(this.bob)) * 0.012 * Math.min(1, p.planarSpeed / 4);
    if (this.shake > 0) { cam.position.x += (Math.random() - 0.5) * this.shake * 0.25; cam.position.y += (Math.random() - 0.5) * this.shake * 0.25; this.shake = Math.max(0, this.shake - dt * 2.2); }
    if (cam.position.y < p.pos.y + 0.25) cam.position.y = p.pos.y + 0.25;
    cam.lookAt(cam.position.x + this.dir.x, cam.position.y + this.dir.y, cam.position.z + this.dir.z);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
