// All surface art is generated procedurally on canvases at start-up: no third-party image assets.
import * as THREE from 'three';
import { mulberry32 } from '../core/util';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
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
function noise(g: CanvasRenderingContext2D, w: number, h: number, amount: number, r: () => number) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}

export interface FacadeStyle { map: THREE.Texture; emissive: THREE.Texture }
const WALLS = ['#6b4a3a', '#cfc6b4', '#8a8478', '#7a5a48', '#3b4a44', '#6f7378']; // London stock brick, Portland stone, stucco...
const TRIM = ['#d8d2c4', '#9c9484', '#d6d0c0', '#c9b79a', '#c8b560', '#4a4e52'];

/** A tile of 4 bays x 4 floors. One bay = 3.5 m, one floor = 3.4 m. */
export function facadeTexture(style: number): FacadeStyle {
  const r = mulberry32(style * 77 + 5);
  const [c, g] = canvas(256, 256), [e, ge] = canvas(256, 256);
  g.fillStyle = WALLS[style % WALLS.length]; g.fillRect(0, 0, 256, 256);
  if (style % 6 === 0 || style % 6 === 3) { // brick courses
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
    for (let y = 0; y < 256; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  }
  noise(g, 256, 256, 18, r);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  for (let fy = 0; fy < 4; fy++) for (let bx = 0; bx < 4; bx++) {
    const x = bx * 64 + 16, y = fy * 64 + 12, w = 32, h = 40;
    g.fillStyle = TRIM[style % TRIM.length]; g.fillRect(x - 3, y - 3, w + 6, h + 7);
    const lit = r() < 0.42;
    const warm = ['#ffd9a0', '#ffe9c4', '#cfe4ff', '#ffc98a'][Math.floor(r() * 4)];
    g.fillStyle = lit ? warm : '#141a22'; g.fillRect(x, y, w, h);
    if (lit) { ge.fillStyle = warm; ge.globalAlpha = 0.55 + r() * 0.45; ge.fillRect(x, y, w, h); ge.globalAlpha = 1; if (r() < 0.5) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y, w, h * (0.2 + r() * 0.4)); ge.fillStyle = 'rgba(0,0,0,0.5)'; ge.fillRect(x, y, w, h * 0.3); } }
    g.strokeStyle = TRIM[style % TRIM.length]; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); // sash bars
    ge.strokeStyle = '#000'; ge.lineWidth = 2; ge.beginPath(); ge.moveTo(x + w / 2, y); ge.lineTo(x + w / 2, y + h); ge.moveTo(x, y + h / 2); ge.lineTo(x + w, y + h / 2); ge.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let fy = 0; fy < 4; fy++) g.fillRect(0, fy * 64 + 60, 256, 2); // string courses
  return { map: tex(c), emissive: tex(e) };
}

const SHOP_COLOURS = ['#1d3b2a', '#5a1420', '#14233f', '#2b2b2b', '#6a4a12', '#3c1d4f', '#0f4a4a', '#7a2a10'];
/** A shopfront strip (sign fascia + glazing). Width given in metres so text scales sensibly. */
export function shopfrontTexture(name: string, widthM: number, seed: number, kind = 'shop'): THREE.Texture {
  const r = mulberry32(seed);
  const W = Math.min(512, Math.max(192, Math.round(widthM * 28))), H = 160;
  const [c, g] = canvas(W, H), [, ge] = canvas(2, 2); // (emissive reuses the colour map to save memory)
  const col = kind === 'pub' ? '#16301f' : kind === 'police' ? '#1b2a4a' : kind === 'garage' ? '#22262a' : kind === 'theatre' ? '#3a0d14' : kind === 'lockup' ? '#12393a' : SHOP_COLOURS[Math.floor(r() * SHOP_COLOURS.length)];
  g.fillStyle = col; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  // glazing
  const glow = kind === 'pub' ? '#ffb45a' : kind === 'garage' || kind === 'lockup' ? '#39424a' : ['#ffe6b0', '#fff2d6', '#d9ecff', '#ffd08a', '#ffc2d4'][Math.floor(r() * 5)];
  const panes = Math.max(2, Math.round(widthM / 3));
  for (let i = 0; i < panes; i++) {
    const x = (i * W) / panes + 6, w = W / panes - 12;
    const door = kind !== 'garage' && kind !== 'lockup' && i === Math.floor(panes / 2);
    g.fillStyle = glow; g.fillRect(x, 52, w, door ? 108 : 86);
    ge.fillStyle = glow; ge.globalAlpha = kind === 'garage' || kind === 'lockup' ? 0.15 : 0.8; ge.fillRect(x, 52, w, door ? 108 : 86); ge.globalAlpha = 1;
    if (kind === 'garage' || kind === 'lockup') { g.strokeStyle = '#20262b'; for (let y = 56; y < 160; y += 8) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); } }
    else for (let k = 0; k < 5; k++) { // silhouettes of stock / punters
      g.fillStyle = `rgba(${40 + r() * 60},${30 + r() * 40},${20 + r() * 40},0.55)`;
      const sw = 6 + r() * 14, sh = 14 + r() * 40; const sx = x + r() * (w - sw);
      g.fillRect(sx, 138 - sh, sw, sh); ge.fillStyle = 'rgba(0,0,0,0.5)'; ge.fillRect(sx, 138 - sh, sw, sh);
    }
    if (door) { g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(x + 2, 54, w - 4, 104); }
  }
  // fascia lettering
  const gold = kind === 'pub' ? '#e8c66a' : kind === 'police' ? '#ffffff' : ['#f4efe0', '#e8c66a', '#ff8ad0', '#7df3ff', '#ffe14a'][Math.floor(r() * 5)];
  let size = 30; g.font = `bold ${size}px Georgia, serif`;
  while (g.measureText(name.toUpperCase()).width > W - 24 && size > 12) { size -= 2; g.font = `bold ${size}px Georgia, serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = gold; g.fillText(name.toUpperCase(), W / 2, 26);
  ge.font = g.font; ge.textAlign = 'center'; ge.textBaseline = 'middle'; ge.fillStyle = gold; ge.fillText(name.toUpperCase(), W / 2, 26);
  return tex(c, false);
}

/** City of Westminster style nameplate: white, black street name, red postcode. */
export function streetSignTexture(name: string): THREE.Texture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#f5f5f0'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(5, 5, 502, 118);
  g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle';
  let size = 54; g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
  while (g.measureText(name.toUpperCase()).width > 400 && size > 20) { size -= 2; g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`; }
  g.fillText(name.toUpperCase(), 22, 54);
  g.fillStyle = '#c8102e'; g.font = 'bold 44px Arial, sans-serif'; g.textAlign = 'right'; g.fillText('W1', 492, 54);
  g.font = 'bold 20px Arial, sans-serif'; g.textAlign = 'left'; g.fillText('CITY OF WESTMINSTER', 22, 102);
  return tex(c, false);
}

export function neonTexture(text: string, colour: string, bg = 'rgba(0,0,0,0)'): THREE.Texture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  let size = 78; g.font = `bold ${size}px "Trebuchet MS", Arial, sans-serif`;
  while (g.measureText(text).width > 480 && size > 18) { size -= 3; g.font = `bold ${size}px "Trebuchet MS", Arial, sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = colour; g.shadowBlur = 22; g.fillStyle = colour; g.fillText(text, 256, 64); g.fillText(text, 256, 64);
  g.shadowBlur = 0; g.fillStyle = '#fff'; g.globalAlpha = 0.75; g.fillText(text, 256, 64);
  return tex(c, false);
}

/** Fictional adverts for the big corner screens. */
export function billboardTexture(frame: number): THREE.Texture {
  const ads: [string, string, string, string][] = [['NIGHT OWL CARS', 'Soho’s minicab since 1987', '#ffcf3a', '#12122a'], ['HALCYON WHARF', 'Luxury riverside living · Phase 2 now selling', '#e8f6ff', '#0b4a66'],
    ['BRERA', 'Espresso · Negroni · Until late', '#ffe9d0', '#7a1c1c'], ['KESTREL COURIERS', 'Same-hour delivery across W1', '#0d2b2b', '#27d6c4'], ['THE CORINTHIAN', 'A New Musical · Booking to March', '#ffd76a', '#32104a']];
  const [c, g] = canvas(512, 256);
  const [a, b, fg, bg] = ads[frame % ads.length];
  const grd = g.createLinearGradient(0, 0, 512, 256); grd.addColorStop(0, bg); grd.addColorStop(1, '#000');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 62px "Trebuchet MS", Arial'; g.fillText(a, 256, 104, 480);
  g.font = '24px Arial'; g.fillText(b, 256, 170, 480);
  return tex(c, false);
}

export function asphaltTexture(): THREE.Texture {
  const r = mulberry32(9);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#23252a'; g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 26, r);
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(10,12,16,${0.15 + r() * 0.2})`; g.beginPath(); g.ellipse(r() * 256, r() * 256, 10 + r() * 30, 6 + r() * 16, r() * 3, 0, 7); g.fill(); }
  const t = tex(c); t.repeat.set(60, 60); return t;
}
export function pavingTexture(): THREE.Texture {
  const r = mulberry32(21);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#7d7f7c'; g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 20, r);
  g.strokeStyle = 'rgba(30,30,30,0.5)'; g.lineWidth = 2;
  for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (let y = 0; y < 4; y++) for (let x = 0; x <= 2; x++) { const ox = (y % 2) * 64 + x * 128; g.beginPath(); g.moveTo(ox, y * 64); g.lineTo(ox, y * 64 + 64); g.stroke(); }
  return tex(c);
}

/** Soft radial sprite used for lamp glows and ground light pools. */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return tex(c, false);
}

/** A tiny equirect "night city" used as the reflection environment for wet roads and car paint. */
export function envTexture(): THREE.Texture {
  const r = mulberry32(3);
  const [c, g] = canvas(512, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#0a1020'); grd.addColorStop(0.45, '#27304a'); grd.addColorStop(0.5, '#5a4a3a'); grd.addColorStop(0.56, '#14161c'); grd.addColorStop(1, '#050608');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = ['#ffb766', '#ff5a8a', '#6ad8ff', '#fff1c8', '#ffd04a', '#ff3b30'][Math.floor(r() * 6)];
    g.globalAlpha = 0.35 + r() * 0.6;
    g.fillRect(r() * 512, 96 + r() * 46, 2 + r() * 10, 2 + r() * 8);
  }
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
