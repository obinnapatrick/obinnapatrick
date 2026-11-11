// Turns the pure Layout into meshes + static colliders, and answers spatial queries for AI.
import * as THREE from 'three';
import { Physics, GR_PAVE, GR_STATIC } from '../physics/Physics';
import { Renderer } from '../render/Renderer';
import { QuadBatch } from '../render/Batch';
import { asphaltTexture, billboardTexture, facadeTexture, glowTexture, labelTexture, neonTexture, pavingTexture, shopfrontTexture, streetSignTexture } from '../render/textures';
import { V2, mulberry32, pushOutOfRect, rectContains } from '../core/util';
import { Building, KERB, Layout, ROAD_HALF, WORLD_HALF, XS, ZS, generateLayout, lineClear } from './layout';
import { NavGraph, RoadGraph } from './graphs';

const SHOP_H = 3.6;
const NEON_WORDS: [string, string][] = [['OPEN', '#ff4d6d'], ['BAR', '#7df3ff'], ['NOODLES', '#ffd04a'], ['LIVE JAZZ', '#c58bff'], ['24 HR', '#6dff9c'], ['COCKTAILS', '#ff8ad0'], ['TATTOO', '#ff5a3a'], ['KARAOKE', '#7df3ff']];

export class City {
  layout: Layout = generateLayout();
  nav = new NavGraph(this.layout);
  roads = new RoadGraph();
  group = new THREE.Group();
  private screens: THREE.MeshBasicMaterial[] = [];
  private ads: THREE.Texture[] = [];
  private adTimer = 0; private adFrame = 0;
  private beacons: THREE.MeshStandardMaterial[] = [];

  constructor(private phys: Physics, private gfx: Renderer) {
    gfx.scene.add(this.group);
    this.buildGround(); this.buildBuildings(); this.buildLandmarks(); this.buildFurniture(); this.buildMarkings();
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
    if (this.adTimer > 5) { this.adTimer = 0; this.adFrame++; this.screens.forEach((m, i) => { m.map = this.ads[(this.adFrame + i) % this.ads.length]; }); }
    const blink = Math.floor(performance.now() / 600) % 2;
    for (const b of this.beacons) b.emissiveIntensity = blink ? 2.2 : 0.3;
  }

  // ---------------------------------------------------------------- construction
  private nightMat(mat: THREE.MeshStandardMaterial, base: number) { mat.emissiveIntensity = base; this.gfx.nightMaterials.push({ mat, base, prop: 'emissiveIntensity' }); return mat; }

  private buildGround() {
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.3, metalness: 0.25, envMapIntensity: 1.6 });
    this.gfx.wetMaterials.push({ mat: asphalt, dry: 0.85, wet: 0.22 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2), asphalt);
    road.rotation.x = -Math.PI / 2; road.receiveShadow = true; this.group.add(road);
    this.phys.fixedBox(0, -1, 0, WORLD_HALF + 20, 1, WORLD_HALF + 20);
    // invisible outer walls in case anything squeezes past the terraces
    for (const [x, z, hx, hz] of [[0, -WORLD_HALF - 1, WORLD_HALF, 1], [0, WORLD_HALF + 1, WORLD_HALF, 1], [-WORLD_HALF - 1, 0, 1, WORLD_HALF], [WORLD_HALF + 1, 0, 1, WORLD_HALF]]) this.phys.fixedBox(x, 10, z, hx, 10, hz);
    const paving = new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.55, metalness: 0.05 });
    this.gfx.wetMaterials.push({ mat: paving, dry: 0.9, wet: 0.45 });
    const pb = new QuadBatch();
    for (const s of this.layout.slabs) {
      pb.box(s.x0, s.z0, s.x1, s.z1, 0, KERB, 2.4);
      this.phys.fixedBox((s.x0 + s.x1) / 2, KERB / 2, (s.z0 + s.z1) / 2, (s.x1 - s.x0) / 2, KERB / 2, (s.z1 - s.z0) / 2, GR_PAVE);
    }
    const pm = pb.build(paving); pm.receiveShadow = true; this.group.add(pm);
  }

  private buildBuildings() {
    const L = this.layout, r = mulberry32(88);
    const styles = [0, 1, 2, 3, 4, 5].map((i) => facadeTexture(i));
    const walls = styles.map(() => new QuadBatch());
    const plain = new QuadBatch(), roofs = new QuadBatch(), bases = new QuadBatch(), steel = new QuadBatch();
    const shopGeo = new Map<string, THREE.PlaneGeometry>();
    const outsideFree = (x: number, z: number, self: Building) => Math.abs(x) < WORLD_HALF - 1 && Math.abs(z) < WORLD_HALF - 1 && !L.buildings.some((b) => b !== self && rectContains(b, x, z));
    const inNarrowAlley = (x: number, z: number) => L.alleys.some((a) => rectContains(a, x, z) && Math.min(a.x1 - a.x0, a.z1 - a.z0) < 6);
    let neon = 0;

    for (const b of L.buildings) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      this.phys.fixedBox((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2, w / 2, b.h / 2, d / 2);
      if (b.kind === 'container' || b.kind === 'cabin') { steel.box(b.x0, b.z0, b.x1, b.z1, KERB, b.h, 3); continue; }
      if (b.kind === 'frame') { // unfinished concrete frame: floor plates + columns
        for (let y = 3.4; y <= b.h; y += 3.4) plain.box(b.x0, b.z0, b.x1, b.z1, y - 0.3, y, 4);
        for (const cx of [b.x0, (b.x0 + b.x1) / 2 - 0.3, b.x1 - 0.6]) for (const cz of [b.z0, (b.z0 + b.z1) / 2 - 0.3, b.z1 - 0.6]) plain.box(cx, cz, cx + 0.6, cz + 0.6, KERB, b.h, 4);
        continue;
      }
      const hasShop = b.kind !== 'booth';
      const y0 = KERB + (hasShop ? SHOP_H : 0);
      if (b.h > y0 + 0.5) walls[b.style % 6].boxSides(b.x0, b.z0, b.x1, b.z1, y0, b.h, 14, 13.6);
      else plain.boxSides(b.x0, b.z0, b.x1, b.z1, KERB, b.h, 4, 4);
      roofs.top(b.x0, b.z0, b.x1, b.z1, b.h, 4);
      roofs.boxSides(b.x0 - 0.15, b.z0 - 0.15, b.x1 + 0.15, b.z1 + 0.15, b.h - 0.5, b.h + 0.25, 4, 4); // cornice
      roofs.top(b.x0 - 0.15, b.z0 - 0.15, b.x1 + 0.15, b.z1 + 0.15, b.h + 0.25, 4);
      bases.boxSides(b.x0, b.z0, b.x1, b.z1, KERB, y0, 4, 4);
      // shopfront on every street-facing side
      const label = b.name ?? b.shop ?? 'To Let';
      const faces: [number, number, number, number, number][] = [ // mid x, mid z, yaw (facing out), width, -
        [(b.x0 + b.x1) / 2, b.z1, 0, w, 0], [(b.x0 + b.x1) / 2, b.z0, Math.PI, w, 0], [b.x1, (b.z0 + b.z1) / 2, Math.PI / 2, d, 0], [b.x0, (b.z0 + b.z1) / 2, -Math.PI / 2, d, 0]];
      let mat: THREE.MeshStandardMaterial | null = null;
      for (const [fx, fz, yaw, fw] of faces) {
        const ox = fx + Math.sin(yaw) * 2.2, oz = fz + Math.cos(yaw) * 2.2;
        if (fw < 5 || !outsideFree(ox, oz, b) || inNarrowAlley(ox, oz)) continue;
        if (!mat) {
          const t = shopfrontTexture(label, Math.min(fw, 18), Math.floor(r() * 1e6), b.kind ?? 'shop');
          mat = this.nightMat(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, roughness: 0.4, metalness: 0.1 }), b.kind === 'garage' || b.kind === 'lockup' ? 0.2 : 0.5);
        }
        const key = fw.toFixed(1);
        if (!shopGeo.has(key)) shopGeo.set(key, new THREE.PlaneGeometry(fw - 0.3, hasShop ? SHOP_H - 0.1 : b.h - 0.2));
        const m = new THREE.Mesh(shopGeo.get(key)!, mat);
        m.position.set(fx + Math.sin(yaw) * 0.04, KERB + (hasShop ? SHOP_H / 2 : b.h / 2), fz + Math.cos(yaw) * 0.04); m.rotation.y = yaw;
        this.group.add(m);
        // neon: theatres get a marquee, the pub a hanging sign, some shops a window sign
        if (b.kind === 'theatre') this.addNeon(b.name!.replace('The ', '').toUpperCase(), '#ffd76a', fx, 7.2, fz, yaw, Math.min(fw - 2, 14), 2.4);
        else if (b.kind === 'pub') this.addNeon('THE GILDED STAG', '#ffc46a', fx, 5.2, fz, yaw, Math.min(fw - 2, 9), 1.3);
        else if (b.kind === 'police') { this.addNeon('POLICE', '#8fc2ff', fx, 5.2, fz, yaw, 6, 1.5); }
        else if (b.kind === 'hospital') { this.addNeon('WALK-IN CENTRE', '#7dffb0', fx, 5.2, fz, yaw, 9, 1.4); }
        else if (!b.kind && r() < 0.3) { const [t, c] = NEON_WORDS[neon++ % NEON_WORDS.length]; this.addNeon(t, c, fx + (r() - 0.5) * (fw - 6), 5 + r() * 2, fz, yaw, 3.6, 0.9); }
      }
    }
    styles.forEach((s, i) => {
      if (walls[i].empty) return;
      const mat = this.nightMat(new THREE.MeshStandardMaterial({ map: s.map, emissiveMap: s.emissive, emissive: 0xffffff, roughness: 0.85 }), 1.25);
      const m = walls[i].build(mat); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
    });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x77797c, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x2f5d73, roughness: 0.6, metalness: 0.4 });
    for (const [bt, mt] of [[plain, concrete], [roofs, roofMat], [bases, baseMat], [steel, steelMat]] as const) if (!bt.empty) { const m = bt.build(mt); m.castShadow = true; m.receiveShadow = true; this.group.add(m); }

    // hoardings around the development site
    const hoard = new QuadBatch();
    for (const f of L.fences) { hoard.box(f.x0, f.z0, f.x1, f.z1, KERB, 2.8, 1); this.phys.fixedBox((f.x0 + f.x1) / 2, 1.4, (f.z0 + f.z1) / 2, Math.max(0.2, (f.x1 - f.x0) / 2), 1.4, Math.max(0.2, (f.z1 - f.z0) / 2)); }
    const ht = labelTexture('HALCYON WHARF · A NEW LONDON ADDRESS', '#e8f6ff', '#0b3f57', 512, 64); ht.wrapS = THREE.RepeatWrapping; ht.repeat.set(1 / 12, 1 / 2.8);
    this.group.add(hoard.build(new THREE.MeshStandardMaterial({ map: ht, roughness: 0.6 })));
  }

  private addNeon(text: string, colour: string, x: number, y: number, z: number, yaw: number, w: number, h: number) {
    const mat = new THREE.MeshBasicMaterial({ map: neonTexture(text, colour), transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
    this.gfx.nightMaterials.push({ mat, base: 1, prop: 'opacity' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x + Math.sin(yaw) * 0.35, y, z + Math.cos(yaw) * 0.35); m.rotation.y = yaw;
    this.group.add(m);
  }

  private buildLandmarks() {
    const L = this.layout, g = this.group;
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.7 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x4a5a50, roughness: 0.35, metalness: 0.8 });
    // --- the big corner screens
    const lights = L.buildings.find((b) => b.kind === 'lights')!;
    for (let i = 0; i < 5; i++) this.ads.push(billboardTexture(i));
    const screen = (x: number, z: number, yaw: number, w: number) => {
      const mat = new THREE.MeshBasicMaterial({ map: this.ads[this.screens.length % 5], toneMapped: false });
      this.screens.push(mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 13), mat);
      m.position.set(x + Math.sin(yaw) * 0.3, 12.5, z + Math.cos(yaw) * 0.3); m.rotation.y = yaw; g.add(m);
    };
    screen(lights.x0, (lights.z0 + lights.z1) / 2, -Math.PI / 2, 23); screen((lights.x0 + lights.x1) / 2, lights.z1, 0, 23);
    const glowL = new THREE.PointLight(0x9fc8ff, 220, 60, 1.6); glowL.position.set(lights.x0 - 8, 12, lights.z1 + 8); g.add(glowL);

    // --- memorial fountain with steps (original design; the steps are real geometry you can climb)
    const f = L.poi('circus');
    [[4.6, 0.22], [3.8, 0.44], [3.0, 0.66]].forEach(([rad, top]) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.22, 8), stone); m.position.set(f.x, KERB + top - 0.11, f.z); m.receiveShadow = true; g.add(m);
      this.phys.fixedCylinder(f.x, KERB + top - 0.11, f.z, 0.11, rad, GR_PAVE);
    });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 3.2, 8), bronze); col.position.set(f.x, KERB + 2.2, f.z); col.castShadow = true; g.add(col);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 0.8, 0.6, 12), bronze); bowl.position.set(f.x, KERB + 4, f.z); g.add(bowl);
    const fig = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.7, 6), new THREE.MeshStandardMaterial({ color: 0xbfc5c9, metalness: 0.9, roughness: 0.25 })); fig.position.set(f.x, KERB + 5.2, f.z); fig.rotation.z = 0.25; g.add(fig);
    for (const s of [-1, 1]) { const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), fig.material); wing.position.set(f.x + s * 0.45, KERB + 5.6, f.z); wing.rotation.z = s * 0.6; g.add(wing); }
    this.phys.fixedCylinder(f.x, 2.5, f.z, 2.5, 1.2);

    // --- Leicester Square: lawns, statue, trees, benches
    const lawn = new THREE.MeshStandardMaterial({ color: 0x1f3b22, roughness: 1 });
    const sq = { x: 112.5, z: 114 };
    for (const [lx, lz] of [[-13, -11], [13, -11], [-13, 13], [13, 13]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(17, 0.08, 15), lawn); m.position.set(sq.x + lx, KERB + 0.04, sq.z + lz); m.receiveShadow = true; g.add(m); }
    [[2.4, 0.2], [1.7, 0.4]].forEach(([rad, top]) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.2, 8), stone); m.position.set(sq.x, KERB + top - 0.1, sq.z); g.add(m);
      this.phys.fixedCylinder(sq.x, KERB + top - 0.1, sq.z, 0.1, rad, GR_PAVE);
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 1.4), stone); plinth.position.set(sq.x, KERB + 1.4, sq.z); plinth.castShadow = true; g.add(plinth);
    const statue = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.2, 4, 8), bronze); statue.position.set(sq.x, KERB + 3.4, sq.z); g.add(statue);
    this.phys.fixedBox(sq.x, 1.5, sq.z, 0.7, 1.5, 0.7);
    const trunkG = new THREE.CylinderGeometry(0.22, 0.3, 4, 6), leafG = new THREE.IcosahedronGeometry(2.6, 1);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 1 }), leafM = new THREE.MeshStandardMaterial({ color: 0x24452a, roughness: 1, flatShading: true });
    for (const t of L.trees) {
      const a = new THREE.Mesh(trunkG, trunkM); a.position.set(t.x, KERB + 2, t.z); a.castShadow = true;
      const b = new THREE.Mesh(leafG, leafM); b.position.set(t.x, KERB + 5.4, t.z); b.scale.y = 0.8; b.castShadow = true; g.add(a, b);
      this.phys.fixedCylinder(t.x, 2, t.z, 2, 0.3);
    }
    const benchG = new THREE.BoxGeometry(2, 0.45, 0.6), benchM = new THREE.MeshStandardMaterial({ color: 0x2c3b2a, roughness: 0.8 });
    for (const b of L.benches) { const m = new THREE.Mesh(benchG, benchM); m.position.set(b.x, KERB + 0.23, b.z); m.rotation.y = b.yaw; g.add(m); this.phys.fixedBox(b.x, 0.4, b.z, b.yaw % Math.PI === 0 ? 1 : 0.3, 0.3, b.yaw % Math.PI === 0 ? 0.3 : 1); }

    // --- Chinatown gate + lanterns along Gerrard Street
    const red = new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.5 }), green = new THREE.MeshStandardMaterial({ color: 0x1d6b4a, roughness: 0.5 }), gold = new THREE.MeshStandardMaterial({ color: 0xd9b040, roughness: 0.4, metalness: 0.6 });
    for (const z of [34.6, 40.4]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6.4, 8), red); c.position.set(12, KERB + 3.2, z); c.castShadow = true; g.add(c); this.phys.fixedCylinder(12, 3.2, z, 3.2, 0.32); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 8.2), gold); beam.position.set(12, KERB + 6.3, 37.5); g.add(beam);
    const roof1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 9.6), green); roof1.position.set(12, KERB + 7.1, 37.5); g.add(roof1);
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 5.4), green); roof2.position.set(12, KERB + 7.9, 37.5); g.add(roof2);
    const lanternMat = this.nightMat(new THREE.MeshStandardMaterial({ color: 0xd42020, emissive: 0xff3a20, roughness: 0.6 }), 1.6);
    const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), lanternMat, 44);
    const mx = new THREE.Matrix4(); let li = 0;
    for (let x = 15; x < 64; x += 4.6) for (const z of [35.2, 36.7, 38.3, 39.8]) { mx.makeTranslation(x + (z % 1), 5.2 + Math.sin(x) * 0.2, z); lanterns.setMatrixAt(li++, mx); }
    lanterns.count = li; g.add(lanterns);
    const cl = new THREE.PointLight(0xff5a3a, 80, 30, 1.8); cl.position.set(36, 5, 37.5); g.add(cl);

    // --- tower crane on the Halcyon Wharf site
    const craneM = new THREE.MeshStandardMaterial({ color: 0xd9a514, roughness: 0.6 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 34, 1.2), craneM); mast.position.set(116, 17, -128); g.add(mast);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(30, 0.9, 0.9), craneM); jib.position.set(108, 33.5, -128); g.add(jib);
    const beaconM = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 }); this.beacons.push(beaconM);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), beaconM); bc.position.set(116, 34.6, -128); g.add(bc);
    this.phys.fixedBox(116, 5, -128, 0.6, 5, 0.6);
    const sl = new THREE.PointLight(0xfff0d0, 120, 40, 1.7); sl.position.set(114, 7, -112); g.add(sl); // site floodlight

    // --- station entrances (plain "STATION" totems: no transport branding is reproduced)
    for (const id of ['tube_picc', 'tube_leic']) {
      const p = L.poi(id);
      const tot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 1.1), new THREE.MeshStandardMaterial({ map: labelTexture('STATION', '#fff', '#12224a', 256, 64), emissive: 0x223366, emissiveIntensity: 0.6 }));
      tot.position.set(p.x + 1.4, KERB + 1.7, p.z); g.add(tot);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 0.08), new THREE.MeshStandardMaterial({ color: 0x15171a })); rail.position.set(p.x, KERB + 0.5, p.z + 1.2); g.add(rail);
      const pit = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x050505 })); pit.rotation.x = -Math.PI / 2; pit.position.set(p.x, KERB + 0.02, p.z); g.add(pit);
    }
    // --- lit doorways for the three enterable interiors
    for (const id of ['pub', 'shop', 'garage']) {
      const p = L.poi(id);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.5), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false, transparent: true, opacity: 0.85 }));
      const off = id === 'garage' ? 2.42 : id === 'pub' ? 1.92 : 1.72; // distance from the POI back to the wall
      door.position.set(p.x - Math.sin(p.yaw) * off, KERB + 1.25, p.z - Math.cos(p.yaw) * off); door.rotation.y = p.yaw; g.add(door);
    }
  }

  private buildFurniture() {
    const L = this.layout, g = this.group, mx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, pts: V2[], y: number, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length));
      pts.forEach((p, i) => { mx.compose(v.set(p.x, y, p.z), q, sc); m.setMatrixAt(i, mx); });
      m.count = pts.length; m.castShadow = shadow; g.add(m); return m;
    };
    const iron = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.5, metalness: 0.6 });
    // street lamps: pole, glowing head, halo sprite and a pool of light on the wet ground
    inst(new THREE.CylinderGeometry(0.07, 0.11, 6, 6), iron, L.lamps, KERB + 3);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    this.gfx.nightMaterials.push({ mat: headMat, base: 1, prop: 'opacity' }); headMat.transparent = true;
    inst(new THREE.BoxGeometry(0.5, 0.16, 0.5), headMat, L.lamps, KERB + 6);
    const glow = glowTexture();
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(L.lamps.flatMap((l) => [l.x, KERB + 5.95, l.z]), 3));
    const haloMat = new THREE.PointsMaterial({ map: glow, color: 0xffc070, size: 5.5, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.gfx.nightMaterials.push({ mat: haloMat, base: 0.55, prop: 'opacity' });
    g.add(new THREE.Points(haloGeo, haloMat));
    const poolMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xffb060, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
    this.gfx.nightMaterials.push({ mat: poolMat, base: 0.2, prop: 'opacity' });
    const poolGeo = new THREE.PlaneGeometry(15, 15); poolGeo.rotateX(-Math.PI / 2);
    inst(poolGeo, poolMat, L.lamps, KERB + 0.03);
    for (const l of L.lamps) this.phys.fixedCylinder(l.x, 3, l.z, 3, 0.12);

    inst(new THREE.CylinderGeometry(0.11, 0.13, 1, 8), iron, L.bollards, KERB + 0.5);
    for (const b of L.bollards) this.phys.fixedCylinder(b.x, 0.6, b.z, 0.6, 0.14);
    const red = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.35, metalness: 0.2 });
    inst(new THREE.BoxGeometry(0.9, 2.4, 0.9), red, L.phoneBoxes, KERB + 1.2, true);
    const glass = this.nightMat(new THREE.MeshStandardMaterial({ color: 0x222a30, emissive: 0xffe2b0 }), 0.7);
    inst(new THREE.BoxGeometry(0.94, 1.5, 0.94).scale(1, 1, 1), glass, L.phoneBoxes.map((p) => ({ x: p.x, z: p.z })), KERB + 1.35).scale.set(1, 1, 1);
    // red frame bars over the glazing so it still reads as a phone box
    inst(new THREE.BoxGeometry(0.98, 0.14, 0.98), red, L.phoneBoxes, KERB + 2.25);
    inst(new THREE.BoxGeometry(0.98, 0.5, 0.98), red, L.phoneBoxes, KERB + 0.3);
    for (const p of L.phoneBoxes) this.phys.fixedBox(p.x, 1.2, p.z, 0.47, 1.2, 0.47);
    inst(new THREE.CylinderGeometry(0.26, 0.26, 1.45, 10), red, L.postBoxes, KERB + 0.72, true);
    for (const p of L.postBoxes) this.phys.fixedCylinder(p.x, 0.75, p.z, 0.75, 0.28);
    inst(new THREE.CylinderGeometry(0.28, 0.24, 1, 8), iron, L.bins, KERB + 0.5);
    for (const p of L.bins) this.phys.fixedCylinder(p.x, 0.5, p.z, 0.5, 0.3);

    // street nameplates on two short posts
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    const plate = new THREE.PlaneGeometry(1.7, 0.42), post = new THREE.BoxGeometry(0.06, 0.95, 0.06);
    for (const s of L.signs) {
      if (!cache.has(s.name)) cache.set(s.name, new THREE.MeshStandardMaterial({ map: streetSignTexture(s.name), roughness: 0.6, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: streetSignTexture(s.name), emissiveIntensity: 0.18 }));
      const grp = new THREE.Group(); grp.position.set(s.x, KERB, s.z); grp.rotation.y = s.yaw;
      const p = new THREE.Mesh(plate, cache.get(s.name)!); p.position.y = 0.95; grp.add(p);
      for (const ox of [-0.75, 0.75]) { const a = new THREE.Mesh(post, iron); a.position.set(ox, 0.47, -0.02); grp.add(a); }
      g.add(grp);
    }
  }

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
    // zebra crossings on every arm of every junction
    for (const cx of XS) for (const cz of ZS) for (const sg of [-1, 1]) {
      const c = 8.4 * sg;
      for (let t = -ROAD_HALF + 0.5; t < ROAD_HALF - 0.4; t += 1.1) {
        if (Math.abs(cx + c + sg * 3) < XS[4] + ROAD_HALF) white.top(cx + c - 1.4, cz + t, cx + c + 1.4, cz + t + 0.55, y); // across the E-W street arm
        if (Math.abs(cz + c + sg * 3) < ZS[4] + ROAD_HALF) white.top(cx + t, cz + c - 1.4, cx + t + 0.55, cz + c + 1.4, y);
      }
    }
    const wm = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ym = new THREE.MeshStandardMaterial({ color: 0xd8b21a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const a = white.build(wm), b = yellow.build(ym); a.receiveShadow = b.receiveShadow = true;
    this.group.add(a, b);
  }
}
