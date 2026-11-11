// Scene, camera, lighting, weather and post-processing. Knows nothing about gameplay rules.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp, lerp, V2 } from '../core/util';
import { envTexture } from './textures';

export type Quality = 'low' | 'medium' | 'high';
const Q = {
  low: { ratio: 0.75, bloom: false, shadows: false, rain: 500, lights: 3, far: 220 },
  medium: { ratio: 1, bloom: true, shadows: false, rain: 1300, lights: 6, far: 300 },
  high: { ratio: 1.5, bloom: true, shadows: true, rain: 2400, lights: 8, far: 380 },
};
const RAIN_MAX = 2400, MAX_LIGHTS = 8;

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.15, 400);
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  quality: Quality = 'medium';
  hemi = new THREE.HemisphereLight(0x8fa8ff, 0x1a1410, 0.6);
  sun = new THREE.DirectionalLight(0xbfd0ff, 0.5);
  private lampLights: THREE.PointLight[] = [];
  /** A faint fill light that travels with the player so the character always reads against the dark. */
  private follow = new THREE.PointLight(0xdfe6ff, 5, 9, 1.6);
  private lampPositions: V2[] = [];
  private lampTimer = 0;
  /** When set (interiors), the pooled lights are placed here instead of on street lamps. */
  lightOverride: { x: number; y: number; z: number }[] | null = null;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainVel = new Float32Array(RAIN_MAX);
  rainAmount = 1; // 0..1
  night = 1; // 0 day .. 1 night
  /** materials whose emissive intensity follows the night factor */
  nightMaterials: { mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.PointsMaterial; base: number; prop: 'emissiveIntensity' | 'opacity' }[] = [];
  wetMaterials: { mat: THREE.MeshStandardMaterial; dry: number; wet: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.scene.fog = new THREE.FogExp2(0x0c1020, 0.0075);
    this.scene.background = new THREE.Color(0x0c1020);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromEquirectangular(envTexture()).texture;
    this.scene.environmentIntensity = 0.5;
    pm.dispose();

    this.scene.add(this.hemi, this.sun, this.sun.target, this.follow);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0006;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 26, 1.8);
      l.position.set(0, -50, 0);
      this.lampLights.push(l); this.scene.add(l);
    }

    // rain streaks that follow the camera
    this.rainPos = new Float32Array(RAIN_MAX * 6);
    for (let i = 0; i < RAIN_MAX; i++) this.resetDrop(i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.32, fog: false, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setQuality('medium');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resetDrop(i: number, anywhere: boolean) {
    const p = this.rainPos, o = i * 6;
    const x = (Math.random() - 0.5) * 44, z = (Math.random() - 0.5) * 44, y = anywhere ? Math.random() * 22 : 22;
    p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = x + 0.12; p[o + 4] = y - 0.75; p[o + 5] = z;
    this.rainVel[i] = 19 + Math.random() * 8;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const c = Q[q];
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? dpr * 0.75 : Math.min(dpr, c.ratio));
    this.renderer.shadowMap.enabled = c.shadows;
    this.sun.castShadow = c.shadows;
    this.bloom.enabled = c.bloom;
    this.camera.far = c.far; this.camera.updateProjectionMatrix();
    this.rain.geometry.setDrawRange(0, c.rain * 2);
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.resize();
  }
  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
  }
  setLampPositions(l: V2[]): void { this.lampPositions = l; }

  /** hour: 0..24. Drives sky, fog, light balance and window glow. */
  setTime(hour: number): void {
    const dayness = clamp(Math.min((hour - 5.5) / 2, (19.5 - hour) / 2), 0, 1);
    this.night = 1 - dayness;
    const n = this.night;
    const sky = new THREE.Color(0x10131f).lerp(new THREE.Color(0x8d9aa6), dayness);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.FogExp2).color.copy(sky);
    (this.scene.fog as THREE.FogExp2).density = lerp(0.004, 0.0085, n) + this.rainAmount * 0.002;
    this.hemi.intensity = lerp(1.9, 0.9, n);
    this.follow.intensity = lerp(0, 5, n);
    this.hemi.color.set(n > 0.5 ? 0x8fa0e0 : 0xdfe8f2);
    this.sun.intensity = lerp(2.2, 0.35, n);
    this.sun.color.set(n > 0.5 ? 0x9fb4ff : 0xfff1dd);
    this.scene.environmentIntensity = lerp(0.9, 0.5, n);
    for (const m of this.nightMaterials) (m.mat as any)[m.prop] = m.base * lerp(0.12, 1, n);
    for (const w of this.wetMaterials) w.mat.roughness = lerp(w.dry, w.wet, this.rainAmount);
  }

  update(dt: number, focus: THREE.Vector3): void {
    // rain
    const count = Q[this.quality].rain;
    this.rain.visible = this.rainAmount > 0.03 && !this.lightOverride;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.34 * this.rainAmount;
    if (this.rain.visible) {
      this.rain.position.set(this.camera.position.x, this.camera.position.y - 8, this.camera.position.z);
      const p = this.rainPos;
      for (let i = 0; i < count; i++) {
        const o = i * 6, v = this.rainVel[i] * dt;
        p[o + 1] -= v; p[o + 4] -= v;
        if (p[o + 4] < 0) this.resetDrop(i, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    this.follow.position.set(focus.x, focus.y + 2.6, focus.z);
    // sun/shadow frustum follows the action
    this.sun.position.set(focus.x + 40, focus.y + 70, focus.z + 25);
    this.sun.target.position.copy(focus);
    // hand the limited real lights to the street lamps nearest the action
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.25;
      const n = Q[this.quality].lights;
      const near = this.lampPositions.map((l) => ({ l, d: (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2 })).sort((a, b) => a.d - b.d);
      for (let i = 0; i < MAX_LIGHTS; i++) {
        const L = this.lampLights[i];
        if (this.lightOverride) { const o = this.lightOverride[i]; if (o) { L.position.set(o.x, o.y, o.z); L.intensity = 38; } else L.intensity = 0; continue; }
        if (i < n && near[i]) { L.position.set(near[i].l.x, 5.4, near[i].l.z); L.intensity = 55 * lerp(0.05, 1, this.night); }
        else L.intensity = 0;
      }
    }
  }
  render(): void {
    this.renderer.info.reset();
    if (this.bloom.enabled) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
  stats(): { calls: number; triangles: number } { return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }; }
}
