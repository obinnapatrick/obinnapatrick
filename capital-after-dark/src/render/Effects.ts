// Short-lived visual effects (tracers, sparks, flashes) and world markers. Everything is pooled.
import * as THREE from 'three';
import { glowTexture } from './textures';

export interface Marker { x: number; z: number; y: number; r: number; colour: number; icon: string; mesh: THREE.Mesh; remove(): void; move(x: number, z: number, y?: number): void }

export class Effects {
  markers: Marker[] = [];
  private tracers: { line: THREE.Line; life: number }[] = [];
  private sparks: { s: THREE.Sprite; life: number; vx: number; vy: number; vz: number }[] = [];
  private flash = new THREE.PointLight(0xffd9a0, 0, 16, 1.6);
  private flashLife = 0;
  private glow = glowTexture();
  private markerGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);

  constructor(private scene: THREE.Scene) {
    scene.add(this.flash);
    for (let i = 0; i < 24; i++) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      line.frustumCulled = false; line.visible = false; scene.add(line); this.tracers.push({ line, life: 0 });
    }
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffc060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      s.visible = false; scene.add(s); this.sparks.push({ s, life: 0, vx: 0, vy: 0, vz: 0 });
    }
  }
  tracer(a: THREE.Vector3, b: THREE.Vector3, colour = 0xffe6a8): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const p = t.line.geometry.attributes.position as THREE.BufferAttribute;
    p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
    (t.line.material as THREE.LineBasicMaterial).color.setHex(colour);
    t.life = 0.09; t.line.visible = true;
  }
  muzzle(p: THREE.Vector3): void { this.flash.position.copy(p); this.flash.intensity = 70; this.flashLife = 0.06; this.burst(p.x, p.y, p.z, 0xffe0a0, 2, 0.7); }
  /** Non-graphic impact puff: sparks for metal/stone, a white "pop" for people. */
  burst(x: number, y: number, z: number, colour = 0xffc060, count = 5, size = 0.35): void {
    for (let i = 0; i < count; i++) {
      const sp = this.sparks.find((q) => q.life <= 0); if (!sp) return;
      sp.s.position.set(x, y, z); sp.s.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      (sp.s.material as THREE.SpriteMaterial).color.setHex(colour);
      sp.vx = (Math.random() - 0.5) * 4; sp.vy = Math.random() * 3; sp.vz = (Math.random() - 0.5) * 4; sp.life = 0.25 + Math.random() * 0.2; sp.s.visible = true;
    }
  }
  addMarker(x: number, z: number, r = 2.5, colour = 0xffd23a, icon = '●', y = 0.15): Marker {
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(this.markerGeo, mat); mesh.scale.set(r, 5, r); mesh.position.set(x, y + 2.5, z); this.scene.add(mesh);
    const m: Marker = { x, z, y, r, colour, icon, mesh,
      remove: () => { this.scene.remove(mesh); mat.dispose(); const i = this.markers.indexOf(m); if (i >= 0) this.markers.splice(i, 1); },
      move: (nx, nz, ny) => { m.x = nx; m.z = nz; if (ny !== undefined) m.y = ny; mesh.position.set(nx, m.y + 2.5, nz); } };
    this.markers.push(m); return m;
  }
  update(dt: number, time: number): void {
    for (const t of this.tracers) if (t.life > 0) { t.life -= dt; (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.09); if (t.life <= 0) t.line.visible = false; }
    for (const s of this.sparks) if (s.life > 0) {
      s.life -= dt; s.vy -= 9 * dt; s.s.position.x += s.vx * dt; s.s.position.y += s.vy * dt; s.s.position.z += s.vz * dt;
      (s.s.material as THREE.SpriteMaterial).opacity = Math.min(1, s.life * 5); if (s.life <= 0) s.s.visible = false;
    }
    if (this.flashLife > 0) { this.flashLife -= dt; if (this.flashLife <= 0) this.flash.intensity = 0; }
    const pulse = 0.26 + Math.sin(time * 4) * 0.08;
    for (const m of this.markers) (m.mesh.material as THREE.MeshBasicMaterial).opacity = pulse;
  }
}
