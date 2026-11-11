// Three enterable interiors (pub, corner shop, garage). Each is a real room with colliders, built away
// from the street map; doors teleport the player. Every menu entry changes saved game state.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Npc } from '../npc/Npc';
import type { ShopItem } from '../ui/UI';
import { dist2 } from '../core/util';
import { labelTexture } from '../render/textures';
import { WEAPONS } from '../combat/types';
import { GARAGE_STOCK, VEHICLES, VehicleType } from '../vehicles/specs';
import { recall } from '../npc/dialogue';

export interface InteriorDef { id: 'pub' | 'shop' | 'garage'; name: string; poi: string; ox: number; oz: number; w: number; d: number; floor: number; wall: number }
const Y = -60, H = 3.4;
const DEFS: InteriorDef[] = [
  { id: 'pub', name: 'The Gilded Stag', poi: 'pub', ox: 0, oz: 420, w: 13, d: 10, floor: 0x3a2618, wall: 0x4a1f1f },
  { id: 'shop', name: 'Wardour Food & Wine', poi: 'shop', ox: 40, oz: 420, w: 10, d: 8, floor: 0x9a9a92, wall: 0xd8d4c4 },
  { id: 'garage', name: 'Brewer Street Motors', poi: 'garage', ox: 80, oz: 420, w: 14, d: 10, floor: 0x4a4c50, wall: 0x6a6e72 },
];

export class Interiors {
  current: InteriorDef | null = null;
  defs = DEFS;
  private keepers: Npc[] = [];
  private returnPos: [number, number, number, number] = [0, 0, 0, 0];
  private staff: (() => void)[] = [];
  constructor(private g: Game) { for (const d of DEFS) this.build(d); }
  /** (Re)create the people who work in the interiors. Call after the population has been cleared. */
  populate(): void { this.keepers = []; this.current = null; this.g.gfx.lightOverride = null; for (const f of this.staff) f(); }


  private build(d: InteriorDef): void {
    const g = this.g, grp = new THREE.Group(), ph = g.phys;
    const box = (w: number, h: number, dp: number, x: number, y: number, z: number, colour: number, solid = true, emissive = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8, emissive, emissiveIntensity: emissive ? 1 : 0 }));
      m.position.set(d.ox + x, Y + y, d.oz + z); grp.add(m);
      if (solid) ph.fixedBox(d.ox + x, Y + y, d.oz + z, w / 2, h / 2, dp / 2);
      return m;
    };
    box(d.w, 0.4, d.d, 0, -0.2, 0, d.floor); box(d.w, 0.3, d.d, 0, H + 0.15, 0, 0x1a1a1c);
    box(d.w, H, 0.3, 0, H / 2, -d.d / 2 - 0.15, d.wall); box(d.w, H, 0.3, 0, H / 2, d.d / 2 + 0.15, d.wall);
    box(0.3, H, d.d, -d.w / 2 - 0.15, H / 2, 0, d.wall); box(0.3, H, d.d, d.w / 2 + 0.15, H / 2, 0, d.wall);
    box(1.5, 2.4, 0.08, 0, 1.2, d.d / 2 - 0.02, 0x1c120c, false); // the way out
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshBasicMaterial({ map: labelTexture('EXIT', '#fff', '#0a7a3a', 128, 32), toneMapped: false }));
    exit.position.set(d.ox, Y + 2.7, d.oz + d.d / 2 - 0.05); exit.rotation.y = Math.PI; grp.add(exit);
    if (d.id === 'pub') {
      box(8, 1.1, 0.8, -1.5, 0.55, -d.d / 2 + 2, 0x2a1810); box(8, 2.2, 0.4, -1.5, 1.1, -d.d / 2 + 0.25, 0x1a0f0a, false);
      for (let i = 0; i < 14; i++) box(0.12, 0.34, 0.12, -5 + i * 0.52, 2.1, -d.d / 2 + 0.5, [0x2a6a3a, 0xa8641c, 0xd8d0b0, 0x7a1c1c][i % 4], false, i % 3 === 0 ? 0x332200 : 0);
      for (const [x, z] of [[4.2, 2.5], [-4.5, 2.6], [4.2, -0.5]]) { box(1.1, 0.75, 1.1, x, 0.38, z, 0x2a1810); }
      box(2.6, 1.3, 0.5, 5.9, 0.65, -3, 0x4a1420); // booth
    } else if (d.id === 'shop') {
      box(4, 1, 0.7, -2, 0.5, -d.d / 2 + 1.6, 0xb8b4a8);
      for (const x of [-1.2, 1.6]) { box(0.6, 1.7, 4, x + 1.2, 0.85, 1, 0x8a8a84); for (let k = 0; k < 10; k++) box(0.3, 0.24, 0.3, x + 1.2 + (k % 2 ? 0.34 : -0.34), 0.5 + (k % 3) * 0.5, -0.6 + k * 0.36, [0xe04a3a, 0x2aa3d8, 0xf0c030, 0x3ac27a][k % 4], false); }
      box(0.7, 2, 3, d.w / 2 - 0.45, 1, -1.5, 0xe8eef2, true, 0x223344); // drinks fridge
    } else {
      box(4.4, 0.25, 2.2, -3, 0.12, 0.5, 0xd9a514); // lift
      box(1.9, 1.1, 4.4, -3, 0.8, 0.5, 0x1c2f4a); box(1.7, 0.6, 2.2, -3, 1.6, 0.3, 0x0b1118); // car on the lift
      box(3, 1, 0.8, 4.5, 0.5, -d.d / 2 + 1.2, 0x33373c); box(0.9, 2, 0.6, 6.3, 1, -d.d / 2 + 0.6, 0xa81c1c); // bench + tool chest
      for (let k = 0; k < 4; k++) box(0.7, 0.7, 0.25, 6.6, 0.35 + (k % 2) * 0.7, 1 + Math.floor(k / 2) * 0.9, 0x0c0c0d); // tyre stack
    }
    g.gfx.scene.add(grp);
    // staff: persistent characters with their own memories of the player
    this.staff.push(() => {
    const keeper = (pid: string, name: string, role: any, x: number, z: number, yaw: number, menu: () => void, look?: string) => {
      const n = g.npcs.spawn(role, d.ox + x, d.oz + z, { name, pid, yaw, scripted: true, groundY: Y, look });
      n.maxHp = n.hp = 90; n.talk = () => { menu(); return true; }; this.keepers.push(n);
      return n;
    };
    if (d.id === 'pub') {
      keeper('len', 'Len Dawkins', 'publican', -1.5, -d.d / 2 + 1.1, 0, () => this.pubMenu());
      keeper('nails', '“Nails”', 'contact', 4.2, 1.3, Math.PI, () => this.nailsMenu(), 'heavy').pose = 'none';
      keeper('vivienne', 'Vivienne Marlowe', 'contact', 5.9, -2.1, Math.PI, () => this.vivienneTalk(), 'marlowe').faction = 'marlowe';
      for (const [x, z] of [[-4.5, 1.6], [-3.6, 2.9], [2, 3]]) { const n = g.npcs.spawn('nightlife', d.ox + x, d.oz + z, { scripted: true, groundY: Y }); n.pose = 'talk'; n.activity = 'having a pint'; this.keepers.push(n); }
    } else if (d.id === 'shop') keeper('farah', 'Farah Aziz', 'shopkeeper', -2, -d.d / 2 + 0.9, 0, () => this.shopMenu());
    else keeper('dezzie', 'Dezzie Marsh', 'mechanic', 4.5, -d.d / 2 + 2.2, Math.PI, () => this.garageMenu());
    });
  }

  /** The interior whose street door the player is standing at (or null). */
  doorNearby(): InteriorDef | null {
    if (this.current) return null;
    const p = this.g.player.pos;
    for (const d of DEFS) { const q = this.g.city.layout.poi(d.poi); if (dist2(p.x, p.z, q.x, q.z) < 2.3) return d; }
    return null;
  }
  atExit(): boolean { const d = this.current, p = this.g.player.pos; return !!d && dist2(p.x, p.z, d.ox, d.oz + d.d / 2 - 0.8) < 1.6; }

  enter(d: InteriorDef): void {
    const g = this.g, p = g.player;
    if (g.police.wanted.level > 0) { g.ui.toast('They’ve bolted the door - not while the police are after you'); return; }
    this.returnPos = [p.pos.x, p.pos.y, p.pos.z, p.yaw];
    this.current = d;
    g.audio.play('door');
    p.teleport(d.ox, Y, d.oz + d.d / 2 - 1.3, Math.PI); g.camera.snapBehind(Math.PI);
    g.gfx.lightOverride = [{ x: d.ox - d.w / 4, y: Y + 3, z: d.oz }, { x: d.ox + d.w / 4, y: Y + 3, z: d.oz }, { x: d.ox, y: Y + 3, z: d.oz - d.d / 3 }];
    g.bus.emit({ type: 'enterInterior', id: d.id });
  }
  exit(): void {
    const g = this.g; if (!this.current) return;
    const q = g.city.layout.poi(this.current.poi);
    this.current = null; g.gfx.lightOverride = null; g.audio.play('door');
    g.player.teleport(q.x, 0.15, q.z, q.yaw); g.camera.snapBehind(q.yaw);
    for (const k of this.keepers) if (k.alive && k.state !== 'scripted' && k.state !== 'ko') { k.setState('scripted'); k.target = null; k.mood = 'wary'; }
    g.bus.emit({ type: 'exitInterior' });
  }
  /** Where a save made indoors should put the player back. */
  streetPos(): [number, number, number, number] | null { if (!this.current) return null; const q = this.g.city.layout.poi(this.current.poi); return [q.x, 0.15, q.z, q.yaw]; }

  // ------------------------------------------------------------------ service menus
  /** Staff who remember being attacked or robbed refuse to serve until you make it right. */
  private barred(pid: string, name: string, open: () => void): boolean {
    const g = this.g, rec = g.state.person(pid);
    if (rec.rel > -30) return false;
    const m = [...rec.mem].reverse()[0];
    g.ui.dialogue([{ who: name, text: `You’re barred. I remember ${m ? recall(g, m) : 'what you did'}. Out.` },
      { who: 'You', text: '', choices: [{ label: 'Apologise and pay £100 for the trouble', pick: () => { if (g.state.spend(100, 'apology')) { rec.rel = -5; g.state.remember(pid, 'apologised', this.current?.name ?? '', 0); g.ui.toast(`${name} accepts the apology`); open(); } else g.ui.toast('You haven’t got £100'); } }, { label: 'Leave it', pick: () => {} }] }]);
    return true;
  }
  private priceFor(pid: string, base: number): number { const r = this.g.state.person(pid).rel; return Math.round(base * (r < -10 ? 1.25 : r > 25 ? 0.9 : 1)); }

  shopMenu(): void {
    const g = this.g, d = g.state.data; g.state.person('farah').met = true;
    if (this.barred('farah', 'Farah', () => this.shopMenu())) return;
    const r = g.state.person('farah').rel;
    g.ui.openShop('Wardour Food & Wine', r < -10 ? 'Farah watches you closely. Prices seem higher than the labels.' : r > 25 ? '“My best customer! Bit off for you.”' : '“Evening, love. Open till late.”', (): ShopItem[] => [
      { label: 'Sausage roll', desc: 'Snack: restores 25 health when eaten [G]', price: this.priceFor('farah', 4), buy: () => { d.items.snack++; g.state.adjustRel('farah', 1); } },
      { label: 'Meal deal', desc: 'Eat now: +50 health', price: this.priceFor('farah', 9), enabled: g.player.hp < g.player.maxHp, buy: () => { g.player.heal(50); g.state.adjustRel('farah', 1); } },
      { label: 'First-aid kit', desc: 'Restores full health when used [G]', price: this.priceFor('farah', 45), buy: () => { d.items.medkit++; g.state.adjustRel('farah', 2); } },
    ]);
  }
  pubMenu(): void {
    const g = this.g; g.state.person('len').met = true;
    if (this.barred('len', 'Len', () => this.pubMenu())) return;
    g.ui.openShop('The Gilded Stag', '“What’ll it be?”', (): ShopItem[] => [
      { label: 'Pint of bitter', desc: '+12 health. Len likes regulars.', price: this.priceFor('len', 6), buy: () => { g.player.heal(12); g.state.adjustRel('len', 2); } },
      { label: 'Pie and chips', desc: '+45 health', price: this.priceFor('len', 11), enabled: g.player.hp < g.player.maxHp, buy: () => { g.player.heal(45); g.state.adjustRel('len', 1); } },
      { label: 'Ask what he’s heard', desc: 'Local gossip', price: 0, buy: () => { g.ui.closeShop(); g.ui.dialogue([{ who: 'Len', text: this.gossip() }]); } },
    ]);
  }
  private gossip(): string {
    const s = this.g.state, n = s.data.notoriety;
    const worst = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    if (worst && worst[1] > 30) return `Word is somebody’s been causing bother round ${worst[0]}. Description sounds a lot like you, if I’m honest.`;
    if (s.done('choose_side')) return s.flag('side') === 'marlowe' ? 'Kestrels are spitting feathers about that van. Watch yourself round the Square.' : 'Vivienne’s lot want a word with whoever took that motor. I’d steer clear of Old Compton Street.';
    if (s.done('delivery')) return 'Two firms, one square mile, and some developer buying up every freehold that catches fire. Funny, that.';
    return 'Quiet. Too quiet. Halcyon Wharf lot were in again, measuring up the building.';
  }
  nailsMenu(): void {
    const g = this.g, c = g.combat; g.state.person('nails').met = true;
    if (this.barred('nails', 'Nails', () => this.nailsMenu())) return;
    g.ui.openShop('“Nails”', '“You didn’t get it from me.”', (): ShopItem[] => {
      const items: ShopItem[] = [];
      if (!c.owns('pistol')) items.push({ label: WEAPONS.pistol.name, desc: 'Handgun with one full magazine', price: WEAPONS.pistol.price, buy: () => { c.give('pistol', 1); c.switchTo('pistol'); } });
      else items.push({ label: 'Pistol magazine', desc: '12 rounds', price: WEAPONS.pistol.magPrice, buy: () => c.give('pistol', 1) });
      if (c.owns('smg')) items.push({ label: 'SMG magazine', desc: '30 rounds', price: WEAPONS.smg.magPrice, buy: () => c.give('smg', 1) });
      else items.push({ label: WEAPONS.smg.name, desc: g.state.done('choose_side') ? 'Compact SMG with one magazine' : 'Not for strangers. Prove yourself to one of the firms first.', price: WEAPONS.smg.price, enabled: g.state.done('choose_side'), buy: () => { c.give('smg', 1); c.switchTo('smg'); } });
      return items;
    });
  }
  private vivienneTalk(): void {
    const g = this.g, s = g.state; s.person('vivienne').met = true;
    const st = s.factionStance('marlowe');
    const text = !s.done('delivery') ? 'This booth is taken, darling.' : st < 0 ? 'You drive for Reeve now. Finish your drink and go, while I’m feeling sentimental.'
      : st > 0 ? 'My family has kept this street honest for sixty years. Stay close and you’ll do very well.' : 'Col tells me you’re reliable. Reliable is rare. Speak to him outside if you want proper work.';
    g.ui.dialogue([{ who: 'Vivienne Marlowe', text }]);
  }
  garageMenu(): void {
    const g = this.g, d = g.state.data; g.state.person('dezzie').met = true;
    if (this.barred('dezzie', 'Dezzie', () => this.garageMenu())) return;
    const bay = g.city.layout.poi('garage_bay');
    const parked = () => g.vehicles.list.find((v) => v.spec.drivable && !v.driver && v.type !== 'police' && dist2(v.x, v.z, bay.x, bay.z) < 26 && (v.owned || v.health < v.spec.health));
    g.ui.openShop('Brewer Street Motors', '“Leave it on the forecourt and I’ll sort it.”', (): ShopItem[] => {
      const items: ShopItem[] = [];
      const v = parked();
      const cost = v ? Math.max(20, Math.round((1 - v.health / v.spec.health) * 160)) : 0;
      items.push({ label: v ? `Repair the ${v.spec.name}` : 'Repair vehicle', desc: v ? (v.health >= v.spec.health ? 'No damage to fix' : `Body at ${Math.round((v.health / v.spec.health) * 100)}%`) : 'Park a damaged vehicle on the forecourt first', price: this.priceFor('dezzie', cost),
        enabled: !!v && v.health < v.spec.health, buy: () => { v!.repair(); g.state.adjustRel('dezzie', 2); g.ui.toast('Vehicle repaired'); } });
      for (const t of d.vehicles as VehicleType[]) items.push({ label: `Bring round the ${VEHICLES[t].name}`, desc: t === d.activeVehicle ? 'Your current vehicle - delivered to the forecourt' : 'Owned', price: 0, buy: () => { d.activeVehicle = t; g.deliverOwnedVehicle(bay.x, bay.z, bay.yaw); g.ui.toast(`${VEHICLES[t].name} is on the forecourt`); } });
      for (const st of GARAGE_STOCK) if (!d.vehicles.includes(st.type)) {
        const locked = !!st.needs && !g.state.done(st.needs);
        items.push({ label: `Buy ${VEHICLES[st.type].name}`, desc: locked ? 'Dezzie only sells these to people he trusts (finish HEAT ON THE STREETS)' : `Top speed ${Math.round(VEHICLES[st.type].maxSpeed * 2.237)} mph`, price: this.priceFor('dezzie', VEHICLES[st.type].price), enabled: !locked,
          buy: () => { d.vehicles.push(st.type); d.activeVehicle = st.type; g.deliverOwnedVehicle(bay.x, bay.z, bay.yaw); g.state.adjustRel('dezzie', 5); g.ui.toast(`You own a ${VEHICLES[st.type].name}`); } });
      }
      return items;
    });
  }
}
