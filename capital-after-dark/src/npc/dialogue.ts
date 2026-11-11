// What people say when you talk to them. Lines are chosen from STORED state (mood, faction standing,
// district notoriety and - for named characters - their individual memories of you).
import type { Game } from '../core/Game';
import { pick } from '../core/util';
import { districtAt } from '../world/layout';
import { dayName, MemoryEntry } from '../state/WorldState';
import type { Npc } from './Npc';

const WHAT: Record<string, string> = { assault: 'laying into someone', gunfire: 'letting off shots', shooting: 'shooting at people', carjack: 'helping yourself to a motor', hitrun: 'driving like a lunatic',
  assaultOfficer: 'going for a copper', vandalism: 'smashing up a car', brawl: 'scrapping in the street', alarm: 'setting the alarms off' };

export function recall(g: Game, m: MemoryEntry): string {
  const d = g.state.data.day - m.day;
  const when = d === 0 ? 'earlier' : d === 1 ? 'last night' : `on ${dayName(m.day)}`;
  return `${when}, ${m.where} - ${WHAT[m.what] ?? m.what}`;
}

const CALM: Record<string, string[]> = {
  pedestrian: ['Sorry, mate, in a rush.', 'You alright?', 'Is it ever going to stop raining?', 'Can’t stop, last tube’s in twenty.', 'Evening.'],
  office: ['Long day. Longer tomorrow.', 'If this is about the minicab, I already paid.', 'Do you know if the Central line’s running?', 'I just want a pint and my bed.'],
  tourist: ['Excuse me - Leicester Square is this way, yes?', 'We have been walking for hours! Wonderful city.', 'Could you take our photo by the fountain?', 'Is it always this wet?'],
  nightlife: ['You coming in or what? Queue’s moving.', 'Best night out in ages, this.', 'Don’t suppose you’ve got a light?', 'Where’s good after two?', 'You a cab? Proper cab or minicab?'],
  cabbie: ['Thirty years I’ve done the Knowledge. Thirty.', 'Minicab, are you? No offence.', 'Shaftesbury Avenue’s solid again.'],
  police: ['Evening. Mind how you go.', 'Keep it sensible tonight, please.', 'Busy night. Move along, there’s a good chap.'],
  contact: ['Not now.'], heavy: ['Site’s closed. Hop it.'], shopkeeper: ['Open till late.'], publican: ['What’ll it be?'], mechanic: ['Be with you in a tick.'],
};

export function barkFor(n: Npc, g: Game): string {
  const s = g.state, hour = s.hour, where = districtAt(n.pos.x, n.pos.z), not = s.notoriety(where);
  if (n.pid) { const line = personLine(n.pid, n, g); if (line) return line; }
  if (n.mood === 'scared') return pick(['Stay away from me!', 'I don’t want any trouble!', 'Please - just leave me alone!']);
  if (n.mood === 'angry') return pick(['You want some, do you?', 'Walk away. Now.']);
  if (n.faction) {
    const st = s.factionStance(n.faction), other = n.faction === 'marlowe' ? 'the Kestrels' : 'the Firm';
    if (st > 0) return n.faction === 'marlowe' ? pick(['Alright, driver. Viv says you’re sound.', 'Firm looks after its own. Need anything, shout.']) : pick(['Kes rates you. That’s rare.', 'Safe. You need something moved, you come to us.']);
    if (st < 0) return pick(['You’ve got some front, showing your face round here.', `Run back to ${other}, yeah?`]);
    return n.faction === 'marlowe' ? pick(['Keep moving, cabbie.', 'This is Firm ground. Behave yourself.']) : pick(['You lost? Square’s that way.', 'We’re working here. Keep walking.']);
  }
  if (n.role === 'police') {
    if (g.police.wanted.level > 0) return 'Stay exactly where you are!';
    if (not > 45) return `We’ve had reports about someone matching your description round ${where}. Anything you want to tell me?`;
    if (not > 15) return 'I’d keep my head down if I were you. People talk.';
  } else if (not > 55) return pick(['I know your face. I don’t want anything to do with you.', `Everyone in ${where} knows what you’ve been up to.`]);
  else if (not > 25 && Math.random() < 0.5) return pick(['You’re the one from the other night, aren’t you…', 'Just… keep your distance, alright?']);
  if (g.gfx.rainAmount > 0.5 && Math.random() < 0.25) return pick(['Filthy night.', 'I’m soaked through.']);
  if ((hour < 5 || hour > 23) && Math.random() < 0.3 && n.role !== 'police') return pick(['Bit late to be out, isn’t it?', 'Night buses. Never again.']);
  return pick(CALM[n.role] ?? CALM.pedestrian);
}

/** Named characters: lines driven by their own memory log and relationship score. */
export function personLine(pid: string, n: Npc, g: Game): string | null {
  const s = g.state, p = s.person(pid), first = !p.met;
  p.met = true;
  const hit = s.lastMemory(pid, 'attacked');
  if (hit && p.rel < -20) return `You’ve got a nerve. ${cap(recallShort(g, hit))} you put me on the floor. I don’t forget that.`;
  const bad = [...p.mem].reverse().find((m) => WHAT[m.what]);
  switch (pid) {
    case 'tommo':
      if (first) return 'Tommo. I play here most nights - see everything, say nothing. Usually.';
      if (bad && p.rel < 0) return `I saw you, ${recall(g, bad)}. Don’t worry, I’m not the talking kind. Not for free.`;
      return p.rel > 15 ? 'There he is! Requests are a fiver, but for you - still a fiver.' : pick(['Spare some change for the band? I’m the band.', 'Quiet tonight. Well - quiet for Piccadilly.']);
    case 'pc_bell':
      if (g.police.wanted.level > 0) return 'Don’t make this worse for yourself!';
      if (bad) return `PC Bell. I’ve a note in my book: ${recall(g, bad)}. I’ve got my eye on you.`;
      return first ? 'PC Bell, West End Central. You’re the Night Owl driver, aren’t you? Drive carefully.' : 'Evening, driver. Quiet shift, I hope.';
    case 'col': {
      const st = s.factionStance('marlowe');
      if (st < 0) return 'Vivienne’s patience with you ran out. So has mine.';
      if (!s.done('wrong_place')) return 'Do I know you? No. Then keep walking.';
      return st > 0 ? 'Viv’s pleased. Stay useful.' : 'You handle yourself alright, for a cabbie. Might have work for you.';
    }
    case 'kes': {
      const st = s.factionStance('kestrel');
      if (st < 0) return 'You chose the old woman’s side. Brave. Stupid, but brave.';
      if (!s.done('delivery')) return 'Kestrel Couriers. We’re closed to walk-ins.';
      return st > 0 ? 'My driver. Soho’s going to look very different soon.' : 'You drive well. The Firm doesn’t deserve you.';
    }
    case 'ines':
      return s.factionStance('kestrel') < 0 ? 'Kes says we don’t talk to you.' : pick(['Parcels in, parcels out. Don’t ask what’s in them.', 'If you’re looking for Kes, he’s busy. He’s always busy.']);
  }
  return null;
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
function recallShort(g: Game, m: MemoryEntry): string { const d = g.state.data.day - m.day; return d === 0 ? 'earlier tonight' : d === 1 ? 'last night' : `on ${dayName(m.day)}`; }
