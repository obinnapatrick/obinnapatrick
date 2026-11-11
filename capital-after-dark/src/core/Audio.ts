// Every sound is synthesised with WebAudio at run time - no recorded or licensed audio is shipped.
type Sfx = 'punch' | 'hit' | 'gun' | 'smg' | 'reload' | 'empty' | 'cash' | 'ui' | 'crash' | 'horn' | 'door' | 'fail' | 'success' | 'whoosh' | 'radio' | 'pickup' | 'thud';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private engineOsc?: OscillatorNode; private engineGain?: GainNode; private engineFilter?: BiquadFilterNode;
  private rainGain?: GainNode; private cityGain?: GainNode; private sirenGain?: GainNode; private sirenOsc?: OscillatorNode;
  private volume = 0.7;
  private hornTimer = 8;
  played: Record<string, number> = {}; // counters, handy for tests

  /** Must be called from a user gesture (browser autoplay rules). */
  start(): void {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = w * 0.5 + last * 3; }
      const loop = (freq: number, type: BiquadFilterType, q: number) => {
        const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start();
        return g;
      };
      this.rainGain = loop(5200, 'highpass', 0.4);
      this.cityGain = loop(160, 'lowpass', 0.3);
      this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 50;
      this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 300;
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master); this.engineOsc.start();
      this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'square'; this.sirenOsc.frequency.value = 660;
      const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 900; sf.Q.value = 0.8;
      this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(sf); sf.connect(this.sirenGain); this.sirenGain.connect(this.master); this.sirenOsc.start();
    } catch { this.ctx = null; }
  }
  setVolume(v: number): void { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  /** Continuous layers. engine: 0..1 rev or -1 off; siren: 0..1 loudness */
  ambience(dt: number, o: { rain: number; engine: number; siren: number; indoors: boolean; night: number }): void {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    this.rainGain!.gain.setTargetAtTime(o.rain * (o.indoors ? 0.02 : 0.085), t, 0.3);
    this.cityGain!.gain.setTargetAtTime(o.indoors ? 0.05 : 0.3, t, 0.5);
    this.engineGain!.gain.setTargetAtTime(o.engine < 0 ? 0 : 0.05 + o.engine * 0.05, t, 0.08);
    if (o.engine >= 0) { this.engineOsc!.frequency.setTargetAtTime(42 + o.engine * 120, t, 0.06); this.engineFilter!.frequency.setTargetAtTime(240 + o.engine * 900, t, 0.06); }
    this.sirenGain!.gain.setTargetAtTime(o.siren * 0.05, t, 0.2);
    this.sirenOsc!.frequency.setValueAtTime(Math.floor(t * 1.7) % 2 ? 620 : 830, t); // two-tone
    this.hornTimer -= dt;
    if (this.hornTimer <= 0 && !o.indoors) { this.hornTimer = 9 + Math.random() * 16; this.play('horn', 30 + Math.random() * 50); }
  }

  play(name: Sfx, distance = 0): void {
    this.played[name] = (this.played[name] ?? 0) + 1;
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const vol = 1 / (1 + distance / 9);
    if (vol < 0.03) return;
    const t = c.currentTime;
    const out = c.createGain(); out.gain.value = vol; out.connect(this.master);
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, t + delay); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + dur);
      g.gain.setValueAtTime(gain, t + delay); g.gain.exponentialRampToValueAtTime(0.0008, t + delay + dur);
      o.connect(g); g.connect(out); o.start(t + delay); o.stop(t + delay + dur + 0.02);
    };
    const burst = (freq: number, type: BiquadFilterType, dur: number, gain: number, delay = 0) => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.5;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); g.gain.setValueAtTime(gain, t + delay); g.gain.exponentialRampToValueAtTime(0.0008, t + delay + dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(t + delay, Math.random()); s.stop(t + delay + dur + 0.02);
    };
    switch (name) {
      case 'punch': burst(900, 'lowpass', 0.09, 0.5); tone('sine', 150, 60, 0.1, 0.5); break;
      case 'hit': burst(1400, 'lowpass', 0.12, 0.6); tone('sine', 110, 45, 0.16, 0.6); break;
      case 'thud': tone('sine', 90, 35, 0.22, 0.7); burst(400, 'lowpass', 0.15, 0.4); break;
      case 'whoosh': burst(1800, 'bandpass', 0.14, 0.2); break;
      case 'gun': burst(2600, 'lowpass', 0.2, 0.9); tone('square', 220, 50, 0.12, 0.35); break;
      case 'smg': burst(3400, 'lowpass', 0.11, 0.7); tone('square', 260, 70, 0.07, 0.25); break;
      case 'reload': burst(3000, 'bandpass', 0.04, 0.3); burst(2200, 'bandpass', 0.05, 0.35, 0.22); break;
      case 'empty': burst(4000, 'bandpass', 0.03, 0.25); break;
      case 'cash': tone('triangle', 1320, 1320, 0.09, 0.25); tone('triangle', 1760, 1760, 0.2, 0.25, 0.08); break;
      case 'pickup': tone('triangle', 660, 990, 0.14, 0.25); break;
      case 'ui': tone('sine', 520, 620, 0.06, 0.18); break;
      case 'door': burst(500, 'lowpass', 0.18, 0.4); tone('sine', 120, 70, 0.14, 0.3); break;
      case 'radio': burst(2400, 'bandpass', 0.18, 0.18); tone('square', 1200, 1200, 0.05, 0.08, 0.16); break;
      case 'crash': burst(1200, 'lowpass', 0.35, 0.9); burst(5000, 'highpass', 0.25, 0.3, 0.02); tone('sine', 80, 30, 0.3, 0.6); break;
      case 'horn': tone('square', 392, 392, 0.4, 0.14); tone('square', 494, 494, 0.4, 0.12); break;
      case 'fail': tone('sawtooth', 300, 110, 0.6, 0.22); break;
      case 'success': [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.22, 0.22, i * 0.11)); break;
    }
  }
}
