import type * as THREE from 'three';
export type DamageKind = 'melee' | 'bullet' | 'vehicle';
/** Anything that can hit and be hit: the player and every NPC. */
export interface Combatant {
  pos: THREE.Vector3; hp: number; alive: boolean; isPlayer?: boolean;
  takeDamage(amount: number, attacker: Combatant | null, kind: DamageKind, dx: number, dz: number, heavy?: boolean): void;
}
export interface WeaponDef { id: string; name: string; melee: boolean; damage: number; mag: number; rate: number; reload: number; spread: number; range: number; auto: boolean; price: number; magPrice: number }
export const WEAPONS: Record<string, WeaponDef> = {
  fists: { id: 'fists', name: 'Fists', melee: true, damage: 12, mag: 0, rate: 0.3, reload: 0, spread: 0, range: 1.8, auto: false, price: 0, magPrice: 0 },
  pistol: { id: 'pistol', name: 'Marlow 9 pistol', melee: false, damage: 34, mag: 12, rate: 0.26, reload: 1.3, spread: 0.01, range: 95, auto: false, price: 250, magPrice: 30 },
  smg: { id: 'smg', name: 'Kessler Compact SMG', melee: false, damage: 17, mag: 30, rate: 0.085, reload: 1.9, spread: 0.032, range: 70, auto: true, price: 900, magPrice: 60 },
};
