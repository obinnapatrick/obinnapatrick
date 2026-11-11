// The six story missions. Original characters and plot; all dialogue written for this game.
import type { Game } from '../core/Game';
import type { GameEvent } from '../core/EventBus';
import type { Marker } from '../render/Effects';
import type { Npc } from '../npc/Npc';
import type { Vehicle } from '../vehicles/Vehicle';
import { dist2, fmtMoney } from '../core/util';
import { FACTIONS, FactionId } from '../state/WorldState';
import { Mission } from './Mission';

const MAUREEN = 'Maureen (dispatch)';

// 1 ------------------------------------------------------------------------------------------
export class NightShift extends Mission {
  readonly id = 'night_shift'; readonly title = 'The Night Shift';
  private fare!: Npc; private pick!: Marker; private drop: Marker | null = null; private cabM: Marker | null = null;
  private aboard = false; private bumps = 0; private away = 0; private chat = 0;
  begin(): void {
    const g = this.g;
    g.ensureOwnedVehicleNear(-5.35, 30, Math.PI, 70);
    this.fare = this.npc('office', -118, 82.4, { name: 'Imogen Ward', yaw: Math.PI }); this.fare.activity = 'waiting for a minicab'; this.fare.pose = 'phone';
    this.say([{ who: MAUREEN, text: 'Night Owl Cars to driver seven. You awake, love? Got a pick-up for you.' },
      { who: MAUREEN, text: 'Lady at Piccadilly Circus, by the fountain. Going to the Gilded Stag on Old Compton Street. Account job, so be nice.' },
      { who: 'You', text: 'On my way.' }], () => this.go(0, 'Get in your black cab  [F]'));
    const cab = g.ownedVehicle(); if (cab) this.cabM = this.marker(cab.x, cab.z, 2.6, 0xffffff, 'C');
  }
  tick(dt: number): void {
    const g = this.g, p = g.player, cab = p.vehicle && p.vehicle.owned ? p.vehicle : null;
    if (this.stage === 0) {
      const own = g.ownedVehicle(); if (!own || own.dead) return this.lose('Your cab is a write-off');
      this.cabM?.move(own.x, own.z);
      if (cab) { this.cabM?.remove(); this.cabM = null; this.pick = this.marker(-118, 78.6, 4, 0xffd23a, 'F'); this.go(1, 'Pick up the fare at Piccadilly Circus (keep left!)'); g.ui.toast('W/S accelerate & brake · A/D steer · Space handbrake'); }
      return;
    }
    const own = g.ownedVehicle();
    if (!own || own.dead) return this.lose('Your cab is a write-off');
    if (!this.fare.alive && !this.aboard) return this.lose('The customer was hurt');
    if (!cab) { this.away += dt; if (this.away > 25) return this.lose(this.aboard ? 'The customer got fed up waiting' : 'You abandoned the job'); } else this.away = 0;
    if (this.stage === 1 && cab && this.at(this.pick, true)) { this.pick.remove(); this.fare.pose = 'none'; this.fare.follow = { pos: p.pos }; this.fare.setState('follow'); this.go(2, 'Wait for the customer to get in'); }
    if (this.stage === 2) {
      if (cab && dist2(this.fare.pos.x, this.fare.pos.z, cab.x, cab.z) < 3.2) {
        this.aboard = true; g.npcs.despawn(this.fare); g.audio.play('door');
        this.drop = this.marker(-22.5, -70.6, 4, 0xffd23a, 'D');
        g.ui.bark('Imogen', 'Gilded Stag, please. And I’m late, so…');
        this.go(3, 'Drive to The Gilded Stag, Old Compton Street', 150);
      } else if (this.t > 30) return this.lose('The customer gave up waiting');
    }
    if (this.stage === 3) {
      this.chat += dt;
      if (this.chat > 22) { this.chat = 0; g.ui.bark('Imogen', ['Do you get much trouble, driving nights?', 'Halcyon Wharf are buying our whole building, you know. Everyone’s out by spring.', 'You can go down Wardour Street, it’s quicker.'][Math.floor(this.t / 22) % 3]); }
      if (this.timer <= 0) return this.lose('Too slow - the customer walked');
      if (cab && this.drop && this.at(this.drop, true)) {
        const tip = Math.max(0, 30 - this.bumps * 8) + Math.round(Math.min(20, this.timer / 6));
        const out = g.npcs.spawn('office', cab.x, cab.z - 2.6, { name: 'Imogen Ward' }); out.goalKind = 'pub'; out.goTo(g, -22.5, -67);
        g.state.data.stats.fares++;
        this.say([{ who: 'Imogen', text: this.bumps ? 'Well. We got here. Keep the change, I suppose.' : 'Lovely smooth ride. Thank you - keep the change.' }], () => this.win({ cash: 60 + tip, lines: [`Fare £60 + tip ${fmtMoney(tip)}`] }));
        this.go(4, '');
      }
    }
  }
  event(e: GameEvent): void { if (e.type === 'playerCrash' && this.aboard && this.stage === 3 && e.impact > 5) { this.bumps++; this.g.ui.bark('Imogen', this.bumps > 2 ? 'Are you TRYING to kill us?' : 'Careful!'); } }
}

// 2 ------------------------------------------------------------------------------------------
export class WrongPlace extends Mission {
  readonly id = 'wrong_place'; readonly title = 'Wrong Place';
  private m!: Marker; private gaz: Npc | null = null; private drop: Marker | null = null;
  begin(): void {
    this.say([{ who: MAUREEN, text: 'Driver seven - that account lady left her phone on your back seat. She’s rung in a right state.' },
      { who: MAUREEN, text: 'Says her fella will meet you round the back of the Stag. Stag Passage, the alley. There’s a tenner in it for you.' },
      { who: 'You', text: 'A tenner. For an alley in Soho at this time of night. Fine.' }], () => { this.m = this.marker(-37.5, -40, 2.2, 0xffd23a, 'A'); this.go(0, 'Take the phone to Stag Passage, the alley beside The Gilded Stag (on foot)'); });
  }
  tick(_dt: number): void {
    const g = this.g, p = g.player;
    if (this.stage === 0 && !p.vehicle && this.at(this.m)) {
      this.m.remove();
      const gaz = (this.gaz = this.npc('pedestrian', -37.5, -30, { name: 'Gaz', look: 'heavy', yaw: Math.PI }));
      gaz.maxHp = gaz.hp = 70; gaz.meleeDamage = 7; gaz.skill = 0.25; gaz.bravery = 1; gaz.aggression = 1; gaz.runSpeed = 4.4;
      this.say([{ who: 'Gaz', text: 'That’s Immy’s phone. What you doing with my bird’s phone?' }, { who: 'You', text: 'Giving it back. I’m her cab driver.' },
        { who: 'Gaz', text: 'Course you are. Everyone’s a cab driver. Come here.' }], () => {
        gaz.onDefeated = () => this.gazDown(); gaz.startFight(p);
        this.go(1, 'Defend yourself - put him on the floor');
        g.ui.toast('Left click: punch - keep clicking for a combo'); setTimeout(() => !this.ended && g.ui.toast('Right click: block · Q: dodge · V: kick'), 2600);
      });
    }
    if (this.stage >= 1 && dist2(p.pos.x, p.pos.z, -37.5, -40) > 75) return this.lose('You walked away');
    if (this.stage === 2 && this.drop && !p.vehicle && this.at(this.drop)) {
      this.drop.remove(); this.drop = null;
      g.combat.give('pistol', 2); g.combat.switchTo('pistol'); g.audio.play('pickup');
      g.ui.toast('Picked up: Marlow 9 pistol  [1/2 switch · R reload]');
      this.go(3, '');
      this.say([{ who: 'Col Hartigan', text: 'Easy. Easy! I’m not with him.' }, { who: 'Col Hartigan', text: 'Gaz there owes my employer a great deal of money. You just did in thirty seconds what I’ve been putting off for a week.' },
        { who: 'Col Hartigan', text: 'Keep the shooter - he won’t be needing it. And if a cabbie who can handle himself wants proper work, I’m usually outside the Stag.' }],
      () => { g.state.changeRep('marlowe', 8, false); g.state.remember('col', 'impressed', 'Soho', 15); this.win({ cash: 40, lines: ['Marlowe Firm reputation +8', 'New weapon: Marlow 9 pistol'] }); });
    }
  }
  private gazDown(): void {
    const n = this.gaz!;
    this.drop = this.marker(n.pos.x + 0.8, n.pos.z + 0.6, 1.3, 0x7df3ff, '!');
    this.go(2, 'He dropped something. Pick it up');
  }
}

// 3 ------------------------------------------------------------------------------------------
export class Delivery extends Mission {
  readonly id = 'delivery'; readonly title = 'The Delivery';
  private m!: Marker; private integrity = 100;
  begin(): void {
    this.say([{ who: 'Col Hartigan', text: 'There he is. Got a parcel needs to be on Coventry Street in the next couple of minutes. Kestrel Couriers - the lock-up facing Leicester Square.' },
      { who: 'You', text: 'What’s in it?' }, { who: 'Col Hartigan', text: 'Paper. Fragile paper. Don’t open it, don’t bend it, and don’t bounce it off any buses. Hundred and fifty on arrival.' }],
    () => { this.g.ensureOwnedVehicleNear(-30, -69.65, -Math.PI / 2, 60); this.go(0, 'Get in a vehicle'); });
  }
  tick(_dt: number): void {
    const g = this.g, p = g.player;
    if (this.stage === 0 && p.vehicle) { this.m = this.marker(112.5, 71.2, 4.2, 0xffd23a, 'D'); this.go(1, this.text(), 140); }
    if (this.stage === 1) {
      this.objective = this.text();
      if (this.integrity <= 0) return this.lose('The package was wrecked');
      if (this.timer <= 0) return this.lose('Too late - the Kestrels shut up shop');
      if (this.at(this.m, true)) {
        this.go(2, '');
        this.say([{ who: 'Tobias “Kes” Reeve', text: 'So Vivienne Marlowe is using minicabs now. You know what you just carried across town?' },
          { who: 'You', text: 'Paper. Fragile paper.' },
          { who: 'Kes', text: 'Deeds. Three freeholds on Gerrard Street, signed over to Halcyon Wharf. The old woman is selling the ground out from under all of us and calling it retirement.' },
          { who: 'Kes', text: 'You got it here in one piece through that traffic. I pay better than she does. Think about it.' }],
        () => { g.state.changeRep('marlowe', 10, false); g.state.changeRep('kestrel', 8, false); g.state.remember('kes', 'delivered', 'Leicester Square', 10); this.win({ cash: 150 + Math.round(this.integrity / 2), lines: ['Marlowe Firm +10 · Kestrels +8', 'You now know both crews'] }); });
      }
    }
  }
  private text(): string { return `Deliver the package to Kestrel Couriers, Leicester Square · Package ${Math.max(0, Math.round(this.integrity))}%`; }
  event(e: GameEvent): void { if (e.type === 'playerCrash' && this.stage === 1) { this.integrity -= e.impact * 3.2; this.g.ui.toast('The package took a knock'); } if (e.type === 'playerHurt' && this.stage === 1) this.integrity -= 10; }
}

// 4 ------------------------------------------------------------------------------------------
export class Heat extends Mission {
  readonly id = 'heat'; readonly title = 'Heat on the Streets';
  private car!: Vehicle; private carM: Marker | null = null; private bay: Marker | null = null; private wasWanted = false;
  begin(): void {
    const g = this.g;
    this.car = this.vehicle('sports', 69.65, -40, Math.PI, 0xd81e1e);
    const pc = this.npc('police', 66.6, -34, { yaw: 2.4 }); pc.scripted = false; pc.home = { x: 66.6, z: -34 }; pc.setState('idle'); pc.idleFor = 600; pc.activity = 'watching the street';
    this.say([{ who: 'Kes', text: 'A test. There’s a red Vesper GT on Dean Street belonging to one of Halcyon’s suits. Dezzie at Brewer Street Motors has a buyer.' },
      { who: 'Kes', text: 'One wrinkle: there is a constable stood about ten feet from it. He will see you. So take it, lose him and his friends, and only then go to Dezzie.' },
      { who: 'You', text: 'And if I bring the police to the garage?' }, { who: 'Kes', text: 'Then you’re no use to anyone.' }],
    () => { this.carM = this.marker(this.car.x, this.car.z, 3, 0xffd23a, 'V'); this.go(0, 'Steal the red Vesper GT on Dean Street'); });
  }
  tick(_dt: number): void {
    const g = this.g, p = g.player, w = g.police.wanted;
    if (this.car.dead) return this.lose('The Vesper was wrecked');
    if (this.stage === 0) { this.carM?.move(this.car.x, this.car.z); if (p.vehicle === this.car) { this.carM?.remove(); this.carM = null; this.go(1, 'Lose the police'); } return; }
    if (w.level > 0) this.wasWanted = true;
    if (this.stage === 1 && w.level === 0 && (this.wasWanted || this.t > 6)) {
      const b = g.city.layout.poi('garage_bay'); this.bay = this.marker(b.x, b.z, 4, 0xffd23a, 'G');
      this.go(2, 'Deliver the Vesper to Brewer Street Motors');
    }
    if (this.stage === 2) {
      this.objective = w.level > 0 ? 'Lose the police before you go near the garage' : p.vehicle === this.car ? 'Deliver the Vesper to Brewer Street Motors' : 'Get back in the Vesper';
      if (w.level === 0 && p.vehicle === this.car && this.bay && this.at(this.bay, true)) {
        const cond = this.car.health / this.car.spec.health;
        this.go(3, '');
        p.exitVehicle(true); this.car.locked = true;
        this.say([{ who: 'Dezzie', text: cond > 0.8 ? 'Not a mark on her. You’ve done this before.' : 'She’s seen better days. I’ll knock it off your end.' },
          { who: 'Dezzie', text: 'Any friend of Kes can buy from the back lot. Got a Vesper of my own going, if you’ve the money.' }],
        () => { g.vehicles.remove(this.car); g.state.changeRep('kestrel', 12, false); g.state.remember('dezzie', 'delivered', 'Soho', 12); this.win({ cash: 150 + Math.round(cond * 150), lines: ['Kestrels +12', 'Garage: Vesper GT now for sale'] }); });
      }
    }
  }
}

// 5 ------------------------------------------------------------------------------------------
export class ChooseSide extends Mission {
  readonly id = 'choose_side'; readonly title = 'Choose a Side';
  private target!: Vehicle; private guards: Npc[] = []; private m: Marker | null = null; private warned = 0; private alerted = false;
  constructor(g: Game, private side: FactionId) { super(g); }
  begin(): void {
    const marlowe = this.side === 'marlowe';
    if (marlowe) {
      this.target = this.vehicle('van', 100, 69.65, Math.PI / 2, 0x1e6a66);
      this.guards = [this.npc('kestrel', 103, 67.3, { yaw: 0 }), this.npc('kestrel', 97.5, 67.6, { yaw: 0.5 })];
      this.say([{ who: 'Col Hartigan', text: 'Vivienne’s decided. The Kestrels move everything they own through one teal van. It’s parked outside their lock-up right now.' },
        { who: 'Col Hartigan', text: 'I want it finished. Ram it, shoot it, kick it to bits - I’m not fussy. Do this and you’re Firm. There’s no going back to Reeve afterwards.' }],
      () => { this.m = this.marker(this.target.x, this.target.z, 3.5, 0xff5a5a, 'X'); this.go(0, 'Wreck the Kestrels’ courier van outside their lock-up'); });
    } else {
      this.target = this.vehicle('saloon', -14, -69.65, -Math.PI / 2, 0x8a8f96);
      this.guards = [this.npc('marlowe', -12, -67.4, { yaw: Math.PI }), this.npc('marlowe', -17, -67.2, { yaw: 2.6 })];
      this.say([{ who: 'Kes', text: 'Every night the Firm’s bagman leaves a grey Calder saloon outside the Stag with the week’s takings in the boot.' },
        { who: 'Kes', text: 'Bring it here, boot unopened. Do that, and Vivienne Marlowe will never speak to you again - which is rather the point.' }],
      () => { this.m = this.marker(this.target.x, this.target.z, 3.5, 0xffd23a, 'V'); this.go(0, 'Steal the Firm’s grey saloon outside The Gilded Stag'); });
    }
    this.guards.forEach((n, i) => { n.activity = 'guarding'; n.maxHp = n.hp = 90; if (i === 0) n.setArmed(true, 8); });
  }
  private alert(): void {
    if (this.alerted) return; this.alerted = true;
    for (const n of this.guards) if (n.alive) { n.scripted = true; n.startFight(this.g.player); }
    this.g.ui.bark(this.guards[0], 'It’s the cabbie! Get him!');
  }
  tick(dt: number): void {
    const g = this.g, p = g.player, v = this.target, marlowe = this.side === 'marlowe';
    const d = dist2(p.pos.x, p.pos.z, v.x, v.z);
    if (!this.alerted) {
      if (v.health < v.spec.health - 1 || p.vehicle === v) this.alert();
      else if (d < 6 && !p.vehicle) { this.warned += dt; if (this.warned > 0.2 && this.warned < 0.3) g.ui.bark(this.guards[0], 'Step away from the motor.'); if (this.warned > 3.5) this.alert(); }
    }
    if (marlowe) {
      if (this.stage === 0) { this.m?.move(v.x, v.z); if (v.dead) { this.m?.remove(); this.m = null; this.go(1, 'The van is finished. Get clear of the lock-up'); } }
      else if (this.stage === 1 && d > 70 && g.police.wanted.level === 0) this.finish();
      else if (this.stage === 1) this.objective = d > 70 ? 'Lose the police' : 'The van is finished. Get clear of the lock-up';
    } else {
      if (v.dead) return this.lose('The cash car was wrecked');
      if (this.stage === 0) { this.m?.move(v.x, v.z); if (p.vehicle === v) { this.m?.remove(); this.m = this.marker(112.5, 71.2, 4.2, 0xffd23a, 'D'); this.go(1, 'Deliver the car to the Kestrel lock-up'); } }
      else if (this.stage === 1) {
        this.objective = g.police.wanted.level > 0 ? 'Lose the police, then deliver the car' : p.vehicle === v ? 'Deliver the car to the Kestrel lock-up' : 'Get back in the grey saloon';
        if (p.vehicle === v && g.police.wanted.level === 0 && this.m && this.at(this.m, true)) { p.exitVehicle(true); v.locked = true; this.finish(); }
      }
    }
  }
  private finish(): void {
    const g = this.g, rival = FACTIONS[this.side].rival;
    this.go(9, '');
    const who = this.side === 'marlowe' ? 'Col Hartigan' : 'Kes';
    this.say([{ who, text: this.side === 'marlowe' ? 'I heard it from here. Vivienne says welcome to the Firm - and to give you this. Reeve will want your head now, so use it.' : 'Unopened. Good. You’re a Kestrel now, driver - and the Firm will be looking for you. Take this; you’ll need it in Soho.' }], () => {
      g.state.changeRep(this.side, 35); g.state.changeRep(rival, -18, false); g.state.setFlag('side', this.side);
      g.state.remember(this.side === 'marlowe' ? 'col' : 'kes', 'sided', 'London', 30); g.state.remember(this.side === 'marlowe' ? 'kes' : 'col', 'betrayed', 'London', -40);
      g.combat.give('smg', 3);
      this.win({ cash: 400, lines: [`${FACTIONS[this.side].name} +35 · ${FACTIONS[rival].name} now hostile`, 'New weapon: Kessler Compact SMG'] });
    });
  }
}

// 6 ------------------------------------------------------------------------------------------
export class AfterDark extends Mission {
  readonly id = 'after_dark'; readonly title = 'After Dark';
  private dana!: Npc; private m!: Marker; private heavies: Npc[] = []; private wasWanted = false;
  begin(): void {
    const g = this.g, side = (g.state.flag('side') as FactionId) ?? 'marlowe', boss = side === 'marlowe' ? 'Vivienne Marlowe' : 'Kes';
    this.dana = this.npc('contact', -131, 93, { name: 'Dana Whitlock', look: 'office', yaw: 1 }); this.dana.activity = 'waiting'; this.dana.invulnerable = true;
    this.say([{ who: boss, text: side === 'marlowe' ? 'Somebody torched my club on Brewer Street last month. I blamed Reeve. Reeve blamed me for his depot. We were both wrong.' : 'My depot burned in March. I blamed the old woman. She blamed me for her club. Turns out we’re both mugs.' },
      { who: boss, text: 'Edmund Vale. Halcyon Wharf. He has been paying people in both crews to start those fires, then buying the freeholds for pennies.' },
      { who: boss, text: 'A journalist called Whitlock says she can prove it, if someone brings her the proof. She’s at the Piccadilly fountain. Go and be someone.' }],
    () => { this.m = this.marker(-131, 94.6, 2.4, 0xffd23a, 'J'); this.go(0, 'Meet Dana Whitlock at the Piccadilly Circus fountain'); });
  }
  tick(_dt: number): void {
    const g = this.g, p = g.player, w = g.police.wanted;
    if (this.stage === 0 && !p.vehicle && this.at(this.m)) {
      this.m.remove(); this.go(1, '');
      this.say([{ who: 'Dana Whitlock', text: 'You’re the driver. Good. Vale keeps a paper ledger - he doesn’t trust computers. Every payment, every fire, both firms.' },
        { who: 'Dana Whitlock', text: 'It’s in the site office at Halcyon Wharf, top of Dean Street. He’s hired security that isn’t really security.' },
        { who: 'You', text: 'And once I have it?' }, { who: 'Dana Whitlock', text: 'Bring it to me in Leicester Square and it’s on the front page by morning. Or sell it, I suppose. People usually do.' }], () => {
        const s = g.city.layout.poi('site'); this.m = this.marker(s.x, s.z, 4, 0xffd23a, 'H');
        const spots: [number, number][] = [[112, -100], [121, -108], [104, -112], [126, -121]];
        this.heavies = spots.map(([x, z], i) => { const n = this.npc('heavy', x, z, { yaw: 0 }); n.activity = 'guarding the site'; if (i >= 2) n.setArmed(true, 9); n.onDefeated = () => this.count(); return n; });
        this.dana.pos.set(112.5, 0.15, 104); this.dana.yaw = Math.PI;
        this.go(2, 'Go to the Halcyon Wharf site at the top of Dean Street');
      });
    }
    if (this.stage === 2 && (this.at(this.m) || p.pos.z < -86 && p.pos.x > 85)) {
      this.m.remove();
      for (const n of this.heavies) n.startFight(p);
      g.ui.bark(this.heavies[0], 'Site’s closed! Last warning!');
      this.go(3, this.guardText());
    }
    if (this.stage === 4 && !p.vehicle && this.at(this.m)) {
      this.m.remove(); g.audio.play('pickup');
      g.crime('alarm', { x: p.pos.x, z: p.pos.z });
      g.ui.toast('You have the ledger - and the office alarm just went off');
      this.go(5, 'Lose the police');
    }
    if (this.stage === 5) {
      if (w.level > 0) this.wasWanted = true;
      if (w.level === 0 && (this.wasWanted || this.t > 5)) { this.m = this.marker(112.5, 102.5, 2.4, 0xffd23a, 'J'); this.go(6, 'Take the ledger to Dana Whitlock in Leicester Square'); }
    }
    if (this.stage === 6 && !p.vehicle && this.at(this.m)) { this.m.remove(); this.go(7, ''); this.ending(); }
  }
  private guardText(): string { return `Deal with Vale’s hired security (${this.heavies.filter((h) => !h.alive).length}/${this.heavies.length})`; }
  private count(): void {
    if (this.stage !== 3) { if (this.stage < 3) this.stage = 3; }
    if (this.heavies.every((h) => !h.alive)) { this.m = this.marker(128, -126.6, 1.8, 0x7df3ff, 'L'); this.go(4, 'Take the ledger from the site office'); }
    else this.objective = this.guardText();
  }
  private ending(): void {
    const g = this.g, side = (g.state.flag('side') as FactionId) ?? 'marlowe', boss = FACTIONS[side].leader;
    this.say([{ who: 'Dana Whitlock', text: 'That’s it. That’s his handwriting. You understand what happens to both firms when this runs?' },
      { who: 'You', text: '', choices: [
        { label: 'Print it. All of it.', pick: () => { g.state.setFlag('ending', 'published'); g.state.changeRep('marlowe', 10, false); g.state.changeRep('kestrel', 10, false); g.state.log('story', 'Leicester Square', 'Gave the Halcyon ledger to the press');
          this.say([{ who: 'Dana Whitlock', text: 'Then go home, driver. Tomorrow Soho wakes up and finds out who’s been burning it.' }], () => this.win({ cash: 1500, lines: ['The Halcyon Wharf story runs at dawn', 'Both crews +10'] })); } },
        { label: `Sell it to ${boss} instead`, pick: () => { g.state.setFlag('ending', 'sold'); g.state.changeRep(side, 30); g.state.log('story', 'Leicester Square', `Sold the Halcyon ledger to ${boss}`);
          this.say([{ who: 'Dana Whitlock', text: 'Of course. Everyone does. Mind how you go.' }, { who: boss, text: 'Now Vale works for me. You’ve done very well tonight, driver.' }], () => this.win({ cash: 3000, lines: [`${FACTIONS[side].name} +30`, 'Edmund Vale has a new owner'] })); } }] }]);
  }
}
