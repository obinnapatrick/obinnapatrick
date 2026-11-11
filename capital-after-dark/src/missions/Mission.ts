// Mission framework: every mission is a small state machine with real objectives, fail states and rewards.
import type { Game } from '../core/Game';
import type { GameEvent } from '../core/EventBus';
import type { Marker } from '../render/Effects';
import type { Npc, Role } from '../npc/Npc';
import type { Vehicle } from '../vehicles/Vehicle';
import type { VehicleType } from '../vehicles/specs';
import type { DialogueLine } from '../ui/UI';
import { dist2 } from '../core/util';

export interface Reward { cash: number; lines?: string[] }

export abstract class Mission {
  abstract readonly id: string;
  abstract readonly title: string;
  stage = 0; t = 0; objective = ''; timer = -1;
  ended = false;
  private cleanups: (() => void)[] = [];
  constructor(protected g: Game) {}
  abstract begin(): void;
  abstract tick(dt: number): void;
  event(_e: GameEvent): void {}

  protected go(stage: number, objective: string, timer = -1): void { this.stage = stage; this.t = 0; this.objective = objective; this.timer = timer; this.g.audio.play('ui'); }
  protected marker(x: number, z: number, r = 2.5, colour = 0xffd23a, icon = '●'): Marker { const m = this.g.fx.addMarker(x, z, r, colour, icon); this.cleanups.push(() => m.remove()); return m; }
  protected npc(role: Role, x: number, z: number, o: { name?: string; look?: string; yaw?: number } = {}): Npc {
    const n = this.g.npcs.spawn(role, x, z, { ...o, scripted: true });
    this.cleanups.push(() => { if (this.g.npcs.list.includes(n)) { if (n.alive) { n.scripted = false; n.hostileToPlayer = false; n.remove = !n.target; n.setState('idle'); n.idleFor = 0; } else n.scripted = false; } });
    return n;
  }
  protected vehicle(type: VehicleType, x: number, z: number, yaw: number, colour?: number): Vehicle {
    for (const o of [...this.g.vehicles.list]) if (!o.driver && !o.owned && !o.missionTag && dist2(o.x, o.z, x, z) < 7) this.g.vehicles.remove(o); // clear the kerb
    const v = this.g.vehicles.spawn(type, x, z, yaw, { tag: this.id, colour });
    this.cleanups.push(() => { v.missionTag = ''; });
    return v;
  }
  protected say(lines: DialogueLine[], then?: () => void): void { this.g.ui.dialogue(lines, then); }
  /** Is the player (on foot or driving) inside a marker? `stopped` also requires the vehicle to be nearly still. */
  protected at(m: { x: number; z: number; r: number }, stopped = false): boolean {
    const p = this.g.player;
    if (dist2(p.pos.x, p.pos.z, m.x, m.z) > m.r + (p.vehicle ? 1.5 : 0)) return false;
    return !stopped || !p.vehicle || Math.abs(p.vehicle.speed) < 1.8;
  }
  protected win(r: Reward): void { this.g.missions.complete(this, r); }
  protected lose(reason: string): void { this.g.missions.fail(this, reason); }
  dispose(): void { this.ended = true; for (const c of this.cleanups) c(); this.cleanups = []; }
}
