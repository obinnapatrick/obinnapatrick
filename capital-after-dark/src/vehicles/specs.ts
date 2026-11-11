// Vehicle definitions (pure data). Speeds in m/s; these are arcade values, not a simulation.
export type VehicleType = 'cab' | 'saloon' | 'sports' | 'van' | 'police' | 'bus';
export interface VehicleSpec {
  name: string; w: number; h: number; l: number; maxSpeed: number; accel: number; brake: number; steer: number; grip: number;
  health: number; colours: number[]; price: number; drivable: boolean;
}
export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  cab: { name: 'Black Cab', w: 1.9, h: 1.85, l: 4.6, maxSpeed: 27, accel: 9, brake: 22, steer: 2.3, grip: 7.5, health: 140, colours: [0x1b1d24], price: 0, drivable: true },
  saloon: { name: 'Calder Saloon', w: 1.82, h: 1.45, l: 4.5, maxSpeed: 32, accel: 11, brake: 24, steer: 2.2, grip: 7, health: 110, colours: [0x7a1a1a, 0x1c2f4a, 0x8a8f96, 0xd8d8d2, 0x254a34, 0x2a2a2e], price: 1500, drivable: true },
  sports: { name: 'Vesper GT', w: 1.92, h: 1.22, l: 4.4, maxSpeed: 48, accel: 19, brake: 30, steer: 2.5, grip: 8.5, health: 95, colours: [0xd81e1e, 0xf2b600, 0x1e6ad8, 0xe8e8e8], price: 6000, drivable: true },
  van: { name: 'Transit Van', w: 2.0, h: 2.3, l: 5.4, maxSpeed: 23, accel: 7, brake: 18, steer: 1.9, grip: 6.5, health: 170, colours: [0xe8e8e4, 0x1e6a66, 0x24456a], price: 2200, drivable: true },
  police: { name: 'Area Car', w: 1.86, h: 1.5, l: 4.6, maxSpeed: 40, accel: 15, brake: 28, steer: 2.4, grip: 8, health: 150, colours: [0xf2f2f2], price: 0, drivable: true },
  bus: { name: 'Double-Decker Bus', w: 2.55, h: 4.4, l: 10.6, maxSpeed: 15, accel: 4, brake: 14, steer: 1.25, grip: 9, health: 400, colours: [0xc8102e], price: 0, drivable: false },
};
/** What the garage is willing to sell, and when. */
export const GARAGE_STOCK: { type: VehicleType; needs?: string }[] = [{ type: 'saloon' }, { type: 'van' }, { type: 'sports', needs: 'heat' }];
