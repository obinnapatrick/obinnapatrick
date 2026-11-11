// Scene, camera, lighting, weather and post-processing. Knows nothing about gameplay rules.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { clamp, lerp, V2 } from '../core/util';
import { envTexture, glowTexture, skyTexture } from './textures';

export type Quality = 'low' | 'medium' | 'high';
const Q = {
  low: { ratio: 0.75, bloom: false, shadows: false, rain: 600, lights: 3, far: 230, mirror: 0 },
  medium: { ratio: 1, bloom: true, shadows: false, rain: 1500, lights: 6, far: 300, mirror: 0.5 },
  high: { ratio: 1.5, bloom: true, shadows: true, rain: 2600, lights: 8, far: 380, mirror: 0.75 },
};
const RAIN_MAX = 2600, MAX_LIGHTS = 8, SPLASHES = 260;

/** Final colour grade: crushed blacks, cool shadows / warm highlights, vignette and film grain. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.055 }, uVig: { value: 0.5 }, uNight: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig, uNight; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = max(c - 0.012 * uNight, 0.0) * 1.03;
      c = (c - 0.5) * (1.0 + 0.14 * uNight) + 0.5;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, mix(0.72, 1.12, smoothstep(0.08, 0.55, l)));          // muddy shadows, punchy lights
      c += (1.0 - smoothstep(0.0, 0.4, l)) * vec3(-0.010, 0.004, 0.026) * uNight; // cold shadows
      c += smoothstep(0.45, 1.0, l) * vec3(0.035, 0.012, -0.03);                  // sodium-warm highlights
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - uVig * smoothstep(0.32, 0.86, d);
      float n = fract(sin(dot(floor(vUv * vec2(960.0, 540.0)) + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain * (1.0 - l * 0.6);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/** Additive mirror layer laid over the tarmac: real planar reflections, broken up by puddles and ripples. */
const WetRoadShader = {
  name: 'WetRoad',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uWet: { value: 1 }, uTime: { value: 0 } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uWet, uTime; varying vec4 vUv; varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    void main(){
      vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;
      float fres = pow(1.0 - max(V.y, 0.0), 2.6);
      float puddle = smoothstep(0.44, 0.62, vn(vW.xz * 0.21) * 0.7 + vn(vW.xz * 0.9) * 0.3);
      float rough = mix(0.030, 0.006, puddle);
      vec2 rip = vec2(vn(vW.xz * 3.1 + uTime * 0.9), vn(vW.zx * 3.3 - uTime * 0.8)) - 0.5;
      rip += (vec2(vn(vW.xz * 17.0), vn(vW.zx * 19.0)) - 0.5) * 0.6;              // tarmac texture breaks the mirror up
      vec4 uv = vUv; uv.xy += rip * rough * uv.w;
      vec3 r = texture2DProj(tDiffuse, uv).rgb;
      uv.y += 0.018 * uv.w; r += texture2DProj(tDiffuse, uv).rgb;                  // smear downwards like a wet street
      uv.y += 0.03 * uv.w; r = (r + texture2DProj(tDiffuse, uv).rgb) / 3.0;
      float a = uWet * mix(0.26, 1.0, puddle) * mix(0.08, 0.8, fres) * exp(-dist * 0.010);
      gl_FragColor = vec4(min(r, vec3(1.6)) * a, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, 1, 0.15, 400);
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  quality: Quality = 'medium';
  hemi = new THREE.HemisphereLight(0x7f90d8, 0x1a1410, 0.5);
  sun = new THREE.DirectionalLight(0xbfd0ff, 0.3);
  private lampLights: THREE.PointLight[] = [];
  /** A faint fill light that travels with the player so the character always reads against the dark. */
  private follow = new THREE.PointLight(0xdfe6ff, 5, 9, 1.6);
  private lampPositions: V2[] = [];
  private lampTimer = 0;
  /** When set (interiors), the pooled lights are placed here instead of on street lamps. */
  lightOverride: { x: number; y: number; z: number }[] | null = null;
  /** Coloured light sources (neon, screens) that the two accent lights are handed to as you move. */
  accents: { x: number; y: number; z: number; colour: number; power: number }[] = [];
  private accentLights: THREE.PointLight[] = [];
  /** One real spotlight for the headlamps of the car the player is driving. */
  headlight = new THREE.SpotLight(0xfff0d0, 0, 46, 0.5, 0.6, 1.2);
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainVel = new Float32Array(RAIN_MAX);
  private splash: THREE.Points;
  private sky: THREE.Mesh;
  private mirror: Reflector;
  private clock = 0;
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
    this.scene.fog = new THREE.FogExp2(0x15121c, 0.0095);
    this.scene.background = new THREE.Color(0x15121c);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromEquirectangular(envTexture()).texture;
    this.scene.environmentIntensity = 0.5;
    pm.dispose();

    this.scene.add(this.hemi, this.sun, this.sun.target, this.follow, this.headlight, this.headlight.target);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0006;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 28, 1.7);
      l.position.set(0, -50, 0);
      this.lampLights.push(l); this.scene.add(l);
    }
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xff4080, 0, 26, 1.6); l.position.set(0, -50, 0); this.accentLights.push(l); this.scene.add(l); }

    // sky dome
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false, transparent: true }));
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.scene.add(this.sky);

    // wet road mirror
    this.mirror = new Reflector(new THREE.PlaneGeometry(380, 380), { textureWidth: 640, textureHeight: 360, shader: WetRoadShader, multisample: 0, clipBias: 0.02 });
    this.mirror.rotation.x = -Math.PI / 2; this.mirror.position.y = 0.025;
    const mm = this.mirror.material as THREE.ShaderMaterial; mm.transparent = true; mm.blending = THREE.AdditiveBlending; mm.depthWrite = false;
    this.mirror.renderOrder = 2; this.scene.add(this.mirror);

    // rain streaks that follow the camera
    this.rainPos = new Float32Array(RAIN_MAX * 6);
    for (let i = 0; i < RAIN_MAX; i++) this.resetDrop(i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa8b8d8, transparent: true, opacity: 0.3, fog: false, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    // splashes where the drops land
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPLASHES * 3), 3));
    this.splash = new THREE.Points(sg, new THREE.PointsMaterial({ map: glowTexture(), color: 0xbfd0f0, size: 0.13, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.splash.frustumCulled = false; this.scene.add(this.splash);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setQuality('medium');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resetDrop(i: number, anywhere: boolean) {
    const p = this.rainPos, o = i * 6;
    const x = (Math.random() - 0.5) * 44, z = (Math.random() - 0.5) * 44, y = anywhere ? Math.random() * 22 : 22;
    p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = x + 0.22; p[o + 4] = y - 1.0; p[o + 5] = z + 0.06;
    this.rainVel[i] = 21 + Math.random() * 9;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const c = Q[q];
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? dpr * 0.75 : Math.min(dpr, c.ratio));
    this.renderer.shadowMap.enabled = c.shadows;
    this.sun.castShadow = c.shadows;
    this.bloom.enabled = c.bloom;
    this.mirror.visible = c.mirror > 0;
    if (c.mirror > 0) this.mirror.getRenderTarget().setSize(Math.round(1280 * c.mirror), Math.round(720 * c.mirror));
    this.camera.far = c.far; this.camera.updateProjectionMatrix();
    this.rain.geometry.setDrawRange(0, c.rain * 2);
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && !Array.isArray(m)) m.needsUpdate = true; });
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
    const sky = new THREE.Color(0x15121c).lerp(new THREE.Color(0x7d8a96), dayness);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.FogExp2).color.copy(sky);
    (this.scene.fog as THREE.FogExp2).density = lerp(0.004, 0.0088, n) + this.rainAmount * 0.0022;
    (this.sky.material as THREE.MeshBasicMaterial).opacity = n;
    this.hemi.intensity = lerp(1.8, 0.62, n);
    this.hemi.color.set(n > 0.5 ? 0x6f80c8 : 0xdfe8f2);
    this.sun.intensity = lerp(2.0, 0.22, n);
    this.sun.color.set(n > 0.5 ? 0x8fa4ff : 0xfff1dd);
    this.follow.intensity = lerp(0, 4.5, n);
    this.scene.environmentIntensity = lerp(0.9, 0.55, n);
    for (const m of this.nightMaterials) (m.mat as any)[m.prop] = m.base * lerp(0.1, 1, n);
    for (const w of this.wetMaterials) w.mat.roughness = lerp(w.dry, w.wet, this.rainAmount);
    this.grade.uniforms.uNight.value = n;
  }

  /** Aim the player's-car headlamp (or switch it off). */
  setHeadlight(on: boolean, x = 0, y = 0, z = 0, dx = 0, dz = 1): void {
    this.headlight.intensity = on ? 260 * lerp(0.25, 1, this.night) : 0;
    if (!on) return;
    this.headlight.position.set(x, y, z); this.headlight.target.position.set(x + dx * 12, y - 1.2, z + dz * 12);
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.clock += dt;
    const indoors = !!this.lightOverride;
    this.grade.uniforms.uTime.value = this.clock % 100;
    const mu = (this.mirror.material as THREE.ShaderMaterial).uniforms;
    mu.uTime.value = this.clock; mu.uWet.value = lerp(0.3, 1, this.rainAmount) * lerp(0.35, 1, this.night);
    if (Q[this.quality].mirror > 0) this.mirror.visible = !indoors;
    this.sky.position.copy(this.camera.position); this.sky.visible = !indoors;
    // rain
    const count = Q[this.quality].rain;
    this.rain.visible = this.rainAmount > 0.03 && !indoors;
    this.splash.visible = this.rain.visible;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.32 * this.rainAmount;
    if (this.rain.visible) {
      this.rain.position.set(this.camera.position.x, this.camera.position.y - 8, this.camera.position.z);
      const p = this.rainPos;
      for (let i = 0; i < count; i++) {
        const o = i * 6, v = this.rainVel[i] * dt;
        p[o + 1] -= v; p[o + 4] -= v;
        if (p[o + 4] < 0) this.resetDrop(i, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      const sp = this.splash.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < SPLASHES; i++) if (Math.random() < 0.35) sp.setXYZ(i, focus.x + (Math.random() - 0.5) * 34, focus.y + 0.2 + (Math.random() < 0.5 ? 0 : -0.14), focus.z + (Math.random() - 0.5) * 34);
      sp.needsUpdate = true;
      (this.splash.material as THREE.PointsMaterial).opacity = 0.42 * this.rainAmount;
    }
    this.follow.position.set(focus.x, focus.y + 2.6, focus.z);
    // sun/shadow frustum follows the action
    this.sun.position.set(focus.x + 40, focus.y + 70, focus.z + 25);
    this.sun.target.position.copy(focus);
    // hand the limited real lights to the street lamps (and neon) nearest the action
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.25;
      const n = Q[this.quality].lights;
      const near = indoors ? [] : this.lampPositions.map((l) => ({ l, d: (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2 })).sort((a, b) => a.d - b.d);
      for (let i = 0; i < MAX_LIGHTS; i++) {
        const L = this.lampLights[i];
        if (this.lightOverride) { const o = this.lightOverride[i]; if (o) { L.position.set(o.x, o.y, o.z); L.intensity = 34; L.color.setHex(0xffc98a); } else L.intensity = 0; continue; }
        if (i < n && near[i]) { L.position.set(near[i].l.x, 5.6, near[i].l.z); L.color.setHex(0xffa850); L.intensity = 75 * lerp(0.05, 1, this.night); }
        else L.intensity = 0;
      }
      const acc = indoors ? [] : this.accents.map((a) => ({ a, d: (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 })).sort((p, q) => p.d - q.d);
      this.accentLights.forEach((L, i) => {
        const a = acc[i]?.a;
        if (a && acc[i].d < 60 * 60) { L.position.set(a.x, a.y, a.z); L.color.setHex(a.colour); L.intensity = a.power * lerp(0.05, 1, this.night); } else L.intensity = 0;
      });
    }
  }
  render(): void {
    this.renderer.info.reset();
    this.composer.render();
  }
  stats(): { calls: number; triangles: number } { return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }; }
}
