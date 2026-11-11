// Third-person orbit camera with collision, an over-the-shoulder aim mode and a chase mode for driving.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import { GR_RAY_WORLD } from '../physics/Physics';
import { clamp, damp, dampAngle, leftX, leftZ } from '../core/util';

export class CameraRig {
  yaw = Math.PI; pitch = -0.2;
  private dist = 4.6; private fov = 62; private idle = 0; private shake = 0;
  private target = new THREE.Vector3(); private dir = new THREE.Vector3();
  aimDir = new THREE.Vector3(0, 0, 1);
  constructor(private g: Game) {}
  kick(amount: number): void { this.shake = Math.min(0.6, this.shake + amount); }
  snapBehind(yaw: number): void { this.yaw = yaw; this.pitch = -0.2; }

  update(dt: number): void {
    const g = this.g, p = g.player, cam = g.gfx.camera, inp = g.input, sens = 0.0023 * g.settings.sensitivity;
    if (inp.dx || inp.dy) { this.yaw -= inp.dx * sens; this.pitch -= inp.dy * sens * (g.settings.invertY ? -1 : 1); this.idle = 0; } else this.idle += dt;
    this.pitch = clamp(this.pitch, -1.15, 0.75);
    let wantDist = 4.6, wantFov = 62, shoulder = 0, height = 1.55;
    const v = p.vehicle;
    if (v) {
      wantDist = 5.8 + v.spec.l * 0.5 + Math.abs(v.speed) * 0.07; height = v.spec.h * 0.5 + 1.0; wantFov = 64 + Math.min(14, Math.abs(v.speed) * 0.35);
      if (this.idle > 1 && v.speed > -1.5) { this.yaw = dampAngle(this.yaw, v.yaw, 2.6, dt); this.pitch = damp(this.pitch, -0.2, 2, dt); }
    } else if (p.aiming && p.gunOut) { wantDist = 2.9; wantFov = 50; shoulder = 0.8; height = 1.65; }
    else if (g.interiors.current) wantDist = 3.2;
    if (p.crouching && !v) height -= 0.35;
    this.fov = damp(this.fov, wantFov, 8, dt);
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.aimDir.copy(this.dir);
    this.target.set(p.pos.x - leftX(this.yaw) * shoulder, p.pos.y + height, p.pos.z - leftZ(this.yaw) * shoulder);
    // pull the camera in when a wall is in the way
    const hit = g.phys.raycast(this.target.x, this.target.y, this.target.z, -this.dir.x, -this.dir.y, -this.dir.z, wantDist + 0.3, GR_RAY_WORLD);
    const allowed = hit ? Math.max(0.5, hit.dist - 0.3) : wantDist;
    this.dist = allowed < this.dist ? allowed : damp(this.dist, allowed, 6, dt);
    cam.position.copy(this.target).addScaledVector(this.dir, -this.dist);
    if (this.shake > 0) { cam.position.x += (Math.random() - 0.5) * this.shake * 0.25; cam.position.y += (Math.random() - 0.5) * this.shake * 0.25; this.shake = Math.max(0, this.shake - dt * 2.2); }
    if (cam.position.y < p.pos.y + 0.25) cam.position.y = p.pos.y + 0.25;
    cam.lookAt(cam.position.x + this.dir.x, cam.position.y + this.dir.y, cam.position.z + this.dir.z);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
