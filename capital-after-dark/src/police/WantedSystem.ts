// Pure wanted-level logic: heat comes only from REPORTED crimes, and falls away only by evasion.
import { V2 } from '../core/util';

export type CrimeType = 'assault' | 'gunfire' | 'shooting' | 'carjack' | 'hitrun' | 'assaultOfficer' | 'vandalism' | 'alarm' | 'brawl';
export const CRIME_HEAT: Record<CrimeType, number> = { brawl: 0.6, vandalism: 0.6, assault: 1, carjack: 1.5, hitrun: 2, gunfire: 2, shooting: 3, alarm: 6, assaultOfficer: 3.5 };
export const CRIME_LABEL: Record<CrimeType, string> = { brawl: 'Affray', vandalism: 'Criminal damage', assault: 'Assault', carjack: 'Vehicle theft', hitrun: 'Dangerous driving',
  gunfire: 'Firearm discharged', shooting: 'Shooting', alarm: 'Break-in reported', assaultOfficer: 'Assaulting an officer' };
export const LEVEL_HEAT = [1, 3, 6, 10, 15]; // heat needed for 1..5 stars
export type PoliceMode = 'clear' | 'pursuit' | 'search';

export const levelForHeat = (heat: number) => { let l = 0; for (const t of LEVEL_HEAT) if (heat >= t) l++; return l; };
export const searchDuration = (level: number) => 16 + level * 6;

export class WantedSystem {
  heat = 0;
  level = 0;
  mode: PoliceMode = 'clear';
  searchTimer = 0;
  lastKnown: V2 | null = null;
  /** Unidentified disturbances officers should walk over and look at. */
  investigations: { pos: V2; ttl: number }[] = [];
  private seen = new Set<number>();
  onLevelChange: (level: number, prev: number) => void = () => {};

  /**
   * A witness (or officer) reports a crime. Each crime id only counts once however many people saw it.
   * `identified` = the reporter saw the player do it; otherwise it is just a disturbance to investigate.
   */
  report(crime: { id: number; type: CrimeType; pos: V2 }, identified: boolean): boolean {
    if (!identified) { this.investigations.push({ pos: { ...crime.pos }, ttl: 45 }); if (this.investigations.length > 4) this.investigations.shift(); return false; }
    if (this.seen.has(crime.id)) return false;
    this.seen.add(crime.id);
    this.heat = Math.min(this.heat + CRIME_HEAT[crime.type], LEVEL_HEAT[4] + 3);
    this.lastKnown = { ...crime.pos };
    this.setLevel(Math.max(this.level, levelForHeat(this.heat)));
    if (this.mode === 'clear') this.mode = 'search';
    this.searchTimer = searchDuration(this.level);
    return true;
  }

  /** Call every tick. `visible` = at least one police unit can currently see the player. */
  update(dt: number, visible: boolean, playerPos: V2): 'evaded' | null {
    for (const i of this.investigations) i.ttl -= dt;
    this.investigations = this.investigations.filter((i) => i.ttl > 0);
    if (this.level === 0) return null;
    if (visible) {
      this.mode = 'pursuit';
      this.lastKnown = { x: playerPos.x, z: playerPos.z };
      this.searchTimer = searchDuration(this.level);
      return null;
    }
    this.mode = 'search';
    this.searchTimer -= dt;
    if (this.searchTimer <= 0) { this.clear(); return 'evaded'; }
    return null;
  }

  clear(): void {
    this.heat = 0; this.mode = 'clear'; this.searchTimer = 0; this.lastKnown = null;
    this.setLevel(0);
  }
  private setLevel(l: number) { if (l !== this.level) { const p = this.level; this.level = l; this.onLevelChange(l, p); } }
}
