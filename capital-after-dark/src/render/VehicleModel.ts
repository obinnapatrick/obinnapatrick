// Procedural vehicle bodies built from extruded side-profiles (so each type has its own silhouette),
// with tumblehome, glazing, arches, bumpers, lamps, plates and livery. All models face +Z, origin at the
// centre of the collision box.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEHICLES, VehicleType } from '../vehicles/specs';
import { glowTexture, labelTexture, spillTexture } from './textures';

type P = [number, number][]; // side profile: [z along the car, y above the road]
const tyre = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9 });
const glass = new THREE.MeshStandardMaterial({ color: 0x070b10, roughness: 0.06, metalness: 0.9, envMapIntensity: 2.6, flatShading: true });
const trim = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.7, flatShading: true });
const chrome = new THREE.MeshStandardMaterial({ color: 0xa8aeb4, roughness: 0.2, metalness: 0.95, envMapIntensity: 2 });
const plateRear = new THREE.MeshStandardMaterial({ color: 0xf2c200, emissive: 0xf2c200, emissiveIntensity: 0.4 });
const plateFront = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, emissive: 0xffffff, emissiveIntensity: 0.3 });
const amber = new THREE.MeshStandardMaterial({ color: 0xff8a00, emissive: 0xff7000, emissiveIntensity: 0.5 });
let hubMat: THREE.MeshStandardMaterial | null = null, glow: THREE.Texture | null = null, spill: THREE.Texture | null = null;
const WHEEL = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).rotateZ(Math.PI / 2);
const BEAM_POOL = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const BEAM_CONE = new THREE.ConeGeometry(1.25, 8, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 4);
const texCache = new Map<string, THREE.Texture>();
const label = (t: string, fg: string, bg: string, w = 256, h = 64) => { const k = t + fg + bg + w; if (!texCache.has(k)) texCache.set(k, labelTexture(t, fg, bg, w, h)); return texCache.get(k)!; };

export interface VehicleVisual {
  group: THREE.Group; paint: THREE.MeshStandardMaterial; wheels: THREE.Mesh[]; tail: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial;
  bar?: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]; sign?: THREE.MeshStandardMaterial; smoke: THREE.Mesh; beam: THREE.Object3D;
  tailGlow: THREE.SpriteMaterial; barGlow?: THREE.SpriteMaterial;
}

function extrude(profile: P, width: number, h: number, belt = 99, top = 100, narrow = 1): THREE.BufferGeometry {
  const s = new THREE.Shape(); profile.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(width / 2, -h / 2, 0);
  const p = g.attributes.position; // tumblehome: the cabin leans in above the belt line
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + h / 2; if (y > belt) p.setX(i, p.getX(i) * (1 - (1 - narrow) * Math.min(1, (y - belt) / (top - belt)))); }
  g.computeVertexNormals();
  return g;
}
const box = (w: number, hh: number, l: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, hh, l).translate(x, y, z);
const cyl = (r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'z' = 'z') => { const g = new THREE.CylinderGeometry(r, r, len, 10); if (axis === 'z') g.rotateX(Math.PI / 2); else g.rotateZ(Math.PI / 2); return g.translate(x, y, z); };
function merged(parts: THREE.BufferGeometry[], mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh | null {
  if (!parts.length) return null;
  const m = new THREE.Mesh(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!, mat); m.castShadow = true; parent.add(m); return m;
}

interface Shape { body: P; glass: P[]; belt: number; roof: number; narrow: number; wheelZ: [number, number]; wheelR?: number; nose: number; tailY: number }
const SHAPES: Record<VehicleType, Shape> = {
  saloon: { body: [[-2.25, 0.26], [-2.25, 0.74], [-2.08, 0.84], [-1.42, 0.86], [-0.92, 1.42], [0.34, 1.45], [1.02, 0.9], [2.02, 0.8], [2.25, 0.62], [2.25, 0.26]], glass: [[[-1.46, 0.9], [-0.95, 1.37], [0.36, 1.4], [1.06, 0.93]]], belt: 0.88, roof: 1.45, narrow: 0.84, wheelZ: [-1.38, 1.42], nose: 0.66, tailY: 0.72 },
  police: { body: [[-2.3, 0.27], [-2.3, 0.78], [-2.12, 0.88], [-1.3, 0.9], [-0.9, 1.47], [0.4, 1.5], [1.08, 0.94], [2.08, 0.84], [2.3, 0.64], [2.3, 0.27]], glass: [[[-1.34, 0.94], [-0.93, 1.42], [0.42, 1.45], [1.12, 0.97]]], belt: 0.92, roof: 1.5, narrow: 0.84, wheelZ: [-1.42, 1.46], nose: 0.68, tailY: 0.76 },
  cab: { body: [[-2.3, 0.3], [-2.3, 1.02], [-2.2, 1.12], [-2.04, 1.78], [-1.9, 1.84], [0.42, 1.85], [0.62, 1.74], [0.98, 1.1], [1.3, 1.02], [2.12, 0.98], [2.3, 0.8], [2.3, 0.3]], glass: [[[-2.07, 1.14], [-1.96, 1.74], [-0.72, 1.78], [-0.72, 1.14]], [[-0.6, 1.14], [-0.6, 1.78], [0.44, 1.78], [0.66, 1.7], [1.01, 1.14]]], belt: 1.1, roof: 1.85, narrow: 0.86, wheelZ: [-1.45, 1.5], nose: 0.82, tailY: 0.86 },
  sports: { body: [[-2.2, 0.2], [-2.2, 0.72], [-2.05, 0.86], [-1.2, 0.9], [-0.55, 1.2], [0.3, 1.21], [1.08, 0.8], [1.9, 0.64], [2.2, 0.46], [2.2, 0.2]], glass: [[[-1.24, 0.93], [-0.58, 1.16], [0.32, 1.17], [1.12, 0.83]]], belt: 0.82, roof: 1.21, narrow: 0.78, wheelZ: [-1.36, 1.38], nose: 0.5, tailY: 0.74 },
  van: { body: [[-2.7, 0.32], [-2.7, 2.2], [-2.6, 2.3], [1.15, 2.3], [1.3, 2.22], [1.78, 1.42], [2.52, 1.22], [2.7, 0.98], [2.7, 0.32]], glass: [[[0.72, 1.46], [0.72, 2.12], [1.2, 2.16], [1.34, 2.16], [1.82, 1.45]]], belt: 1.4, roof: 2.3, narrow: 0.93, wheelZ: [-1.65, 1.75], wheelR: 1.08, nose: 0.9, tailY: 1.0 },
  bus: { body: [[-5.3, 0.36], [-5.3, 4.22], [-5.12, 4.4], [4.9, 4.4], [5.24, 4.1], [5.3, 2.3], [5.3, 0.36]], glass: [], belt: 3.9, roof: 4.4, narrow: 0.95, wheelZ: [-3.1, 3.5], wheelR: 1.45, nose: 0.9, tailY: 1.3 },
};

export function buildVehicle(type: VehicleType, colour: number): VehicleVisual {
  const s = VEHICLES[type], S = SHAPES[type], g = new THREE.Group(), h = s.h, hw = s.w / 2, hl = s.l / 2, Y = (y: number) => y - h / 2;
  glow ??= glowTexture(); spill ??= spillTexture();
  if (!hubMat) { const t = label('hub', '#000', '#000', 64, 64), c = (t.image as HTMLCanvasElement).getContext('2d')!; c.fillStyle = '#0a0a0b'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#8f959b'; c.beginPath(); c.arc(32, 32, 19, 0, 7); c.fill(); c.fillStyle = '#2a2c30'; for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(32 + Math.cos(i * 1.257) * 11, 32 + Math.sin(i * 1.257) * 11, 3.4, 0, 7); c.fill(); } c.beginPath(); c.arc(32, 32, 4, 0, 7); c.fill(); t.needsUpdate = true; hubMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.5 }); }
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.3, metalness: 0.4, envMapIntensity: 2.2, flatShading: true });
  const tail = new THREE.MeshStandardMaterial({ color: 0x3a0606, emissive: 0xff1410, emissiveIntensity: 0.9 });
  const head = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff0c8, emissiveIntensity: 1.8 });
  const pt: THREE.BufferGeometry[] = [], gl: THREE.BufferGeometry[] = [], tr: THREE.BufferGeometry[] = [], ch: THREE.BufferGeometry[] = [], hd: THREE.BufferGeometry[] = [], tl: THREE.BufferGeometry[] = [], am: THREE.BufferGeometry[] = [];
  const extra = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
  const both = (f: (sx: number) => void) => { f(1); f(-1); };

  pt.push(extrude(S.body, s.w, h, S.belt, S.roof, S.narrow));
  for (const gp of S.glass) gl.push(extrude(gp, s.w + 0.03, h, S.belt, S.roof, S.narrow));
  const rad = 0.34 * (S.wheelR ?? 1);
  const v: VehicleVisual = { group: g, paint, wheels: [], tail, head, smoke: new THREE.Mesh(), beam: new THREE.Group(), tailGlow: new THREE.SpriteMaterial({ map: glow, color: 0xff2010, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }) };
  // wheels in dark arches (order matters to Vehicle.ts: odd indices are the front, steered wheels)
  both((sx) => {
    S.wheelZ.forEach((wz) => {
      tr.push(cyl(rad + 0.09, 0.07, sx * (hw - 0.01), Y(rad + 0.03), wz, 'x'));
      const w = new THREE.Mesh(WHEEL, [tyre, hubMat!, hubMat!]); w.scale.set(1, S.wheelR ?? 1, S.wheelR ?? 1); w.position.set(sx * (hw - 0.1), Y(rad), wz); w.rotation.order = 'YXZ'; g.add(w); v.wheels.push(w);
    });
    tr.push(box(0.05, 0.14, s.l * 0.56, sx * (hw - 0.01), Y(S.body[0][1] + 0.07), 0)); // sill
  });
  const fy = Y(S.nose), ty = Y(S.tailY);
  if (type === 'bus') {
    // black skirt and window surrounds, lit saloons on both decks, blinds, a side advert
    tr.push(box(s.w + 0.03, 0.5, s.l - 0.2, 0, Y(0.62), 0));
    const win = (() => { const t = label('win', '#000', '#000', 512, 64), c = (t.image as HTMLCanvasElement).getContext('2d')!; c.fillStyle = '#0a0a0c'; c.fillRect(0, 0, 512, 64); for (let i = 0; i < 8; i++) { c.fillStyle = '#ffe2a8'; c.fillRect(i * 64 + 4, 5, 56, 54); c.fillStyle = 'rgba(40,24,16,0.75)'; for (let k = 0; k < 2; k++) if (Math.random() < 0.6) { const x = i * 64 + 10 + k * 26; c.fillRect(x, 30, 16, 30); c.beginPath(); c.arc(x + 8, 24, 8, 0, 7); c.fill(); } } t.needsUpdate = true; return t; })();
    const lit = new THREE.MeshStandardMaterial({ map: win, emissiveMap: win, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3 });
    both((sx) => { for (const y of [1.75, 3.45]) { const m = extra(new THREE.PlaneGeometry(s.l - 1.5, 0.95), lit); m.position.set(sx * (hw + 0.012) * (y > 3 ? 0.985 : 1), Y(y), -0.2); m.rotation.y = sx * Math.PI / 2; } });
    const ad = label('FIZZ!  ICE COLD COLA', '#ffffff', '#e01228', 512, 48);
    both((sx) => { const m = extra(new THREE.PlaneGeometry(5.6, 0.55), new THREE.MeshStandardMaterial({ map: ad, emissive: 0xffffff, emissiveMap: ad, emissiveIntensity: 0.25 })); m.position.set(sx * (hw + 0.014), Y(2.6), -0.8); m.rotation.y = sx * Math.PI / 2; });
    gl.push(box(s.w - 0.3, 1.25, 0.05, 0, Y(1.75), hl + 0.005), box(s.w - 0.3, 0.95, 0.05, 0, Y(3.45), hl - 0.1), box(s.w - 0.5, 0.9, 0.05, 0, Y(3.45), -hl - 0.005), box(0.05, 1.9, 1.1, hw + 0.012, Y(1.35), 3.9), box(0.05, 1.9, 1.3, hw + 0.012, Y(1.35), 0.2));
    const blind = label('N19 SOHO', '#ffb000', '#060606', 256, 64), bm = new THREE.MeshStandardMaterial({ map: blind, emissive: 0xffffff, emissiveMap: blind, emissiveIntensity: 0.8 });
    const b1 = extra(new THREE.PlaneGeometry(1.8, 0.42), bm); b1.position.set(0, Y(2.62), hl + 0.03);
    const b2 = extra(new THREE.PlaneGeometry(0.9, 0.36), bm); b2.position.set(0, Y(2.62), -hl - 0.03); b2.rotation.y = Math.PI;
    pt.push(box(s.w * 0.96, 0.08, s.l - 0.6, 0, Y(4.43), 0));
  } else {
    // pillars, door shuts, mirrors
    const bz = type === 'cab' ? -0.66 : type === 'van' ? 0.66 : -0.28;
    both((sx) => {
      if (type !== 'cab' && type !== 'van') pt.push(box(0.04, S.roof - S.belt - 0.06, 0.1, sx * (hw * S.narrow + 0.012), Y((S.roof + S.belt) / 2), bz));
      for (const dz of type === 'van' ? [0.66, -0.7, -2.5] : [bz, bz + 1.02, bz - 0.98]) tr.push(box(0.02, S.belt - 0.42, 0.025, sx * (hw + 0.004), Y((S.belt + 0.42) / 2), dz));
      pt.push(box(0.16, 0.1, 0.12, sx * (hw + 0.07), Y(S.belt + 0.06), type === 'van' ? 1.7 : S.glass[S.glass.length - 1][S.glass[S.glass.length - 1].length - 1][0] - 0.08));
      ch.push(box(0.03, 0.03, 0.14, sx * (hw + 0.012), Y(S.belt - 0.1), bz + 0.75));
    });
  }
  // bumpers, grille, lamps, plates
  const bump = type === 'cab' ? ch : tr;
  bump.push(box(s.w + 0.04, 0.16, 0.14, 0, Y(S.body[0][1] + 0.16), hl + 0.03), box(s.w + 0.04, 0.16, 0.14, 0, Y(S.body[0][1] + 0.16), -hl - 0.03));
  if (type === 'cab') { for (let i = -3; i <= 3; i++) ch.push(box(0.035, 0.36, 0.04, i * 0.085, fy - 0.02, hl + 0.02)); tr.push(box(0.66, 0.4, 0.03, 0, fy - 0.02, hl + 0.005)); both((sx) => { hd.push(cyl(0.12, 0.06, sx * (hw - 0.3), fy + 0.02, hl + 0.01)); am.push(box(0.1, 0.07, 0.04, sx * (hw - 0.3), fy - 0.2, hl + 0.02)); }); }
  else { tr.push(box(s.w * (type === 'sports' ? 0.5 : 0.56), type === 'bus' ? 0.5 : 0.13, 0.04, 0, fy - (type === 'bus' ? 0.2 : 0.02), hl + 0.012)); both((sx) => { hd.push(box(type === 'sports' ? 0.4 : 0.34, type === 'sports' ? 0.09 : 0.15, 0.05, sx * (hw - 0.28), fy + (type === 'sports' ? 0.06 : 0), hl + 0.012)); am.push(box(0.1, 0.1, 0.05, sx * (hw - 0.07), fy, hl - 0.03)); }); }
  both((sx) => { tl.push(box(type === 'sports' ? 0.5 : 0.3, type === 'van' || type === 'bus' ? 0.4 : 0.15, 0.05, sx * (hw - 0.24), ty, -hl - 0.012)); am.push(box(0.1, 0.1, 0.05, sx * (hw - 0.06), ty, -hl + 0.02)); });
  if (type === 'sports') { tl.push(box(s.w * 0.5, 0.04, 0.05, 0, ty, -hl - 0.012)); pt.push(box(s.w * 0.86, 0.04, 0.3, 0, Y(1.0), -hl + 0.2)); both((sx) => { tr.push(box(0.05, 0.14, 0.1, sx * 0.62, Y(0.93), -hl + 0.2)); ch.push(cyl(0.05, 0.12, sx * 0.4, Y(0.3), -hl - 0.02)); }); }
  extra(box(0.5, 0.11, 0.02, 0, Y(S.body[0][1] + (type === 'bus' ? 0.5 : 0.17)), hl + 0.105), plateFront);
  extra(box(0.5, 0.11, 0.02, 0, Y(S.body[0][1] + (type === 'bus' ? 0.6 : 0.36)), -hl - (type === 'bus' ? 0.03 : 0.035)), plateRear);

  merged(pt, paint, g); merged(gl, glass, g); merged(tr, trim, g); merged(ch, chrome, g); merged(hd, head, g); merged(tl, tail, g); merged(am, amber, g);

  if (type === 'cab') {
    v.sign = new THREE.MeshStandardMaterial({ map: label('TAXI', '#1a1200', '#ffb400', 128, 48), emissive: 0xffa000, emissiveIntensity: 1.4 });
    extra(box(0.56, 0.17, 0.16, 0, Y(1.94), 0.3), v.sign);
  }
  if (type === 'van' && colour !== 0xe8e8e4) both((sx) => { const m = extra(new THREE.PlaneGeometry(2.6, 0.5), new THREE.MeshStandardMaterial({ map: label('KESTREL COURIERS', '#ffffff', '#12827c', 512, 96), roughness: 0.5 })); m.position.set(sx * (hw * 0.95 + 0.02), Y(1.75), -1.0); m.rotation.y = sx * Math.PI / 2; });
  if (type === 'police') {
    // blue-and-yellow chequers down the flanks, chevrons on the boot, a light bar
    const chk = (() => { const t = label('chk', '#fff', '#fff', 128, 32), c = (t.image as HTMLCanvasElement).getContext('2d')!; for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#1840c8' : '#e2ec2e'; c.fillRect(i * 16, j * 16, 16, 16); } t.needsUpdate = true; return t; })();
    const cm = new THREE.MeshStandardMaterial({ map: chk, roughness: 0.4, emissive: 0xffffff, emissiveMap: chk, emissiveIntensity: 0.22 });
    both((sx) => { const m = extra(new THREE.PlaneGeometry(s.l * 0.86, 0.36), cm); m.position.set(sx * (hw + 0.012), Y(0.66), 0); m.rotation.y = sx * Math.PI / 2; });
    const pl = new THREE.MeshStandardMaterial({ map: label('POLICE', '#10206a', '#f2f2f2', 256, 64), roughness: 0.4 });
    const bon = extra(new THREE.PlaneGeometry(1.1, 0.3), pl); bon.rotation.set(-Math.PI / 2 + 0.1, 0, Math.PI); bon.position.set(0, Y(0.9), 1.6);
    const chev = (() => { const t = label('chev', '#fff', '#fff', 128, 32), c = (t.image as HTMLCanvasElement).getContext('2d')!; c.fillStyle = '#e2ec2e'; c.fillRect(0, 0, 128, 32); c.fillStyle = '#d81e1e'; for (let i = -2; i < 10; i++) { c.beginPath(); c.moveTo(i * 20, 32); c.lineTo(i * 20 + 10, 32); c.lineTo(i * 20 + 26, 0); c.lineTo(i * 20 + 16, 0); c.fill(); } t.needsUpdate = true; return t; })();
    const rear = extra(new THREE.PlaneGeometry(s.w * 0.9, 0.3), new THREE.MeshStandardMaterial({ map: chev, emissive: 0xffffff, emissiveMap: chev, emissiveIntensity: 0.3 })); rear.position.set(0, Y(0.6), -hl - 0.045); rear.rotation.y = Math.PI;
    const m1 = new THREE.MeshStandardMaterial({ color: 0x0a1a60, emissive: 0x2a5cff, emissiveIntensity: 0 }), m2 = m1.clone();
    extra(box(0.5, 0.12, 0.22, 0.3, Y(1.57), -0.2), m1); extra(box(0.5, 0.12, 0.22, -0.3, Y(1.57), -0.2), m2); extra(box(0.16, 0.1, 0.2, 0, Y(1.56), -0.2), trim);
    v.bar = [m1, m2];
    v.barGlow = new THREE.SpriteMaterial({ map: glow, color: 0x3a6cff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const sp = new THREE.Sprite(v.barGlow); sp.scale.set(7, 5, 1); sp.position.set(0, Y(1.7), -0.2); g.add(sp);
  }
  // lamp glow: beams in the rain, a pool on the road, a red bloom behind
  const beamMat = new THREE.MeshBasicMaterial({ map: spill, color: 0xfff0cc, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  both((sx) => { const c = new THREE.Mesh(BEAM_CONE, beamMat); c.position.set(sx * (hw - 0.3), fy, hl); c.rotation.x = 0.06; v.beam.add(c); });
  const pool = new THREE.Mesh(BEAM_POOL, new THREE.MeshBasicMaterial({ map: glow, color: 0xfff0cc, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  pool.scale.set(s.w + 3, 1, 12); pool.position.set(0, -h / 2 + 0.06, hl + 5); v.beam.add(pool); g.add(v.beam);
  const tg = new THREE.Sprite(v.tailGlow); tg.scale.set(s.w * 1.5, 0.7, 1); tg.position.set(0, ty, -hl - 0.12); g.add(tg);
  // smoke puff shown when the engine is failing
  v.smoke = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.55, depthWrite: false }));
  v.smoke.position.set(0, h / 2 - 0.2, s.l * 0.36); v.smoke.visible = false; g.add(v.smoke);
  return v;
}
