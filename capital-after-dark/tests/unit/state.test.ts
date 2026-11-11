import { describe, expect, it } from 'vitest';
import { WorldState, newSaveData, SAVE_VERSION } from '../../src/state/WorldState';
import { SaveSystem, KV, loadSettings, saveSettings, defaultSettings } from '../../src/state/SaveSystem';
import { WantedSystem, levelForHeat, searchDuration, CRIME_HEAT } from '../../src/police/WantedSystem';
import { availableMissions } from '../../src/missions/MissionManager';
import { roleMix, populationTarget, goalKindFor } from '../../src/npc/Population';
import { VEHICLES } from '../../src/vehicles/specs';
import { WEAPONS } from '../../src/combat/types';

class MemStore implements KV { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe('economy', () => {
  it('earns, spends and refuses to overspend', () => {
    const s = new WorldState(); const start = s.data.cash;
    s.addCash(60); expect(s.data.cash).toBe(start + 60);
    expect(s.spend(50)).toBe(true); expect(s.data.cash).toBe(start + 10);
    expect(s.spend(1e6)).toBe(false); expect(s.data.cash).toBe(start + 10);
    s.addCash(-1e9); expect(s.data.cash).toBe(0);
  });
});

describe('factions and relationships', () => {
  it('helping one crew costs standing with its rival', () => {
    const s = new WorldState(); s.changeRep('marlowe', 40);
    expect(s.data.rep.marlowe).toBe(40); expect(s.data.rep.kestrel).toBe(-20);
    expect(s.factionStance('marlowe')).toBe(1); expect(s.factionStance('kestrel')).toBe(0);
    s.changeRep('kestrel', -15, false); expect(s.factionStance('kestrel')).toBe(-1);
  });
  it('clamps reputation', () => { const s = new WorldState(); s.changeRep('kestrel', 500); expect(s.data.rep.kestrel).toBe(100); expect(s.data.rep.marlowe).toBe(-100); });
  it('named characters keep a bounded memory log with relationship changes', () => {
    const s = new WorldState();
    s.remember('farah', 'assault', 'Soho', -35);
    expect(s.person('farah').rel).toBe(-35); expect(s.lastMemory('farah', 'assault')?.where).toBe('Soho');
    for (let i = 0; i < 30; i++) s.remember('farah', 'gunfire', 'Soho');
    expect(s.person('farah').mem.length).toBe(12);
  });
  it('district notoriety rises, clamps and decays over time', () => {
    const s = new WorldState(); s.addNotoriety('Soho', 30); s.addNotoriety('Soho', 500); expect(s.notoriety('Soho')).toBe(100);
    s.decayNotoriety(10); expect(s.notoriety('Soho')).toBe(85); expect(s.notoriety('Chinatown')).toBe(0);
  });
  it('clock rolls over into the next day', () => { const s = new WorldState(); s.data.clock = 1430; s.advanceClock(20); expect(s.data.day).toBe(2); expect(s.data.clock).toBe(10); });
});

describe('save system', () => {
  it('round-trips money, inventory, missions, vehicles and relationships', () => {
    const store = new MemStore(), saves = new SaveSystem(store), s = new WorldState();
    expect(saves.hasSave()).toBe(false);
    s.addCash(777); s.data.weapons.push('pistol'); s.data.ammo.pistol = { mag: 7, reserve: 24 }; s.data.items.medkit = 2;
    s.data.missionsDone.push('night_shift', 'wrong_place'); s.data.vehicles.push('sports'); s.data.activeVehicle = 'sports';
    s.changeRep('kestrel', 35); s.remember('tommo', 'gunfire', 'Piccadilly', -10); s.addNotoriety('Piccadilly', 22); s.setFlag('side', 'kestrel'); s.data.pos = [12, 0.15, -34];
    expect(saves.save(s)).toBe(true); expect(saves.hasSave()).toBe(true);
    const l = saves.load()!;
    expect(l.data.cash).toBe(s.data.cash); expect(l.data.weapons).toEqual(['fists', 'pistol']); expect(l.data.ammo.pistol).toEqual({ mag: 7, reserve: 24 });
    expect(l.data.items.medkit).toBe(2); expect(l.done('wrong_place')).toBe(true); expect(l.data.vehicles).toContain('sports'); expect(l.data.activeVehicle).toBe('sports');
    expect(l.data.rep).toEqual(s.data.rep); expect(l.person('tommo').mem[0].what).toBe('gunfire'); expect(l.notoriety('Piccadilly')).toBe(22); expect(l.flag('side')).toBe('kestrel'); expect(l.data.pos).toEqual([12, 0.15, -34]);
    saves.clear(); expect(saves.hasSave()).toBe(false);
  });
  it('rejects corrupt or wrong-version saves and repairs partial ones', () => {
    expect(WorldState.deserialize('not json')).toBeNull(); expect(WorldState.deserialize(null)).toBeNull();
    expect(WorldState.deserialize(JSON.stringify({ ...newSaveData(), v: SAVE_VERSION + 1 }))).toBeNull();
    const partial = WorldState.deserialize(JSON.stringify({ v: SAVE_VERSION, cash: 5, weapons: ['pistol'], pos: [NaN, 0, 0] }))!;
    expect(partial.data.weapons[0]).toBe('fists'); expect(partial.data.pos).toEqual(newSaveData().pos); expect(partial.data.rep.marlowe).toBe(0);
  });
  it('settings persist with defaults for missing keys', () => {
    const store = new MemStore(); expect(loadSettings(store)).toEqual(defaultSettings());
    saveSettings(store, { ...defaultSettings(), quality: 'low', volume: 0.2 }); expect(loadSettings(store).quality).toBe('low'); expect(loadSettings(store).sensitivity).toBe(1);
  });
});

describe('wanted system', () => {
  const crime = (id: number, type: any = 'assault') => ({ id, type, pos: { x: 0, z: 0 } });
  it('maps heat to five levels', () => { expect([0, 1, 3, 6, 10, 15, 99].map(levelForHeat)).toEqual([0, 1, 2, 3, 4, 5, 5]); });
  it('only reported, identified crimes raise the level - and each crime counts once', () => {
    const w = new WantedSystem();
    w.report(crime(1), false); expect(w.level).toBe(0); expect(w.investigations.length).toBe(1);
    expect(w.report(crime(2), true)).toBe(true); expect(w.level).toBe(1);
    expect(w.report(crime(2), true)).toBe(false); expect(w.heat).toBe(CRIME_HEAT.assault);
    w.report(crime(3, 'shooting'), true); expect(w.level).toBe(2);
    w.report(crime(4, 'alarm'), true); expect(w.level).toBe(4);
  });
  it('pursues while visible, searches when sight is lost, then stands down', () => {
    const w = new WantedSystem(); w.report(crime(1, 'gunfire'), true); expect(w.level).toBe(1);
    w.update(1, true, { x: 5, z: 6 }); expect(w.mode).toBe('pursuit'); expect(w.lastKnown).toEqual({ x: 5, z: 6 });
    w.update(1, false, { x: 50, z: 60 }); expect(w.mode).toBe('search'); expect(w.lastKnown).toEqual({ x: 5, z: 6 }); // last KNOWN position does not follow the player
    let res: string | null = null; for (let t = 0; t < searchDuration(1) + 2 && !res; t++) res = w.update(1, false, { x: 50, z: 60 });
    expect(res).toBe('evaded'); expect(w.level).toBe(0); expect(w.mode).toBe('clear');
  });
  it('being seen again resets the search clock', () => {
    const w = new WantedSystem(); w.report(crime(1), true);
    for (let t = 0; t < searchDuration(1) - 2; t++) w.update(1, false, { x: 0, z: 0 });
    w.update(1, true, { x: 0, z: 0 });
    for (let t = 0; t < searchDuration(1) - 2; t++) expect(w.update(1, false, { x: 0, z: 0 })).toBeNull();
    expect(w.level).toBe(1);
  });
  it('notifies listeners of level changes', () => { const w = new WantedSystem(); const seen: number[] = []; w.onLevelChange = (l) => seen.push(l); w.report(crime(1, 'alarm'), true); w.clear(); expect(seen).toEqual([3, 0]); });
});

describe('progression data', () => {
  it('unlocks missions in order and branches on the chosen side', () => {
    const s = new WorldState();
    expect(availableMissions(s).map((d) => d.id)).toEqual(['night_shift']);
    s.data.missionsDone.push('night_shift', 'wrong_place', 'delivery', 'heat');
    expect(availableMissions(s).map((d) => d.side)).toEqual(['marlowe', 'kestrel']);
    s.data.missionsDone.push('choose_side'); s.setFlag('side', 'kestrel');
    const last = availableMissions(s); expect(last.length).toBe(1); expect(last[0].id).toBe('after_dark'); expect(last[0].x).toBeGreaterThan(0);
    s.data.missionsDone.push('after_dark'); expect(availableMissions(s).length).toBe(0);
  });
  it('NPC routines change with the time of day', () => {
    expect(roleMix(9).office).toBeGreaterThan(roleMix(23).office); expect(roleMix(23).nightlife).toBeGreaterThan(roleMix(9).nightlife);
    expect(populationTarget(4)).toBeLessThan(populationTarget(21));
    expect(goalKindFor('office', 8, 0.5)).toBe('work'); expect(goalKindFor('office', 12.5, 0.2)).toBe('cafe'); expect(goalKindFor('office', 18, 0.9)).toBe('tube'); expect(goalKindFor('tourist', 2, 0.1)).toBe('tube');
  });
  it('vehicle and weapon tables are sane', () => {
    expect(VEHICLES.bus.drivable).toBe(false); expect(VEHICLES.sports.maxSpeed).toBeGreaterThan(VEHICLES.cab.maxSpeed);
    for (const v of Object.values(VEHICLES)) { expect(v.health).toBeGreaterThan(0); expect(v.l).toBeGreaterThan(v.w); }
    expect(WEAPONS.smg.auto).toBe(true); expect(WEAPONS.pistol.mag).toBe(12); expect(WEAPONS.fists.melee).toBe(true);
  });
});
