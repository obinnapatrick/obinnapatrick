// Accumulates quads into a single BufferGeometry so the whole city costs a handful of draw calls.
import * as THREE from 'three';

export class QuadBatch {
  private pos: number[] = []; private nor: number[] = []; private uv: number[] = []; private idx: number[] = [];
  private quad(p: number[], n: [number, number, number], uvs: number[]) {
    const base = this.pos.length / 3;
    this.pos.push(...p);
    for (let i = 0; i < 4; i++) this.nor.push(...n);
    this.uv.push(...uvs);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Vertical wall from a to b; its outward normal is (-dz, 0, dx). */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, tileU = 1, tileV = 1, u0 = 0): void {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const u1 = u0 + len / tileU, v0 = y0 / tileV, v1 = y1 / tileV;
    this.quad([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], [-dz / len, 0, dx / len], [u0, v0, u1, v0, u1, v1, u0, v1]);
  }
  boxSides(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tileU = 1, tileV = 1): void {
    this.wall(x0, z1, x1, z1, y0, y1, tileU, tileV, x0 / tileU); // south
    this.wall(x1, z0, x0, z0, y0, y1, tileU, tileV, -x1 / tileU); // north
    this.wall(x1, z1, x1, z0, y0, y1, tileU, tileV, -z1 / tileU); // east
    this.wall(x0, z0, x0, z1, y0, y1, tileU, tileV, z0 / tileU); // west
  }
  top(x0: number, z0: number, x1: number, z1: number, y: number, tile = 1): void {
    this.quad([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], [0, 1, 0], [x0 / tile, z1 / tile, x1 / tile, z1 / tile, x1 / tile, z0 / tile, x0 / tile, z0 / tile]);
  }
  box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile = 1): void { this.boxSides(x0, z0, x1, z1, y0, y1, tile, tile); this.top(x0, z0, x1, z1, y1, tile); }
  get empty(): boolean { return this.idx.length === 0; }
  build(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}
