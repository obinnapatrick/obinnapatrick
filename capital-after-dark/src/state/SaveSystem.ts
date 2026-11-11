// Local persistence (localStorage). The storage object is injectable so unit tests can run in Node.
import { WorldState } from './WorldState';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const SAVE_KEY = 'capital-after-dark.save.v1';
export const SETTINGS_KEY = 'capital-after-dark.settings.v1';

export class SaveSystem {
  constructor(private store: KV) {}
  hasSave(): boolean { return WorldState.deserialize(this.safeGet(SAVE_KEY)) !== null; }
  save(state: WorldState): boolean {
    try { this.store.setItem(SAVE_KEY, state.serialize()); return true; } catch { return false; }
  }
  load(): WorldState | null { return WorldState.deserialize(this.safeGet(SAVE_KEY)); }
  clear(): void { try { this.store.removeItem(SAVE_KEY); } catch { /* ignore */ } }
  private safeGet(k: string): string | null { try { return this.store.getItem(k); } catch { return null; } }
}

export interface Settings { quality: 'low' | 'medium' | 'high'; volume: number; sensitivity: number; invertY: boolean }
export const defaultSettings = (): Settings => ({ quality: 'medium', volume: 0.7, sensitivity: 1, invertY: false });
export function loadSettings(store: KV): Settings {
  try { return { ...defaultSettings(), ...JSON.parse(store.getItem(SETTINGS_KEY) || '{}') }; } catch { return defaultSettings(); }
}
export function saveSettings(store: KV, s: Settings): void { try { store.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
