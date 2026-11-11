// DOM overlay: menus, HUD, minimap, dialogue, shop panels, banners and toasts.
import type { Game } from '../core/Game';
import type { Npc } from '../npc/Npc';
import { fmtClock, fmtMoney } from '../core/util';
import { ROAD_HALF, WORLD_HALF, XS, ZS, districtAt, streetNameAt } from '../world/layout';
import { FACTIONS, dayName } from '../state/WorldState';
import { saveSettings } from '../state/SaveSystem';
import { WEAPONS } from '../combat/types';

export interface DialogueLine { who: string; text: string; choices?: { label: string; pick: () => void }[] }
export interface ShopItem { label: string; desc?: string; price: number; enabled?: boolean; buy: () => void }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  dialogueActive = false; shopActive = false;
  private lines: DialogueLine[] = []; private lineIdx = 0; private onDialogueDone: (() => void) | null = null;
  private shopItems: (() => ShopItem[]) | null = null; private onShopClose: (() => void) | null = null;
  private barkT = 0; private bannerT = 0; private hurtT = 0; private saveT = 0;
  private mapBase: HTMLCanvasElement; private mctx: CanvasRenderingContext2D;
  private cache: Record<string, string> = {};
  private menuStack: string[] = ['menu-main'];
  private frames = 0; private fpsT = 0; private simMs = 0; showFps = false;
  lastToast = ''; lastBark = ''; lastBanner = '';

  constructor(private g: Game) {
    this.mctx = $<HTMLCanvasElement>('minimap').getContext('2d')!;
    this.mapBase = this.renderMapBase();
    document.querySelectorAll<HTMLButtonElement>('#menu button[data-act]').forEach((b) => b.addEventListener('click', () => { g.audio.start(); g.audio.play('ui'); this.menuAction(b.dataset.act!); }));
    const s = g.settings;
    const q = $<HTMLSelectElement>('set-quality'), vol = $<HTMLInputElement>('set-volume'), sens = $<HTMLInputElement>('set-sens'), inv = $<HTMLInputElement>('set-invert'), fps = $<HTMLInputElement>('set-fps');
    q.value = s.quality; vol.value = String(s.volume); sens.value = String(s.sensitivity); inv.checked = s.invertY;
    const apply = () => {
      s.quality = q.value as any; s.volume = Number(vol.value); s.sensitivity = Number(sens.value); s.invertY = inv.checked; this.showFps = fps.checked;
      g.gfx.setQuality(s.quality); g.audio.setVolume(s.volume); saveSettings(localStorage, s); $('fps').classList.toggle('hidden', !this.showFps);
    };
    [q, vol, sens, inv, fps].forEach((el) => el.addEventListener('input', apply));
    $('dialogue').addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) this.advanceDialogue(); });
  }

  // ------------------------------------------------------------------ menus
  private showPanel(id: string): void { for (const p of ['menu-main', 'menu-pause', 'menu-settings', 'menu-controls']) $(p).classList.toggle('hidden', p !== id); }
  openMenu(root: 'menu-main' | 'menu-pause'): void {
    this.menuStack = [root]; $('menu').classList.remove('hidden'); this.showPanel(root);
    ($('btn-continue') as HTMLButtonElement).disabled = !this.g.saves.hasSave();
    if (root === 'menu-pause') this.renderStanding();
    this.g.input.unlock();
  }
  closeMenu(): void { $('menu').classList.add('hidden'); }
  menuAction(act: string): void {
    const g = this.g;
    switch (act) {
      case 'new': g.newGame(); break;
      case 'continue': g.continueGame(); break;
      case 'resume': g.setPaused(false); break;
      case 'save': g.saveGame('Game saved'); this.renderStanding(); break;
      case 'quit': g.quitToMenu(); break;
      case 'settings': this.menuStack.push('menu-settings'); this.showPanel('menu-settings'); break;
      case 'controls': this.menuStack.push('menu-controls'); this.showPanel('menu-controls'); break;
      case 'back': this.menuStack.pop(); this.showPanel(this.menuStack[this.menuStack.length - 1]); break;
    }
  }
  private renderStanding(): void {
    const d = this.g.state.data;
    const rep = (Object.keys(FACTIONS) as (keyof typeof FACTIONS)[]).map((f) => `${FACTIONS[f].name}: <b>${Math.round(d.rep[f])}</b>`).join(' · ');
    const not = Object.entries(d.notoriety).filter(([, v]) => v > 1).map(([k, v]) => `${k} <b>${Math.round(v)}</b>`).join(' · ') || 'none';
    $('standing').innerHTML = `${dayName(d.day)} ${fmtClock(d.clock)} · ${fmtMoney(d.cash)}<br>Standing - ${rep}<br>Notoriety - ${not}<br>Missions complete: <b>${d.missionsDone.length}</b> / 6 · Fares: <b>${d.stats.fares}</b> · Evaded police: <b>${d.stats.evaded}</b>`;
  }
  showHud(on: boolean): void { $('hud').classList.toggle('hidden', !on); }

  // ------------------------------------------------------------------ messages
  toast(text: string): void {
    this.lastToast = text;
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
    const box = $('toasts'); box.appendChild(el);
    while (box.children.length > 5) box.firstChild!.remove();
    setTimeout(() => el.remove(), 4200);
  }
  bark(who: Npc | string, text: string): void {
    const name = typeof who === 'string' ? who : who.name;
    this.lastBark = text;
    $('bark').innerHTML = ''; const b = document.createElement('b'); b.textContent = name; $('bark').append(b, document.createTextNode(text));
    $('bark').classList.remove('hidden'); this.barkT = 3.6;
  }
  banner(title: string, sub = '', fail = false): void {
    this.lastBanner = title;
    const el = $('banner'); el.classList.remove('hidden'); el.classList.toggle('fail', fail);
    el.querySelector('h1')!.textContent = title; el.querySelector('p')!.textContent = sub; this.bannerT = 5;
  }
  damageFlash(): void { this.hurtT = 0.25; $('vignette').classList.add('hurt'); }
  saveIndicator(text: string): void { $('saveind').textContent = '💾 ' + text; $('saveind').classList.remove('hidden'); this.saveT = 2.5; }
  fade(on: boolean): void { $('fade').classList.toggle('on', on); }

  // ------------------------------------------------------------------ dialogue
  dialogue(lines: DialogueLine[], done?: () => void): void {
    this.lines = lines; this.lineIdx = 0; this.onDialogueDone = done ?? null; this.dialogueActive = true;
    this.g.player.frozen = true; this.g.input.unlock();
    $('dialogue').classList.remove('hidden'); this.renderLine();
  }
  private renderLine(): void {
    const l = this.lines[this.lineIdx];
    $('dwho').textContent = l.who; $('dtext').textContent = l.text;
    const box = $('dchoices'); box.innerHTML = '';
    $('dhint').textContent = l.choices ? 'Press a number to choose' : 'E / Enter to continue';
    l.choices?.forEach((c, i) => { const b = document.createElement('button'); b.textContent = `${i + 1}. ${c.label}`; b.addEventListener('click', () => this.choose(i)); box.appendChild(b); });
  }
  choose(i: number): void {
    const l = this.lines[this.lineIdx]; if (!l?.choices?.[i]) return;
    const c = l.choices[i]; this.g.audio.play('ui');
    this.nextLine(); c.pick();
  }
  advanceDialogue(): void { if (this.dialogueActive && !this.lines[this.lineIdx]?.choices) { this.g.audio.play('ui'); this.nextLine(); } }
  private nextLine(): void {
    this.lineIdx++;
    if (this.lineIdx < this.lines.length) { this.renderLine(); return; }
    this.dialogueActive = false; $('dialogue').classList.add('hidden'); this.g.player.frozen = false;
    const f = this.onDialogueDone; this.onDialogueDone = null;
    if (!this.shopActive) this.g.input.lock();
    f?.();
  }

  // ------------------------------------------------------------------ shops
  openShop(title: string, sub: string, items: () => ShopItem[], onClose?: () => void): void {
    this.shopActive = true; this.shopItems = items; this.onShopClose = onClose ?? null;
    this.g.player.frozen = true; this.g.input.unlock();
    $('shop').classList.remove('hidden'); $('shop').querySelector('h2')!.textContent = title; ($('shop').querySelector('.sub') as HTMLElement).textContent = sub;
    this.renderShop();
  }
  private renderShop(): void {
    const box = $('shopitems'); box.innerHTML = '';
    this.shopItems!().forEach((it, i) => {
      const b = document.createElement('button');
      b.disabled = it.enabled === false;
      b.innerHTML = `<span>${i + 1}. ${it.label}${it.desc ? `<small>${it.desc}</small>` : ''}</span><span class="price">${it.price > 0 ? fmtMoney(it.price) : it.price < 0 ? '+' + fmtMoney(-it.price) : '-'}</span>`;
      b.addEventListener('click', () => this.buy(i)); box.appendChild(b);
    });
  }
  /** Purchases go through WorldState.spend(), so nothing here is decorative. */
  buy(i: number): boolean {
    const it = this.shopItems?.()[i]; if (!it || it.enabled === false) return false;
    if (it.price > 0 && !this.g.state.spend(it.price, it.label)) { this.toast('Not enough cash'); this.g.audio.play('empty'); return false; }
    it.buy(); if (it.price > 0) this.g.audio.play('cash');
    if (this.shopActive) this.renderShop();
    return true;
  }
  closeShop(): void {
    if (!this.shopActive) return;
    this.shopActive = false; $('shop').classList.add('hidden'); this.g.player.frozen = this.dialogueActive;
    if (!this.dialogueActive) this.g.input.lock();
    const f = this.onShopClose; this.onShopClose = null; f?.();
  }

  /** Keyboard handling for modal UI. Called every tick with raw (unsuppressed) input. */
  modalInput(): void {
    const inp = this.g.input;
    if (this.dialogueActive) {
      if (inp.rawHit('KeyE') || inp.rawHit('Enter') || inp.rawHit('Space')) this.advanceDialogue();
      for (let i = 0; i < 4; i++) if (inp.rawHit('Digit' + (i + 1))) this.choose(i);
    } else if (this.shopActive) {
      if (inp.rawHit('Escape') || inp.rawHit('KeyE')) this.closeShop();
      for (let i = 0; i < 9; i++) if (inp.rawHit('Digit' + (i + 1))) this.buy(i);
    }
  }

  // ------------------------------------------------------------------ HUD
  private set(id: string, v: string, html = false): void { if (this.cache[id] !== v) { this.cache[id] = v; if (html) $(id).innerHTML = v; else $(id).textContent = v; } }
  setPrompt(html: string | null): void {
    const el = $('prompt');
    if (!html) { if (this.cache.prompt !== '') { this.cache.prompt = ''; el.classList.add('hidden'); } return; }
    if (this.cache.prompt !== html) { this.cache.prompt = html; el.innerHTML = html; el.classList.remove('hidden'); }
  }
  noteSim(ms: number): void { this.simMs = this.simMs * 0.95 + ms * 0.05; }

  update(dt: number): void {
    const g = this.g, d = g.state.data, p = g.player, w = g.police.wanted;
    if (this.barkT > 0 && (this.barkT -= dt) <= 0) $('bark').classList.add('hidden');
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) $('banner').classList.add('hidden');
    if (this.hurtT > 0 && (this.hurtT -= dt) <= 0) $('vignette').classList.remove('hurt');
    if (this.saveT > 0 && (this.saveT -= dt) <= 0) $('saveind').classList.add('hidden');
    this.set('money', fmtMoney(d.cash));
    let stars = '';
    for (let i = 1; i <= 5; i++) stars += `<span class="${i <= w.level ? 'on' : ''}">★</span>`;
    this.set('stars', stars, true);
    $('stars').classList.toggle('search', w.mode === 'search' && w.level > 0);
    const wd = WEAPONS[g.combat.current], am = g.combat.ammo();
    this.set('weapon', wd.melee ? wd.name : `${wd.name} <b>${am.mag}</b> / ${am.reserve}${g.combat.reloadT > 0 ? ' · reloading' : ''}`, true);
    this.set('veh', p.vehicle ? `${p.vehicle.spec.name} · ${Math.round(Math.abs(p.vehicle.speed) * 2.237)} mph · body ${Math.max(0, Math.round((p.vehicle.health / p.vehicle.spec.health) * 100))}%` : '');
    const hp = Math.max(0, Math.round(p.hp));
    if (this.cache.hp !== String(hp)) { this.cache.hp = String(hp); $('hpfill').style.width = hp + '%'; $('hptext').textContent = `Health ${hp}`; }
    this.set('items', `Snacks ${d.items.snack} · First-aid ${d.items.medkit}  [G]`);
    const inside = g.interiors.current;
    this.set('district', inside ? inside.name : districtAt(p.pos.x, p.pos.z));
    this.set('street', inside ? 'Interior' : streetNameAt(p.pos.x, p.pos.z));
    this.set('clock', `${dayName(d.day)} ${fmtClock(d.clock)}${g.gfx.rainAmount > 0.4 ? ' · rain' : ''}`);
    const m = g.missions;
    this.set('objective', m.objective);
    const t = m.timer;
    this.set('timer', t >= 0 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '');
    $('timer').classList.toggle('low', t >= 0 && t < 20);
    const ch = $('crosshair'); ch.classList.toggle('on', p.gunOut && !p.vehicle && p.alive);
    const arr = g.police.arrest; $('arrest').classList.toggle('hidden', arr <= 0.02); if (arr > 0.02) $('arrestfill').style.width = Math.round(arr * 100) + '%';
    this.drawMinimap();
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 1) {
      if (this.showFps) { const st = g.gfx.stats(); $('fps').textContent = `${Math.round(this.frames / this.fpsT)} fps  sim ${this.simMs.toFixed(2)} ms\n${st.calls} draws  ${(st.triangles / 1000).toFixed(0)}k tris\n${g.npcs.list.length} npcs  ${g.vehicles.list.length} vehicles`; }
      g.perf.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0;
    }
  }

  // ------------------------------------------------------------------ minimap
  private renderMapBase(): HTMLCanvasElement {
    const S = 2, size = WORLD_HALF * 2 * S, c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d')!, L = this.g.city.layout, tx = (v: number) => (v + WORLD_HALF) * S;
    x.fillStyle = '#3a3f4a'; x.fillRect(0, 0, size, size); // roads
    x.fillStyle = '#20242c'; for (const s of L.slabs) x.fillRect(tx(s.x0), tx(s.z0), (s.x1 - s.x0) * S, (s.z1 - s.z0) * S);
    x.fillStyle = '#12151b'; for (const b of L.buildings) x.fillRect(tx(b.x0), tx(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
    x.fillStyle = '#1e3a24'; x.fillRect(tx(89), tx(96), 47 * S, 40 * S);
    x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 1; x.setLineDash([6, 6]);
    for (const sx of XS) { x.beginPath(); x.moveTo(tx(sx), tx(-150 - ROAD_HALF)); x.lineTo(tx(sx), tx(150 + ROAD_HALF)); x.stroke(); }
    for (const sz of ZS) { x.beginPath(); x.moveTo(tx(-150 - ROAD_HALF), tx(sz)); x.lineTo(tx(150 + ROAD_HALF), tx(sz)); x.stroke(); }
    x.setLineDash([]);
    const icon = (id: string, ch: string, col: string) => { const p = L.poi(id); x.fillStyle = col; x.beginPath(); x.arc(tx(p.x), tx(p.z), 9, 0, 7); x.fill(); x.fillStyle = '#000'; x.font = 'bold 13px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, tx(p.x), tx(p.z) + 1); };
    icon('shop', 'S', '#8dff9a'); icon('garage', 'G', '#ffb400'); icon('pub', 'P', '#ff9a5a'); icon('police', '!', '#5aa2ff'); icon('hospital', '+', '#ff6a6a');
    return c;
  }
  private drawMinimap(): void {
    const g = this.g, c = this.mctx, p = g.player, R = 190, half = 95, scale = 1.05;
    c.fillStyle = '#0d1017'; c.fillRect(0, 0, R, R);
    if (g.interiors.current) { c.fillStyle = '#9aa3b2'; c.font = '13px Arial'; c.textAlign = 'center'; c.fillText(g.interiors.current.name, half, half); return; }
    const src = half / scale;
    c.drawImage(this.mapBase, (p.pos.x + WORLD_HALF - src) * 2, (p.pos.z + WORLD_HALF - src) * 2, src * 4, src * 4, 0, 0, R, R);
    const dot = (x: number, z: number, col: string, r = 3.5, clampEdge = false, label = '') => {
      let mx = (x - p.pos.x) * scale + half, my = (z - p.pos.z) * scale + half;
      if (clampEdge) { mx = Math.max(7, Math.min(R - 7, mx)); my = Math.max(7, Math.min(R - 7, my)); } else if (mx < 0 || my < 0 || mx > R || my > R) return;
      c.fillStyle = col; c.beginPath(); c.arc(mx, my, r, 0, 7); c.fill();
      if (label) { c.fillStyle = '#000'; c.font = 'bold 9px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, mx, my + 0.5); }
    };
    for (const v of g.vehicles.list) { if (v.owned && v !== p.vehicle) dot(v.x, v.z, '#ffffff', 4, true, 'C'); else if (v.type === 'police' && v.siren) dot(v.x, v.z, Math.floor(performance.now() / 250) % 2 ? '#5aa2ff' : '#ff5a5a', 4.5); }
    for (const n of g.npcs.list) { if (n.state === 'police') dot(n.pos.x, n.pos.z, '#5aa2ff', 3); else if (n.hostileToPlayer && n.alive && !n.far) dot(n.pos.x, n.pos.z, '#ff5a5a', 3); }
    for (const m of g.fx.markers) dot(m.x, m.z, '#' + m.colour.toString(16).padStart(6, '0'), 6, true, m.icon);
    c.save(); c.translate(half, half); c.rotate(-p.yaw); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, 8); c.lineTo(-5.5, -6); c.lineTo(0, -3); c.lineTo(5.5, -6); c.closePath(); c.fill(); c.stroke(); c.restore();
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.font = 'bold 10px Arial'; c.textAlign = 'center'; c.fillText('N', half, 11);
  }
}
