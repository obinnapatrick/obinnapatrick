// Small dependency-free maths helpers shared by simulation code (and unit tests).
export interface V2 { x: number; z: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Convention: yaw 0 faces +Z (south); forward = (sin yaw, 0, cos yaw); left = (cos yaw, 0, -sin yaw). */
export const fwdX = (yaw: number) => Math.sin(yaw);
export const fwdZ = (yaw: number) => Math.cos(yaw);
export const leftX = (yaw: number) => Math.cos(yaw);
export const leftZ = (yaw: number) => -Math.sin(yaw);
export const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const dampAngle = (a: number, b: number, lambda: number, dt: number) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(arr: readonly T[], r: () => number = Math.random): T => arr[Math.floor(r() * arr.length) % arr.length];
export const rand = (a: number, b: number, r: () => number = Math.random) => a + (b - a) * r();

export const rectContains = (r: Rect, x: number, z: number, pad = 0) =>
  x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

/** 2D segment vs axis-aligned rectangle (slab test). Used for cheap line-of-sight checks. */
export function segHitsRect(ax: number, az: number, bx: number, bz: number, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, ax - r.x0) && clip(dx, r.x1 - ax) && clip(-dz, az - r.z0) && clip(dz, r.z1 - az) && t0 <= t1;
}

/** Push a circle out of a rectangle. Returns true if it was overlapping. */
export function pushOutOfRect(p: V2, r: Rect, radius: number): boolean {
  const cx = clamp(p.x, r.x0, r.x1), cz = clamp(p.z, r.z0, r.z1);
  let dx = p.x - cx, dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * radius; p.z = cz + (dz / d) * radius;
    return true;
  }
  // centre is inside: exit through the nearest face
  const l = p.x - r.x0, rr = r.x1 - p.x, t = p.z - r.z0, b = r.z1 - p.z;
  const m = Math.min(l, rr, t, b);
  if (m === l) p.x = r.x0 - radius; else if (m === rr) p.x = r.x1 + radius;
  else if (m === t) p.z = r.z0 - radius; else p.z = r.z1 + radius;
  return true;
}

/** Is a point inside an oriented box (centre c, yaw, half extents)? Returns local coords when inside. */
export function pointInObb(px: number, pz: number, cx: number, cz: number, yaw: number, hw: number, hl: number, pad = 0): { lx: number; lz: number } | null {
  const dx = px - cx, dz = pz - cz;
  const lz = dx * fwdX(yaw) + dz * fwdZ(yaw);
  const lx = dx * leftX(yaw) + dz * leftZ(yaw);
  return Math.abs(lx) < hw + pad && Math.abs(lz) < hl + pad ? { lx, lz } : null;
}

export const fmtMoney = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
export const fmtClock = (minutes: number) => {
  const m = Math.floor(minutes) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
