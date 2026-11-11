// "The city that remembers": every persistent fact about a playthrough lives in SaveData.
// Nothing here is random flavour - reputation, notoriety and per-character memories are explicit,
// stored values that other systems read back (dialogue, prices, hostility, police presence).
import { clamp } from '../core/util';
import { District, DISTRICTS } from '../world/layout';

export type FactionId = 'marlowe' | 'kestrel';
export const FACTIONS: Record<FactionId, { name: string; leader: string; rival: FactionId; colour: string; turf: string }> = {
  marlowe: { name: 'The Marlowe Firm', leader: 'Vivienne Marlowe', rival: 'kestrel', colour: '#b0304a', turf: 'Soho' },
  kestrel: { name: 'The Kestrels', leader: 'Tobias "Kes" Reeve', rival: 'marlowe', colour: '#1fa6a0', turf: 'Chinatown & Leicester Square' },
};

export interface MemoryEntry { what: string; day: number; clock: number; where: string }
export interface PersonRecord { rel: number; mem: MemoryEntry[]; met: boolean }
export interface LogEntry { day: number; clock: number; type: string; where: string; text: string }
export interface SaveData {
  v: number;
  cash: number;
  hp: number;
  pos: [number, number, number];
  yaw: number;
  weapons: string[];
  ammo: Record<string, { mag: number; reserve: number }>;
  items: { snack: number; medkit: number };
  clock: number; // minutes since midnight
  day: number;
  missionsDone: string[];
  flags: Record<string, string | number | boolean>;
  rep: Record<FactionId, number>;
  notoriety: Record<string, number>; // per district, 0..100
  people: Record<string, PersonRecord>;
  vehicles: string[]; // owned vehicle types
  activeVehicle: string;
  log: LogEntry[];
  stats: { fares: number; knockouts: number; busted: number; wasted: number; evaded: number; distance: number };
  savedAt: number;
}
export const SAVE_VERSION = 1;

export function newSaveData(): SaveData {
  return {
    v: SAVE_VERSION, cash: 120, hp: 100, pos: [-8.3, 0.15, 41], yaw: Math.PI, weapons: ['fists'], ammo: {}, items: { snack: 1, medkit: 0 },
    clock: 21 * 60 + 30, day: 4, missionsDone: [], flags: {}, rep: { marlowe: 0, kestrel: 0 },
    notoriety: Object.fromEntries(DISTRICTS.map((d) => [d, 0])), people: {}, vehicles: ['cab'], activeVehicle: 'cab', log: [],
    stats: { fares: 0, knockouts: 0, busted: 0, wasted: 0, evaded: 0, distance: 0 }, savedAt: 0,
  };
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayName = (day: number) => DAY_NAMES[(day - 1) % 7];

export class WorldState {
  data: SaveData;
  onChange: (what: string, detail?: any) => void = () => {};
  constructor(data: SaveData = newSaveData()) { this.data = data; }

  // ---- economy
  addCash(amount: number, reason = ''): void { this.data.cash = Math.max(0, Math.round(this.data.cash + amount)); this.onChange('cash', { amount, reason }); }
  spend(amount: number, reason = ''): boolean {
    if (this.data.cash < amount) return false;
    this.data.cash = Math.round(this.data.cash - amount); this.onChange('cash', { amount: -amount, reason });
    return true;
  }

  // ---- factions
  /** Helping one crew costs you half as much standing with its rival. */
  changeRep(f: FactionId, delta: number, spill = true): void {
    this.data.rep[f] = clamp(this.data.rep[f] + delta, -100, 100);
    if (spill) { const rv = FACTIONS[f].rival; this.data.rep[rv] = clamp(this.data.rep[rv] - delta * 0.5, -100, 100); }
    this.onChange('rep', { faction: f, delta });
  }
  /** -1 hostile on sight, 0 neutral, 1 friendly */
  factionStance(f: FactionId): -1 | 0 | 1 { const r = this.data.rep[f]; return r <= -30 ? -1 : r >= 25 ? 1 : 0; }

  // ---- district notoriety
  addNotoriety(d: District, n: number): void { this.data.notoriety[d] = clamp((this.data.notoriety[d] ?? 0) + n, 0, 100); }
  notoriety(d: District): number { return this.data.notoriety[d] ?? 0; }
  /** Notoriety fades slowly: `hours` of in-game time. */
  decayNotoriety(hours: number): void { for (const d of DISTRICTS) this.data.notoriety[d] = Math.max(0, (this.data.notoriety[d] ?? 0) - hours * 1.5); }

  // ---- persistent people
  person(id: string): PersonRecord { return (this.data.people[id] ??= { rel: 0, mem: [], met: false }); }
  adjustRel(id: string, delta: number): void { const p = this.person(id); p.rel = clamp(p.rel + delta, -100, 100); this.onChange('rel', { id, delta }); }
  remember(id: string, what: string, where: string, relDelta = 0): void {
    const p = this.person(id);
    p.mem.push({ what, day: this.data.day, clock: this.data.clock, where });
    if (p.mem.length > 12) p.mem.shift();
    if (relDelta) p.rel = clamp(p.rel + relDelta, -100, 100);
    this.onChange('memory', { id, what });
  }
  lastMemory(id: string, what?: string): MemoryEntry | undefined {
    const m = this.person(id).mem;
    for (let i = m.length - 1; i >= 0; i--) if (!what || m[i].what === what) return m[i];
    return undefined;
  }

  // ---- event log
  log(type: string, where: string, text: string): void {
    this.data.log.push({ day: this.data.day, clock: Math.floor(this.data.clock), type, where, text });
    if (this.data.log.length > 60) this.data.log.shift();
  }

  // ---- clock
  advanceClock(minutes: number): void {
    this.data.clock += minutes;
    while (this.data.clock >= 1440) { this.data.clock -= 1440; this.data.day++; }
  }
  get hour(): number { return this.data.clock / 60; }

  flag(k: string): string | number | boolean | undefined { return this.data.flags[k]; }
  setFlag(k: string, v: string | number | boolean): void { this.data.flags[k] = v; }
  done(missionId: string): boolean { return this.data.missionsDone.includes(missionId); }

  serialize(): string { this.data.savedAt = Date.now(); return JSON.stringify(this.data); }
  /** Parse + validate a save. Returns null when the payload is unusable. */
  static deserialize(json: string | null): WorldState | null {
    if (!json) return null;
    try {
      const raw = JSON.parse(json);
      if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION || typeof raw.cash !== 'number') return null;
      const base = newSaveData();
      const data: SaveData = { ...base, ...raw, items: { ...base.items, ...raw.items }, rep: { ...base.rep, ...raw.rep },
        notoriety: { ...base.notoriety, ...raw.notoriety }, stats: { ...base.stats, ...raw.stats } };
      if (!Array.isArray(data.weapons) || !data.weapons.includes('fists')) data.weapons = ['fists', ...(Array.isArray(data.weapons) ? data.weapons : [])];
      if (!Array.isArray(data.pos) || data.pos.length !== 3 || data.pos.some((n) => !Number.isFinite(n))) data.pos = base.pos;
      return new WorldState(data);
    } catch { return null; }
  }
}
