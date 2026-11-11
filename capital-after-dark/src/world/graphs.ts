// Road graph (vehicles, left-hand traffic) and pavement graph (pedestrians). Pure logic.
import { V2, dist2, leftX, leftZ, yawTo } from '../core/util';
import { XS, ZS, LANE, ROAD_HALF, Layout, lineClear } from './layout';

export interface GNode extends V2 { id: number; links: number[]; tag?: string }

function astar(nodes: GNode[], from: number, to: number): number[] {
  if (from === to) return [from];
  const open = new Set<number>([from]);
  const came = new Map<number, number>();
  const g = new Map<number, number>([[from, 0]]);
  const h = (n: number) => dist2(nodes[n].x, nodes[n].z, nodes[to].x, nodes[to].z);
  const f = new Map<number, number>([[from, h(from)]]);
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const n of open) { const v = f.get(n)!; if (v < best) { best = v; cur = n; } }
    if (cur === to) {
      const path = [cur];
      while (came.has(cur)) { cur = came.get(cur)!; path.unshift(cur); }
      return path;
    }
    open.delete(cur);
    for (const nb of nodes[cur].links) {
      const t = g.get(cur)! + dist2(nodes[cur].x, nodes[cur].z, nodes[nb].x, nodes[nb].z);
      if (t < (g.get(nb) ?? Infinity)) { came.set(nb, cur); g.set(nb, t); f.set(nb, t + h(nb)); open.add(nb); }
    }
  }
  return [];
}

export class RoadGraph {
  nodes: GNode[] = [];
  constructor() {
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) this.nodes.push({ id: j * 5 + i, x: XS[i], z: ZS[j], links: [] });
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const n = this.nodes[j * 5 + i];
      if (i > 0) n.links.push(n.id - 1);
      if (i < 4) n.links.push(n.id + 1);
      if (j > 0) n.links.push(n.id - 5);
      if (j < 4) n.links.push(n.id + 5);
    }
  }
  nearest(x: number, z: number): number {
    let b = 0, bd = Infinity;
    for (const n of this.nodes) { const d = dist2(x, z, n.x, n.z); if (d < bd) { bd = d; b = n.id; } }
    return b;
  }
  route(from: number, to: number): number[] { return astar(this.nodes, from, to); }
  /** Heading when driving from node a to node b. */
  heading(a: number, b: number): number { return yawTo(this.nodes[b].x - this.nodes[a].x, this.nodes[b].z - this.nodes[a].z); }
  /**
   * A point on the LEFT-hand lane when travelling a -> b. `along` is metres from a.
   * Left-hand traffic: the lane centre is offset to the driver's left of the centre line.
   */
  lanePoint(a: number, b: number, along: number, offset = LANE): V2 {
    const A = this.nodes[a], B = this.nodes[b];
    const yaw = this.heading(a, b), len = dist2(A.x, A.z, B.x, B.z), t = along / len;
    return { x: A.x + (B.x - A.x) * t + leftX(yaw) * offset, z: A.z + (B.z - A.z) * t + leftZ(yaw) * offset };
  }
  edgeLength(a: number, b: number): number { return dist2(this.nodes[a].x, this.nodes[a].z, this.nodes[b].x, this.nodes[b].z); }
  /** Pick the next node at a junction (no U-turn unless it is a dead end). */
  nextNode(prev: number, cur: number, rnd: () => number): number {
    const opts = this.nodes[cur].links.filter((n) => n !== prev);
    if (!opts.length) return prev;
    // prefer going straight on: makes traffic read as flowing rather than wandering
    const straight = opts.find((n) => Math.abs(this.heading(prev, cur) - this.heading(cur, n)) < 0.01);
    if (straight !== undefined && rnd() < 0.55) return straight;
    return opts[Math.floor(rnd() * opts.length) % opts.length];
  }
}

const PAVE_MID = ROAD_HALF + 1.9;

export class NavGraph {
  nodes: GNode[] = [];
  private poiNode = new Map<string, number>();
  constructor(private layout: Layout) {
    const add = (x: number, z: number, tag?: string) => { const n: GNode = { id: this.nodes.length, x, z, links: [], tag }; this.nodes.push(n); return n.id; };
    const link = (a: number, b: number) => { if (a !== b && !this.nodes[a].links.includes(b)) { this.nodes[a].links.push(b); this.nodes[b].links.push(a); } };
    // four pavement corners per block: index = (j*4+i)*4 + corner (0 NW, 1 NE, 2 SE, 3 SW)
    const corner = (i: number, j: number, c: number) => (j * 4 + i) * 4 + c;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x0 = XS[i] + PAVE_MID, x1 = XS[i + 1] - PAVE_MID, z0 = ZS[j] + PAVE_MID, z1 = ZS[j + 1] - PAVE_MID;
      add(x0, z0); add(x1, z0); add(x1, z1); add(x0, z1);
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      for (let c = 0; c < 4; c++) link(corner(i, j, c), corner(i, j, (c + 1) % 4));
      if (i < 3) { link(corner(i, j, 1), corner(i + 1, j, 0)); link(corner(i, j, 2), corner(i + 1, j, 3)); } // cross the N-S street to the east
      if (j < 3) { link(corner(i, j, 3), corner(i, j + 1, 0)); link(corner(i, j, 2), corner(i, j + 1, 1)); } // cross the E-W street to the south
    }
    // alleys: a node at each mouth, linked through
    for (const a of layout.alleys) {
      const vertical = a.z1 - a.z0 > a.x1 - a.x0;
      const cx = (a.x0 + a.x1) / 2, cz = (a.z0 + a.z1) / 2;
      const m0 = vertical ? add(cx, a.z0 - 1.7, 'alley') : add(a.x0 - 1.7, cz, 'alley');
      const m1 = vertical ? add(cx, a.z1 + 1.7, 'alley') : add(a.x1 + 1.7, cz, 'alley');
      link(m0, m1);
      for (const m of [m0, m1]) this.attach(m, link);
    }
    const alleyNodes = this.nodes.filter((n) => n.tag === 'alley').map((n) => n.id);
    const order = [...layout.pois].sort((a, b) => Number(!!a.via) - Number(!!b.via)); // anchors first
    for (const p of order) {
      const n = add(p.nx ?? p.x, p.nz ?? p.z, p.id);
      this.poiNode.set(p.id, n);
      if (p.via === 'alley') {
        alleyNodes.map((id) => ({ id, d: dist2(p.x, p.z, this.nodes[id].x, this.nodes[id].z) })).sort((a, b) => a.d - b.d).slice(0, 2).forEach((m) => link(n, m.id));
      } else if (p.via === 'circus') link(n, this.poiNode.get('circus')!);
      else if (p.via === 'yard') link(n, this.poiNode.get('site')!);
      else this.attach(n, link, p.id === 'square' ? 4 : p.id === 'circus' ? 1 : 2);
    }
    // shortcuts: doorways, alley mouths and plazas also connect to anything close by in a clear straight line
    for (let i = 64; i < this.nodes.length; i++) for (const o of this.nodes) {
      if (o.id === i) continue;
      const me = this.nodes[i];
      if (dist2(me.x, me.z, o.x, o.z) < 30 && lineClear(layout, me.x, me.z, o.x, o.z)) link(i, o.id);
    }
  }
  /** Link a node to its nearest block-corner nodes (the first 64 nodes). */
  private attach(n: number, link: (a: number, b: number) => void, count = 2) {
    const me = this.nodes[n];
    const sorted = this.nodes.slice(0, 64).map((c) => ({ id: c.id, d: dist2(me.x, me.z, c.x, c.z) })).sort((a, b) => a.d - b.d);
    for (let k = 0; k < count; k++) link(n, sorted[k].id);
  }
  nodeOfPoi(id: string): number { return this.poiNode.get(id) ?? 0; }
  nearest(x: number, z: number, maxId = Infinity): number {
    let b = 0, bd = Infinity;
    for (const n of this.nodes) { if (n.id >= maxId) break; const d = dist2(x, z, n.x, n.z); if (d < bd) { bd = d; b = n.id; } }
    return b;
  }
  path(from: number, to: number): number[] { return astar(this.nodes, from, to); }
  private nearestClear(x: number, z: number, k: number): number[] {
    const sorted = this.nodes.map((n) => ({ id: n.id, d: dist2(x, z, n.x, n.z) })).sort((a, b) => a.d - b.d).slice(0, k + 3);
    const clear = sorted.filter((n) => lineClear(this.layout, x, z, this.nodes[n.id].x, this.nodes[n.id].z)).slice(0, k).map((n) => n.id);
    return clear.length ? clear : [sorted[0].id];
  }
  /**
   * Walking route between two arbitrary points. The entry and exit nodes are chosen to minimise the
   * whole journey (not just "nearest node"), which stops chasers doubling back on themselves.
   */
  pathPoints(fx: number, fz: number, tx: number, tz: number): V2[] {
    let best: number[] = [], bc = Infinity;
    for (const s of this.nearestClear(fx, fz, 3)) for (const e of this.nearestClear(tx, tz, 2)) {
      const ids = this.path(s, e); if (!ids.length) continue;
      let c = dist2(fx, fz, this.nodes[s].x, this.nodes[s].z) + dist2(tx, tz, this.nodes[e].x, this.nodes[e].z);
      for (let i = 1; i < ids.length; i++) c += dist2(this.nodes[ids[i - 1]].x, this.nodes[ids[i - 1]].z, this.nodes[ids[i]].x, this.nodes[ids[i]].z);
      if (c < bc) { bc = c; best = ids; }
    }
    const pts = best.map((i) => ({ x: this.nodes[i].x, z: this.nodes[i].z }));
    // drop leading nodes we can already walk past in a straight line
    while (pts.length > 1 && lineClear(this.layout, fx, fz, pts[1].x, pts[1].z) && dist2(fx, fz, pts[1].x, pts[1].z) < 40) pts.shift();
    pts.push({ x: tx, z: tz });
    return pts;
  }
  randomCorner(rnd: () => number): GNode { return this.nodes[Math.floor(rnd() * 64) % 64]; }
}
