// Procedural low-poly people with a small pose-driven animation system (no external assets).
import * as THREE from 'three';
import { damp } from '../core/util';

export interface Look { skin: number; top: number; bottom: number; hair: number; hat?: 'helmet' | 'cap' | 'flat' | 'beanie'; hatColour?: number; vest?: number; pack?: number; scale?: number }
export type Action = 'none' | 'jab' | 'cross' | 'hook' | 'kick' | 'block' | 'aim' | 'hit' | 'down' | 'crouch' | 'phone' | 'cower' | 'talk' | 'dodge' | 'baton';
export interface Anim { speed: number; action: Action; t: number; armed?: boolean; air?: boolean }

const BOX = new THREE.BoxGeometry(1, 1, 1);
const DOME = new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const BLOB = new THREE.CircleGeometry(0.42, 10).rotateX(-Math.PI / 2);
const mats = new Map<number, THREE.MeshStandardMaterial>();
const mat = (c: number) => { if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })); return mats.get(c)!; };
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.7 });

function part(parent: THREE.Object3D, colour: number, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(BOX, mat(colour)); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
function limb(parent: THREE.Object3D, colour: number, w: number, len: number, x: number, y: number, endColour?: number): THREE.Group {
  const g = new THREE.Group(); g.position.set(x, y, 0); parent.add(g);
  part(g, colour, w, len, w, 0, -len / 2, 0);
  if (endColour !== undefined) part(g, endColour, w * 0.95, w * 0.9, w * 1.05, 0, -len - w * 0.2, 0.02);
  return g;
}

export class CharacterModel {
  root = new THREE.Group(); // feet at origin, facing +Z
  private body = new THREE.Group();
  private torso: THREE.Group; private head: THREE.Mesh;
  private armL: THREE.Group; private armR: THREE.Group; private legL: THREE.Group; private legR: THREE.Group;
  private gun: THREE.Mesh;
  private phase = Math.random() * 6;
  private pose = { al: 0, ar: 0, alz: 0, arz: 0, ll: 0, lr: 0, lean: 0, lie: 0, crouch: 0, twist: 0 };

  constructor(look: Look) {
    const s = look.scale ?? 1;
    this.root.add(this.body); this.body.scale.setScalar(s);
    const blob = new THREE.Mesh(BLOB, blobMat); blob.position.y = 0.02; this.root.add(blob);
    this.torso = new THREE.Group(); this.torso.position.y = 0.88; this.body.add(this.torso);
    part(this.torso, look.top, 0.44, 0.6, 0.25, 0, 0.3, 0);
    if (look.vest !== undefined) { const v = part(this.torso, look.vest, 0.47, 0.42, 0.28, 0, 0.34, 0); (v.material as THREE.MeshStandardMaterial).emissive.setHex(look.vest).multiplyScalar(0.25); }
    if (look.pack !== undefined) part(this.torso, look.pack, 0.32, 0.4, 0.16, 0, 0.32, -0.2);
    this.head = part(this.torso, look.skin, 0.22, 0.25, 0.23, 0, 0.75, 0);
    part(this.torso, look.hair, 0.235, 0.09, 0.245, 0, 0.86, -0.005);
    if (look.hat) {
      const hc = look.hatColour ?? 0x14161c;
      if (look.hat === 'helmet') { const d = new THREE.Mesh(DOME, mat(hc)); d.scale.set(0.27, 0.3, 0.29); d.position.set(0, 0.86, 0); this.torso.add(d); part(this.torso, 0xc9ccd0, 0.06, 0.06, 0.02, 0, 0.93, 0.14); }
      else if (look.hat === 'beanie') { const d = new THREE.Mesh(DOME, mat(hc)); d.scale.set(0.26, 0.2, 0.27); d.position.set(0, 0.84, 0); this.torso.add(d); }
      else { part(this.torso, hc, 0.25, 0.07, 0.26, 0, 0.9, 0); part(this.torso, hc, 0.22, 0.025, 0.12, 0, 0.875, 0.17); }
    }
    this.armL = limb(this.torso, look.top, 0.12, 0.56, 0.28, 0.56, look.skin);
    this.armR = limb(this.torso, look.top, 0.12, 0.56, -0.28, 0.56, look.skin);
    this.legL = limb(this.body, look.bottom, 0.15, 0.8, 0.11, 0.88, 0x18181a);
    this.legR = limb(this.body, look.bottom, 0.15, 0.8, -0.11, 0.88, 0x18181a);
    this.gun = new THREE.Mesh(BOX, gunMat); this.gun.scale.set(0.05, 0.12, 0.26); this.gun.position.set(0, -0.66, 0.1); this.gun.visible = false; this.armR.add(this.gun);
  }

  setGun(visible: boolean, long = false): void { this.gun.visible = visible; this.gun.scale.z = long ? 0.5 : 0.26; }

  update(dt: number, a: Anim): void {
    const p = this.pose;
    const moving = Math.min(a.speed / 2.2, 2.2);
    this.phase += dt * (4 + a.speed * 1.7) * (a.speed > 0.15 ? 1 : 0);
    const sw = Math.sin(this.phase) * 0.55 * Math.min(1, moving);
    let al = -sw, ar = sw, ll = sw, lr = -sw, alz = 0.06, arz = -0.06, lean = Math.min(0.22, a.speed * 0.022), lie = 0, crouch = 0, twist = 0;
    if (a.air) { al = -2.2; ar = -2.2; ll = 0.5; lr = -0.3; }
    const k = Math.sin(Math.min(1, a.t) * Math.PI); // 0 -> 1 -> 0 over the action
    switch (a.action) {
      case 'jab': al = -1.6 * k - 0.6; ar = -0.9; twist = -0.35 * k; break;
      case 'cross': ar = -1.7 * k - 0.6; al = -0.9; twist = 0.4 * k; break;
      case 'hook': ar = -1.5 * k - 0.5; arz = -0.9 * k; al = -0.9; twist = 0.7 * k; lean = 0.2; break;
      case 'baton': ar = -2.6 + 1.6 * k; al = -0.4; twist = 0.3 * k; break;
      case 'kick': lr = -1.5 * k; ll = 0.15; lean = -0.25 * k; al = -0.6; ar = 0.5; break;
      case 'block': al = -1.9; ar = -1.9; alz = -0.55; arz = 0.55; lean = 0.08; break;
      case 'aim': ar = -1.52; al = a.armed ? -1.35 : al; alz = a.armed ? -0.45 : alz; break;
      case 'hit': lean = -0.38 * k; al = 0.5 * k; ar = 0.4 * k; twist = 0.3 * k; break;
      case 'down': lie = 1; al = -0.4; ar = 0.5; alz = 0.9; arz = -0.9; ll = 0.15; lr = -0.2; lean = 0; break;
      case 'crouch': crouch = 1; break;
      case 'cower': crouch = 1; al = -2.7; ar = -2.7; alz = -0.4; arz = 0.4; lean = 0.4; break;
      case 'phone': ar = -2.5; arz = 0.5; break;
      case 'talk': al = -0.5 + Math.sin(performance.now() / 260) * 0.25; break;
      case 'dodge': crouch = 0.8; lean = 0.5; break;
    }
    const L = 16;
    p.al = damp(p.al, al, L, dt); p.ar = damp(p.ar, ar, L, dt); p.alz = damp(p.alz, alz, L, dt); p.arz = damp(p.arz, arz, L, dt);
    p.ll = damp(p.ll, ll, L, dt); p.lr = damp(p.lr, lr, L, dt); p.lean = damp(p.lean, lean, 10, dt); p.lie = damp(p.lie, lie, 9, dt);
    p.crouch = damp(p.crouch, crouch, 12, dt); p.twist = damp(p.twist, twist, L, dt);
    this.armL.rotation.set(p.al, 0, p.alz); this.armR.rotation.set(p.ar, 0, p.arz);
    const bend = p.crouch * 0.9;
    this.legL.rotation.x = p.ll - bend; this.legR.rotation.x = p.lr - bend;
    this.torso.rotation.set(p.lean + p.crouch * 0.35, p.twist, 0);
    this.torso.position.y = 0.88 - p.crouch * 0.3;
    this.legL.position.y = this.legR.position.y = 0.88 - p.crouch * 0.3;
    this.body.rotation.x = -p.lie * Math.PI / 2;
    this.body.position.y = p.lie * 0.2 + Math.abs(Math.sin(this.phase)) * 0.03 * Math.min(1, moving);
  }
}

// ---- wardrobe
const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68a5f, 0x9a6a44, 0x70482c, 0x55341f];
const HAIR = [0x1a1410, 0x3b2a1c, 0x6b4a2a, 0xa8793c, 0x8a8a8a, 0x101010, 0x5a1f1f];
const rc = (arr: number[], r: () => number) => arr[Math.floor(r() * arr.length) % arr.length];
export function lookFor(role: string, r: () => number = Math.random): Look {
  const base: Look = { skin: rc(SKIN, r), hair: rc(HAIR, r), top: 0x444444, bottom: 0x22262e, scale: 0.94 + r() * 0.1 };
  switch (role) {
    case 'police': return { ...base, top: 0x12151c, bottom: 0x12151c, vest: 0xd7e83a, hat: 'helmet', hatColour: 0x0d1016 };
    case 'armed': return { ...base, top: 0x12151c, bottom: 0x12151c, vest: 0x1d2330, hat: 'cap', hatColour: 0x0d1016 };
    case 'office': return { ...base, top: rc([0x2b3140, 0x3a3d45, 0x1f2a3a, 0x5a5560, 0x8a8f99], r), bottom: rc([0x1c1f26, 0x2a2d35, 0x15171c], r) };
    case 'tourist': return { ...base, top: rc([0xe04a3a, 0x2aa3d8, 0xf0c030, 0x3ac27a, 0xf07ab0], r), bottom: rc([0x3a5a8a, 0x8a7a5a, 0x2a2a2a], r), pack: rc([0x2a2a2a, 0xa03030, 0x30508a], r), hat: r() < 0.3 ? 'cap' : undefined, hatColour: 0xd8d8d8 };
    case 'nightlife': return { ...base, top: rc([0xb81d5a, 0x101010, 0xd9d9d9, 0x6a2ad8, 0x12a39a, 0xc9a227], r), bottom: rc([0x101014, 0x2a1a3a, 0x1a2a4a], r) };
    case 'shopkeeper': return { ...base, top: 0x3a6a4a, bottom: 0x2a2a2e, vest: 0x24402e };
    case 'publican': return { ...base, top: 0xd8d2c4, bottom: 0x1a1a1e, vest: 0x2a1a14 };
    case 'mechanic': return { ...base, top: 0x24456a, bottom: 0x24456a, hat: 'beanie', hatColour: 0x1a1a1a };
    case 'cabbie': return { ...base, top: 0x4a4436, bottom: 0x2a2a2e, hat: 'flat', hatColour: 0x3a3a34 };
    case 'marlowe': return { ...base, top: rc([0x5a1424, 0x3a0d18, 0x1a1a1e], r), bottom: 0x16161a, hat: r() < 0.35 ? 'flat' : undefined, hatColour: 0x1a1a1e };
    case 'kestrel': return { ...base, top: rc([0x0f6a66, 0x12827c, 0x0b4a4a], r), bottom: 0x1a1e22, hat: r() < 0.45 ? 'beanie' : undefined, hatColour: 0x0d2b2b };
    case 'heavy': return { ...base, top: 0x2a2f38, bottom: 0x1a1c20, scale: 1.08, hat: 'beanie', hatColour: 0x16181c };
    case 'player': return { skin: 0xc68a5f, hair: 0x1a1410, top: 0x9a6a2c, bottom: 0x2c3a52, scale: 1 };
    default: return { ...base, top: rc([0x4a4a52, 0x6a5a4a, 0x2f4a5a, 0x5a2f2f, 0x3a4a3a, 0x7a7468, 0x25303a], r), bottom: rc([0x22262e, 0x3a3a40, 0x2a3040, 0x4a4234], r), hat: r() < 0.15 ? 'beanie' : undefined, hatColour: rc([0x8a2a2a, 0x2a2a2a, 0x2a4a8a], r) };
  }
}
