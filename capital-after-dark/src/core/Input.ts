// Keyboard + mouse state with per-tick edge detection and pointer-lock mouse look.
export class Input {
  private keys = new Set<string>();
  private edges = new Set<string>();
  private btn = [false, false, false];
  private btnEdge = [false, false, false];
  dx = 0; dy = 0; wheel = 0;
  locked = false;
  enabled = true;
  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) { this.keys.add(e.code); this.edges.add(e.code); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.btn = [false, false, false]; });
    el.addEventListener('mousedown', (e) => { if (e.button < 3) { this.btn[e.button] = true; this.btnEdge[e.button] = true; } });
    window.addEventListener('mouseup', (e) => { if (e.button < 3) this.btn[e.button] = false; });
    window.addEventListener('mousemove', (e) => { if (this.locked || this.btn[2] || this.btn[0]) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; } });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
  }
  lock(): void { try { const p = this.el.requestPointerLock() as any; if (p?.catch) p.catch(() => {}); } catch { /* headless / denied */ } }
  unlock(): void { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code: string): boolean { return this.enabled && this.keys.has(code); }
  hit(code: string): boolean { return this.enabled && this.edges.has(code); }
  /** Raw edge (works even while gameplay input is disabled: menus, dialogue). */
  rawHit(code: string): boolean { return this.edges.has(code); }
  mouse(b: number): boolean { return this.enabled && this.btn[b]; }
  mouseHit(b: number): boolean { return this.enabled && this.btnEdge[b]; }
  rawMouseHit(b: number): boolean { return this.btnEdge[b]; }
  axis(neg: string[], pos: string[]): number { return (pos.some((k) => this.down(k)) ? 1 : 0) - (neg.some((k) => this.down(k)) ? 1 : 0); }
  endTick(): void { this.edges.clear(); this.btnEdge = [false, false, false]; this.dx = 0; this.dy = 0; this.wheel = 0; }
  /** Test hook: synthesise input without real DOM events. */
  inject(code: string, isDown: boolean): void { if (isDown) { if (!this.keys.has(code)) this.edges.add(code); this.keys.add(code); } else this.keys.delete(code); }
  injectMouse(b: number, isDown: boolean): void { if (isDown && !this.btn[b]) this.btnEdge[b] = true; this.btn[b] = isDown; }
}
