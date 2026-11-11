// Turns the pure Layout into meshes + static colliders, and answers spatial queries for AI.
// Visual dressing (signage, scaffolds, street furniture, clutter) lives here; gameplay data stays in layout.ts.
import * as THREE from 'three';
import { Physics, GR_PAVE, GR_STATIC } from '../physics/Physics';
import { Renderer } from '../render/Renderer';
import { QuadBatch } from '../render/Batch';
import { AD_COUNT, asphaltTexture, billboardTexture, brickWallTexture, decalTexture, facadeTexture, glowTexture, labelTexture, mansardTexture, marqueeTexture, neonTexture, nettingTexture, pavingTexture, posterTexture, shopfrontTexture, spillTexture, streetSignTexture } from '../render/textures';
import { V2, mulberry32, pushOutOfRect, rectContains } from '../core/util';
import { Building, KERB, Layout, ROAD_HALF, WORLD_HALF, XS, ZS, generateLayout, lineClear } from './layout';
import { NavGraph, RoadGraph } from './graphs';

const SHOP_H = 3.6;
const BLADES: [string, string][] = [['BAR', '#ff3a7a'], ['JAZZ', '#7df3ff'], ['CLUB', '#c58bff'], ['CAFE', '#ffd04a'], ['PIZZA', '#ff5a3a'], ['FILMS', '#6dff9c'], ['TATTOO', '#ff3a3a'], ['BOOKS', '#ffe9b0'],
  ['HOTEL', '#58a8ff'], ['LIVE', '#ff8ad0'], ['24 HR', '#6dff9c'], ['DISCO', '#ff5ad0'], ['CASINO', '#ffd04a'], ['SAUNA', '#ff7a3a'], ['VINYL', '#7df3ff'], ['CHIPS', '#ffe14a'], ['KEBAB', '#ff5a3a'], ['POOL', '#58a8ff']];
const CHINA: [string, string][] = [['GOLDEN WOK', '#ffcf3a'], ['TEA HOUSE', '#ff4a3a'], ['DUMPLINGS', '#ffcf3a'], ['ROAST DUCK', '#ff4a3a'], ['NOODLE BAR', '#ffe9b0'], ['LANTERN', '#ff4a3a']];
const hex = (css: string) => new THREE.Color(css).getHex();

export class City {
  layout: Layout = generateLayout();
  nav = new NavGraph(this.layout);
  roads = new RoadGraph();
  group = new THREE.Group();
  private screens: THREE.MeshBasicMaterial[] = [];
  private ads: THREE.Texture[] = [];
  private adTimer = 0; private adFrame = 0;
  private beacons: THREE.MeshStandardMaterial[] = [];
  private flicker: THREE.MeshBasicMaterial[] = [];
  private mx = new THREE.Matrix4(); private q = new THREE.Quaternion(); private sc = new THREE.Vector3(1, 1, 1); private v = new THREE.Vector3();

  constructor(private phys: Physics, private gfx: Renderer) {
    gfx.scene.add(this.group);
    this.buildGround(); this.buildBuildings(); this.buildLandmarks(); this.buildFurniture(); this.buildDressing(); this.buildMarkings();
    gfx.setLampPositions(this.layout.lamps);
  }

  // ---------------------------------------------------------------- queries
  /** Keep a walking agent out of buildings and hoardings. */
  resolve(p: V2, radius = 0.35): void {
    for (const s of this.layout.solids) if (p.x > s.x0 - radius && p.x < s.x1 + radius && p.z > s.z0 - radius && p.z < s.z1 + radius) pushOutOfRect(p, s, radius);
    const lim = WORLD_HALF - 1; if (p.x > lim) p.x = lim; if (p.x < -lim) p.x = -lim; if (p.z > lim) p.z = lim; if (p.z < -lim) p.z = -lim;
  }
  inSolid(x: number, z: number, pad = 0): boolean { return this.layout.solids.some((s) => rectContains(s, x, z, pad)); }
  los(ax: number, az: number, bx: number, bz: number): boolean { return lineClear(this.layout, ax, az, bx, bz); }

  update(dt: number): void {
    this.adTimer += dt;
    if (this.adTimer > 4) { this.adTimer = 0; this.adFrame++; this.screens.forEach((m, i) => { m.map = this.ads[(this.adFrame + i * 3) % this.ads.length]; }); }
    const now = performance.now();
    const blink = Math.floor(now / 550) % 2;
    for (const b of this.beacons) b.emissiveIntensity = blink ? 2.6 : 0.25;
    // one or two dying neon tubes
    this.flicker.forEach((m, i) => { m.opacity = Math.sin(now / 90 + i * 7) > 0.92 || Math.sin(now / 1300 + i) > 0.985 ? 0.25 : 1; });
  }

  // ---------------------------------------------------------------- helpers
  private nightMat<T extends THREE.MeshStandardMaterial>(mat: T, base: number): T { mat.emissiveIntensity = base; this.gfx.nightMaterials.push({ mat, base, prop: 'emissiveIntensity' }); return mat; }
  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, pts: (V2 & { yaw?: number; y?: number; s?: number })[], y: number, shadow = false): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length));
    pts.forEach((p, i) => { this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw ?? 0); const s = p.s ?? 1; this.mx.compose(this.v.set(p.x, p.y ?? y, p.z), this.q, this.sc.set(s, s, s)); m.setMatrixAt(i, this.mx); });
    m.count = pts.length; m.castShadow = shadow; this.group.add(m); return m;
  }
  private plane(w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, yaw: number, flat = false): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    if (flat) m.rotation.set(-Math.PI / 2, 0, yaw); else m.rotation.y = yaw;
    m.position.set(x, y, z); this.group.add(m); return m;
  }
  private neonMats = new Map<THREE.Texture, THREE.MeshBasicMaterial>();
  /** A glowing sign. `both` hangs it as a projecting sign readable (un-mirrored) from either side. */
  private neon(tex: THREE.Texture, x: number, y: number, z: number, yaw: number, w: number, h: number, flicker = false, both = false): void {
    let mat = flicker ? undefined : this.neonMats.get(tex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
      if (flicker) this.flicker.push(mat); else { this.gfx.nightMaterials.push({ mat, base: 1, prop: 'opacity' }); this.neonMats.set(tex, mat); }
    }
    this.plane(w, h, mat, x, y, z, yaw);
    if (both) this.plane(w, h, mat, x - Math.sin(yaw) * 0.04, y, z - Math.cos(yaw) * 0.04, yaw + Math.PI);
  }

  // ---------------------------------------------------------------- ground
  private buildGround() {
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.6, metalness: 0, envMapIntensity: 0.6 });
    this.gfx.wetMaterials.push({ mat: asphalt, dry: 0.95, wet: 0.58 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2), asphalt);
    road.rotation.x = -Math.PI / 2; road.receiveShadow = true; this.group.add(road);
    this.phys.fixedBox(0, -1, 0, WORLD_HALF + 20, 1, WORLD_HALF + 20);
    for (const [x, z, hx, hz] of [[0, -WORLD_HALF - 1, WORLD_HALF, 1], [0, WORLD_HALF + 1, WORLD_HALF, 1], [-WORLD_HALF - 1, 0, 1, WORLD_HALF], [WORLD_HALF + 1, 0, 1, WORLD_HALF]]) this.phys.fixedBox(x, 10, z, hx, 10, hz);
    const paving = new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.55, metalness: 0.05, envMapIntensity: 1.3 });
    this.gfx.wetMaterials.push({ mat: paving, dry: 0.92, wet: 0.36 });
    const kerb = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.6 });
    const pb = new QuadBatch(), kb = new QuadBatch();
    for (const s of this.layout.slabs) {
      pb.top(s.x0, s.z0, s.x1, s.z1, KERB, 4.2); kb.boxSides(s.x0, s.z0, s.x1, s.z1, 0, KERB, 1, 1);
      kb.top(s.x0, s.z0, s.x1, s.z0 + 0.22, KERB + 0.004); kb.top(s.x0, s.z1 - 0.22, s.x1, s.z1, KERB + 0.004); kb.top(s.x0, s.z0, s.x0 + 0.22, s.z1, KERB + 0.004); kb.top(s.x1 - 0.22, s.z0, s.x1, s.z1, KERB + 0.004); // granite kerbstones
      this.phys.fixedBox((s.x0 + s.x1) / 2, KERB / 2, (s.z0 + s.z1) / 2, (s.x1 - s.x0) / 2, KERB / 2, (s.z1 - s.z0) / 2, GR_PAVE);
    }
    const pm = pb.build(paving); pm.receiveShadow = true; this.group.add(pm, kb.build(kerb));
  }

  // ---------------------------------------------------------------- buildings
  private buildBuildings() {
    const L = this.layout, r = mulberry32(88), g = this.group;
    const styles = [0, 1, 2, 3, 4, 5].map((i) => facadeTexture(i));
    const walls = styles.map(() => new QuadBatch());
    const plain = new QuadBatch(), roofs = new QuadBatch(), bases = new QuadBatch(), steel = new QuadBatch(), trim = new QuadBatch(), mans = new QuadBatch(), scaff = new QuadBatch(), planks = new QuadBatch(), barrier = new QuadBatch();
    const shopGeo = new Map<string, THREE.PlaneGeometry>();
    const spill: { p: number[]; uv: number[]; i: number[] } = { p: [], uv: [], i: [] };
    const outsideFree = (x: number, z: number, self: Building) => Math.abs(x) < WORLD_HALF - 1 && Math.abs(z) < WORLD_HALF - 1 && !L.buildings.some((b) => b !== self && rectContains(b, x, z));
    const alleyAt = (x: number, z: number) => L.alleys.find((a) => rectContains(a, x, z));
    const bladeTex = BLADES.map(([t, c]) => neonTexture(t, c, true, true)), chinaTex = CHINA.map(([t, c]) => neonTexture(t, c, true, true));
    const awnMats = [0x7a1420, 0x14402a, 0x1a2a52, 0x8a6a1c, 0x2a2a2e].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }));
    const netMat = new THREE.MeshStandardMaterial({ map: nettingTexture(), transparent: true, side: THREE.DoubleSide, roughness: 1 });
    let blade = 0, nth = 0;

    for (const b of L.buildings) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      this.phys.fixedBox((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2, w / 2, b.h / 2, d / 2);
      if (b.kind === 'container' || b.kind === 'cabin') { steel.box(b.x0, b.z0, b.x1, b.z1, KERB, b.h, 3); continue; }
      if (b.kind === 'frame') { // unfinished concrete frame: floor plates + columns
        for (let y = 3.4; y <= b.h; y += 3.4) plain.box(b.x0, b.z0, b.x1, b.z1, y - 0.3, y, 4);
        for (const cx of [b.x0, (b.x0 + b.x1) / 2 - 0.3, b.x1 - 0.6]) for (const cz of [b.z0, (b.z0 + b.z1) / 2 - 0.3, b.z1 - 0.6]) plain.box(cx, cz, cx + 0.6, cz + 0.6, KERB, b.h, 4);
        continue;
      }
      nth++;
      const hasShop = b.kind !== 'booth';
      const y0 = KERB + (hasShop ? SHOP_H : 0);
      const mansard = hasShop && b.h > 17 && b.style !== 5 && r() < 0.6;
      const top = mansard ? b.h - 3.4 : b.h;
      if (top > y0 + 0.5) walls[b.style % 6].boxSides(b.x0, b.z0, b.x1, b.z1, y0, top, 14, 13.6);
      else plain.boxSides(b.x0, b.z0, b.x1, b.z1, KERB, b.h, 4, 4);
      // cornices: over the shopfront, and a heavier one at the eaves
      if (hasShop) trim.box(b.x0 - 0.22, b.z0 - 0.22, b.x1 + 0.22, b.z1 + 0.22, y0 - 0.12, y0 + 0.2, 3);
      trim.box(b.x0 - 0.3, b.z0 - 0.3, b.x1 + 0.3, b.z1 + 0.3, top - 0.45, top + 0.12, 3);
      if (mansard) { mans.boxSides(b.x0 + 0.7, b.z0 + 0.7, b.x1 - 0.7, b.z1 - 0.7, top, b.h, 14, 3.4); roofs.top(b.x0 + 0.7, b.z0 + 0.7, b.x1 - 0.7, b.z1 - 0.7, b.h, 4); roofs.top(b.x0, b.z0, b.x1, b.z1, top + 0.13, 4); }
      else { roofs.boxSides(b.x0, b.z0, b.x1, b.z1, top, top + 0.7, 4, 4); roofs.top(b.x0, b.z0, b.x1, b.z1, top + 0.7, 4); }
      // chimney stacks break up the skyline
      for (let k = 0; k < 2; k++) if (r() < 0.6) { const cx = b.x0 + 1 + r() * Math.max(0.1, w - 3), cz = b.z0 + 1 + r() * Math.max(0.1, d - 3), ch = 1.6 + r() * 1.6; plain.box(cx, cz, cx + 1.3, cz + 0.8, b.h, b.h + ch, 2); roofs.box(cx + 0.15, cz + 0.15, cx + 0.5, cz + 0.5, b.h + ch, b.h + ch + 0.5, 1); roofs.box(cx + 0.75, cz + 0.2, cx + 1.1, cz + 0.55, b.h + ch, b.h + ch + 0.4, 1); }
      bases.boxSides(b.x0, b.z0, b.x1, b.z1, KERB, y0, 4, 4);

      const label = b.name ?? b.shop ?? 'To Let';
      const faces: [number, number, number, number][] = [ // mid x, mid z, yaw (facing out), width
        [(b.x0 + b.x1) / 2, b.z1, 0, w], [(b.x0 + b.x1) / 2, b.z0, Math.PI, w], [b.x1, (b.z0 + b.z1) / 2, Math.PI / 2, d], [b.x0, (b.z0 + b.z1) / 2, -Math.PI / 2, d]];
      let mat: THREE.MeshStandardMaterial | null = null, dressed = false;
      for (const [fx, fz, yaw, fw] of faces) {
        const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
        const ox = fx + nx * 2.2, oz = fz + nz * 2.2;
        const alley = alleyAt(ox, oz), narrow = !!alley && Math.min(alley.x1 - alley.x0, alley.z1 - alley.z0) < 6;
        if (fw < 5 || !outsideFree(ox, oz, b) || narrow) continue;
        const china = !!alley;
        if (!mat) {
          const t = shopfrontTexture(label, Math.min(fw, 18), Math.floor(r() * 1e6), b.kind ?? 'shop');
          mat = this.nightMat(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, roughness: 0.35, metalness: 0.1 }), b.kind === 'garage' || b.kind === 'lockup' ? 0.18 : 0.5);
        }
        const key = fw.toFixed(1);
        if (!shopGeo.has(key)) shopGeo.set(key, new THREE.PlaneGeometry(fw - 0.3, hasShop ? SHOP_H - 0.1 : b.h - 0.2));
        const m = new THREE.Mesh(shopGeo.get(key)!, mat);
        m.position.set(fx + nx * 0.04, KERB + (hasShop ? SHOP_H / 2 : b.h / 2), fz + nz * 0.04); m.rotation.y = yaw; g.add(m);
        const lit = b.kind !== 'garage' && b.kind !== 'lockup';
        if (lit) { // light thrown across the wet pavement
          const base = spill.p.length / 3, hw = fw / 2 - 0.4, y = KERB + 0.02, out = 4.2;
          for (const [a, o, u, vv] of [[-hw, 0.05, 0, 0], [hw, 0.05, 1, 0], [hw, out, 1, 1], [-hw, out, 0, 1]]) { spill.p.push(fx + tx * a + nx * o, y, fz + tz * a + nz * o); spill.uv.push(u, vv); }
          spill.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
        // --- signage
        if (b.kind === 'theatre') {
          const cw = Math.min(fw - 2, 13);
          const can = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.55, 2.6), new THREE.MeshStandardMaterial({ color: 0x18090b, roughness: 0.6 })); can.position.set(fx + nx * 1.3, 4.1, fz + nz * 1.3); can.rotation.y = yaw; g.add(can);
          const mt = marqueeTexture(b.name!.replace('The ', ''));
          this.plane(cw, 1.5, new THREE.MeshBasicMaterial({ map: mt, toneMapped: false }), fx + nx * 2.62, 4.6, fz + nz * 2.62, yaw);
          for (const s of [-1, 1]) this.plane(2.6, 1.5, new THREE.MeshBasicMaterial({ map: mt, toneMapped: false }), fx + nx * 1.3 + tx * s * (cw / 2 + 0.01), 4.6, fz + nz * 1.3 + tz * s * (cw / 2 + 0.01), yaw + s * Math.PI / 2);
          const under = this.plane(cw - 0.3, 2.3, new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), fx + nx * 1.3, 3.8, fz + nz * 1.3, 0, true); under.rotation.set(Math.PI / 2, 0, -yaw);
          this.neon(neonTexture(b.name!.replace('The ', '').split(' ')[0].toUpperCase(), '#ffd76a', true, true), fx + nx * 0.9 + tx * (cw / 2 - 0.6), 11, fz + nz * 0.9 + tz * (cw / 2 - 0.6), yaw + Math.PI / 2, 1.5, 8.5, false, true);
          this.gfx.accents.push({ x: fx + nx * 3, y: 3.4, z: fz + nz * 3, colour: 0xffc070, power: 60 });
        } else if (b.kind === 'pub') {
          this.neon(neonTexture('THE GILDED STAG', '#ffc46a'), fx + nx * 0.3, 5.4, fz + nz * 0.3, yaw, Math.min(fw - 2, 9), 1.3);
          for (const s of [-1, 1]) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd89848 })); lamp.position.set(fx + nx * 0.6 + tx * s * (fw / 2 - 2), 3.9, fz + nz * 0.6 + tz * s * (fw / 2 - 2)); g.add(lamp); }
          const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.08), new THREE.MeshStandardMaterial({ map: labelTexture('STAG', '#e3bf5a', '#142a1c', 128, 128), emissive: 0x332810, emissiveIntensity: 1 })); sign.position.set(fx + nx * 0.9 + tx * (fw / 2 - 0.8), 4.8, fz + nz * 0.9 + tz * (fw / 2 - 0.8)); sign.rotation.y = yaw + Math.PI / 2; g.add(sign);
          this.gfx.accents.push({ x: fx + nx * 2.5, y: 3, z: fz + nz * 2.5, colour: 0xffa850, power: 40 });
        } else if (b.kind === 'police') this.neon(neonTexture('POLICE', '#8fc2ff', false, true), fx + nx * 0.3, 5.2, fz + nz * 0.3, yaw, 6, 1.5);
        else if (b.kind === 'hospital') this.neon(neonTexture('WALK-IN CENTRE', '#7dffb0', false, true), fx + nx * 0.3, 5.2, fz + nz * 0.3, yaw, 9, 1.4);
        else if (lit && b.kind !== 'office' && b.kind !== 'booth') {
          // projecting blade sign: what makes a Soho street read as Soho from a hundred metres away
          if (r() < (china ? 0.95 : 0.62)) {
            const k = china ? blade % CHINA.length : blade % BLADES.length; blade++;
            const along = (r() - 0.5) * (fw - 3), yy = 5.4 + r() * 3.2, hgt = china ? 4.4 : 3.2 + r() * 1.6;
            this.neon(china ? chinaTex[k] : bladeTex[k], fx + nx * 0.75 + tx * along, yy, fz + nz * 0.75 + tz * along, yaw + Math.PI / 2, hgt * 0.26, hgt, !china && blade % 9 === 0, true);
            if (blade % 3 === 0) this.gfx.accents.push({ x: fx + nx * 1.6 + tx * along, y: yy, z: fz + nz * 1.6 + tz * along, colour: hex((china ? CHINA : BLADES)[k][1]), power: 45 });
          }
          if (r() < 0.34 && !china) { // canvas awning
            const aw = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.8, 1.7), awnMats[Math.floor(r() * awnMats.length)]);
            aw.position.set(fx + nx * 0.8, KERB + 3.05, fz + nz * 0.8); aw.rotation.set(-1.15, yaw, 0, 'YXZ'); g.add(aw);
          }
        }
        // --- scaffolding with debris netting on the odd building
        if (!dressed && !b.kind && fw >= 12 && nth % 9 === 4) {
          dressed = true;
          const rect = (a0: number, a1: number, o0: number, o1: number): [number, number, number, number] => { const xa = fx + tx * a0 + nx * o0, xb = fx + tx * a1 + nx * o1, za = fz + tz * a0 + nz * o0, zb = fz + tz * a1 + nz * o1; return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)]; };
          const hw = fw / 2 - 0.3, sh = Math.min(b.h - 2, 15);
          for (let a = -hw; a <= hw + 0.01; a += (hw * 2) / Math.round((hw * 2) / 2.4)) for (const o of [0.25, 1.55]) scaff.box(...rect(a - 0.04, a + 0.04, o - 0.04, o + 0.04), KERB, sh, 1);
          for (let y = 2.7; y < sh; y += 2.1) { scaff.box(...rect(-hw, hw, 1.51, 1.59), y, y + 0.08, 1); scaff.box(...rect(-hw, hw, 1.51, 1.59), y + 1, y + 1.08, 1); planks.box(...rect(-hw, hw, 0.2, 1.55), y - 0.06, y, 1.5); }
          const net = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.6, sh - 2.9), netMat); (net.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 1);
          net.geometry.attributes.uv.array.forEach((_, i, arr: any) => { arr[i] *= i % 2 ? (sh - 2.9) / 2 : (fw - 0.6) / 2; });
          net.position.set(fx + nx * 1.62, 2.8 + (sh - 2.9) / 2, fz + nz * 1.62); net.rotation.y = yaw; g.add(net);
          for (let a = -hw; a < hw - 1; a += 2.2) barrier.box(...rect(a, a + 2, 1.9, 1.96), KERB + 0.35, KERB + 1.05, 0.5); // chapter-8 barriers round the base
        }
      }
    }
    styles.forEach((s, i) => {
      if (walls[i].empty) return;
      const mat = this.nightMat(new THREE.MeshStandardMaterial({ map: s.map, emissiveMap: s.emissive, emissive: 0xffffff, roughness: 0.9 }), 1.5);
      const m = walls[i].build(mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
    });
    const mt = mansardTexture();
    const stripes = labelTexture('', '#fff', '#fff', 64, 16); { const c = (stripes.image as HTMLCanvasElement).getContext('2d')!; for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#e8e8e4' : '#d81e1e'; c.fillRect(i * 16, 0, 16, 16); } stripes.needsUpdate = true; stripes.wrapS = THREE.RepeatWrapping; }
    const mats: [QuadBatch, THREE.Material][] = [
      [plain, new THREE.MeshStandardMaterial({ map: brickWallTexture(), roughness: 0.95 })], [roofs, new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.9 })],
      [bases, new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.7 })], [steel, new THREE.MeshStandardMaterial({ color: 0x2b5568, roughness: 0.6, metalness: 0.4 })],
      [trim, new THREE.MeshStandardMaterial({ color: 0x8f8878, roughness: 0.8 })], [mans, this.nightMat(new THREE.MeshStandardMaterial({ map: mt.map, emissiveMap: mt.emissive, emissive: 0xffffff, roughness: 0.6, metalness: 0.2 }), 1.4)],
      [scaff, new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.8 })], [planks, new THREE.MeshStandardMaterial({ color: 0x7a6038, roughness: 0.9 })],
      [barrier, new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 })]];
    for (const [bt, m] of mats) if (!bt.empty) { const mesh = bt.build(m); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); }
    // one merged additive layer for all the shop light on the pavement
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(spill.p, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(spill.uv, 2)); sg.setIndex(spill.i);
    const sm = new THREE.MeshBasicMaterial({ map: spillTexture(), color: 0xffc078, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.gfx.nightMaterials.push({ mat: sm, base: 0.34, prop: 'opacity' });
    g.add(new THREE.Mesh(sg, sm));

    // hoardings around the development site, fly-posted
    const hoard = new QuadBatch();
    for (const f of L.fences) { hoard.box(f.x0, f.z0, f.x1, f.z1, KERB, 2.8, 1); this.phys.fixedBox((f.x0 + f.x1) / 2, 1.4, (f.z0 + f.z1) / 2, Math.max(0.2, (f.x1 - f.x0) / 2), 1.4, Math.max(0.2, (f.z1 - f.z0) / 2)); }
    const ht = labelTexture('HALCYON WHARF · A NEW LONDON ADDRESS', '#e8f6ff', '#0b3f57', 512, 64); ht.wrapS = THREE.RepeatWrapping; ht.repeat.set(1 / 12, 1 / 2.8);
    g.add(hoard.build(new THREE.MeshStandardMaterial({ map: ht, roughness: 0.6 })));
    const posters = [0, 1, 2, 3, 4, 5].map((i) => new THREE.MeshStandardMaterial({ map: posterTexture(i), roughness: 0.8 }));
    for (let x = 87; x < 106; x += 1.7) this.plane(1.2, 1.8, posters[Math.floor(r() * 6)], x, KERB + 1.2 + r() * 0.3, -84.96, 0);
    for (let x = 120; x < 139; x += 1.7) this.plane(1.2, 1.8, posters[Math.floor(r() * 6)], x, KERB + 1.2 + r() * 0.3, -84.96, 0);
  }

  // ---------------------------------------------------------------- landmarks
  private buildLandmarks() {
    const L = this.layout, g = this.group;
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.7 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x3a4a40, roughness: 0.35, metalness: 0.8 });
    // --- the illuminated corner: a wall of LED panels wrapping two faces
    const lights = L.buildings.find((b) => b.kind === 'lights')!;
    for (let i = 0; i < AD_COUNT; i++) this.ads.push(billboardTexture(i));
    const frame = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.5 });
    const screen = (x: number, y: number, z: number, yaw: number, w: number, h: number) => {
      const mat = new THREE.MeshBasicMaterial({ map: this.ads[(this.screens.length * 3) % AD_COUNT], toneMapped: false });
      this.screens.push(mat);
      this.plane(w + 0.5, h + 0.5, frame, x + Math.sin(yaw) * 0.32, y, z + Math.cos(yaw) * 0.32, yaw);
      this.plane(w, h, mat, x + Math.sin(yaw) * 0.36, y, z + Math.cos(yaw) * 0.36, yaw);
    };
    const wall = (cx: number, cz: number, yaw: number) => {
      const tx = Math.cos(yaw), tz = -Math.sin(yaw);
      screen(cx - tx * 5, 14.6, cz - tz * 5, yaw, 13.6, 11); // the big one
      screen(cx + tx * 7.4, 17.6, cz + tz * 7.4, yaw, 9.6, 5); screen(cx + tx * 7.4, 11.6, cz + tz * 7.4, yaw, 9.6, 5.6);
      screen(cx, 6.6, cz, yaw, 24, 3.6); // ticker strip above the shops
    };
    wall(lights.x0, (lights.z0 + lights.z1) / 2, -Math.PI / 2); wall((lights.x0 + lights.x1) / 2, lights.z1, 0);
    const glowL = new THREE.PointLight(0xa8ccff, 170, 70, 1.5); glowL.position.set(lights.x0 - 9, 11, lights.z1 + 9); g.add(glowL);

    // --- memorial fountain with steps (original design; the steps are real geometry you can climb)
    const f = L.poi('circus');
    [[4.6, 0.22], [3.8, 0.44], [3.0, 0.66]].forEach(([rad, top]) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.22, 8), stone); m.position.set(f.x, KERB + top - 0.11, f.z); m.receiveShadow = true; g.add(m);
      this.phys.fixedCylinder(f.x, KERB + top - 0.11, f.z, 0.11, rad, GR_PAVE);
    });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 3.2, 8), bronze); col.position.set(f.x, KERB + 2.2, f.z); col.castShadow = true; g.add(col);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 0.8, 0.6, 12), bronze); bowl.position.set(f.x, KERB + 4, f.z); g.add(bowl);
    const silver = new THREE.MeshStandardMaterial({ color: 0xbfc5c9, metalness: 0.9, roughness: 0.25 });
    const fig = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.7, 6), silver); fig.position.set(f.x, KERB + 5.2, f.z); fig.rotation.z = 0.25; g.add(fig);
    for (const s of [-1, 1]) { const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), silver); wing.position.set(f.x + s * 0.45, KERB + 5.6, f.z); wing.rotation.z = s * 0.6; g.add(wing); }
    this.phys.fixedCylinder(f.x, 2.5, f.z, 2.5, 1.2);

    // --- Leicester Square: lawns, statue, trees, benches, low railings round the lawns
    const lawn = new THREE.MeshStandardMaterial({ color: 0x15281a, roughness: 1 });
    const sq = { x: 112.5, z: 114 };
    for (const [lx, lz] of [[-13, -11], [13, -11], [-13, 13], [13, 13]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(17, 0.08, 15), lawn); m.position.set(sq.x + lx, KERB + 0.04, sq.z + lz); m.receiveShadow = true; g.add(m); }
    [[2.4, 0.2], [1.7, 0.4]].forEach(([rad, top]) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.2, 8), stone); m.position.set(sq.x, KERB + top - 0.1, sq.z); g.add(m);
      this.phys.fixedCylinder(sq.x, KERB + top - 0.1, sq.z, 0.1, rad, GR_PAVE);
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 1.4), stone); plinth.position.set(sq.x, KERB + 1.4, sq.z); plinth.castShadow = true; g.add(plinth);
    const statue = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.2, 4, 8), bronze); statue.position.set(sq.x, KERB + 3.4, sq.z); g.add(statue);
    this.phys.fixedBox(sq.x, 1.5, sq.z, 0.7, 1.5, 0.7);
    const trunkG = new THREE.CylinderGeometry(0.22, 0.34, 4.4, 6), leafG = new THREE.IcosahedronGeometry(2.8, 0);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 }), leafM = new THREE.MeshStandardMaterial({ color: 0x1a3320, roughness: 1, flatShading: true });
    for (const t of L.trees) {
      const a = new THREE.Mesh(trunkG, trunkM); a.position.set(t.x, KERB + 2.2, t.z); a.castShadow = true; g.add(a);
      for (const [ox, oy, oz, s] of [[0, 5.6, 0, 1], [1.3, 4.9, 0.6, 0.7], [-1.1, 5.1, -0.8, 0.75]]) { const b = new THREE.Mesh(leafG, leafM); b.position.set(t.x + ox, KERB + oy, t.z + oz); b.scale.set(s, s * 0.8, s); b.rotation.y = t.x + oz; b.castShadow = true; g.add(b); }
      this.phys.fixedCylinder(t.x, 2, t.z, 2, 0.3);
    }
    const benchG = new THREE.BoxGeometry(2, 0.45, 0.6), benchM = new THREE.MeshStandardMaterial({ color: 0x1e2a1c, roughness: 0.8 });
    for (const b of L.benches) { const m = new THREE.Mesh(benchG, benchM); m.position.set(b.x, KERB + 0.23, b.z); m.rotation.y = b.yaw; g.add(m); this.phys.fixedBox(b.x, 0.4, b.z, b.yaw % Math.PI === 0 ? 1 : 0.3, 0.3, b.yaw % Math.PI === 0 ? 0.3 : 1); }
    this.neon(neonTexture('REGAL CINEMA', '#ff3a6a', false, true), 112.5, 7.5, 159.6, Math.PI, 12, 2.4); // the square's picture house
    this.neon(neonTexture('CAPITOL', '#58a8ff', false, true), 159.6, 7.5, 112.5, -Math.PI / 2, 9, 2.2);
    this.gfx.accents.push({ x: 112.5, y: 6, z: 152, colour: 0xff3a6a, power: 120 }, { x: 152, y: 6, z: 112.5, colour: 0x58a8ff, power: 110 });

    // --- Chinatown: a gate at each end of Gerrard Street, lanterns strung between the buildings, banners
    const red = new THREE.MeshStandardMaterial({ color: 0xa81414, roughness: 0.5 }), green = new THREE.MeshStandardMaterial({ color: 0x175a3e, roughness: 0.5 }), gold = new THREE.MeshStandardMaterial({ color: 0xd9b040, roughness: 0.4, metalness: 0.6, emissive: 0x4a3a08 });
    for (const gx of [12, 63]) {
      for (const z of [34.6, 40.4]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 6.4, 8), red); c.position.set(gx, KERB + 3.2, z); c.castShadow = true; g.add(c); this.phys.fixedCylinder(gx, 3.2, z, 3.2, 0.32);
        const plb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), stone); plb.position.set(gx, KERB + 0.25, z); g.add(plb); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 8.4), gold); beam.position.set(gx, KERB + 6.3, 37.5); g.add(beam);
      for (const [w, d, y] of [[2.2, 10.2, 7.15], [1.6, 8.2, 7.5], [1.5, 5.8, 8.15], [1.0, 4.4, 8.45]]) { const rf = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, d), green); rf.position.set(gx, KERB + y, 37.5); g.add(rf); }
      for (const s of [-1, 1]) { const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 4), gold); tip.position.set(gx, KERB + 7.6, 37.5 + s * 5.1); tip.rotation.x = s * 0.9; g.add(tip); }
    }
    const lanternMat = this.nightMat(new THREE.MeshStandardMaterial({ color: 0xd42020, emissive: 0xff3a20, roughness: 0.6 }), 2.2);
    const lp: V2[] = []; for (let x = 15; x < 62; x += 2.9) for (const z of [35.0, 36.3, 37.5, 38.7, 40.0]) lp.push({ x: x + ((z * 7) % 1.4), z });
    const lan = this.inst(new THREE.SphereGeometry(0.3, 8, 6).scale(1, 1.25, 1), lanternMat, lp.map((p) => ({ ...p, y: 5.5 + Math.sin(p.x * 0.9) * 0.35 })), 5.5);
    lan.frustumCulled = false;
    const wire = new QuadBatch(); for (let x = 15; x < 62; x += 2.9) wire.box(x + 0.6, 34.1, x + 0.63, 40.9, 5.95, 5.98, 1);
    g.add(wire.build(new THREE.MeshBasicMaterial({ color: 0x050505 })));
    for (const cx of [24, 51]) { const cl = new THREE.PointLight(0xff4a2a, 70, 24, 1.7); cl.position.set(cx, 4.6, 37.5); g.add(cl); }
    this.gfx.accents.push({ x: 9, y: 6, z: 37.5, colour: 0xffb060, power: 90 }, { x: 66, y: 6, z: 37.5, colour: 0xffb060, power: 90 });

    // --- tower crane on the Halcyon Wharf site
    const craneM = new THREE.MeshStandardMaterial({ color: 0xc9980e, roughness: 0.6 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 34, 1.2), craneM); mast.position.set(116, 17, -128); g.add(mast);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(30, 0.9, 0.9), craneM); jib.position.set(108, 33.5, -128); g.add(jib);
    const beaconM = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 }); this.beacons.push(beaconM);
    for (const [bx, by] of [[116, 34.6], [93.5, 34.2]]) { const bc = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), beaconM); bc.position.set(bx, by, -128); g.add(bc); }
    this.phys.fixedBox(116, 5, -128, 0.6, 5, 0.6);
    const sl = new THREE.PointLight(0xfff0d0, 140, 44, 1.6); sl.position.set(114, 7, -112); g.add(sl); // site floodlight

    // --- station entrances (plain "STATION" totems: no transport branding is reproduced)
    for (const id of ['tube_picc', 'tube_leic']) {
      const p = L.poi(id);
      const tot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 1.1), new THREE.MeshStandardMaterial({ map: labelTexture('STATION', '#fff', '#12224a', 256, 64), emissive: 0x223366, emissiveIntensity: 0.9 }));
      tot.position.set(p.x + 1.4, KERB + 1.7, p.z); g.add(tot);
      const iron = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.5, metalness: 0.6 });
      for (const [rx, rz, rw, rd] of [[0, 1.2, 2.3, 0.07], [0, -1.2, 2.3, 0.07], [-1.15, 0, 0.07, 2.4]]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(rw, 1.05, rd), iron); rail.position.set(p.x + rx, KERB + 0.52, p.z + rz); g.add(rail); }
      const pit = this.plane(2.2, 2.3, new THREE.MeshBasicMaterial({ color: 0x1a1608 }), p.x, KERB + 0.02, p.z, 0, true);
      const glow = new THREE.PointLight(0xffe0a0, 30, 9, 1.8); glow.position.set(p.x, KERB + 0.6, p.z); g.add(glow); pit.renderOrder = 1;
    }
    // --- lit doorways for the three enterable interiors
    for (const id of ['pub', 'shop', 'garage']) {
      const p = L.poi(id);
      const off = id === 'garage' ? 2.42 : id === 'pub' ? 1.92 : 1.72; // distance from the POI back to the wall
      this.plane(1.5, 2.5, new THREE.MeshBasicMaterial({ color: 0xd8a868, transparent: true, opacity: 0.7 }), p.x - Math.sin(p.yaw) * off, KERB + 1.25, p.z - Math.cos(p.yaw) * off, p.yaw);
    }
  }

  // ---------------------------------------------------------------- street furniture
  private buildFurniture() {
    const L = this.layout, g = this.group;
    const iron = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.45, metalness: 0.7 });
    // street lamps: column, bracket, lantern, halo, a cone of lit rain and a pool of light on the wet ground
    this.inst(new THREE.CylinderGeometry(0.06, 0.13, 6, 6), iron, L.lamps, KERB + 3);
    this.inst(new THREE.CylinderGeometry(0.2, 0.24, 0.9, 6), iron, L.lamps, KERB + 0.45);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false, transparent: true });
    this.gfx.nightMaterials.push({ mat: headMat, base: 1, prop: 'opacity' });
    this.inst(new THREE.CylinderGeometry(0.34, 0.2, 0.3, 6), headMat, L.lamps, KERB + 6.05);
    this.inst(new THREE.ConeGeometry(0.42, 0.22, 6), iron, L.lamps, KERB + 6.32);
    const glow = glowTexture();
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(L.lamps.flatMap((l) => [l.x, KERB + 6.0, l.z]), 3));
    const haloMat = new THREE.PointsMaterial({ map: glow, color: 0xffa040, size: 4.2, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.gfx.nightMaterials.push({ mat: haloMat, base: 0.4, prop: 'opacity' });
    g.add(new THREE.Points(haloGeo, haloMat));
    const coneMat = new THREE.MeshBasicMaterial({ map: spillTexture(), color: 0xffa850, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.gfx.nightMaterials.push({ mat: coneMat, base: 0.06, prop: 'opacity' });
    const coneGeo = new THREE.ConeGeometry(3.2, 5.9, 12, 1, true); { const uv = coneGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 0.5); }
    this.inst(coneGeo, coneMat, L.lamps, KERB + 3.05);
    const poolMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xff9a40, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.gfx.nightMaterials.push({ mat: poolMat, base: 0.22, prop: 'opacity' });
    this.inst(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), poolMat, L.lamps, KERB + 0.03);
    for (const l of L.lamps) this.phys.fixedCylinder(l.x, 3, l.z, 3, 0.12);

    this.inst(new THREE.CylinderGeometry(0.1, 0.14, 1, 8), iron, L.bollards, KERB + 0.5);
    this.inst(new THREE.SphereGeometry(0.13, 6, 4), iron, L.bollards, KERB + 1.02);
    for (const b of L.bollards) this.phys.fixedCylinder(b.x, 0.6, b.z, 0.6, 0.14);
    // red telephone kiosks: domed roof, glazed panels, lit sign
    const red = new THREE.MeshStandardMaterial({ color: 0xb00e22, roughness: 0.35, metalness: 0.2 });
    const glass = this.nightMat(new THREE.MeshStandardMaterial({ color: 0x1a2026, emissive: 0xffdca0 }), 0.9);
    this.inst(new THREE.BoxGeometry(0.94, 1.5, 0.94), glass, L.phoneBoxes, KERB + 1.3);
    for (const [ox, oz] of [[-0.44, -0.44], [0.44, -0.44], [0.44, 0.44], [-0.44, 0.44]]) this.inst(new THREE.BoxGeometry(0.12, 2.2, 0.12), red, L.phoneBoxes.map((p) => ({ x: p.x + ox, z: p.z + oz })), KERB + 1.1, true);
    this.inst(new THREE.BoxGeometry(1.0, 0.5, 1.0), red, L.phoneBoxes, KERB + 0.25);
    this.inst(new THREE.BoxGeometry(1.0, 0.28, 1.0), red, L.phoneBoxes, KERB + 2.2);
    this.inst(new THREE.SphereGeometry(0.62, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), red, L.phoneBoxes, KERB + 2.33);
    for (const o of [-0.25, 0.25]) this.inst(new THREE.BoxGeometry(0.97, 0.05, 0.97), red, L.phoneBoxes, KERB + 1.3 + o);
    for (const p of L.phoneBoxes) this.phys.fixedBox(p.x, 1.2, p.z, 0.47, 1.2, 0.47);
    // pillar boxes with a black base and cap
    this.inst(new THREE.CylinderGeometry(0.26, 0.26, 1.3, 10), red, L.postBoxes, KERB + 0.8, true);
    this.inst(new THREE.CylinderGeometry(0.29, 0.29, 0.22, 10), iron, L.postBoxes, KERB + 0.11);
    this.inst(new THREE.CylinderGeometry(0.1, 0.31, 0.2, 10), red, L.postBoxes, KERB + 1.55);
    this.inst(new THREE.BoxGeometry(0.3, 0.05, 0.02), iron, L.postBoxes.map((p) => ({ x: p.x, z: p.z + 0.26 })), KERB + 1.2);
    for (const p of L.postBoxes) this.phys.fixedCylinder(p.x, 0.75, p.z, 0.75, 0.28);
    // litter bins
    this.inst(new THREE.CylinderGeometry(0.27, 0.23, 0.95, 8), iron, L.bins, KERB + 0.48);
    this.inst(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0xb8982a, roughness: 0.5 }), L.bins, KERB + 0.86);
    for (const p of L.bins) this.phys.fixedCylinder(p.x, 0.5, p.z, 0.5, 0.3);

    // street nameplates on two short posts
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    const plate = new THREE.PlaneGeometry(1.7, 0.42), post = new THREE.BoxGeometry(0.06, 0.95, 0.06);
    for (const s of L.signs) {
      if (!cache.has(s.name)) { const t = streetSignTexture(s.name); cache.set(s.name, new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.14 })); }
      const grp = new THREE.Group(); grp.position.set(s.x, KERB, s.z); grp.rotation.y = s.yaw;
      const p = new THREE.Mesh(plate, cache.get(s.name)!); p.position.y = 0.95; grp.add(p);
      for (const ox of [-0.75, 0.75]) { const a = new THREE.Mesh(post, iron); a.position.set(ox, 0.47, -0.02); grp.add(a); }
      g.add(grp);
    }

    // pedestrian guard railings at the busy junctions (very London; they stop cars mounting the corner)
    const railGeo = (() => { const b = new QuadBatch(); b.box(-1.2, -0.02, 1.2, 0.02, 0.98, 1.03, 1); b.box(-1.2, -0.02, 1.2, 0.02, 0.2, 0.24, 1); for (let x = -1.2; x <= 1.21; x += 0.2) b.box(x - 0.012, -0.012, x + 0.012, 0.012, 0.2, 1, 1); for (const x of [-1.2, 1.17]) b.box(x, -0.03, x + 0.05, 0.03, 0, 1.08, 1); return b.build(iron).geometry; })();
    const rails: (V2 & { yaw: number })[] = [];
    for (const cx of XS.slice(1, 4)) for (const cz of ZS.slice(1, 4)) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const k = ROAD_HALF + 0.28;
      for (const a of [12.7, 15.1]) { rails.push({ x: cx + sx * a, z: cz + sz * k, yaw: 0 }, { x: cx + sx * k, z: cz + sz * a, yaw: Math.PI / 2 }); }
      this.phys.fixedBox(cx + sx * 13.9, 0.6, cz + sz * k, 2.4, 0.5, 0.05); this.phys.fixedBox(cx + sx * k, 0.6, cz + sz * 13.9, 0.05, 0.5, 2.4);
    }
    this.inst(railGeo, iron, rails, KERB);

    // Belisha beacons at the zebra crossings
    const bel: V2[] = [];
    for (const cx of XS.slice(1, 4)) for (const cz of ZS.slice(1, 4)) bel.push({ x: cx + 7.1, z: cz + 10.6 }, { x: cx - 7.1, z: cz - 10.6 }, { x: cx + 10.6, z: cz - 7.1 }, { x: cx - 10.6, z: cz + 7.1 });
    const stripe = labelTexture('', '#fff', '#fff', 16, 64); { const c = (stripe.image as HTMLCanvasElement).getContext('2d')!; for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#0c0c0c' : '#e8e8e4'; c.fillRect(0, i * 8, 16, 8); } stripe.needsUpdate = true; }
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }), bel, KERB + 1.25);
    const amber = new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff9000, emissiveIntensity: 2 }); this.beacons.push(amber);
    this.inst(new THREE.SphereGeometry(0.19, 8, 6), amber, bel, KERB + 2.62);

    // bus shelters on the main roads
    const shelterGlass = new THREE.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.45 });
    const flag = new THREE.MeshStandardMaterial({ map: labelTexture('BUS STOP', '#fff', '#c8102e', 128, 64), roughness: 0.5, emissive: 0x220408, emissiveIntensity: 1 });
    const stops: [number, number, number][] = [[-58, -7.75, 0], [46, 7.75, Math.PI], [-142.25, -46, Math.PI / 2 + Math.PI], [-142.25, 41, -Math.PI / 2], [142.25, -41, Math.PI / 2], [142.25, 36, Math.PI / 2], [41, 82.75, Math.PI]];
    stops.forEach(([x, z, yaw], i) => {
      const grp = new THREE.Group(); grp.position.set(x, KERB, z); grp.rotation.y = yaw; g.add(grp);
      const add = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); grp.add(o); return o; };
      add(new THREE.BoxGeometry(4.4, 0.1, 1.5), iron, 0, 2.5, 0); add(new THREE.BoxGeometry(4.2, 1.9, 0.05), shelterGlass, 0, 1.3, -0.65);
      for (const px of [-2.1, 2.1]) add(new THREE.BoxGeometry(0.08, 2.5, 0.08), iron, px, 1.25, -0.65);
      add(new THREE.BoxGeometry(3, 0.08, 0.34), new THREE.MeshStandardMaterial({ color: 0xa01420, roughness: 0.6 }), -0.3, 0.5, -0.4); // perch seat
      const ad = add(new THREE.BoxGeometry(0.12, 1.9, 1.3), new THREE.MeshBasicMaterial({ map: posterTexture(i), toneMapped: false }), 2.14, 1.25, 0); (ad as THREE.Mesh).material = [ad.material as THREE.Material, ad.material as THREE.Material, iron, iron, iron, iron] as any;
      add(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), iron, -3, 1.5, 0.3); add(new THREE.BoxGeometry(0.5, 0.42, 0.05), flag, -3, 2.8, 0.3);
      this.phys.fixedBox(x - Math.sin(yaw) * 0.65, 1.2, z - Math.cos(yaw) * 0.65, Math.abs(Math.cos(yaw)) * 2.1 + 0.05, 1.2, Math.abs(Math.sin(yaw)) * 2.1 + 0.05);
      this.gfx.accents.push({ x: x + Math.cos(yaw) * 2.2, y: 1.6, z: z - Math.sin(yaw) * 2.2, colour: 0xdfe8ff, power: 26 });
      this.plane(2.6, 2.6, new THREE.MeshBasicMaterial({ map: this.busDecal ??= decalTexture('busStop'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), x + Math.sin(yaw) * 3.4, 0.016, z + Math.cos(yaw) * 3.4, yaw, true);
    });
  }
  private busDecal: THREE.Texture | null = null;

  // ---------------------------------------------------------------- clutter: the stuff that stops a street looking like a model
  private buildDressing() {
    const L = this.layout, r = mulberry32(4711);
    const bagM = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.25, metalness: 0.3, flatShading: true });
    const boxM = new THREE.MeshStandardMaterial({ color: 0x6e5636, roughness: 1 });
    const binM = new THREE.MeshStandardMaterial({ color: 0x14301e, roughness: 0.6 }), lidM = new THREE.MeshStandardMaterial({ color: 0x0a1a10, roughness: 0.6 });
    const bags: any[] = [], boxes: any[] = [], wheelies: any[] = [], boards: any[] = [], cabinets: any[] = [], cones: any[] = [];
    const pile = (x: number, z: number, n: number) => { for (let i = 0; i < n; i++) { const a = r() * 6.28, d = r() * 0.7; if (r() < 0.72) bags.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, yaw: r() * 6, s: 0.8 + r() * 0.6, y: KERB + 0.24 }); else boxes.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, yaw: r() * 6, s: 0.7 + r() * 0.7, y: KERB + 0.2 }); } };
    for (const a of L.alleys) { // alleys: wheelie bins, sacks and boxes against the walls
      const vertical = a.z1 - a.z0 > a.x1 - a.x0, len = vertical ? a.z1 - a.z0 : a.x1 - a.x0, wide = Math.min(a.x1 - a.x0, a.z1 - a.z0) >= 6;
      for (let t = 5; t < len - 4; t += wide ? 13 : 7) {
        const side = r() < 0.5 ? 0.55 : -0.55, off = ((vertical ? a.x1 - a.x0 : a.z1 - a.z0) / 2 - 0.5) * (side > 0 ? 1 : -1);
        const x = vertical ? (a.x0 + a.x1) / 2 + off : a.x0 + t, z = vertical ? a.z0 + t : (a.z0 + a.z1) / 2 + off;
        if (r() < 0.6 && !wide) { wheelies.push({ x, z, yaw: vertical ? 0 : Math.PI / 2 }); this.phys.fixedBox(x, 0.6, z, 0.34, 0.6, 0.34); }
        pile(x + (vertical ? 0 : 1.2), z + (vertical ? 1.2 : 0), 2 + Math.floor(r() * 4));
      }
    }
    for (const l of L.lamps) if (r() < 0.2) pile(l.x + 0.7, l.z + 0.5, 2 + Math.floor(r() * 3)); // tomorrow's collection, by the lamp posts
    for (const b of L.buildings) { // A-boards and BT-style cabinets on the pavement
      if (b.kind || r() > 0.2) continue;
      const south = isFinite(b.z1) && !this.inSolid((b.x0 + b.x1) / 2, b.z1 + 2);
      if (south && Math.abs(b.z1) < 150) boards.push({ x: b.x0 + 2 + r() * (b.x1 - b.x0 - 4), z: b.z1 + 1.1, yaw: r() * 0.4 - 0.2 });
      else if (!this.inSolid(b.x1 + 2, (b.z0 + b.z1) / 2) && Math.abs(b.x1) < 150) cabinets.push({ x: b.x1 + 0.35, z: b.z0 + 2 + r() * (b.z1 - b.z0 - 4), yaw: Math.PI / 2 });
    }
    for (const [x, z] of [[108.6, -84.3], [110, -83.6], [116.2, -84.3], [115, -83.5], [112.5, -86.5]]) cones.push({ x, z }); // site gate
    this.inst(new THREE.IcosahedronGeometry(0.34, 0).scale(1, 0.75, 1), bagM, bags, 0);
    this.inst(new THREE.BoxGeometry(0.55, 0.4, 0.45), boxM, boxes, 0);
    this.inst(new THREE.BoxGeometry(0.62, 1.0, 0.7), binM, wheelies, KERB + 0.56); this.inst(new THREE.BoxGeometry(0.68, 0.08, 0.76), lidM, wheelies, KERB + 1.1);
    const ab = this.inst(new THREE.BoxGeometry(0.6, 0.95, 0.42), new THREE.MeshStandardMaterial({ map: labelTexture('OPEN LATE', '#ffe14a', '#101010', 64, 96), roughness: 0.8 }), boards, KERB + 0.48); ab.castShadow = true;
    this.inst(new THREE.BoxGeometry(1.1, 1.25, 0.4), new THREE.MeshStandardMaterial({ color: 0x1c3a2a, roughness: 0.6 }), cabinets, KERB + 0.63);
    const coneM = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.6, emissive: 0x401000 });
    this.inst(new THREE.ConeGeometry(0.17, 0.62, 8), coneM, cones, KERB + 0.31); this.inst(new THREE.BoxGeometry(0.4, 0.04, 0.4), coneM, cones, KERB + 0.02);
    // café tables under the awnings on Old Compton Street and Gerrard Street
    const steelM = new THREE.MeshStandardMaterial({ color: 0x9a9ea4, roughness: 0.3, metalness: 0.9 });
    const tables: V2[] = [{ x: 44, z: -83.3 }, { x: 47.5, z: -83.3 }, { x: -50, z: -8.5 }, { x: -46.5, z: -8.5 }, { x: 34, z: 39.6 }, { x: 41.5, z: 39.6 }, { x: 28, z: 35.3 }];
    this.inst(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 10), steelM, tables, KERB + 0.74); this.inst(new THREE.CylinderGeometry(0.04, 0.2, 0.74, 6), steelM, tables, KERB + 0.37);
    this.inst(new THREE.BoxGeometry(0.38, 0.46, 0.38), steelM, tables.flatMap((t) => [{ x: t.x - 0.75, z: t.z }, { x: t.x + 0.75, z: t.z }]), KERB + 0.23);
    for (const t of tables) this.phys.fixedCylinder(t.x, 0.5, t.z, 0.4, 0.36);
    // an evening-paper stand at each station
    for (const id of ['tube_picc', 'tube_leic']) { const p = L.poi(id); const st = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.6), new THREE.MeshStandardMaterial({ map: labelTexture('EVENING DISPATCH', '#111', '#f2efe4', 256, 96), roughness: 0.8 })); st.position.set(p.x - 2.6, KERB + 0.6, p.z - 0.6); this.group.add(st); }
  }

  // ---------------------------------------------------------------- road paint
  private buildMarkings() {
    const white = new QuadBatch(), yellow = new QuadBatch(), y = 0.014;
    const J = 12.5; // junction half-size kept free of lane markings
    for (let s = 0; s < 5; s++) for (let k = 0; k < 4; k++) {
      const a0 = XS[k] + J, a1 = XS[k + 1] - J;
      for (let t = a0; t < a1 - 1; t += 6) { white.top(t, ZS[s] - 0.07, t + 3, ZS[s] + 0.07, y); white.top(XS[s] - 0.07, t, XS[s] + 0.07, t + 3, y); }
      for (const o of [ROAD_HALF - 0.35, ROAD_HALF - 0.6]) for (const sg of [-1, 1]) {
        yellow.top(a0 - 2, ZS[s] + sg * o - 0.05, a1 + 2, ZS[s] + sg * o + 0.05, y); yellow.top(XS[s] + sg * o - 0.05, a0 - 2, XS[s] + sg * o + 0.05, a1 + 2, y);
      }
    }
    const lookR = decalTexture('lookRight'), lookL = decalTexture('lookLeft'), box = decalTexture('box'), man = decalTexture('manhole');
    const dm = (t: THREE.Texture, o = 0.9) => new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mR = dm(lookR, 0.75), mL = dm(lookL, 0.75), mBox = dm(box, 0.8), mMan = dm(man, 1);
    const r = mulberry32(606);
    for (const cx of XS) for (const cz of ZS) {
      const inner = Math.abs(cx) < 150 && Math.abs(cz) < 150;
      for (const sg of [-1, 1]) {
        const c = 8.4 * sg, okX = Math.abs(cx + c + sg * 3) < XS[4] + ROAD_HALF, okZ = Math.abs(cz + c + sg * 3) < ZS[4] + ROAD_HALF;
        for (let t = -ROAD_HALF + 0.5; t < ROAD_HALF - 0.4; t += 1.1) {
          if (okX) white.top(cx + c - 1.4, cz + t, cx + c + 1.4, cz + t + 0.55, y); // zebra across the E-W arm
          if (okZ) white.top(cx + t, cz + c - 1.4, cx + t + 0.55, cz + c + 1.4, y);
        }
        // give-way line for the left-hand lane of each arm, and LOOK RIGHT / LOOK LEFT for people stepping off the kerb
        if (okX) { white.top(cx + sg * 11.0, cz + (sg > 0 ? 0.15 : -ROAD_HALF + 0.9), cx + sg * 11.0 + 0.3, cz + (sg > 0 ? ROAD_HALF - 0.9 : -0.15), y);
          if (inner) { this.plane(1.5, 1.5, mR, cx + c, y + 0.004, cz - sg * 4.9, sg > 0 ? Math.PI : 0, true); this.plane(1.5, 1.5, mL, cx + c, y + 0.004, cz + sg * 1.5, sg > 0 ? Math.PI : 0, true); } }
        if (okZ) white.top(cx + (sg > 0 ? -ROAD_HALF + 0.9 : 0.15), cz + sg * 11.0, cx + (sg > 0 ? -0.15 : ROAD_HALF - 0.9), cz + sg * 11.0 + 0.3, y);
      }
      if (inner && (cx === 0 || cz === 0)) this.plane(11, 11, mBox, cx, y + 0.002, cz, 0, true); // yellow box junctions on the two main roads
      for (let k = 0; k < 3; k++) this.plane(0.8, 0.8, mMan, cx + (r() - 0.5) * 60, y + 0.003, cz + (r() < 0.5 ? -1 : 1) * (1.5 + r() * 3.5), 0, true);
    }
    const wm = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ym = new THREE.MeshStandardMaterial({ color: 0xb8961a, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const a = white.build(wm), b = yellow.build(ym); a.receiveShadow = b.receiveShadow = true;
    this.group.add(a, b);
  }
}
