// Tracks which story missions are available, starts them from world markers, and settles outcomes.
import type { Game } from '../core/Game';
import type { GameEvent } from '../core/EventBus';
import type { Marker } from '../render/Effects';
import { dist2, fmtMoney } from '../core/util';
import type { FactionId, WorldState } from '../state/WorldState';
import { Mission, Reward } from './Mission';
import { AfterDark, ChooseSide, Delivery, Heat, NightShift, WrongPlace } from './story';

interface Def { id: string; title: string; x: number; z: number; icon: string; needs?: string; side?: FactionId; when?: (s: WorldState) => boolean; make: (g: Game) => Mission }
const OFFICE = { x: -8.2, z: 34.2 }, PUB = { x: -29.4, z: -67.4 }, LOCKUP = { x: 109.2, z: 67.2 };
export const MISSION_DEFS: Def[] = [
  { id: 'night_shift', title: 'The Night Shift', ...OFFICE, icon: '1', make: (g) => new NightShift(g) },
  { id: 'wrong_place', title: 'Wrong Place', ...OFFICE, icon: '2', needs: 'night_shift', make: (g) => new WrongPlace(g) },
  { id: 'delivery', title: 'The Delivery', ...PUB, icon: '3', needs: 'wrong_place', make: (g) => new Delivery(g) },
  { id: 'heat', title: 'Heat on the Streets', ...LOCKUP, icon: '4', needs: 'delivery', make: (g) => new Heat(g) },
  { id: 'choose_side', title: 'Choose a Side (Marlowe Firm)', ...PUB, icon: 'M', needs: 'heat', side: 'marlowe', make: (g) => new ChooseSide(g, 'marlowe') },
  { id: 'choose_side', title: 'Choose a Side (Kestrels)', ...LOCKUP, icon: 'K', needs: 'heat', side: 'kestrel', make: (g) => new ChooseSide(g, 'kestrel') },
  { id: 'after_dark', title: 'After Dark', ...PUB, icon: '6', needs: 'choose_side', when: (s) => s.flag('side') !== 'kestrel', make: (g) => new AfterDark(g) },
  { id: 'after_dark', title: 'After Dark', ...LOCKUP, icon: '6', needs: 'choose_side', when: (s) => s.flag('side') === 'kestrel', make: (g) => new AfterDark(g) },
];
/** Which mission definitions are open given a save state (pure - unit tested). */
export function availableMissions(s: WorldState): Def[] {
  return MISSION_DEFS.filter((d) => !s.done(d.id) && (!d.needs || s.done(d.needs)) && (!d.when || d.when(s)));
}

export class MissionManager {
  active: Mission | null = null;
  private starts: { def: Def; marker: Marker; armed: boolean }[] = [];
  private cooldown = 0;
  constructor(private g: Game) {
    g.bus.on('*', (e: GameEvent) => {
      if (!this.active) return;
      if (e.type === 'busted') this.fail(this.active, 'You were arrested');
      else if (e.type === 'wasted') this.fail(this.active, 'You were put in hospital');
      else this.active.event(e);
    });
  }
  get objective(): string { return this.active?.objective ?? ''; }
  get timer(): number { return this.active ? this.active.timer : -1; }

  /** Rebuild the start markers from saved progress. */
  refresh(): void {
    for (const s of this.starts) s.marker.remove();
    this.starts = [];
    if (this.active) return;
    for (const def of availableMissions(this.g.state)) this.starts.push({ def, marker: this.g.fx.addMarker(def.x, def.z, 1.5, 0xffd23a, def.icon), armed: false });
  }

  start(def: Def): void {
    const g = this.g;
    for (const s of this.starts) s.marker.remove();
    this.starts = [];
    this.active = def.make(g);
    g.events.cancel();
    g.ui.banner(this.active.title.toUpperCase(), 'Mission started');
    g.state.log('mission', '', `Started ${this.active.title}`);
    this.active.begin();
    g.bus.emit({ type: 'missionStart', id: def.id });
  }
  startById(id: string, side?: FactionId): boolean {
    const def = availableMissions(this.g.state).find((d) => d.id === id && (!side || d.side === side));
    if (!def || this.active) return false;
    this.start(def); return true;
  }

  update(dt: number): void {
    const g = this.g, p = g.player;
    if (this.active) {
      const m = this.active;
      m.t += dt;
      if (m.timer > 0 && !g.ui.dialogueActive) m.timer = Math.max(0, m.timer - dt);
      m.tick(dt);
      return;
    }
    this.cooldown -= dt;
    for (const s of this.starts) {
      const inside = dist2(p.pos.x, p.pos.z, s.def.x, s.def.z) < 1.7 && !p.vehicle && p.pos.y > -5;
      if (!inside) { s.armed = true; continue; } // must step out and back in after a failure
      if (!s.armed || this.cooldown > 0 || g.ui.dialogueActive || !p.alive) continue;
      if (g.police.wanted.level > 0) { if (this.cooldown < -1) { g.ui.toast('Lose the police before starting a job'); this.cooldown = 0; } continue; }
      this.start(s.def);
      return;
    }
  }

  complete(m: Mission, r: Reward): void {
    if (this.active !== m) return;
    const g = this.g;
    m.dispose(); this.active = null;
    if (!g.state.done(m.id)) g.state.data.missionsDone.push(m.id);
    g.state.addCash(r.cash, m.title);
    g.state.log('mission', '', `Completed ${m.title} (+${fmtMoney(r.cash)})`);
    g.ui.banner('Mission passed', [`+${fmtMoney(r.cash)}`, ...(r.lines ?? [])].join('\n'));
    g.audio.play('success');
    g.bus.emit({ type: 'missionComplete', id: m.id, cash: r.cash });
    this.cooldown = 4; this.refresh();
    g.saveGame('Autosaved');
  }
  fail(m: Mission, reason: string): void {
    if (this.active !== m) return;
    const g = this.g;
    m.dispose(); this.active = null;
    g.state.log('mission', '', `Failed ${m.title}: ${reason}`);
    g.ui.banner('Mission failed', reason, true);
    g.audio.play('fail');
    g.bus.emit({ type: 'missionFail', id: m.id, reason });
    this.cooldown = 4; this.refresh();
  }
  /** Drop any running mission without a result (new game / load). */
  reset(): void { if (this.active) { this.active.dispose(); this.active = null; } this.refresh(); }
}
