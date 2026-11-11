// Thin wrapper over Rapier 3D: world, collision groups and the queries the game needs.
import RAPIER from '@dimforge/rapier3d-compat';

export const G_WORLD = 0x0001; // buildings, props, ground
export const G_PAVE = 0x0002; // kerbs, steps (only characters feel these)
export const G_PLAYER = 0x0004;
export const G_VEHICLE = 0x0008;
export const G_PQUERY = 0x0010; // the player's movement query (so cars block the player but are not blocked by them)
export const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;

export const GR_STATIC = groups(G_WORLD, G_PLAYER | G_VEHICLE | G_PQUERY | G_WORLD);
export const GR_PAVE = groups(G_PAVE, G_PLAYER | G_PQUERY);
export const GR_PLAYER = groups(G_PLAYER, G_WORLD | G_PAVE);
export const GR_PLAYER_QUERY = groups(G_PQUERY, G_WORLD | G_PAVE | G_VEHICLE);
export const GR_VEHICLE = groups(G_VEHICLE, G_WORLD | G_VEHICLE | G_PQUERY);
export const GR_RAY_SOLID = groups(G_WORLD, G_WORLD | G_VEHICLE); // bullets, sight lines
export const GR_RAY_WORLD = groups(G_WORLD, G_WORLD); // camera, building-only checks

export interface RayHit { dist: number; x: number; y: number; z: number; nx: number; ny: number; nz: number; collider: RAPIER.Collider }

export class Physics {
  world!: RAPIER.World;
  R = RAPIER;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  static async create(): Promise<Physics> {
    await RAPIER.init();
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    return p;
  }
  step(dt: number): void { this.world.timestep = dt; this.world.step(); }

  fixedBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, group = GR_STATIC): RAPIER.Collider {
    return this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(group));
  }
  fixedCylinder(cx: number, cy: number, cz: number, halfH: number, radius: number, group = GR_STATIC): RAPIER.Collider {
    return this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, radius).setTranslation(cx, cy, cz).setCollisionGroups(group));
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, group = GR_RAY_SOLID, exclude?: RAPIER.RigidBody): RayHit | null {
    const len = Math.hypot(dx, dy, dz) || 1;
    this.ray.origin.x = ox; this.ray.origin.y = oy; this.ray.origin.z = oz;
    this.ray.dir.x = dx / len; this.ray.dir.y = dy / len; this.ray.dir.z = dz / len;
    const hit = this.world.castRayAndGetNormal(this.ray, max, true, undefined, group, undefined, exclude);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return { dist: t, x: ox + this.ray.dir.x * t, y: oy + this.ray.dir.y * t, z: oz + this.ray.dir.z * t, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z, collider: hit.collider };
  }
  /** True when nothing solid lies between two points. */
  clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number, group = GR_RAY_WORLD): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return this.raycast(ax, ay, az, dx, dy, dz, d, group) === null;
  }
  /** Is a capsule-sized space free of world geometry and vehicles? Used when leaving vehicles. */
  spaceFree(x: number, y: number, z: number, radius = 0.4, halfH = 0.5): boolean {
    let free = true;
    this.world.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(halfH, radius), () => { free = false; return false; },
      undefined, groups(G_PQUERY, G_WORLD | G_VEHICLE));
    return free;
  }
}
