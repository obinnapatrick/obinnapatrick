// Pure data description of the playable district (no rendering imports, so it is unit-testable).
//
// The street layout is a HAND-AUTHORED, stylised approximation of the Soho / Piccadilly Circus /
// Chinatown / Leicester Square area. Street names and their rough relationships were taken from
// OpenStreetMap as a reference (© OpenStreetMap contributors, ODbL) - no OSM geometry is bundled.
// +X is east, +Z is south. Units are metres.
import { Rect, V2, mulberry32, rectContains } from '../core/util';

export const XS = [-150, -75, 0, 75, 150]; // centre lines of north-south streets
export const ZS = [-150, -75, 0, 75, 150]; // centre lines of east-west streets
export const NS_NAMES = ['Regent Street', 'Great Windmill Street', 'Wardour Street', 'Dean Street', 'Charing Cross Road'];
export const EW_NAMES = ['Broadwick Street', 'Old Compton Street', 'Shaftesbury Avenue', 'Coventry Street', 'Orange Street'];
export const ROAD_HALF = 6.5; // kerb to centre line
export const BUILD_LINE = 10; // building frontage to centre line
export const LANE = 2.3; // lane centre offset from the centre line (traffic keeps LEFT)
export const KERB = 0.15;
export const OUTER = 160; // frontage of the boundary buildings
export const WORLD_HALF = 186;
export const PARK_OFFSET = 5.35; // parked cars: offset from the centre line

export type District = 'Soho' | 'Piccadilly' | 'Chinatown' | 'Leicester Square';
export const DISTRICTS: District[] = ['Soho', 'Piccadilly', 'Chinatown', 'Leicester Square'];
export function districtAt(x: number, z: number): District {
  if (z < 0) return 'Soho';
  if (x < -75) return 'Piccadilly';
  if (x < 75) return 'Chinatown';
  return 'Leicester Square';
}
/** Which fictional crew claims this ground (see state/factions). */
export function territoryAt(x: number, z: number): 'marlowe' | 'kestrel' | null {
  if (z < 0 && x < 75) return 'marlowe';
  if (z >= 0 && x >= 0) return 'kestrel';
  return null;
}

export function isRoad(x: number, z: number): boolean {
  if (Math.abs(x) > XS[4] + ROAD_HALF || Math.abs(z) > ZS[4] + ROAD_HALF) return false;
  for (const sx of XS) if (Math.abs(x - sx) < ROAD_HALF) return true;
  for (const sz of ZS) if (Math.abs(z - sz) < ROAD_HALF) return true;
  return false;
}
export const groundHeight = (x: number, z: number) => (isRoad(x, z) ? 0 : KERB);

export function streetNameAt(x: number, z: number): string {
  let best = '', bd = 1e9;
  XS.forEach((sx, i) => { const d = Math.abs(x - sx); if (d < bd) { bd = d; best = NS_NAMES[i]; } });
  ZS.forEach((sz, j) => {
    const d = Math.abs(z - sz);
    if (d < bd) { bd = d; best = j === 1 && x < 0 ? 'Brewer Street' : EW_NAMES[j]; }
  });
  return best;
}

export interface Building extends Rect { h: number; style: number; kind?: string; name?: string; shop?: string }
export type PoiKind = 'pub' | 'shop' | 'garage' | 'office' | 'lockup' | 'site' | 'police' | 'hospital' | 'landmark' | 'tube' | 'cafe' | 'work';
export interface Poi { id: string; kind: PoiKind; name: string; x: number; z: number; yaw: number; via?: 'alley' | 'circus' | 'yard'; nx?: number; nz?: number }
export interface ParkSlot { x: number; z: number; yaw: number }
export interface StreetSign { x: number; z: number; yaw: number; name: string }
export interface Layout {
  buildings: Building[];
  fences: Rect[]; // thin solid hoardings
  solids: Rect[]; // everything NPC steering must stay out of
  slabs: Rect[]; // raised pavement / plaza slabs
  pois: Poi[];
  lamps: V2[];
  bollards: V2[];
  trees: V2[];
  benches: (V2 & { yaw: number })[];
  phoneBoxes: V2[];
  postBoxes: V2[];
  bins: V2[];
  parkSlots: ParkSlot[];
  signs: StreetSign[];
  alleys: Rect[];
  poi(id: string): Poi;
}

const SHOP_NAMES = ['Caffè Brera', 'Soho Vinyl', 'The Wardour Arms', 'Lantern House', 'Night Noodle', 'Berwick Books', 'Golden Wok',
  'Dean St Barbers', 'Kingly Tailors', 'Fish & Chips', 'West End Souvenirs', 'Bar Cicala', 'Indigo Jazz Rooms', 'Kebab Palace',
  '24hr Pharmacy', 'Bureau de Change', 'Bubble Tea Lab', 'Circus Gifts', 'Ink & Iron Tattoo', 'The Coach & Lamp', 'Dumpling Yard',
  'Late Licence Bar', 'Meard St Deli', 'Vape & Phone', 'Bookmakers', 'The Blue Posts Tavern', 'Peking Duck House', 'Neon Arcade'];
const THEATRES = ['The Corinthian Theatre', 'Palladian Playhouse', 'The Empire Rooms'];

export function generateLayout(seed = 1904): Layout {
  const r = mulberry32(seed);
  const buildings: Building[] = [];
  const fences: Rect[] = [];
  const pois: Poi[] = [];
  const alleys: Rect[] = [];
  const bollards: V2[] = [], trees: V2[] = [], benches: (V2 & { yaw: number })[] = [];
  const phoneBoxes: V2[] = [], postBoxes: V2[] = [], bins: V2[] = [];
  let shopIdx = 0, theatreIdx = 0;

  const add = (x0: number, z0: number, x1: number, z1: number, o: Partial<Building> = {}) => {
    const b: Building = { x0, z0, x1, z1, h: 11 + Math.floor(r() * 5) * 3.4, style: Math.floor(r() * 6), ...o };
    if (!b.kind && !b.shop) {
      const wide = Math.max(x1 - x0, z1 - z0) >= 17;
      if (wide && theatreIdx < THEATRES.length && Math.abs(z1 - -BUILD_LINE) < 0.1 && r() < 0.6) { b.kind = 'theatre'; b.name = THEATRES[theatreIdx++]; b.h = 21; }
      else b.shop = SHOP_NAMES[shopIdx++ % SHOP_NAMES.length];
    }
    buildings.push(b);
    return b;
  };
  /** Fill a rectangle with terraced lots (2 rows when deep). */
  const fill = (x0: number, z0: number, x1: number, z1: number) => {
    const w = x1 - x0, d = z1 - z0;
    if (w < 1 || d < 1) return;
    const alongX = w >= d;
    const len = alongX ? w : d, depth = alongX ? d : w;
    const rows = depth > 34 ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      let t = 0;
      while (t < len - 0.01) {
        let seg = 12 + r() * 10;
        if (len - t - seg < 10) seg = len - t;
        const a0 = t, a1 = t + seg, b0 = (depth / rows) * row, b1 = (depth / rows) * (row + 1);
        if (alongX) add(x0 + a0, z0 + b0, x0 + a1, z0 + b1); else add(x0 + b0, z0 + a0, x0 + b1, z0 + a1);
        t += seg;
      }
    }
  };
  const poi = (id: string, kind: PoiKind, name: string, x: number, z: number, yaw: number, extra: Partial<Poi> = {}) => pois.push({ id, kind, name, x, z, yaw, ...extra });

  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x0 = XS[i] + BUILD_LINE, x1 = XS[i + 1] - BUILD_LINE, z0 = ZS[j] + BUILD_LINE, z1 = ZS[j + 1] - BUILD_LINE;
    const key = `${i},${j}`;
    if (key === '0,2') { // Piccadilly: the illuminated corner
      add(-140, 10, -115, 40);
      add(-140, 40, -115, 65, { kind: 'lights', name: 'Circus Lights', h: 24, style: 1 });
      add(-115, 10, -85, 37); add(-115, 37, -85, 65);
    } else if (key === '0,3') { // fountain plaza on the circus
      add(-112, 85, -85, 113); add(-140, 113, -112, 140); add(-112, 113, -85, 140);
      poi('circus', 'landmark', 'Piccadilly Circus fountain', -126, 99, 0, { nx: -134, nz: 91 });
      poi('tube_picc', 'tube', 'Piccadilly Circus station', -116, 109.5, Math.PI, { via: 'circus' });
      for (let k = 0; k < 7; k++) { bollards.push({ x: -139.5 + k * 4.4, z: 85.6 }); bollards.push({ x: -139.4, z: 86 + k * 4.4 }); }
      phoneBoxes.push({ x: -113.5, z: 87.5 }, { x: -113.5, z: 89.3 });
    } else if (key === '2,2') { // Chinatown: pedestrianised Gerrard Street runs through the block
      fill(10, 10, 65, 34); fill(10, 41, 65, 65);
      alleys.push({ x0: 10, z0: 34, x1: 65, z1: 41 });
      poi('gate', 'landmark', 'Chinatown Gate', 12, 37.5, -Math.PI / 2, { via: 'alley' });
      poi('cafe_gerrard', 'cafe', 'Gerrard Street noodle bar', 38, 39.6, Math.PI, { via: 'alley' });
    } else if (key === '1,1') { // The Gilded Stag and the alley behind it
      fill(-65, -65, -40, -10);
      add(-35, -65, -10, -45, { kind: 'pub', name: 'The Gilded Stag', h: 11, style: 4 });
      fill(-35, -45, -10, -10);
      alleys.push({ x0: -40, z0: -65, x1: -35, z1: -10 });
      poi('pub', 'pub', 'The Gilded Stag', -22.5, -67, Math.PI);
      poi('alley', 'landmark', 'Stag Passage', -37.5, -40, 0, { via: 'alley' });
    } else if (key === '0,1') { // Brewer Street Motors with a forecourt
      add(-140, -65, -125, -10); add(-100, -65, -85, -10);
      add(-125, -48, -100, -30, { kind: 'garage', name: 'Brewer Street Motors', h: 7.5, style: 5 });
      add(-125, -30, -100, -10);
      poi('garage', 'garage', 'Brewer Street Motors', -112.5, -50.5, Math.PI, { nx: -112.5, nz: -66.7 });
      poi('garage_bay', 'landmark', 'Garage forecourt', -112.5, -58.5, Math.PI / 2, { nx: -112.5, nz: -66.7 });
    } else if (key === '3,0') { // Halcyon Wharf development site
      const g0 = 107, g1 = 118;
      fences.push({ x0: 85, z0: -140, x1: 140, z1: -139.6 }, { x0: 85, z0: -140, x1: 85.4, z1: -85 }, { x0: 139.6, z0: -140, x1: 140, z1: -85 },
        { x0: 85, z0: -85.4, x1: g0, z1: -85 }, { x0: g1, z0: -85.4, x1: 140, z1: -85 });
      add(121, -136, 135, -128, { kind: 'cabin', name: 'Halcyon Wharf Site Office', h: 3.2, style: 5 });
      add(90, -136, 110, -118, { kind: 'frame', name: 'Halcyon Wharf', h: 17, style: 5 });
      add(90, -108, 96, -96, { kind: 'container', h: 2.8, style: 5 }); add(128, -112, 134, -100, { kind: 'container', h: 2.8, style: 5 });
      add(100, -100, 103, -94, { kind: 'container', h: 2.6, style: 5 });
      poi('site', 'site', 'Halcyon Wharf site gate', 112.5, -82.5, 0);
      poi('site_yard', 'landmark', 'Halcyon Wharf yard', 114, -112, 0, { via: 'yard' });
    } else if (key === '3,3') { // Leicester Square gardens
      add(88, 117, 94, 124, { kind: 'booth', name: 'Half-Price Tickets', h: 3.6, style: 2 });
      poi('square', 'landmark', 'Leicester Square', 112.5, 106, 0);
      poi('tube_leic', 'tube', 'Leicester Square station', 88, 136, 0);
      for (let k = 0; k <= 12; k++) {
        const t = 85.5 + k * 4.5;
        bollards.push({ x: t, z: 85.6 }, { x: t, z: 139.4 }, { x: 85.6, z: t }, { x: 139.4, z: t });
      }
      for (const [tx, tz] of [[98, 106], [127, 98], [127, 127], [98, 127], [112.5, 92], [112.5, 133], [133, 112.5]]) trees.push({ x: tx, z: tz });
      benches.push({ x: 105, z: 112.5, yaw: Math.PI / 2 }, { x: 120, z: 112.5, yaw: -Math.PI / 2 }, { x: 112.5, z: 105, yaw: 0 }, { x: 112.5, z: 120, yaw: Math.PI });
      phoneBoxes.push({ x: 136, z: 88 });
    } else if (key === '3,2') { // the Kestrels' lock-up, facing Leicester Square
      fill(85, 10, 140, 45); add(85, 45, 100, 65); add(125, 45, 140, 65);
      add(100, 45, 125, 65, { kind: 'lockup', name: 'Kestrel Couriers', h: 8, style: 5 });
      poi('lockup', 'lockup', 'Kestrel Couriers lock-up', 112.5, 67, 0);
    } else if (key === '1,2') { // Night Owl Cars minicab office on Wardour Street
      fill(-65, 10, -28, 65); add(-28, 10, -10, 28); add(-28, 46, -10, 65);
      add(-28, 28, -10, 46, { kind: 'office', name: 'Night Owl Cars', h: 11, style: 3 });
      poi('office', 'office', 'Night Owl Cars', -8.2, 37, Math.PI / 2);
    } else if (key === '2,1') { // corner shop on Shaftesbury Avenue
      fill(10, -65, 65, -28);
      add(10, -28, 26, -10, { kind: 'shop', name: 'Wardour Food & Wine', h: 11, style: 0 });
      fill(26, -28, 65, -10);
      poi('shop', 'shop', 'Wardour Food & Wine', 18, -8.2, 0);
    } else if (key === '1,3') {
      fill(x0, z0, x1, 110); fill(x0, 114.5, x1, z1);
      alleys.push({ x0, z0: 110, x1, z1: 114.5 });
    } else if (key === '2,0') {
      fill(x0, z0, 35, z1); fill(39.5, z0, x1, z1);
      alleys.push({ x0: 35, z0, x1: 39.5, z1 });
    } else fill(x0, z0, x1, z1);
  }

  // Boundary terraces enclosing the district.
  const ring = (horizontal: boolean, sign: number) => {
    let t = -WORLD_HALF;
    while (t < WORLD_HALF - 0.01) {
      let seg = 16 + r() * 14;
      if (WORLD_HALF - t - seg < 12) seg = WORLD_HALF - t;
      const a0 = t, a1 = t + seg, b0 = sign > 0 ? OUTER : -WORLD_HALF, b1 = sign > 0 ? WORLD_HALF : -OUTER;
      const o: Partial<Building> = { h: 14 + Math.floor(r() * 5) * 3.4 };
      if (!horizontal && sign > 0 && a0 < 5 && a1 > 5) { o.kind = 'police'; o.name = 'Charing Cross Road Police Station'; o.style = 2; }
      if (horizontal && sign < 0 && a0 < 0 && a1 > 0) { o.kind = 'hospital'; o.name = 'Soho Walk-in Centre'; o.style = 2; }
      if (horizontal) add(a0, b0, a1, b1, o); else add(b0, a0, b1, a1, o);
      t += seg;
    }
  };
  ring(true, -1); ring(true, 1); ring(false, -1); ring(false, 1);
  poi('police', 'police', 'Charing Cross Road Police Station', 158.2, 5, -Math.PI / 2);
  poi('hospital', 'hospital', 'Soho Walk-in Centre', 0, -158.2, 0);

  // Workplaces and cafés used by NPC daily schedules.
  poi('work_a', 'work', 'Golden Square offices', -110, -141.8, 0);
  poi('work_b', 'work', 'Shaftesbury House', 40, 8.2, Math.PI);
  poi('work_c', 'work', 'Regent Chambers', -141.8, -30, Math.PI / 2);
  poi('cafe_a', 'cafe', 'Caffè Brera', -50, -8.2, 0);
  poi('cafe_b', 'cafe', 'Meard St Deli', 45, -83.2, 0);

  // Pavement slabs: one per block plus the outer ring.
  const slabs: Rect[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    slabs.push({ x0: XS[i] + ROAD_HALF, z0: ZS[j] + ROAD_HALF, x1: XS[i + 1] - ROAD_HALF, z1: ZS[j + 1] - ROAD_HALF });
  const E = XS[4] + ROAD_HALF, W = WORLD_HALF;
  slabs.push({ x0: -W, z0: -W, x1: W, z1: -E }, { x0: -W, z0: E, x1: W, z1: W }, { x0: -W, z0: -E, x1: -E, z1: E }, { x0: E, z0: -E, x1: W, z1: E });

  // Street furniture along every road segment.
  const lamps: V2[] = [], parkSlots: ParkSlot[] = [], signs: StreetSign[] = [];
  for (let s = 0; s < 5; s++) for (let k = 0; k < 4; k++) {
    const a = XS[k], c = XS[s];
    for (const [t, side] of [[20, 1], [55, -1], [37.5, 1], [37.5, -1]] as const) {
      if (t === 37.5 && (s + k) % 2) continue;
      lamps.push({ x: a + t, z: ZS[s] + side * 7.3 }); // along E-W street s
      lamps.push({ x: c + side * 7.3, z: ZS[k] + t }); // along N-S street s
    }
    for (let t = 17; t <= 58; t += 6.8) {
      // eastbound traffic keeps to the north side (left of travel), westbound to the south side
      if (r() < 0.2) parkSlots.push({ x: a + t, z: ZS[s] - PARK_OFFSET, yaw: Math.PI / 2 });
      if (r() < 0.2) parkSlots.push({ x: a + t, z: ZS[s] + PARK_OFFSET, yaw: -Math.PI / 2 });
      if (r() < 0.2) parkSlots.push({ x: c + PARK_OFFSET, z: ZS[k] + t, yaw: 0 });
      if (r() < 0.2) parkSlots.push({ x: c - PARK_OFFSET, z: ZS[k] + t, yaw: Math.PI });
    }
    if (r() < 0.5) bins.push({ x: a + 30 + r() * 15, z: ZS[s] + 7.6 });
    if (r() < 0.25) postBoxes.push({ x: c - 7.6, z: ZS[k] + 28 + r() * 20 });
    if (r() < 0.2) phoneBoxes.push({ x: c + 8.6, z: ZS[k] + 14 + r() * 8 });
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    // low Westminster-style nameplates at two corners of each block
    signs.push({ x: XS[i] + 12.5, z: ZS[j] + 7.4, yaw: Math.PI, name: j === 1 && i < 2 ? 'Brewer Street' : EW_NAMES[j] });
    signs.push({ x: XS[i] + 7.4, z: ZS[j] + 12.5, yaw: -Math.PI / 2, name: NS_NAMES[i] });
    signs.push({ x: XS[i + 1] - 12.5, z: ZS[j + 1] - 7.4, yaw: 0, name: j + 1 === 1 && i < 2 ? 'Brewer Street' : EW_NAMES[j + 1] });
    signs.push({ x: XS[i + 1] - 7.4, z: ZS[j + 1] - 12.5, yaw: Math.PI / 2, name: NS_NAMES[i + 1] });
  }
  // keep parked cars away from mission-critical kerbs
  const keepClear: Rect[] = [{ x0: -12, z0: 20, x1: 0, z1: 50 }, { x0: -130, z0: -82, x1: -95, z1: -68 }, { x0: 100, z0: 68, x1: 125, z1: 82 }, { x0: 104, z0: -82, x1: 121, z1: -68 }, { x0: -35, z0: -82, x1: -10, z1: -68 }];
  const slots = parkSlots.filter((s) => !keepClear.some((k) => rectContains(k, s.x, s.z)));

  const lampsClear = lamps.filter((l) => !alleys.some((al) => rectContains(al, l.x, l.z, 4.5)) && !(Math.abs(l.x - 112.5) < 6 && l.z < -70 && l.z > -90));
  const solids: Rect[] = [...buildings, ...fences];
  const layout: Layout = {
    buildings, fences, solids, slabs, pois, lamps: lampsClear, bollards, trees, benches, phoneBoxes, postBoxes, bins, parkSlots: slots, signs, alleys,
    poi(id: string) { const p = pois.find((q) => q.id === id); if (!p) throw new Error('Unknown POI ' + id); return p; },
  };
  return layout;
}

/** Is the straight line between two points free of buildings/fences? (2D check) */
export function lineClear(layout: Layout, ax: number, az: number, bx: number, bz: number): boolean {
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
  for (const s of layout.solids) {
    if (s.x1 < minX || s.x0 > maxX || s.z1 < minZ || s.z0 > maxZ) continue;
    const dx = bx - ax, dz = bz - az;
    // inline slab test
    let t0 = 0, t1 = 1, ok = true;
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    ok = clip(-dx, ax - s.x0) && clip(dx, s.x1 - ax) && clip(-dz, az - s.z0) && clip(dz, s.z1 - az) && t0 <= t1;
    if (ok) return false;
  }
  return true;
}
