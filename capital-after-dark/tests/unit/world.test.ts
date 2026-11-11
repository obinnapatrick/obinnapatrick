import { describe, expect, it } from 'vitest';
import { generateLayout, isRoad, groundHeight, districtAt, lineClear, XS, ZS, LANE, KERB, streetNameAt, territoryAt } from '../../src/world/layout';
import { NavGraph, RoadGraph } from '../../src/world/graphs';
import { rectContains, pushOutOfRect, segHitsRect, angleDiff, pointInObb } from '../../src/core/util';

const L = generateLayout();

describe('district layout', () => {
  it('is deterministic', () => { expect(generateLayout().buildings.length).toBe(L.buildings.length); expect(generateLayout().buildings[17]).toEqual(L.buildings[17]); });
  it('never puts a building on a carriageway', () => {
    for (const b of L.buildings) for (const [x, z] of [[b.x0 + 0.1, b.z0 + 0.1], [b.x1 - 0.1, b.z1 - 0.1], [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]]) expect(isRoad(x, z)).toBe(false);
  });
  it('keeps every point of interest and prop outside solid buildings', () => {
    for (const p of L.pois) expect(L.buildings.some((b) => rectContains(b, p.x, p.z)), p.id).toBe(false);
    for (const l of L.lamps) expect(L.buildings.some((b) => rectContains(b, l.x, l.z))).toBe(false);
    for (const s of L.parkSlots) expect(isRoad(s.x, s.z)).toBe(true);
  });
  it('has the landmark locations the game relies on', () => {
    for (const id of ['pub', 'shop', 'garage', 'office', 'lockup', 'site', 'police', 'hospital', 'circus', 'square', 'gate']) expect(L.poi(id)).toBeTruthy();
    expect(L.buildings.filter((b) => b.kind === 'pub').length).toBe(1);
  });
  it('kerbs: roads are at 0, pavements raised', () => { expect(groundHeight(0, 40)).toBe(0); expect(groundHeight(-8.2, 37)).toBe(KERB); });
  it('names streets and districts', () => {
    expect(streetNameAt(0, 40)).toBe('Wardour Street'); expect(streetNameAt(-100, -75)).toBe('Brewer Street'); expect(streetNameAt(40, -75)).toBe('Old Compton Street');
    expect(districtAt(-126, 99)).toBe('Piccadilly'); expect(districtAt(30, 37)).toBe('Chinatown'); expect(districtAt(112, 112)).toBe('Leicester Square'); expect(districtAt(-20, -60)).toBe('Soho');
    expect(territoryAt(-20, -60)).toBe('marlowe'); expect(territoryAt(112, 60)).toBe('kestrel');
  });
  it('line of sight is blocked by buildings but clear along streets', () => {
    expect(lineClear(L, 0, -140, 0, 140)).toBe(true); // straight down Wardour Street
    expect(lineClear(L, -37.5, 0, 37.5, -75)).toBe(false); // diagonally through blocks
  });
});

describe('road graph (left-hand traffic)', () => {
  const R = new RoadGraph();
  it('connects the 5x5 junction grid', () => { expect(R.nodes.length).toBe(25); expect(R.nodes[12].links.length).toBe(4); expect(R.nodes[0].links.length).toBe(2); });
  it('northbound traffic uses the west side, southbound the east side', () => {
    const south = R.nearest(0, 75), north = R.nearest(0, 0);
    expect(R.lanePoint(south, north, 30).x).toBeCloseTo(-LANE); // driving north (-z): left is west (-x)
    expect(R.lanePoint(north, south, 30).x).toBeCloseTo(LANE); // driving south: left is east
  });
  it('eastbound traffic uses the north side, westbound the south side', () => {
    const w = R.nearest(-75, 0), e = R.nearest(0, 0);
    expect(R.lanePoint(w, e, 30).z).toBeCloseTo(-LANE);
    expect(R.lanePoint(e, w, 30).z).toBeCloseTo(LANE);
  });
  it('opposing lanes never share a side', () => {
    for (const n of R.nodes) for (const m of n.links) { const a = R.lanePoint(n.id, m, 20), b = R.lanePoint(m, n.id, R.edgeLength(n.id, m) - 20); expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(LANE * 2); }
  });
  it('routes between far corners and never U-turns at a junction', () => {
    const route = R.route(0, 24); expect(route[0]).toBe(0); expect(route[route.length - 1]).toBe(24); expect(route.length).toBe(9);
    for (let i = 0; i < 50; i++) expect(R.nextNode(11, 12, Math.random)).not.toBe(11);
  });
});

describe('pavement graph', () => {
  const N = new NavGraph(L);
  it('all nodes are walkable (not in buildings) and the graph is connected', () => {
    for (const n of N.nodes) expect(L.buildings.some((b) => rectContains(b, n.x, n.z)), `node ${n.id} ${n.tag}`).toBe(false);
    const seen = new Set([0]); const q = [0];
    while (q.length) for (const nb of N.nodes[q.pop()!].links) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    expect(seen.size).toBe(N.nodes.length);
  });
  it('no pavement link passes through a building', () => {
    for (const n of N.nodes) for (const m of n.links) expect(lineClear(L, n.x, n.z, N.nodes[m].x, N.nodes[m].z), `${n.id}(${n.tag})-${m}(${N.nodes[m].tag})`).toBe(true);
  });
  it('finds a route from the minicab office to the pub', () => {
    const a = L.poi('office'), b = L.poi('pub');
    const pts = N.pathPoints(a.x, a.z, b.x, b.z);
    expect(pts.length).toBeGreaterThan(1); expect(pts[pts.length - 1]).toEqual({ x: b.x, z: b.z });
  });
});

describe('geometry helpers', () => {
  it('pushes circles out of rectangles', () => { const p = { x: 0.2, z: 5 }; expect(pushOutOfRect(p, { x0: 0, z0: 0, x1: 10, z1: 10 }, 0.4)).toBe(true); expect(p.x).toBeCloseTo(-0.4); });
  it('segment/rect and angle maths', () => {
    expect(segHitsRect(-5, 5, 15, 5, { x0: 0, z0: 0, x1: 10, z1: 10 })).toBe(true); expect(segHitsRect(-5, -5, 15, -1, { x0: 0, z0: 0, x1: 10, z1: 10 })).toBe(false);
    expect(angleDiff(3, -3)).toBeCloseTo(Math.PI * 2 - 6); expect(pointInObb(1, 0, 0, 0, Math.PI / 2, 1, 2)).toBeTruthy(); expect(pointInObb(0, 1.5, 0, 0, Math.PI / 2, 1, 2)).toBeNull();
  });
  it('junction centres are roads', () => { for (const x of XS) for (const z of ZS) expect(isRoad(x, z)).toBe(true); });
});
