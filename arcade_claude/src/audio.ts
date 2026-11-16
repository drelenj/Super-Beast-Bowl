// Procedural WebAudio SFX (no audio files). Starts only after unlock() (first user gesture), respects `muted`,
// and never throws when AudioContext is unavailable.
type AC = AudioContext;
let ac: AC | null = null, master: GainNode | null = null, noiseBuf: AudioBuffer | null = null, amb: GainNode | null = null;
let lastPlay: Record<string, number> = {};

function loadMuted(): boolean { try { return localStorage.getItem('sbb_muted') === '1'; } catch { return false; } }
function noise(c: AC) { if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }
function env(c: AC, v: number, a: number, d: number, t0: number) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(v, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); g.connect(master!); return g; }
function tone(c: AC, type: OscillatorType, f0: number, f1: number, v: number, a: number, d: number, t0: number) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + a + d); o.connect(env(c, v, a, d, t0)); o.start(t0); o.stop(t0 + a + d + 0.05); }
function hiss(c: AC, type: BiquadFilterType, f0: number, f1: number, q: number, v: number, a: number, d: number, t0: number) { const n = noise(c), f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + a + d); n.connect(f); f.connect(env(c, v, a, d, t0)); n.start(t0); n.stop(t0 + a + d + 0.05); }

export const audio = {
  muted: loadMuted(),
  unlock(): void {
    try {
      if (!ac) {
        const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctor) return;
        ac = new Ctor() as AC; master = ac.createGain(); master.gain.value = this.muted ? 0 : 0.5; master.connect(ac.destination);
        // low crowd ambience loop: band-passed noise with a slow swell
        const n = noise(ac), f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.5; amb = ac.createGain(); amb.gain.value = 0.05;
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 0.02; lfo.connect(lg); lg.connect(amb.gain); lfo.start();
        n.connect(f); f.connect(amb); amb.connect(master); n.start();
      }
      if (ac.state === 'suspended') void ac.resume();
    } catch { ac = null; }
  },
  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem('sbb_muted', m ? '1' : '0'); } catch { /* storage unavailable */ }
    try { if (ac && master) master.gain.setTargetAtTime(m ? 0 : 0.5, ac.currentTime, 0.03); } catch { /* ignore */ }
  },
  toggle(): boolean { this.setMuted(!this.muted); return this.muted; },
  /** play a named effect: whistle, whistleLong, tackle, catch, throw, arrow, freeze, shatter, goal, crowd */
  play(name: string, v = 1): void {
    if (this.muted || !ac || !master || ac.state !== 'running') return;
    try {
      const c = ac, t = c.currentTime;
      if (t - (lastPlay[name] ?? -9) < 0.07) return; lastPlay[name] = t;
      switch (name) {
        case 'whistle': tone(c, 'square', 2350, 2250, 0.1 * v, 0.01, 0.22, t); tone(c, 'square', 2500, 2400, 0.06 * v, 0.01, 0.22, t); break;
        case 'whistleLong': tone(c, 'square', 2350, 2200, 0.12 * v, 0.02, 0.9, t); tone(c, 'square', 2480, 2330, 0.07 * v, 0.02, 0.9, t); break;
        case 'tackle': tone(c, 'sine', 130, 38, 0.6 * v, 0.004, 0.22, t); hiss(c, 'lowpass', 900, 200, 0.7, 0.35 * v, 0.004, 0.12, t); break;
        case 'catch': hiss(c, 'bandpass', 1800, 900, 1.2, 0.3 * v, 0.003, 0.07, t); tone(c, 'triangle', 300, 180, 0.15 * v, 0.003, 0.07, t); break;
        case 'throw': hiss(c, 'bandpass', 500, 2400, 1.5, 0.22 * v, 0.05, 0.16, t); break;
        case 'arrow': tone(c, 'sawtooth', 620, 150, 0.16 * v, 0.003, 0.16, t); hiss(c, 'highpass', 3000, 6000, 0.7, 0.14 * v, 0.01, 0.14, t); break;
        case 'freeze': for (let i = 0; i < 4; i++) tone(c, 'sine', [1568, 2093, 2637, 3136][i], [1568, 2093, 2637, 3136][i], 0.09 * v, 0.004, 0.35, t + 0.05 + i * 0.045); break;
        case 'shatter': hiss(c, 'highpass', 5000, 2500, 0.8, 0.16 * v, 0.003, 0.2, t); tone(c, 'triangle', 2400, 900, 0.05 * v, 0.003, 0.15, t); break;
        case 'goal': tone(c, 'sawtooth', 196, 190, 0.2 * v, 0.03, 1.1, t); tone(c, 'sawtooth', 247, 240, 0.15 * v, 0.03, 1.1, t); tone(c, 'square', 98, 96, 0.12 * v, 0.03, 1.1, t); hiss(c, 'bandpass', 700, 1300, 0.5, 0.5 * v, 0.5, 2.2, t); break;
        case 'crowd': hiss(c, 'bandpass', 600, 1000, 0.5, 0.3 * v, 0.2, 0.9, t); break;
        default: break;
      }
    } catch { /* never let audio break the game */ }
  },
};
