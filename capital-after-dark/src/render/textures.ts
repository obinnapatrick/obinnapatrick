// All surface art is painted procedurally on canvases at start-up: no third-party image assets.
// Art direction: early-2000s console look - hand-painted grime, strong signage, limited palettes.
import * as THREE from 'three';
import { mulberry32 } from '../core/util';

type Ctx = CanvasRenderingContext2D;
function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function noise(g: Ctx, w: number, h: number, amount: number, r: () => number) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
/** Vertical dirt streaks and blotches: what stops surfaces looking like clean plastic. */
function grime(g: Ctx, w: number, h: number, r: () => number, strength = 1) {
  for (let i = 0; i < 26 * strength; i++) {
    const x = r() * w, y = r() * h, len = 20 + r() * h * 0.4, wd = 2 + r() * 10;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, `rgba(8,8,10,${0.10 + r() * 0.16})`); gr.addColorStop(1, 'rgba(8,8,10,0)');
    g.fillStyle = gr; g.fillRect(x, y, wd, len);
  }
  for (let i = 0; i < 12 * strength; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '70,60,45'},${0.05 + r() * 0.08})`;
    g.beginPath(); g.ellipse(r() * w, r() * h, 12 + r() * 50, 8 + r() * 30, r() * 3, 0, 7); g.fill();
  }
}
function bricks(g: Ctx, w: number, h: number, base: [number, number, number], r: () => number, bw = 16, bh = 6) {
  g.fillStyle = `rgb(${base[0] * 0.55},${base[1] * 0.55},${base[2] * 0.55})`; g.fillRect(0, 0, w, h); // mortar
  for (let y = 0, row = 0; y < h; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < w; x += bw) {
    const v = 0.78 + r() * 0.36, t = r();
    g.fillStyle = `rgb(${base[0] * v + (t > 0.9 ? 18 : 0)},${base[1] * v},${base[2] * v - (t < 0.08 ? 14 : 0)})`;
    g.fillRect(x + 0.6, y + 0.6, bw - 1.2, bh - 1.2);
  }
}

export interface FacadeStyle { map: THREE.Texture; emissive: THREE.Texture }
interface StyleDef { wall: 'brick' | 'stone' | 'stucco' | 'tile'; base: [number, number, number]; trim: string; arch: boolean; sashes: number; wide?: boolean }
const STYLES: StyleDef[] = [
  { wall: 'brick', base: [150, 122, 82], trim: '#c9c0aa', arch: true, sashes: 2 }, // London stock brick
  { wall: 'stone', base: [158, 150, 134], trim: '#b9b09c', arch: false, sashes: 2 }, // Portland stone
  { wall: 'stucco', base: [176, 166, 142], trim: '#d6cdb6', arch: false, sashes: 3 }, // painted Georgian stucco
  { wall: 'brick', base: [128, 62, 48], trim: '#bfae90', arch: true, sashes: 2 }, // Victorian red brick
  { wall: 'tile', base: [44, 62, 54], trim: '#b9a257', arch: false, sashes: 2 }, // glazed faience (pub / theatre)
  { wall: 'brick', base: [78, 74, 72], trim: '#4c4f55', arch: false, sashes: 1, wide: true }, // sooty post-war block
];
const LIGHTS = ['#ffcf8a', '#ffe2b4', '#ffb86a', '#bcd6ff', '#ffd9a0', '#8fd0ff'];

/** A tile of 4 bays x 4 floors (512 px). One bay = 3.5 m, one floor = 3.4 m. */
export function facadeTexture(style: number): FacadeStyle {
  const S = STYLES[style % STYLES.length], r = mulberry32(style * 131 + 7);
  const W = 512, [c, g] = canvas(W, W), [e, ge] = canvas(W, W);
  if (S.wall === 'brick') bricks(g, W, W, S.base, r);
  else {
    g.fillStyle = `rgb(${S.base})`; g.fillRect(0, 0, W, W);
    if (S.wall === 'stone') { g.strokeStyle = 'rgba(40,36,30,0.35)'; g.lineWidth = 1.5; for (let y = 0; y < W; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let x = (y / 32 % 2) * 32; x < W; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } } }
    if (S.wall === 'tile') { g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; for (let y = 0; y < W; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } for (let x = 0; x < W; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, W); g.stroke(); } }
  }
  noise(g, W, W, 22, r);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, W);
  const F = W / 4;
  for (let fy = 0; fy < 4; fy++) {
    // string course / cornice between storeys
    g.fillStyle = S.trim; g.fillRect(0, fy * F + F - 9, W, 7); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, fy * F + F - 2, W, 3);
    for (let bx = 0; bx < 4; bx++) {
      const ww = S.wide ? 86 : 54, wh = S.wide ? 58 : 82, x = bx * F + (F - ww) / 2, y = fy * F + (S.wide ? 30 : 16);
      // surround, lintel / brick arch, sill
      g.fillStyle = S.trim; g.fillRect(x - 5, y - 5, ww + 10, wh + 9);
      if (S.arch) { g.fillStyle = `rgb(${S.base[0] * 0.75 + 40},${S.base[1] * 0.5},${S.base[2] * 0.45})`; g.beginPath(); g.ellipse(x + ww / 2, y - 2, ww / 2 + 6, 12, 0, Math.PI, 0); g.fill(); }
      g.fillStyle = S.trim; g.fillRect(x - 9, y + wh + 3, ww + 18, 6);
      const lit = r() < 0.38, col = LIGHTS[Math.floor(r() * LIGHTS.length)];
      g.fillStyle = lit ? col : `rgb(${14 + r() * 10},${18 + r() * 10},${26 + r() * 12})`; g.fillRect(x, y, ww, wh);
      if (lit) {
        ge.fillStyle = col; ge.globalAlpha = 0.5 + r() * 0.5; ge.fillRect(x, y, ww, wh); ge.globalAlpha = 1;
        const blind = r();
        if (blind < 0.45) { const bh = wh * (0.25 + r() * 0.45); g.fillStyle = 'rgba(60,40,24,0.55)'; g.fillRect(x, y, ww, bh); ge.fillStyle = 'rgba(0,0,0,0.55)'; ge.fillRect(x, y, ww, bh); } // drawn blind
        else if (blind < 0.7) { for (const sx of [x, x + ww * 0.72]) { g.fillStyle = 'rgba(90,30,30,0.6)'; g.fillRect(sx, y, ww * 0.28, wh); ge.fillStyle = 'rgba(0,0,0,0.5)'; ge.fillRect(sx, y, ww * 0.28, wh); } } // curtains
        if (r() < 0.3) { g.fillStyle = 'rgba(0,0,0,0.6)'; const px = x + 8 + r() * (ww - 26); g.fillRect(px, y + wh - 34, 14, 34); g.beginPath(); g.arc(px + 7, y + wh - 40, 7, 0, 7); g.fill(); ge.fillStyle = '#000'; ge.fillRect(px, y + wh - 34, 14, 34); } // someone at the window
      } else { const gr = g.createLinearGradient(x, y, x + ww, y + wh); gr.addColorStop(0, 'rgba(120,140,170,0.16)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, y, ww, wh); }
      // glazing bars
      g.strokeStyle = S.wide ? '#2a2c30' : '#e4dfd2'; g.lineWidth = 2.5; ge.strokeStyle = '#000'; ge.lineWidth = 2.5;
      for (const cx of [g, ge]) { cx.beginPath(); for (let k = 1; k < S.sashes + 1; k++) { cx.moveTo(x + (ww * k) / (S.sashes + 1), y); cx.lineTo(x + (ww * k) / (S.sashes + 1), y + wh); } cx.moveTo(x, y + wh / 2); cx.lineTo(x + ww, y + wh / 2); cx.stroke(); cx.strokeRect(x, y, ww, wh); }
      // soot under the sill, the odd air-con box
      const st = g.createLinearGradient(0, y + wh + 9, 0, y + wh + 40); st.addColorStop(0, 'rgba(0,0,0,0.32)'); st.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = st; g.fillRect(x - 4, y + wh + 9, ww + 8, 32);
      if (r() < 0.12) { g.fillStyle = '#8d9094'; g.fillRect(x + ww - 26, y + wh - 2, 26, 16); g.fillStyle = '#3a3c40'; g.fillRect(x + ww - 22, y + wh + 2, 18, 8); }
    }
  }
  // a drainpipe and general filth
  g.fillStyle = '#1c1d20'; g.fillRect(F * 2 - 3, 0, 5, W); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(F * 2 - 3, 0, 1.5, W);
  grime(g, W, W, r, 1.4);
  return { map: tex(c), emissive: tex(e) };
}

/** Slate mansard with lit dormers, for the set-back top storey. Tile = 4 bays x 1 floor. */
export function mansardTexture(): FacadeStyle {
  const r = mulberry32(51), [c, g] = canvas(512, 128), [e, ge] = canvas(512, 128);
  g.fillStyle = '#23262c'; g.fillRect(0, 0, 512, 128); ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 128);
  for (let y = 0, row = 0; y < 128; y += 9, row++) for (let x = -(row % 2) * 9; x < 512; x += 18) { g.fillStyle = `rgba(${90 + r() * 50},${100 + r() * 50},${120 + r() * 50},${0.10 + r() * 0.12})`; g.fillRect(x + 1, y + 1, 16, 7); }
  for (let b = 0; b < 4; b++) { const x = b * 128 + 40, lit = r() < 0.4; g.fillStyle = '#34373d'; g.fillRect(x - 6, 26, 60, 82); g.fillStyle = lit ? '#ffcf8a' : '#11151c'; g.fillRect(x, 34, 48, 66); if (lit) { ge.fillStyle = '#ffcf8a'; ge.fillRect(x, 34, 48, 66); } g.strokeStyle = '#ddd6c6'; g.lineWidth = 2; g.strokeRect(x, 34, 48, 66); g.beginPath(); g.moveTo(x + 24, 34); g.lineTo(x + 24, 100); g.stroke(); }
  g.fillStyle = '#4a4d52'; g.fillRect(0, 0, 512, 6);
  return { map: tex(c), emissive: tex(e) };
}

export function brickWallTexture(): THREE.Texture { // blank party walls and alley sides, with fly-posters
  const r = mulberry32(77), [c, g] = canvas(512, 512);
  bricks(g, 512, 512, [104, 84, 64], r); noise(g, 512, 512, 20, r); grime(g, 512, 512, r, 2.2);
  const cols = ['#d8d0b8', '#c2452e', '#e9c84a', '#3c78b4', '#e8e4d8', '#d86a9a'];
  for (let i = 0; i < 9; i++) { const x = r() * 440, y = 330 + r() * 120, w = 36 + r() * 30, h = 50 + r() * 26; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.globalAlpha = 0.85; g.fillRect(x, y, w, h); g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 5, y + 8, w - 10, 6); g.fillRect(x + 5, y + 20, w * 0.5, 4); g.fillRect(x + 5, y + h - 14, w - 10, 3); }
  g.strokeStyle = 'rgba(230,230,230,0.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 300); g.bezierCurveTo(90, 250, 120, 330, 170, 280); g.bezierCurveTo(190, 262, 220, 300, 250, 270); g.stroke(); // a tag
  return tex(c);
}

const SHOP_COLOURS = ['#17301f', '#4a0f18', '#101c36', '#1c1c1e', '#5a3c0c', '#33163f', '#0b3a3a', '#6a2410', '#2b2f18', '#0d0d0f'];
const LETTER = ['#f1ead6', '#e3bf5a', '#ff7ac0', '#7df3ff', '#ffe14a', '#ffffff', '#ff5a3a'];
const FONTS = ['bold $px Georgia, "Times New Roman", serif', 'bold $px "Arial Narrow", Arial, sans-serif', 'italic bold $px Georgia, serif', 'bold $px "Trebuchet MS", Verdana, sans-serif', 'bold $px Impact, "Arial Black", sans-serif'];

/** A shopfront strip: pilasters, fascia + cornice, glazing with a display, recessed door, stall-riser. */
export function shopfrontTexture(name: string, widthM: number, seed: number, kind = 'shop'): THREE.Texture {
  const r = mulberry32(seed);
  const W = Math.min(768, Math.max(256, Math.round(widthM * 40))), H = 192;
  const [c, g] = canvas(W, H);
  const dark = kind === 'garage' || kind === 'lockup';
  const col = kind === 'pub' ? '#142a1c' : kind === 'police' ? '#16223f' : dark ? '#1c2024' : kind === 'theatre' ? '#3a0a12' : kind === 'shop' && name.includes('Food') ? '#0f3d24' : SHOP_COLOURS[Math.floor(r() * SHOP_COLOURS.length)];
  const shut = !kind || kind === 'shop' ? r() < 0.16 && !name.includes('Food') : false; // closed for the night: roller shutter
  g.fillStyle = col; g.fillRect(0, 0, W, H);
  // fascia with cornice and lettering
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, W, 5); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 50, W, 5);
  const ink = kind === 'pub' ? '#e3bf5a' : kind === 'police' ? '#ffffff' : LETTER[Math.floor(r() * LETTER.length)];
  const font = kind === 'pub' || kind === 'theatre' ? FONTS[0] : FONTS[Math.floor(r() * FONTS.length)];
  let size = 34; const txt = name.toUpperCase();
  do { g.font = font.replace('$', String(size)); size -= 2; } while (g.measureText(txt).width > W - 40 && size > 11);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = ink; g.shadowBlur = 10; g.fillStyle = ink; g.fillText(txt, W / 2, 28); g.shadowBlur = 0; g.fillText(txt, W / 2, 28);
  // bays
  const glow = kind === 'pub' ? '#f0a04a' : kind === 'theatre' ? '#ffd27a' : ['#ffe2a8', '#fff0d0', '#d2e6ff', '#ffc87c', '#ffb8cf', '#c8ffd8', '#fff6e6'][Math.floor(r() * 7)];
  const bays = Math.max(2, Math.round(widthM / 3.2)), bw = (W - 16) / bays, doorBay = Math.floor(r() * bays);
  for (let i = 0; i < bays; i++) {
    const x = 8 + i * bw + 5, w = bw - 10, door = !dark && i === doorBay;
    if (dark || shut) { // roller shutter
      g.fillStyle = dark ? '#3a4046' : '#5b5f63'; g.fillRect(x, 60, w, 132);
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1.5; for (let y = 64; y < H; y += 7) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
      if (r() < 0.7) { g.strokeStyle = ['#e8e8e8', '#ff5a8a', '#58d0ff', '#ffe14a'][Math.floor(r() * 4)]; g.globalAlpha = 0.6; g.lineWidth = 3; g.beginPath(); const sx = x + 8 + r() * w * 0.3, sy = 120 + r() * 30; g.moveTo(sx, sy); g.bezierCurveTo(sx + 20, sy - 40, sx + 34, sy + 30, sx + 54, sy - 12); g.stroke(); g.globalAlpha = 1; }
      continue;
    }
    const top = 62, bottom = door ? H : H - 26;
    const gr = g.createLinearGradient(0, top, 0, bottom); gr.addColorStop(0, glow); gr.addColorStop(1, kind === 'pub' ? '#7a4a20' : '#a89878');
    g.fillStyle = gr; g.fillRect(x, top, w, bottom - top);
    if (kind === 'pub') { g.fillStyle = 'rgba(255,240,200,0.35)'; g.fillRect(x, top + 30, w, bottom - top - 30); g.strokeStyle = 'rgba(60,30,10,0.6)'; g.lineWidth = 2; for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(x + (w * k) / 3, top); g.lineTo(x + (w * k) / 3, bottom); g.stroke(); } g.beginPath(); g.moveTo(x, top + 30); g.lineTo(x + w, top + 30); g.stroke(); }
    else if (kind === 'theatre') { if (!door) { g.fillStyle = '#1a0a0c'; g.fillRect(x + 8, top + 10, w - 16, bottom - top - 22); g.fillStyle = ['#c23a2e', '#2e5ec2', '#e0b030', '#7a2ec2'][i % 4]; g.fillRect(x + 12, top + 14, w - 24, bottom - top - 30); g.fillStyle = '#fff'; g.fillRect(x + 18, top + 24, w - 36, 8); g.fillRect(x + 18, bottom - 34, (w - 36) * 0.6, 5); } }
    else if (door) { g.fillStyle = 'rgba(30,20,10,0.35)'; g.fillRect(x, top, w, bottom - top); }
    else for (let k = 0; k < 7; k++) { // stock on shelves / people inside, as dark shapes against the light
      const sw = 6 + r() * 16, sh = 10 + r() * 44, sx = x + 3 + r() * (w - sw - 6);
      g.fillStyle = `rgba(${30 + r() * 90},${20 + r() * 60},${14 + r() * 50},${0.5 + r() * 0.3})`; g.fillRect(sx, bottom - 6 - sh, sw, sh);
    }
    if (!door && r() < 0.45 && kind !== 'pub' && kind !== 'theatre') { // window sticker
      const st = ['SALE', 'OPEN', '24H', 'TOP-UP', 'NEWS', 'CASH', '2 FOR 1', 'HOT FOOD', 'LOTTO'][Math.floor(r() * 9)];
      g.fillStyle = ['#d81e1e', '#ffe14a', '#1e6ad8', '#111'][Math.floor(r() * 4)]; const sw = Math.min(w - 8, 70); g.fillRect(x + 4, top + 6, sw, 20); g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.fillText(st, x + 4 + sw / 2, top + 17, sw - 6);
    }
    g.strokeStyle = col; g.lineWidth = 4; g.strokeRect(x, top, w, bottom - top);
    if (door) { g.fillStyle = '#c9b458'; g.fillRect(x + w * 0.74, top + 70, 4, 14); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.strokeRect(x + 6, top + 6, w - 12, bottom - top - 8); }
  }
  // pilasters and a scuffed stall-riser
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 56, 8, H); g.fillRect(W - 8, 56, 8, H);
  const gb = g.createLinearGradient(0, H - 30, 0, H); gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = gb; g.fillRect(0, H - 30, W, 30);
  grime(g, W, H, r, 0.5);
  return tex(c, false);
}

/** City of Westminster style nameplate: white, black street name, red postcode. */
export function streetSignTexture(name: string): THREE.Texture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#f2f1ea'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(5, 5, 502, 118);
  g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle';
  let size = 54; g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
  while (g.measureText(name.toUpperCase()).width > 400 && size > 20) { size -= 2; g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`; }
  g.fillText(name.toUpperCase(), 22, 54);
  g.fillStyle = '#c8102e'; g.font = 'bold 44px Arial, sans-serif'; g.textAlign = 'right'; g.fillText('W1', 492, 54);
  g.font = 'bold 20px Arial, sans-serif'; g.textAlign = 'left'; g.fillText('CITY OF WESTMINSTER', 22, 102);
  g.fillStyle = 'rgba(60,50,30,0.18)'; for (let i = 0; i < 5; i++) g.fillRect(40 + i * 97, 8, 14, 112);
  return tex(c, false);
}

/** Neon tube lettering. `vertical` stacks the letters for projecting blade signs. */
export function neonTexture(text: string, colour: string, vertical = false, box = false): THREE.Texture {
  const [c, g] = vertical ? canvas(128, 512) : canvas(512, 128);
  const W = c.width, H = c.height;
  if (box) { g.fillStyle = 'rgba(8,8,12,0.92)'; g.fillRect(0, 0, W, H); g.strokeStyle = colour; g.lineWidth = 5; g.shadowColor = colour; g.shadowBlur = 14; g.strokeRect(7, 7, W - 14, H - 14); g.shadowBlur = 0; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const draw = (t: string, x: number, y: number, max: number) => {
    g.shadowColor = colour; g.shadowBlur = 20; g.fillStyle = colour; g.fillText(t, x, y, max); g.fillText(t, x, y, max);
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(t, x, y, max);
  };
  if (vertical) {
    const n = text.length, step = Math.min(84, (H - 40) / n); g.font = `bold ${Math.min(80, step * 0.95)}px "Trebuchet MS", Arial, sans-serif`;
    for (let i = 0; i < n; i++) draw(text[i], W / 2, 20 + step * (i + 0.5) + (H - 40 - step * n) / 2, W - 30);
  } else {
    let size = 80; g.font = `bold ${size}px "Trebuchet MS", Arial, sans-serif`;
    while (g.measureText(text).width > W - 40 && size > 18) { size -= 3; g.font = `bold ${size}px "Trebuchet MS", Arial, sans-serif`; }
    draw(text, W / 2, H / 2, W - 30);
  }
  return tex(c, false);
}

/** Theatre canopy edge: a row of chaser bulbs with the show title. */
export function marqueeTexture(title: string): THREE.Texture {
  const [c, g] = canvas(1024, 160);
  g.fillStyle = '#16070a'; g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#fff3d0'; g.fillRect(20, 26, 984, 108);
  g.fillStyle = '#12090a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 74px Impact, "Arial Black", sans-serif'; g.fillText(title.toUpperCase(), 512, 84, 940);
  for (let i = 0; i < 40; i++) for (const y of [12, 148]) { g.fillStyle = i % 2 ? '#ffd76a' : '#fff6dc'; g.shadowColor = '#ffc040'; g.shadowBlur = 8; g.beginPath(); g.arc(14 + i * 25.6, y, 6, 0, 7); g.fill(); }
  g.shadowBlur = 0;
  return tex(c, false);
}

/** Fictional adverts for the big LED screens, drawn bright with a visible pixel grid. */
export const AD_COUNT = 8;
export function billboardTexture(frame: number): THREE.Texture {
  const ads: [string, string, string, string, string][] = [
    ['NIGHT OWL', 'CARS · 24 HRS', '#ffd23a', '#0c0c26', '#ff3a6a'], ['HALCYON WHARF', 'A NEW LONDON ADDRESS', '#ffffff', '#0a5a86', '#7df3ff'],
    ['BRERA', 'ESPRESSO · NEGRONI', '#fff0dc', '#b01c1c', '#ffd23a'], ['KESTREL', 'COURIERS · W1 IN AN HOUR', '#062626', '#27e0cc', '#ffffff'],
    ['CORINTHIAN', 'THE NEW MUSICAL', '#ffd76a', '#3a0e5a', '#ff5ad0'], ['VESPER GT', 'DRIVE THE NIGHT', '#ffffff', '#c20f1e', '#101010'],
    ['FIZZ!', 'COLA · ICE COLD', '#ffffff', '#e01228', '#ffe14a'], ['SKYLINE', 'MOBILE · TALK ALL NIGHT', '#0a1040', '#ffe14a', '#ff3a6a'],
  ];
  const [c, g] = canvas(512, 256);
  const [a, b, fg, bg, accent] = ads[frame % ads.length];
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  g.fillStyle = accent; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(0, 256); g.lineTo(190, 256); g.lineTo(60, 0); g.lineTo(0, 0); g.fill(); g.globalAlpha = 1;
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 86px Impact, "Arial Black", sans-serif'; g.fillText(a, 270, 104, 440);
  g.font = 'bold 30px "Arial Narrow", Arial'; g.fillText(b, 270, 190, 440);
  g.fillStyle = 'rgba(0,0,0,0.28)'; for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 512, 1); for (let x = 0; x < 512; x += 4) g.fillRect(x, 0, 1, 256); // LED lattice
  return tex(c, false);
}

export function asphaltTexture(): THREE.Texture {
  const r = mulberry32(9), [c, g] = canvas(512, 512);
  g.fillStyle = '#17181b'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${150 + r() * 70},${150 + r() * 70},${150 + r() * 80},${0.03 + r() * 0.07})`; g.fillRect(r() * 512, r() * 512, 1.4, 1.4); } // aggregate
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${6 + r() * 14},${6 + r() * 14},${8 + r() * 14},0.55)`; const w = 50 + r() * 130, h = 30 + r() * 90; g.fillRect(r() * 512, r() * 512, w, h); } // trench repairs
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.3; for (let i = 0; i < 10; i++) { let x = r() * 512, y = r() * 512; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); } // cracks
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(0,0,0,${0.18 + r() * 0.2})`; g.beginPath(); g.ellipse(r() * 512, r() * 512, 8 + r() * 30, 5 + r() * 16, r() * 3, 0, 7); g.fill(); } // oil
  const t = tex(c); t.repeat.set(46, 46); return t;
}
export function pavingTexture(): THREE.Texture {
  const r = mulberry32(21), [c, g] = canvas(512, 512);
  g.fillStyle = '#4e5052'; g.fillRect(0, 0, 512, 512);
  for (let y = 0, row = 0; y < 512; y += 128, row++) for (let x = -(row % 2) * 96; x < 512; x += 192) { const v = 66 + r() * 34; g.fillStyle = `rgb(${v},${v + 1},${v + 3})`; g.fillRect(x + 2, y + 2, 188, 124); }
  noise(g, 512, 512, 22, r);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '15,15,16' : '190,190,185'},${0.25 + r() * 0.3})`; g.beginPath(); g.arc(r() * 512, r() * 512, 1.5 + r() * 3, 0, 7); g.fill(); } // chewing gum
  for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.14})`; g.beginPath(); g.ellipse(r() * 512, r() * 512, 20 + r() * 60, 12 + r() * 34, r() * 3, 0, 7); g.fill(); } // damp patches
  return tex(c);
}

/** Road paint as transparent decals. */
export function decalTexture(kind: 'lookRight' | 'lookLeft' | 'box' | 'busStop' | 'manhole' | 'slow'): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256); g.textAlign = 'center'; g.textBaseline = 'middle';
  if (kind === 'box') { g.strokeStyle = 'rgba(214,176,26,0.9)'; g.lineWidth = 5; g.strokeRect(4, 4, 248, 248); for (let i = -256; i < 256; i += 36) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 256, 256); g.moveTo(i + 256, 0); g.lineTo(i, 256); g.stroke(); } }
  else if (kind === 'manhole') { g.fillStyle = '#0e0e10'; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.fill(); g.strokeStyle = '#3a3c40'; g.lineWidth = 8; g.stroke(); g.lineWidth = 4; for (let i = -90; i <= 90; i += 30) { g.beginPath(); g.moveTo(128 + i, 50); g.lineTo(128 + i, 206); g.stroke(); } }
  else { g.fillStyle = 'rgba(232,232,224,0.92)'; g.font = 'bold 88px "Arial Narrow", Impact, sans-serif'; const t = kind === 'lookRight' ? ['LOOK', 'RIGHT'] : kind === 'lookLeft' ? ['LOOK', 'LEFT'] : kind === 'busStop' ? ['BUS', 'STOP'] : ['SLOW', '']; g.save(); g.scale(1, 1.25); g.fillText(t[0], 128, 58, 240); g.fillText(t[1], 128, 146, 240); g.restore(); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`; g.fillRect(Math.random() * 256, Math.random() * 256, 12, 5); } }
  return tex(c, false);
}

/** Soft radial sprite used for lamp glows and ground light pools. */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return tex(c, false);
}
/** Light spilling out of a doorway or headlamp: bright at one edge, fading away from it. */
export function spillTexture(): THREE.Texture {
  const [c, g] = canvas(64, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 128);
  const side = g.createLinearGradient(0, 0, 64, 0); side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.25, 'rgba(0,0,0,0)'); side.addColorStop(0.75, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = side; g.fillRect(0, 0, 64, 128);
  return tex(c, false);
}

/** Night sky dome: black zenith, dirty sodium glow on the horizon, low cloud. */
export function skyTexture(): THREE.Texture {
  const r = mulberry32(5), [c, g] = canvas(1024, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#04050a'); grd.addColorStop(0.28, '#0a0c18'); grd.addColorStop(0.42, '#1a1624'); grd.addColorStop(0.49, '#4a2c22'); grd.addColorStop(0.5, '#5a3424'); grd.addColorStop(1, '#0a0806');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 60; i++) { const x = r() * 1024, y = 60 + r() * 190, w = 80 + r() * 260, h = 14 + r() * 36; const cg = g.createRadialGradient(x, y, 0, x, y, w); cg.addColorStop(0, `rgba(${70 + r() * 40},${46 + r() * 20},${44 + r() * 20},${0.10 + r() * 0.12})`); cg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = cg; g.save(); g.translate(x, y); g.scale(1, h / w); g.translate(-x, -y); g.fillRect(x - w, y - w, w * 2, w * 2); g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A tiny equirect "night city" used as the reflection environment for car paint and wet paving. */
export function envTexture(): THREE.Texture {
  const r = mulberry32(3), [c, g] = canvas(512, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#05070e'); grd.addColorStop(0.45, '#181a28'); grd.addColorStop(0.5, '#4a3626'); grd.addColorStop(0.56, '#0c0d10'); grd.addColorStop(1, '#030304');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 110; i++) { g.fillStyle = ['#ffb766', '#ff4a8a', '#6ad8ff', '#fff1c8', '#ffd04a', '#ff3b30', '#b06aff'][Math.floor(r() * 7)]; g.globalAlpha = 0.4 + r() * 0.6; g.fillRect(r() * 512, 92 + r() * 48, 2 + r() * 12, 2 + r() * 9); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function labelTexture(text: string, fg = '#fff', bg = '#000', w = 256, h = 64): THREE.Texture {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = h * 0.62; g.font = `bold ${size}px Arial, sans-serif`;
  while (g.measureText(text).width > w - 10 && size > 8) { size -= 2; g.font = `bold ${size}px Arial, sans-serif`; }
  g.fillText(text, w / 2, h / 2 + 1);
  return tex(c, false);
}
/** Green debris netting for scaffolds (transparent weave). */
export function nettingTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = 'rgba(24,70,48,0.72)'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(10,30,20,0.7)'; g.lineWidth = 1; for (let i = 0; i < 64; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 20, 64, 10);
  return tex(c);
}
/** Paid-for poster for bus shelters and hoardings. */
export function posterTexture(i: number): THREE.Texture {
  const P: [string, string, string, string][] = [['FIZZ!', 'ICE COLD', '#e01228', '#fff'], ['CORINTHIAN', 'NOW BOOKING', '#3a0e5a', '#ffd76a'], ['SKYLINE', 'MOBILE', '#ffe14a', '#0a1040'], ['HALCYON', 'WHARF', '#0a5a86', '#fff'], ['EVENING', 'DISPATCH', '#f2efe4', '#111'], ['VESPER', 'GT', '#101010', '#e01228']];
  const [a, b, bg, fg] = P[i % P.length], [c, g] = canvas(128, 192);
  g.fillStyle = bg; g.fillRect(0, 0, 128, 192); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 30px Impact, "Arial Black", sans-serif'; g.fillText(a, 64, 70, 116); g.font = 'bold 20px Arial'; g.fillText(b, 64, 110, 116);
  g.fillStyle = fg; g.globalAlpha = 0.5; g.fillRect(14, 150, 100, 4); g.fillRect(30, 162, 68, 3);
  return tex(c, false);
}
