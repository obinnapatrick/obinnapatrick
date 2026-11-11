// Procedural low-poly people: tapered, jointed bodies (elbows and knees) with flat-shaded vertex colour,
// and a pose-driven animation system. No external assets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp } from '../core/util';

export interface Look {
  skin: number; top: number; bottom: number; hair: number; shoes?: number; shirt?: number;
  hat?: 'helmet' | 'cap' | 'flat' | 'beanie' | 'police'; hatColour?: number; vest?: number; pack?: number; scale?: number;
  build?: number; coat?: boolean; skirt?: boolean; sleeves?: 'long' | 'short'; hairStyle?: 'short' | 'long' | 'bald' | 'bun'; tie?: number; bag?: number; belt?: boolean; apron?: number; hood?: boolean;
}
export type Action = 'none' | 'jab' | 'cross' | 'hook' | 'kick' | 'block' | 'aim' | 'hit' | 'down' | 'crouch' | 'phone' | 'cower' | 'talk' | 'dodge' | 'baton';
export interface Anim { speed: number; action: Action; t: number; armed?: boolean; air?: boolean }

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
// a little self-illumination so people never collapse into black silhouettes in unlit streets (very PS2)
MAT.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.2;'); };
const BLOB = new THREE.CircleGeometry(0.46, 10).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.4, metalness: 0.7 });
const GUN = new THREE.BoxGeometry(1, 1, 1);
const col = new THREE.Color();

/** Tint a primitive, position it, and hand it back ready to merge. */
function part(geo: THREE.BufferGeometry, colour: number, x = 0, y = 0, z = 0, rx = 0, shade = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  col.setHex(colour).multiplyScalar(shade);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
/** A box whose top face is scaled: gives tapered limbs, V-shaped torsos, flared coats. */
function tbox(w: number, h: number, d: number, topW = 1, topD = topW): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * topW); p.setZ(i, p.getZ(i) * topD); }
  return g;
}
const ball = (r: number, sx = 1, sy = 1, sz = 1) => new THREE.IcosahedronGeometry(r, 1).scale(sx, sy, sz);
const dome = (r: number, sy = 1, arc = 0.5) => new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI * arc).scale(1, sy, 1);
function mesh(parts: THREE.BufferGeometry[], parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(mergeGeometries(parts), MAT); m.castShadow = true; parent.add(m);
  for (const p of parts) p.dispose();
  return m;
}
function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

export class CharacterModel {
  root = new THREE.Group(); // feet at origin, facing +Z
  private body = new THREE.Group();
  private hip: THREE.Group; private spine: THREE.Group; private head: THREE.Group;
  private shL: THREE.Group; private shR: THREE.Group; private elL: THREE.Group; private elR: THREE.Group;
  private hpL: THREE.Group; private hpR: THREE.Group; private knL: THREE.Group; private knR: THREE.Group;
  private gun: THREE.Mesh;
  private meshes: THREE.Mesh[] = [];
  private phase = Math.random() * 6; private clock = Math.random() * 10;
  private p = { hipY: 0, lean: 0, twist: 0, nod: 0, lie: 0, sLx: 0, sLz: 0.08, sRx: 0, sRz: -0.08, eL: -0.1, eR: -0.1, hL: 0, hR: 0, kL: 0, kR: 0 };

  constructor(look: Look) {
    const s = look.scale ?? 1, bw = look.build ?? 1, sk = look.skin, top = look.top, bot = look.bottom, shoe = look.shoes ?? 0x141416;
    this.root.add(this.body); this.body.scale.setScalar(s);
    const blob = new THREE.Mesh(BLOB, blobMat); blob.position.y = 0.02; this.root.add(blob);
    const add = (parts: THREE.BufferGeometry[], parent: THREE.Object3D) => { const m = mesh(parts, parent); this.meshes.push(m); return m; };

    // --- pelvis and legs
    this.hip = pivot(this.body, 0, 0.97);
    const legCol = look.skirt ? sk : bot;
    const pel = [part(tbox(0.33 * bw, 0.2, 0.2, 1.04), bot, 0, -0.02, 0)];
    if (look.skirt) pel.push(part(tbox(0.46 * bw, 0.4, 0.34, 0.72, 0.62), bot, 0, -0.26, 0));
    if (look.coat) pel.push(part(tbox(0.42 * bw, 0.36, 0.27, 0.88, 0.86), top, 0, -0.14, 0, 0, 0.92));
    add(pel, this.hip);
    const leg = (side: number): [THREE.Group, THREE.Group] => {
      const hp = pivot(this.hip, side * 0.095 * bw, -0.07);
      add([part(tbox(0.125 * bw, 0.44, 0.135, 1.22, 1.15), legCol, 0, -0.21, 0)], hp);
      const kn = pivot(hp, 0, -0.43);
      add([part(tbox(0.095 * bw, 0.42, 0.105, 1.24, 1.2), legCol, 0, -0.2, -0.005, 0, 0.94), part(tbox(0.115, 0.085, 0.27, 0.92, 0.8), shoe, 0, -0.44, 0.055)], kn);
      return [hp, kn];
    };
    [this.hpL, this.knL] = leg(1); [this.hpR, this.knR] = leg(-1);

    // --- torso
    this.spine = pivot(this.hip, 0, 0.07);
    const sw = 0.2 * bw; // half shoulder width
    const tor = [part(tbox(0.29 * bw, 0.24, 0.185, 1.12, 1.06), top, 0, 0.11, 0, 0, 0.94), part(tbox(0.33 * bw, 0.32, 0.2, 1.22, 1.04), top, 0, 0.39, 0), part(new THREE.CylinderGeometry(0.048, 0.056, 0.09, 6), sk, 0, 0.59, 0)];
    if (look.shirt !== undefined) tor.push(part(tbox(0.11, 0.4, 0.02, 1.5), look.shirt, 0, 0.34, 0.1));
    if (look.tie !== undefined) tor.push(part(tbox(0.035, 0.3, 0.012), look.tie, 0, 0.36, 0.113));
    if (look.vest !== undefined) tor.push(part(tbox(0.36 * bw, 0.36, 0.235, 1.2, 1.04), look.vest, 0, 0.37, 0), part(new THREE.BoxGeometry(0.44 * bw, 0.045, 0.245), 0xc8ccd2, 0, 0.29, 0), part(new THREE.BoxGeometry(0.44 * bw, 0.045, 0.245), 0xc8ccd2, 0, 0.44, 0));
    if (look.apron !== undefined) tor.push(part(new THREE.BoxGeometry(0.3 * bw, 0.5, 0.02), look.apron, 0, 0.2, 0.11));
    if (look.belt) tor.push(part(new THREE.BoxGeometry(0.34 * bw, 0.055, 0.215), 0x0a0a0c, 0, 0.0, 0), part(new THREE.BoxGeometry(0.07, 0.1, 0.05), 0x0a0a0c, 0.13 * bw, 0.5, 0.1));
    if (look.pack !== undefined) tor.push(part(tbox(0.3, 0.4, 0.17, 0.85), look.pack, 0, 0.36, -0.19));
    if (look.bag !== undefined) tor.push(part(new THREE.BoxGeometry(0.1, 0.24, 0.3), look.bag, -0.24 * bw, -0.02, 0), part(new THREE.BoxGeometry(0.03, 0.62, 0.03), look.bag, -0.08 * bw, 0.33, 0.1, 0, 0.8));
    if (look.hood) tor.push(part(ball(0.11, 1.1, 0.8, 0.9), top, 0, 0.56, -0.1, 0, 0.9));
    add(tor, this.spine);

    // --- head
    this.head = pivot(this.spine, 0, 0.63);
    const hd = [part(ball(0.112, 0.92, 1.1, 1.0), sk, 0, 0.115, 0), part(tbox(0.14, 0.09, 0.15, 1.25, 1.15), sk, 0, 0.035, 0.012, 0, 0.96),
      part(new THREE.BoxGeometry(0.03, 0.045, 0.04), sk, 0, 0.1, 0.115, 0, 0.9), part(new THREE.BoxGeometry(0.03, 0.016, 0.01), 0x101010, 0.042, 0.14, 0.1), part(new THREE.BoxGeometry(0.03, 0.016, 0.01), 0x101010, -0.042, 0.14, 0.1)];
    const hs = look.hat ? 'short' : look.hairStyle ?? 'short', hc = look.hatColour ?? 0x14161c;
    if (hs !== 'bald') hd.push(part(dome(0.121, 1.1, 0.56), look.hair, 0, 0.125, -0.012));
    if (hs === 'long') hd.push(part(tbox(0.215, 0.26, 0.09, 1.02, 1.3), look.hair, 0, 0.05, -0.085));
    if (hs === 'bun') hd.push(part(ball(0.055), look.hair, 0, 0.23, -0.07));
    if (look.hat === 'helmet') hd.push(part(dome(0.128, 1.75), hc, 0, 0.15, 0), part(new THREE.CylinderGeometry(0.15, 0.155, 0.022, 10), hc, 0, 0.155, 0.01), part(new THREE.BoxGeometry(0.05, 0.06, 0.012), 0xc9ccd0, 0, 0.24, 0.118));
    else if (look.hat === 'police') hd.push(part(new THREE.CylinderGeometry(0.135, 0.122, 0.065, 10), hc, 0, 0.215, 0), part(new THREE.CylinderGeometry(0.124, 0.124, 0.03, 10), 0xe8e8e8, 0, 0.175, 0), part(new THREE.BoxGeometry(0.2, 0.014, 0.1), 0x050506, 0, 0.165, 0.13));
    else if (look.hat === 'cap') hd.push(part(dome(0.124, 0.85), hc, 0, 0.15, 0), part(new THREE.BoxGeometry(0.17, 0.014, 0.11), hc, 0, 0.165, 0.14));
    else if (look.hat === 'flat') hd.push(part(dome(0.135, 0.5), hc, 0, 0.175, 0.01), part(new THREE.BoxGeometry(0.19, 0.016, 0.09), hc, 0, 0.18, 0.13));
    else if (look.hat === 'beanie') hd.push(part(dome(0.125, 1.05), hc, 0, 0.14, -0.005), part(new THREE.CylinderGeometry(0.127, 0.127, 0.04, 8), hc, 0, 0.15, -0.005, 0, 0.8));
    add(hd, this.head);

    // --- arms
    const sleeve = look.sleeves === 'short' ? sk : top;
    const arm = (side: number): [THREE.Group, THREE.Group] => {
      const sh = pivot(this.spine, side * (sw + 0.062), 0.5);
      add([part(ball(0.068), look.vest ?? top, 0, 0, 0), part(tbox(0.078, 0.28, 0.086, 1.2), top, 0, -0.15, 0)], sh);
      const el = pivot(sh, 0, -0.29);
      add([part(tbox(0.066, 0.25, 0.072, 1.18), sleeve, 0, -0.125, 0, 0, 0.95), part(tbox(0.062, 0.095, 0.05, 1.1), sk, 0, -0.29, 0.005)], el);
      return [sh, el];
    };
    [this.shL, this.elL] = arm(1); [this.shR, this.elR] = arm(-1);
    this.gun = new THREE.Mesh(GUN, gunMat); this.gun.scale.set(0.04, 0.11, 0.24); this.gun.position.set(0, -0.36, 0.09); this.gun.visible = false; this.elR.add(this.gun);
  }

  setGun(visible: boolean, long = false): void { this.gun.visible = visible; this.gun.scale.z = long ? 0.46 : 0.24; this.gun.position.z = long ? 0.16 : 0.09; }
  dispose(): void { for (const m of this.meshes) m.geometry.dispose(); }

  update(dt: number, a: Anim): void {
    const p = this.p;
    this.clock += dt;
    const amt = clamp(a.speed / 1.4, 0, 1), run = clamp((a.speed - 2.6) / 3.4, 0, 1);
    if (a.speed > 0.15) this.phase += dt * (3.2 + a.speed * 1.7);
    const ph = this.phase, sn = Math.sin(ph), cs = Math.cos(ph), A = lerp(0.5, 0.98, run) * amt;
    // locomotion (also the base for most actions)
    let hL = -sn * A, hR = sn * A;
    let kL = (0.12 + Math.max(0, cs) * lerp(0.95, 1.6, run)) * amt, kR = (0.12 + Math.max(0, -cs) * lerp(0.95, 1.6, run)) * amt;
    let sLx = sn * A * 0.85, sRx = -sn * A * 0.85, sLz = 0.07, sRz = -0.07;
    let eL = -0.12 - (0.18 + run * 1.15) * amt - Math.max(0, sn) * 0.25 * amt, eR = -0.12 - (0.18 + run * 1.15) * amt - Math.max(0, -sn) * 0.25 * amt;
    let lean = 0.03 * amt + run * 0.2, twist = sn * 0.13 * amt, nod = -run * 0.1, lie = 0;
    let hipY = -Math.abs(cs) * 0.035 * amt + Math.sin(this.clock * 1.6) * 0.004;
    if (amt < 0.1) { sLx += Math.sin(this.clock * 0.9) * 0.03; sRx -= Math.sin(this.clock * 0.9) * 0.03; lean += Math.sin(this.clock * 1.6) * 0.012; } // breathing
    const k = Math.sin(Math.min(1, a.t) * Math.PI); // 0 -> 1 -> 0 over the action
    const stance = () => { hL = -0.3; hR = 0.22; kL = 0.32; kR = 0.3; hipY = -0.04; };
    const crouch = (c: number) => { hL = lerp(hL, -1.3, c) + sn * 0.2 * amt; hR = lerp(hR, -1.15, c) - sn * 0.2 * amt; kL = lerp(kL, 2.15, c); kR = lerp(kR, 2.0, c); hipY = -0.4 * c; lean = 0.32 * c; };
    if (a.air) { hL = -0.9; hR = 0.25; kL = 1.3; kR = 0.5; sLx = -0.9; sRx = 0.5; sLz = 0.5; sRz = -0.5; eL = -0.8; eR = -0.6; }
    switch (a.action) {
      case 'jab': stance(); sLx = -1.5; eL = lerp(-2.1, -0.06, k); sRx = -1.0; eR = -2.1; sRz = 0.15; twist = -0.35 * k; lean = 0.12; break;
      case 'cross': stance(); sRx = -1.55; eR = lerp(-2.1, -0.04, k); sLx = -1.0; eL = -2.1; sLz = -0.15; twist = 0.5 * k; lean = 0.16; break;
      case 'hook': stance(); sRx = -1.35; sRz = -1.0 * k; eR = -1.5; sLx = -1.0; eL = -2.1; twist = 0.85 * k; lean = 0.18; break;
      case 'baton': stance(); sRx = -2.8 + 1.9 * k; eR = -0.6; sLx = -0.5; eL = -1.0; twist = 0.35 * k; break;
      case 'kick': hR = -1.55 * k; kR = 0.9 * (1 - k); hL = 0.12; kL = 0.2; lean = -0.28 * k; sLx = -0.9; eL = -1.9; sRx = 0.3; eR = -1.2; break;
      case 'block': stance(); sLx = -1.2; sRx = -1.2; eL = -2.3; eR = -2.3; sLz = -0.22; sRz = 0.22; lean = 0.14; nod = 0.2; break;
      case 'aim': sRx = -1.5; eR = -0.06; sRz = 0.12; if (a.armed) { sLx = -1.38; sLz = -0.42; eL = -0.3; } twist = a.armed ? -0.25 : 0; lean += 0.04; break;
      case 'hit': lean = -0.42 * k; twist = 0.35 * k; sLx = 0.5 * k; sRx = 0.3 * k; sLz = 0.6 * k; sRz = -0.6 * k; nod = -0.3 * k; kL = 0.4 * k; kR = 0.3 * k; break;
      case 'down': lie = 1; sLx = -0.3; sRx = 0.4; sLz = 1.1; sRz = -1.0; eL = -0.5; eR = -0.3; hL = 0.1; hR = -0.3; kL = 0.2; kR = 0.7; lean = 0; twist = 0; hipY = 0; break;
      case 'crouch': crouch(1); break;
      case 'dodge': crouch(0.75); lean = 0.55; sLx = -0.8; sRx = -0.8; eL = -1.6; eR = -1.6; break;
      case 'cower': crouch(1); sLx = -2.7; sRx = -2.7; eL = -1.7; eR = -1.7; sLz = -0.35; sRz = 0.35; lean = 0.5; nod = 0.5; break;
      case 'phone': sRx = -0.75; sRz = -0.25; eR = -2.35; nod = 0.08; break;
      case 'talk': sLx = -0.35; eL = -1.25 + Math.sin(this.clock * 4.2) * 0.3; sRx = -0.15; eR = -0.6 + Math.sin(this.clock * 2.9) * 0.15; nod = Math.sin(this.clock * 2.2) * 0.06; break;
    }
    const L = 16, d = (cur: number, to: number, l = L) => damp(cur, to, l, dt);
    p.sLx = d(p.sLx, sLx); p.sRx = d(p.sRx, sRx); p.sLz = d(p.sLz, sLz); p.sRz = d(p.sRz, sRz); p.eL = d(p.eL, eL, 22); p.eR = d(p.eR, eR, 22);
    p.hL = d(p.hL, hL, 20); p.hR = d(p.hR, hR, 20); p.kL = d(p.kL, kL, 20); p.kR = d(p.kR, kR, 20);
    p.lean = d(p.lean, lean, 10); p.twist = d(p.twist, twist); p.nod = d(p.nod, nod, 10); p.lie = d(p.lie, lie, 9); p.hipY = d(p.hipY, hipY, 14);
    this.shL.rotation.set(p.sLx, 0, p.sLz); this.shR.rotation.set(p.sRx, 0, p.sRz);
    this.elL.rotation.x = p.eL; this.elR.rotation.x = p.eR;
    this.hpL.rotation.x = p.hL; this.hpR.rotation.x = p.hR; this.knL.rotation.x = p.kL; this.knR.rotation.x = p.kR;
    this.spine.rotation.set(p.lean, p.twist, 0); this.head.rotation.set(p.nod - p.lean * 0.5, -p.twist * 0.6, 0);
    this.hip.position.y = 0.97 + p.hipY; this.hip.rotation.y = -p.twist * 0.35;
    this.body.rotation.x = -p.lie * Math.PI / 2;
    this.body.position.y = p.lie * 0.2; this.body.position.z = -p.lie * 0.5;
  }
}

// ---- wardrobe
const SKIN = [0xe8bf9c, 0xd6a27e, 0xbd8259, 0x94643f, 0x6c4429, 0x51301c];
const HAIR = [0x16110d, 0x33241a, 0x5e4126, 0x9a6f37, 0x7d7d7d, 0x0c0c0c, 0x521c1c, 0xc9b27a];
const rc = <T>(arr: T[], r: () => number): T => arr[Math.floor(r() * arr.length) % arr.length];
export function lookFor(role: string, r: () => number = Math.random): Look {
  const base: Look = { skin: rc(SKIN, r), hair: rc(HAIR, r), top: 0x444444, bottom: 0x1e222a, scale: 0.94 + r() * 0.1, build: 0.9 + r() * 0.22, hairStyle: rc(['short', 'short', 'long', 'bald', 'bun'] as const, r) };
  const uniform = { ...base, top: 0x0e1016, bottom: 0x0c0d12, shoes: 0x050506, hairStyle: 'short' as const, belt: true, build: 1.05 };
  switch (role) {
    case 'police': return { ...uniform, vest: 0xcfe02e, hat: 'helmet', hatColour: 0x0a0c12, sleeves: 'long' };
    case 'armed': return { ...uniform, vest: 0x161b26, hat: 'police', hatColour: 0x0a0c12, build: 1.12 };
    case 'office': return { ...base, top: rc([0x242a38, 0x33363e, 0x1a2434, 0x4c4852, 0x6e737c], r), bottom: rc([0x191c22, 0x24272e, 0x121418], r), shirt: rc([0xd8dce4, 0xbfd0e8, 0xe8e0d0], r), tie: r() < 0.6 ? rc([0x7a1420, 0x1c2f5a, 0x2a2a2a], r) : undefined, coat: r() < 0.5, skirt: r() < 0.2, bag: r() < 0.5 ? 0x1a1410 : undefined, shoes: 0x0a0a0c };
    case 'tourist': return { ...base, top: rc([0xc83c2e, 0x2590c2, 0xd8aa22, 0x30aa68, 0xd866a0, 0xe8e4d8], r), bottom: rc([0x33507c, 0x7a6c50, 0x242424, 0x8a8a80], r), pack: rc([0x242424, 0x8e2a2a, 0x2a4678], r), hat: r() < 0.35 ? 'cap' : undefined, hatColour: rc([0xd0d0d0, 0xb02020, 0x203a80], r), sleeves: r() < 0.3 ? 'short' : 'long', shoes: 0xd8d8d0 };
    case 'nightlife': return { ...base, top: rc([0xa4184e, 0x0c0c0e, 0xc8c8c8, 0x5c24c0, 0x0e8c84, 0xb48e1e, 0x8a1010], r), bottom: rc([0x0c0c10, 0x24162e, 0x161f38, 0x101010], r), skirt: r() < 0.35, sleeves: r() < 0.4 ? 'short' : 'long', coat: r() < 0.2, shirt: r() < 0.3 ? 0xe0e0e0 : undefined, bag: r() < 0.25 ? 0x101010 : undefined };
    case 'shopkeeper': return { ...base, top: 0x8a8c7a, bottom: 0x25252a, apron: 0x1e4a30, sleeves: 'short', hairStyle: 'bun' };
    case 'publican': return { ...base, top: 0xc8c2b4, bottom: 0x17171a, apron: 0x241610, build: 1.18, hairStyle: 'bald' };
    case 'mechanic': return { ...base, top: 0x1f3c5c, bottom: 0x1f3c5c, hat: 'beanie', hatColour: 0x161616, build: 1.1, shoes: 0x1a1410 };
    case 'cabbie': return { ...base, top: 0x40392c, bottom: 0x25252a, hat: 'flat', hatColour: 0x33332e, shirt: 0xb8b0a0, build: 1.15 };
    case 'marlowe': return { ...base, top: rc([0x4e1020, 0x320a14, 0x16161a], r), bottom: 0x121216, coat: true, shirt: rc([0xd8d0c0, 0x101010], r), hat: r() < 0.35 ? 'flat' : undefined, hatColour: 0x16161a, hairStyle: rc(['short', 'bald'] as const, r), build: 1.1 + r() * 0.1, shoes: 0x0a0806 };
    case 'kestrel': return { ...base, top: rc([0x0c5e5a, 0x0f746e, 0x094040], r), bottom: rc([0x16191d, 0x0c0c0e], r), hood: true, hat: r() < 0.45 ? 'beanie' : r() < 0.3 ? 'cap' : undefined, hatColour: 0x0a2424, hairStyle: 'short', shoes: 0xd0d0d0, build: 1.0 + r() * 0.12 };
    case 'heavy': return { ...base, top: 0x23272f, bottom: 0x15171a, scale: 1.08, build: 1.28, hat: 'beanie', hatColour: 0x121416, hairStyle: 'bald', coat: true };
    case 'player': return { skin: 0xbd8259, hair: 0x16110d, top: 0x7a5522, bottom: 0x263248, shirt: 0xc9c2b0, coat: true, scale: 1, build: 1.04, hairStyle: 'short', shoes: 0x241a12 };
    default: return { ...base, top: rc([0x42424a, 0x5e5042, 0x2a4250, 0x502a2a, 0x334234, 0x6e685c, 0x212b34, 0x8a2a3a, 0x2a2a5a], r), bottom: rc([0x1e222a, 0x33333a, 0x252b3a, 0x423a2e], r), hat: r() < 0.15 ? 'beanie' : undefined, hatColour: rc([0x7c2424, 0x242424, 0x24427c], r), coat: r() < 0.4, hood: r() < 0.2, skirt: r() < 0.15, bag: r() < 0.3 ? rc([0x1a1410, 0x3a2a1a, 0x101014], r) : undefined };
  }
}
