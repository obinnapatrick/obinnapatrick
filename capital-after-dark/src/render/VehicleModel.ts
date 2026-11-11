// Procedural vehicle bodies. All models face +Z with the origin at the centre of the collision box.
import * as THREE from 'three';
import { VEHICLES, VehicleType } from '../vehicles/specs';
import { glowTexture, labelTexture } from './textures';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const WHEEL = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12).rotateZ(Math.PI / 2);
const tyre = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 });
const glass = new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.08, metalness: 0.9, envMapIntensity: 2 });
const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 0.9 });
const plateRear = new THREE.MeshStandardMaterial({ color: 0xf2c200, emissive: 0xf2c200, emissiveIntensity: 0.35 });
const plateFront = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, emissive: 0xffffff, emissiveIntensity: 0.25 });
let beamTex: THREE.Texture | null = null;
const BEAM = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const busGlass = new THREE.MeshStandardMaterial({ color: 0x22201a, emissive: 0xffe2b0, emissiveIntensity: 0.55, roughness: 0.3 });

export interface VehicleVisual {
  group: THREE.Group; paint: THREE.MeshStandardMaterial; wheels: THREE.Mesh[]; tail: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial;
  bar?: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]; sign?: THREE.MeshStandardMaterial; smoke: THREE.Mesh; beam: THREE.Mesh;
}

export function buildVehicle(type: VehicleType, colour: number): VehicleVisual {
  const s = VEHICLES[type], g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.3, metalness: 0.35, envMapIntensity: 2.4 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400808, emissive: 0xff1a1a, emissiveIntensity: 0.9 });
  const head = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2cc, emissiveIntensity: 1.6 });
  const b = (m: THREE.Material, w: number, h: number, l: number, x: number, y: number, z: number) => { const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, l); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const base = -s.h / 2; // bottom of the collision box
  const clear = 0.28;
  const v: VehicleVisual = { group: g, paint, wheels: [], tail, head, smoke: new THREE.Mesh(), beam: new THREE.Mesh() };
  if (type === 'bus') {
    b(paint, s.w, s.h - clear, s.l, 0, clear / 2, 0);
    for (const y of [base + 1.55, base + 3.35]) { b(busGlass, s.w + 0.03, 0.85, s.l - 1.2, 0, y, -0.1); b(busGlass, s.w - 0.3, 0.85, 0.05, 0, y, s.l / 2 + 0.01); }
    const blind = new THREE.MeshStandardMaterial({ map: labelTexture('N19  SOHO · PICCADILLY', '#ffb000', '#0a0a0a', 256, 48), emissive: 0xffffff, emissiveIntensity: 0.5 });
    blind.emissiveMap = blind.map;
    const bl = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.38), blind); bl.position.set(0, base + 2.45, s.l / 2 + 0.02); g.add(bl);
  } else {
    const lower = type === 'van' ? 1.0 : type === 'sports' ? 0.55 : type === 'cab' ? 0.85 : 0.7;
    b(paint, s.w, lower, s.l, 0, base + clear + lower / 2, 0);
    const cabH = s.h - clear - lower;
    if (type === 'van') { b(paint, s.w, cabH, s.l * 0.62, 0, base + clear + lower + cabH / 2, -s.l * 0.17); b(glass, s.w - 0.1, cabH * 0.75, s.l * 0.2, 0, base + clear + lower + cabH * 0.42, s.l * 0.24); }
    else {
      const cl = type === 'cab' ? s.l * 0.62 : type === 'sports' ? s.l * 0.42 : s.l * 0.52, cz = type === 'cab' ? -s.l * 0.08 : -s.l * 0.06;
      b(glass, s.w - 0.16, cabH * 0.8, cl, 0, base + clear + lower + cabH * 0.4, cz);
      b(paint, s.w - 0.1, cabH * 0.2, cl * 0.92, 0, base + clear + lower + cabH * 0.9, cz); // roof
      for (const sx of [-1, 1]) for (const pz of [cz - cl / 2 + 0.06, cz + cl / 2 - 0.06, cz]) b(paint, 0.07, cabH * 0.8, 0.08, sx * (s.w / 2 - 0.09), base + clear + lower + cabH * 0.4, pz); // pillars
    }
    b(chrome, s.w * 0.7, 0.16, 0.06, 0, base + clear + 0.25, s.l / 2 + 0.02); // grille
  }
  for (const sx of [-1, 1]) {
    b(head, 0.32, 0.16, 0.06, sx * (s.w / 2 - 0.3), base + clear + 0.5, s.l / 2 + 0.02);
    b(tail, 0.34, 0.14, 0.06, sx * (s.w / 2 - 0.3), base + clear + 0.55, -s.l / 2 - 0.02);
    for (const sz of [-1, 1]) { const w = new THREE.Mesh(WHEEL, tyre); const rad = type === 'bus' ? 1.4 : 1; w.scale.set(1, rad, rad); w.position.set(sx * (s.w / 2 - 0.1), base + 0.34 * rad, sz * s.l * 0.32); g.add(w); v.wheels.push(w); }
  }
  if (type === 'cab') {
    v.sign = new THREE.MeshStandardMaterial({ map: labelTexture('TAXI', '#1a1200', '#ffb400', 128, 48), emissive: 0xffb400, emissiveIntensity: 1.2 });
    b(v.sign, 0.55, 0.16, 0.14, 0, s.h / 2 + 0.07, s.l * 0.2);
  }
  if (type === 'police') {
    // blue-and-yellow chequered side panels
    const t = labelTexture('', '#fff', '#fff', 64, 16); const c = (t.image as HTMLCanvasElement).getContext('2d')!;
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#1b4fd8' : '#e8f03a'; c.fillRect(i * 8, 0, 8, 16); } t.needsUpdate = true;
    const chk = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.15 });
    for (const sx of [-1, 1]) b(chk, 0.03, 0.34, s.l * 0.9, sx * (s.w / 2 + 0.005), base + clear + 0.42, 0);
    const m1 = new THREE.MeshStandardMaterial({ color: 0x0a1a60, emissive: 0x2a5cff, emissiveIntensity: 0 }), m2 = m1.clone();
    b(m1, 0.5, 0.13, 0.26, 0.3, s.h / 2 + 0.05, -0.2); b(m2, 0.5, 0.13, 0.26, -0.3, s.h / 2 + 0.05, -0.2);
    v.bar = [m1, m2];
  }
  // UK plates: white at the front, yellow at the back
  b(plateFront, 0.5, 0.11, 0.03, 0, base + clear + (type === 'bus' ? 0.5 : 0.2), s.l / 2 + 0.04);
  b(plateRear, 0.5, 0.11, 0.03, 0, base + clear + (type === 'bus' ? 0.6 : 0.32), -s.l / 2 - 0.04);
  // pool of headlight on the road ahead (cheap stand-in for real spotlights)
  beamTex ??= glowTexture();
  v.beam = new THREE.Mesh(BEAM, new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff0cc, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  v.beam.scale.set(s.w + 2.6, 1, 11); v.beam.position.set(0, base + 0.06, s.l / 2 + 4.6); g.add(v.beam);
  // smoke puff shown when the engine is failing
  v.smoke = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.55, depthWrite: false }));
  v.smoke.position.set(0, s.h / 2 - 0.2, s.l * 0.36); v.smoke.visible = false; g.add(v.smoke);
  return v;
}
