// All sounds synthesized with WebAudio: scrubbing noise per tool, bells for cleaned tiles, wet paint dabs, chords.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic, semitones

export type ScrubTool = 0 | 1 | 2 | 3 | 4 | 5; // none, brush, swab, scalpel, burnisher, varnish brush

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private out!: GainNode; // effects bus
  private mus!: GainNode; // music bus
  private verb!: GainNode;
  private noise!: AudioBuffer;
  private scrubGain!: GainNode;
  private scrubBand!: BiquadFilterNode;
  private scrubHi!: BiquadFilterNode;
  private scrubTool: ScrubTool = 0;
  private lastChip = 0;
  private lastScrub = 0;
  muted = false;
  sfxOn = true;
  musicOn = true;
  private music: Music | null = null;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.sfxOn ? 1 : 0;
    this.out.connect(this.master);
    this.mus = ctx.createGain();
    this.mus.gain.value = this.musicOn ? 1 : 0;
    this.mus.connect(this.master);
    // small room: generated impulse response
    const conv = ctx.createConvolver();
    conv.buffer = room(ctx, 2.2, 3.2);
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.28;
    this.verb.connect(conv).connect(this.out);
    // pinkish noise loop
    const nl = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, nl, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nl; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.9;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.scrubHi = ctx.createBiquadFilter();
    this.scrubHi.type = 'highpass';
    this.scrubHi.frequency.value = 300;
    this.scrubBand = ctx.createBiquadFilter();
    this.scrubBand.type = 'bandpass';
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    src.connect(this.scrubHi).connect(this.scrubBand).connect(this.scrubGain).connect(this.out);
    src.start();
    // the scrub must never hang on (a lost pointerup): silence it when nobody has fed it for a moment
    setInterval(() => {
      if (this.ctx && this.ctx.currentTime - this.lastScrub > 0.15) this.scrubGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }, 100);
    this.music = new Music(ctx, this.mus);
    this.music.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }
  /** Page hidden: stop the clock (battery), resume when back. */
  pause(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend(); else void this.ctx.resume();
  }
  setSfx(on: boolean) {
    this.sfxOn = on;
    if (this.ctx) this.out.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.mus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.4);
  }
  /** Mood of the music: 0 calm (cleaning), 1 brighter (retouch), 2 celebratory (finale). */
  mood(m: number) { this.music?.setMood(m); }

  /** Continuous scrubbing: intensity 0..1 from stroke speed, dirt 0..1 under the tool (dirty = fuller, clean = thinner). */
  scrub(tool: ScrubTool, intensity: number, dirt: number) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    if (tool) this.lastScrub = t;
    if (tool !== this.scrubTool) this.scrubTool = tool;
    let f = 1000, q = 1, g = 0;
    if (tool === 1) { f = 3800 - dirt * 1400; q = 0.6; g = 0.5; }
    else if (tool === 2) { f = 1300 - dirt * 400; q = 1.3; g = 0.75; }
    else if (tool === 3) { f = 2600 + (1 - dirt) * 1500; q = 5; g = 0.6; }
    else if (tool === 4) { f = 2200 + dirt * 4400; q = 2 + dirt * 7; g = 0.22 + dirt * 0.16; } // burnisher: `dirt` is shine, the note climbs
    else if (tool === 5) { f = 650; q = 0.8; g = 0.7; }
    this.scrubBand.frequency.setTargetAtTime(f, t, 0.04);
    this.scrubBand.Q.setTargetAtTime(q, t, 0.04);
    const level = tool === 4 ? g * Math.min(1, intensity) : tool ? g * Math.min(1, intensity) * (0.35 + 0.65 * Math.min(1, dirt * 1.5 + 0.15)) : 0;
    this.scrubGain.gain.setTargetAtTime(level, t, tool ? 0.03 : 0.08);
    if (tool === 3 && dirt > 0.25 && intensity > 0.1 && t - this.lastChip > 0.05 + Math.random() * 0.12) {
      this.lastChip = t;
      this.click(2500 + Math.random() * 2500, 0.05 + dirt * 0.1);
    }
  }

  private click(freq: number, vol: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 8;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(bp).connect(g).connect(this.out);
    s.start(t, Math.random() * 1.5, 0.04);
  }

  private bell(freq: number, vol: number, when = 0, decay = 1.6) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(this.out);
    g.connect(this.verb);
    const parts: [number, number, number][] = [[1, 1, 1], [2.0, 0.35, 0.6], [3.0, 0.14, 0.4], [4.2, 0.08, 0.25]];
    for (const [r, a, dk] of parts) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * r * (1 + (Math.random() - 0.5) * 0.002);
      const og = c.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(a * vol, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t + decay * dk);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay * dk + 0.05);
    }
    g.gain.setValueAtTime(1, t);
  }

  private note(step: number, base = 523.25) {
    const oct = Math.floor(step / 5);
    const semi = PENTA[((step % 5) + 5) % 5] + oct * 12;
    return base * Math.pow(2, semi / 12);
  }

  /** A cleaned tile: bells climb the scale as more tiles get done. */
  ding(step: number) {
    this.bell(this.note(step % 10, 659.25), 0.16, 0, 1.4);
  }

  /** A whole layer gone / stage done. */
  chord(root = 0, big = false) {
    const steps = big ? [0, 2, 4, 5, 7] : [0, 2, 4];
    steps.forEach((s, i) => this.bell(this.note(root + s, big ? 392 : 523.25), big ? 0.16 : 0.13, i * (big ? 0.11 : 0.08), big ? 2.8 : 1.8));
  }

  /** Paint going onto the canvas: a soft wet dab, pitched by the paint. size 0..1 (area). */
  dab(paint: number, size: number) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const f0 = this.note(paint % 10, 261.6);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0 * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.12);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.16, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.2);
    // bristles on canvas
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.25 + size * 0.4);
    lp.Q.value = 0.8;
    const g = c.createGain();
    const dur = 0.2 + size * 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1 + size * 0.12, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(g).connect(this.out);
    g.connect(this.verb);
    s.start(t, Math.random(), dur + 0.05);
  }

  /** A leaf of gold leaving the booklet: a papery rustle with a tiny metallic shimmer. */
  rustle() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 5; i++) g.gain.linearRampToValueAtTime((0.05 + Math.random() * 0.08), t + 0.02 + i * 0.045);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    s.connect(hp).connect(g).connect(this.out);
    s.start(t, Math.random(), 0.4);
    this.bell(2400 + Math.random() * 600, 0.02, 0.05, 0.5);
  }

  /** A leaf of gold settling on the bole: a soft papery pat. */
  pat() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(lp).connect(g).connect(this.out);
    s.start(t, Math.random(), 0.15);
    this.bell(3100 + Math.random() * 500, 0.015, 0, 0.6);
  }

  /** Needle through canvas: a short thread pull per stitch. */
  stitch(n: number) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < Math.min(3, n); i++) {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      const t0 = t + i * 0.05;
      bp.frequency.setValueAtTime(1800 + Math.random() * 600, t0);
      bp.frequency.exponentialRampToValueAtTime(4200, t0 + 0.09);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.09, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      s.connect(bp).connect(g).connect(this.out);
      s.start(t0, Math.random(), 0.15);
      this.click(3200 + Math.random() * 800, 0.06);
    }
  }

  /** A dried dropping cracking under the spatula (hold 0..1 raises the pitch). */
  crackle(hold: number) {
    if (!this.ctx) return;
    this.click(1200 + hold * 2400 + Math.random() * 600, 0.05 + hold * 0.08);
  }

  /** ...and popping off. */
  pop() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.16);
    for (let i = 0; i < 4; i++) setTimeout(() => this.click(2000 + Math.random() * 3000, 0.07), 40 + i * 35 + Math.random() * 30);
  }

  /** Wrong paint for this field: a dry little tick. */
  tick() {
    const c = this.ctx;
    if (!c) return;
    this.click(900, 0.12);
  }

  /** Paint finished: small arpeggio. */
  paintDone(paint: number) {
    [0, 2, 4, 7].forEach((s, i) => this.bell(this.note(paint % 5 + s, 523.25), 0.12, i * 0.07, 1.5));
  }

  swish(vol = 0.12) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3500, t + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    s.connect(bp).connect(g).connect(this.out);
    g.connect(this.verb);
    s.start(t, Math.random(), 0.8);
  }
}

function room(ctx: AudioContext, secs: number, curve: number) {
  const len = Math.floor(ctx.sampleRate * secs);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curve);
  }
  return ir;
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Background music: a slow, dreamy piece in F major, 4/4 at about 80 bpm, composed so there's a tune to hum.
 * Seventh and ninth chords (Fmaj7, Am7, B♭maj7, Dm9, C9sus) under a syncopated melody whose hook rises by a
 * leap; the accompaniment is a flowing eighth-note arpeggio (harp / kalimba), the melody a soft vibraphone-like
 * tone with a slow tremolo. Form A A' B, then a few bars of arpeggio alone to breathe; every pass varies a little
 * (melody an octave down, an echo, a second voice a third below). Mood 0 (cleaning): quarter-note arpeggio and a
 * quieter tune; 1 (retouch, gilding): full; 2 (varnish, finale): a little faster, with high bells.
 */
type Note = [number, number, number]; // start (eighths), length (eighths), midi
type Bar = { ch: string; mel: Note[] };
const CHORDS: Record<string, number[]> = {
  Fmaj7: [41, 48, 52, 57, 60], Am7: [45, 52, 55, 60, 64], Bbmaj7: [46, 53, 57, 62, 65], C6: [48, 55, 57, 64, 67],
  Dm9: [50, 57, 60, 64, 65], Gm7: [43, 50, 53, 58, 62], C9sus: [48, 55, 58, 62, 65], C: [48, 55, 60, 64, 67], Dm7: [50, 57, 60, 65, 69],
};
const bars = (chs: string, mel: Note[][]): Bar[] => chs.split(' ').map((ch, i) => ({ ch, mel: mel[i] ?? [] }));
const HOOK: Note[] = [[1, 1, 76], [2, 1, 77], [3, 3, 81], [6, 2, 79]];
const A1 = bars('Fmaj7 Am7 Bbmaj7 C6', [
  HOOK, [[0, 2, 76], [2, 1, 74], [3, 3, 76], [6, 2, 72]],
  [[1, 1, 74], [2, 1, 76], [3, 3, 77], [6, 1, 76], [7, 1, 74]], [[0, 2, 74], [2, 6, 79]],
]);
const A2 = bars('Fmaj7 Am7 Dm9 C9sus', [
  HOOK, [[0, 2, 76], [2, 1, 74], [3, 3, 76], [6, 2, 81]],
  [[0, 3, 77], [3, 1, 76], [4, 4, 74]], [[0, 2, 72], [2, 2, 70], [4, 4, 72]],
]);
const B = bars('Bbmaj7 C Am7 Dm7 Gm7 C9sus Fmaj7 Fmaj7', [
  [[0, 1, 81], [1, 1, 79], [2, 2, 77], [4, 3, 74], [7, 1, 77]], [[0, 3, 79], [3, 1, 77], [4, 4, 76]],
  [[0, 1, 76], [1, 1, 77], [2, 2, 79], [4, 3, 84], [7, 1, 81]], [[0, 6, 81], [6, 2, 77]],
  [[0, 2, 79], [2, 2, 77], [4, 2, 74], [6, 2, 70]], [[0, 6, 72], [6, 2, 74]],
  [[0, 8, 76]], [],
]);
const BREATH = bars('Fmaj7 Bbmaj7 Fmaj7 C9sus', []);
const SONG: { bars: Bar[]; tune: boolean }[] = [
  { bars: A1, tune: true }, { bars: A2, tune: true }, { bars: B, tune: true }, { bars: A1, tune: true }, { bars: A2, tune: true },
  { bars: BREATH, tune: false },
];
const ARP = [0, 1, 2, 3, 4, 3, 2, 1]; // up and down the voicing, one note per eighth
const F_MAJOR = [5, 7, 9, 10, 0, 2, 4];
/** The note a diatonic third below in F major. */
function thirdBelow(n: number) {
  const i = F_MAJOR.indexOf(((n % 12) + 12) % 12);
  if (i < 0) return n - 4;
  const pc = F_MAJOR[(i + 5) % 7];
  let d = ((n % 12) - pc + 12) % 12;
  if (d === 0) d = 12;
  return n - d;
}

class Music {
  private bus: GainNode;
  private verb: GainNode;
  private next = 0;
  private sec = 0;
  private bar = 0;
  private pass = 0;
  private moodV = 0;
  private padNodes: { o: OscillatorNode; g: GainNode }[] = [];
  private padChord = '';
  constructor(private ctx: AudioContext, out: GainNode) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.55;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4600;
    this.bus.connect(lp).connect(out);
    const conv = ctx.createConvolver();
    conv.buffer = room(ctx, 4.2, 2.2);
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.55;
    this.verb.connect(conv).connect(out);
  }
  setMood(m: number) { this.moodV = m; }
  start() {
    this.next = this.ctx.currentTime + 0.5;
    setInterval(() => this.schedule(), 150);
  }
  /** Seconds per eighth note. */
  private get eighth() { return 30 / (76 + this.moodV * 4); }
  schedule(ahead = 0.9) {
    const c = this.ctx;
    while (this.next < c.currentTime + ahead) {
      const section = SONG[this.sec];
      const bar = section.bars[this.bar];
      const t0 = this.next, e = this.eighth, m = this.moodV;
      const v = CHORDS[bar.ch];
      if (bar.ch !== this.padChord) { this.pad(bar.ch, t0); this.padChord = bar.ch; }
      const hum = () => (Math.random() - 0.5) * 0.014;
      // arpeggio: eighths, or quarters while cleaning; a little swing on the off-beats
      for (let i = 0; i < 8; i++) {
        if (m === 0 && i % 2 === 1) continue;
        const n = v[ARP[i]];
        const swing = i % 2 === 1 ? e * 0.08 : 0;
        const vol = i === 0 ? 0.05 : (i % 2 ? 0.016 : 0.022) * (m === 0 ? 0.85 : 1);
        this.note(midi(n), t0 + i * e + swing + hum(), vol, i === 0 ? 'bass' : 'harp');
      }
      if (section.tune) {
        const pv = this.pass % 3;
        for (const [st, len, n] of bar.mel) {
          const low = pv === 1 && this.sec !== 2 ? -12 : 0;
          const vol = (m === 0 ? 0.05 : 0.064) * (st % 2 ? 0.9 : 1);
          const t = t0 + st * e + hum();
          this.note(midi(n + low), t, vol, 'vibe', len * e);
          // second pass: a soft second voice a third below on the long notes
          if (pv === 2 && len >= 3) this.note(midi(thirdBelow(n) + low), t + 0.02, vol * 0.45, 'vibe', len * e);
          // an echo an octave up after long notes, now and then
          if (pv === 0 && len >= 4 && Math.random() < 0.5) this.note(midi(n + 12), t + 2 * e, vol * 0.25, 'harp');
        }
      } else if (this.bar === 1) {
        // breathing bars: a lone high note to keep the thread
        this.note(midi(v[4] + 12), t0 + 2 * e, 0.03, 'vibe', 4 * e);
      }
      if (m >= 2 && this.bar % 2 === 0) this.note(midi(v[3] + 24), t0 + 0.01, 0.018, 'bell');
      this.next += 8 * e;
      if (++this.bar >= section.bars.length) {
        this.bar = 0;
        if (++this.sec >= SONG.length) { this.sec = 0; this.pass++; }
      }
    }
  }
  private note(f: number, t: number, vol: number, kind: 'vibe' | 'harp' | 'bass' | 'bell', hold = 0) {
    const c = this.ctx;
    t = Math.max(t, c.currentTime + 0.005);
    const g = c.createGain();
    g.connect(this.bus);
    if (kind !== 'bass') g.connect(this.verb);
    // vibraphone-ish: soft attack, a faint 4th partial, slow tremolo; harp: brighter and short
    const dec = kind === 'vibe' ? Math.max(1.6, hold * 1.6) : kind === 'bass' ? 2.6 : kind === 'bell' ? 3.0 : 1.2;
    const parts: [number, number, number][] = kind === 'vibe' ? [[1, 1, 1], [4.0, 0.1, 0.25], [2.0, 0.06, 0.5]]
      : kind === 'bell' ? [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.12, 0.25]]
      : kind === 'bass' ? [[1, 1, 1], [2, 0.18, 0.4]] : [[1, 1, 1], [2.002, 0.3, 0.35], [3.0, 0.08, 0.2]];
    const atk = kind === 'vibe' ? 0.012 : kind === 'bass' ? 0.015 : 0.004;
    for (const [r, a, dk] of parts) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * r;
      const og = c.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(a * vol, t + atk);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dec * dk);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dec * dk + 0.05);
    }
    if (kind === 'vibe') {
      // the vibraphone's motor: a slow wobble in loudness
      const lfo = c.createOscillator();
      lfo.frequency.value = 4.8;
      const lg = c.createGain();
      lg.gain.value = 0.18;
      g.gain.value = 0.82;
      lfo.connect(lg).connect(g.gain);
      lfo.start(t);
      lfo.stop(t + dec + 0.05);
    }
  }
  private pad(name: string, t: number) {
    const c = this.ctx;
    for (const p of this.padNodes) {
      p.g.gain.cancelScheduledValues(t);
      p.g.gain.setTargetAtTime(0, t, 0.7);
      p.o.stop(t + 3);
    }
    this.padNodes = [];
    const v = CHORDS[name];
    for (const n of [v[1] + 12, v[2] + 12, v[4] + 12]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(n);
      o.detune.value = (Math.random() - 0.5) * 10;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = c.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.008, t, 1.0);
      o.connect(lp).connect(g).connect(this.bus);
      g.connect(this.verb);
      o.start(t);
      this.padNodes.push({ o, g });
    }
  }
}

/** Dev: render `seconds` of the music offline (to listen to it outside the game). */
export async function renderMusic(seconds: number, mood: number) {
  const off = new OfflineAudioContext(2, Math.round(44100 * seconds), 44100);
  const out = off.createGain();
  out.gain.value = 0.9;
  out.connect(off.destination);
  const m = new Music(off as unknown as AudioContext, out);
  m.setMood(mood);
  m.schedule(seconds - 3);
  return off.startRendering();
}

export const sound = new Sound();
