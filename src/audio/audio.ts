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
 * Background music: a small music-box waltz in D major (3/4, about 70 bpm), composed, not random, so there's a
 * tune to hum. Form A A' B A' and then a few bars of just the accompaniment to breathe; every pass varies a
 * little (melody an octave lower, an echo on the long notes, ornaments) so the loop doesn't wear thin.
 * Accompaniment is a soft oom-pah-pah (bass on one, two chord tones on two and three) over a quiet pad.
 * Mood 0 (cleaning) is slower and sparser, 1 (retouch, gilding) the full waltz, 2 (varnish, finale) adds bells.
 */
type Bar = { ch: string; mel: [number, number | null][] }; // melody: [beats, midi or rest]
const CHORDS: Record<string, [number, number[]]> = {
  D: [50, [62, 66, 69]], 'A/C#': [49, [61, 64, 69]], Bm: [47, [62, 66, 71]], 'F#m': [42, [61, 66, 69]],
  G: [43, [62, 67, 71]], 'D/F#': [42, [62, 66, 69]], Em: [40, [59, 64, 67]], A: [45, [61, 64, 69]], A7: [45, [61, 64, 67]],
};
const bars = (chs: string, mel: [number, number | null][][]): Bar[] => chs.split(' ').map((ch, i) => ({ ch, mel: mel[i] }));
const A1 = bars('D A/C# Bm F#m G D/F# Em A', [
  [[1, 78], [1, 81], [1, 86]], [[2, 85], [1, 83]], [[1, 81], [1, 78], [1, 74]], [[2, 76], [1, 78]],
  [[1, 79], [1, 83], [1, 86]], [[2, 81], [1, 78]], [[1, 79], [1, 78], [1, 76]], [[2, 81], [1, null]],
]);
const A2 = bars('D A/C# Bm F#m G D A7 D', [
  [[1, 78], [1, 81], [1, 86]], [[2, 85], [1, 83]], [[1, 81], [1, 78], [1, 74]], [[2, 76], [1, 78]],
  [[1, 79], [1, 83], [1, 88]], [[2, 86], [1, 85]], [[1, 83], [1, 79], [1, 76]], [[3, 74]],
]);
const B = bars('G A F#m Bm Em A D/F# A7', [
  [[1.5, 86], [0.5, 85], [1, 83]], [[2, 85], [1, 81]], [[1.5, 85], [0.5, 83], [1, 81]], [[2, 83], [1, 78]],
  [[1, 79], [1, 83], [1, 88]], [[1.5, 88], [0.5, 86], [1, 85]], [[1, 86], [1, 81], [1, 78]], [[2, 76], [1, 81]],
]);
const BREATH = bars('D G D A', [[[3, null]], [[3, null]], [[3, null]], [[3, null]]]);
const SONG: { bars: Bar[]; tune: boolean }[] = [
  { bars: A1, tune: true }, { bars: A2, tune: true }, { bars: B, tune: true }, { bars: A2, tune: true }, { bars: BREATH, tune: false },
];

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
    lp.frequency.value = 5200;
    this.bus.connect(lp).connect(out);
    const conv = ctx.createConvolver();
    conv.buffer = room(ctx, 3.8, 2.4);
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.5;
    this.verb.connect(conv).connect(out);
  }
  setMood(m: number) { this.moodV = m; }
  start() {
    this.next = this.ctx.currentTime + 0.5;
    setInterval(() => this.schedule(), 150);
  }
  private get beat() { return 60 / (64 + this.moodV * 5); }
  private schedule() {
    const c = this.ctx;
    // one bar at a time, a little ahead
    while (this.next < c.currentTime + 0.8) {
      const section = SONG[this.sec];
      const bar = section.bars[this.bar];
      const t0 = this.next, bt = this.beat, m = this.moodV;
      const [bass, tones] = CHORDS[bar.ch];
      if (bar.ch !== this.padChord) { this.pad(bar.ch, t0); this.padChord = bar.ch; }
      // oom-pah-pah (sparser while cleaning)
      const hum = () => (Math.random() - 0.5) * 0.012;
      this.pluck(midi(bass), t0 + hum(), 0.05, 'bass');
      if (m >= 1 || this.bar % 2 === 0) this.pluck(midi(tones[1]), t0 + bt + hum(), 0.018, 'soft');
      this.pluck(midi(tones[m >= 1 ? 2 : 1]), t0 + 2 * bt + hum(), m >= 1 ? 0.018 : 0.014, 'soft');
      if (!section.tune && this.bar === 1) this.pluck(midi(tones[2] + 12), t0 + 1.5 * bt, 0.02, 'tune');
      // the tune
      if (section.tune) {
        const v = this.pass % 3;
        let at = 0;
        bar.mel.forEach(([len, n], i) => {
          if (n !== null) {
            const low = v === 1 && this.sec !== 2 ? -12 : 0;
            const vol = (i === 0 ? 0.075 : 0.058) * (m === 0 ? 0.8 : 1);
            this.pluck(midi(n + low), t0 + at * bt + hum(), vol, 'tune');
            // variation 2: an echo an octave up on the long notes
            if (v === 2 && len >= 2) this.pluck(midi(n + 12), t0 + (at + 1) * bt + hum(), vol * 0.35, 'tune');
            // a grace note now and then on the strong beat
            if (v !== 1 && i === 0 && this.bar % 4 === 3 && Math.random() < 0.5) this.pluck(midi(n + 2), t0 + at * bt - 0.07, vol * 0.4, 'tune');
          }
          at += len;
        });
      }
      // finale: bells on the downbeat
      if (m >= 2 && this.bar % 2 === 0) this.pluck(midi(tones[0] + 24), t0 + 0.01, 0.02, 'bell');
      this.next += 3 * bt;
      if (++this.bar >= section.bars.length) {
        this.bar = 0;
        if (++this.sec >= SONG.length) { this.sec = 0; this.pass++; }
      }
    }
  }
  private pluck(f: number, t: number, vol: number, kind: 'tune' | 'soft' | 'bass' | 'bell') {
    const c = this.ctx;
    t = Math.max(t, c.currentTime + 0.005);
    const g = c.createGain();
    g.connect(this.bus);
    if (kind !== 'bass') g.connect(this.verb);
    // music-box tine: fundamental, a bright octave and a faint inharmonic ring; the accompaniment is duller
    const dec = kind === 'bass' ? 2.2 : kind === 'soft' ? 1.4 : kind === 'bell' ? 3.2 : 2.0 + Math.random() * 0.6;
    const parts: [number, number, number][] = kind === 'tune' ? [[1, 1, 1], [2.003, 0.28, 0.4], [4.2, 0.07, 0.12]]
      : kind === 'bell' ? [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.12, 0.25]]
      : kind === 'bass' ? [[1, 1, 1], [2, 0.12, 0.3]] : [[1, 1, 1], [2.004, 0.12, 0.3]];
    for (const [r, a, dk] of parts) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * r;
      const og = c.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(a * vol, t + (kind === 'bass' ? 0.02 : 0.005));
      og.gain.exponentialRampToValueAtTime(0.0001, t + dec * dk);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dec * dk + 0.05);
    }
  }
  private pad(name: string, t: number) {
    const c = this.ctx;
    for (const p of this.padNodes) {
      p.g.gain.cancelScheduledValues(t);
      p.g.gain.setTargetAtTime(0, t, 0.6);
      p.o.stop(t + 3);
    }
    this.padNodes = [];
    const [bass, tones] = CHORDS[name];
    for (const n of [bass + 12, tones[0], tones[2]]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(n);
      o.detune.value = (Math.random() - 0.5) * 8;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;
      const g = c.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.011, t, 0.9);
      o.connect(lp).connect(g).connect(this.bus);
      g.connect(this.verb);
      o.start(t);
      this.padNodes.push({ o, g });
    }
  }
}

export const sound = new Sound();
