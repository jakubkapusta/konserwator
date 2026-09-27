// All sounds synthesized with WebAudio: scrubbing noise per tool, bells for cleaned tiles, wet paint dabs, chords.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic, semitones

export type ScrubTool = 0 | 1 | 2 | 3;

export class Sound {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private verb!: GainNode;
  private noise!: AudioBuffer;
  private scrubGain!: GainNode;
  private scrubBand!: BiquadFilterNode;
  private scrubHi!: BiquadFilterNode;
  private scrubTool: ScrubTool = 0;
  private lastChip = 0;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.out.connect(comp).connect(ctx.destination);
    // small room: generated impulse response
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
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
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Continuous scrubbing: intensity 0..1 from stroke speed, dirt 0..1 under the tool (dirty = fuller, clean = thinner). */
  scrub(tool: ScrubTool, intensity: number, dirt: number) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    if (tool !== this.scrubTool) this.scrubTool = tool;
    let f = 1000, q = 1, g = 0;
    if (tool === 1) { f = 3800 - dirt * 1400; q = 0.6; g = 0.5; }
    else if (tool === 2) { f = 1300 - dirt * 400; q = 1.3; g = 0.75; }
    else if (tool === 3) { f = 2600 + (1 - dirt) * 1500; q = 5; g = 0.6; }
    this.scrubBand.frequency.setTargetAtTime(f, t, 0.04);
    this.scrubBand.Q.setTargetAtTime(q, t, 0.04);
    const level = tool ? g * Math.min(1, intensity) * (0.35 + 0.65 * Math.min(1, dirt * 1.5 + 0.15)) : 0;
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

export const sound = new Sound();
