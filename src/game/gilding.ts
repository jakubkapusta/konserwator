// Stage 3: gilding the frame. Touch the bare frame and a leaf of gold flutters down right there (torn, crooked,
// crumpled), with loose bits sticking out past its edge. Rub with the burnisher: the flakes fly off as gold dust,
// the leaf flattens into a mirror, the burnisher's note climbs as it shines. The frame is split into patches only
// for bookkeeping: a patch that's covered and burnished finishes itself (filling tiny gaps) with a bell.
import type { Camera } from './camera';
import type { Particles } from '../render/particles';
import { Sprite } from '../render/particles';
import { GCELL, GSCALE, type GiltSim, type Leaf } from '../render/gilt';
import { makeRng, hashString, type Rng } from '../core/rng';
import { sound } from '../audio/audio';

export interface Patch {
  x0: number; y0: number; x1: number; y1: number;
  laid: boolean; // any leaf landed in it
  done: boolean;
  cover: number;
  smooth: number;
  cells: number[];
}

interface Placed extends Leaf { flakes: number }

export interface GildingEvents {
  falling(leaf: Leaf, dur: number): void;
  laid(): void;
  patchDone(i: number, n: number): void;
  allDone(): void;
  progress(): void;
}

const FALL = 0.42; // seconds a leaf flutters before it lands

export class Gilding {
  patches: Patch[] = [];
  leaves: Placed[] = [];
  finished = false;
  quiet = false;
  private pending: { leaf: Placed; t: number }[] = [];
  private queue: Leaf[] = [];
  private rubs: { x0: number; y0: number; x1: number; y1: number; p: number }[] = [];
  private fin: { r: number[]; t: number }[] = [];
  private last: { x: number; y: number } | null = null;
  private kind = 'mouse';
  private readT = 0;
  private active = false;
  private speed = 0;
  private doneCount = 0;
  private bell = 0;
  private rng: Rng;
  private floodT = 0;

  constructor(private sim: GiltSim, private cam: Camera, private parts: Particles, readonly W: number, readonly H: number, readonly F: number, seed: string, readonly ev: GildingEvents) {
    this.rng = makeRng(hashString(seed + 'gold'));
    const add = (x0: number, y0: number, x1: number, y1: number) => this.patches.push({ x0, y0, x1, y1, laid: false, done: false, cover: 0, smooth: 0, cells: [] });
    const side = (len: number, f: (a: number, b: number) => void) => {
      const n = Math.max(2, Math.round(len / (F * 1.05)));
      for (let i = 0; i < n; i++) f((i * len) / n, ((i + 1) * len) / n);
    };
    add(-F, -F, 0, 0);
    side(W, (a, b) => add(a, -F, b, 0));
    add(W, -F, W + F, 0);
    side(H, (a, b) => add(W, a, W + F, b));
    add(W, H, W + F, H + F);
    side(W, (a, b) => add(W - b, H, W - a, H + F));
    add(-F, H, 0, H + F);
    side(H, (a, b) => add(-F, H - b, 0, H - a));
    const cs = GCELL * GSCALE;
    const [rx, ry] = sim.rect;
    this.patches.forEach((p) => {
      for (let cy = 0; cy < sim.ch; cy++) for (let cx = 0; cx < sim.cw; cx++) {
        const x = rx + (cx + 0.5) * cs, y = ry + (cy + 0.5) * cs;
        if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1) p.cells.push(cy * sim.cw + cx);
      }
    });
  }

  get progress() {
    let a = 0;
    for (const p of this.patches) a += p.done ? 1 : Math.min(1, p.cover / 0.85) * (0.35 + 0.65 * Math.min(1, p.smooth / 0.72));
    return a / this.patches.length;
  }
  get laidCount() { return this.leaves.length; }

  patchAt(x: number, y: number) {
    return this.patches.findIndex((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
  }
  private onFrame(x: number, y: number) {
    const t = Math.max(-x, x - this.W, -y, y - this.H);
    return t >= -this.F * 0.05 && t <= this.F * 1.02;
  }
  private covered(x: number, y: number) {
    for (const l of this.leaves) if (Math.hypot(l.x - x, l.y - y) < l.hs * 0.95) return true;
    for (const p of this.pending) if (Math.hypot(p.leaf.x - x, p.leaf.y - y) < p.leaf.hs * 0.95) return true;
    const i = this.patchAt(x, y);
    return i >= 0 && this.patches[i].done;
  }

  /** A leaf flutters down at (x, y) and lands after FALL seconds (instant: stamp now, for replay). */
  layAt(x: number, y: number, instant = false) {
    if (!this.onFrame(x, y) || this.covered(x, y)) return false;
    const r = this.rng;
    // pull the leaf's centre towards the middle of the molding so it doesn't hang off the frame
    const t = Math.max(-x, x - this.W, -y, y - this.H);
    const inward = (t - this.F * 0.5) * 0.15;
    const nx = x < 0 ? -1 : x > this.W ? 1 : 0, ny = y < 0 ? -1 : y > this.H ? 1 : 0;
    const leaf: Placed = {
      x: x - nx * inward + r.range(-0.08, 0.08) * this.F, y: y - ny * inward + r.range(-0.08, 0.08) * this.F,
      hs: this.F * r.range(0.3, 0.42), ang: r.range(-0.45, 0.45), seed: r() * 10, flakes: 1,
    };
    const i = this.patchAt(leaf.x, leaf.y);
    if (i >= 0) this.patches[i].laid = true;
    if (instant) { this.leaves.push(leaf); this.queue.push(leaf); return true; }
    this.pending.push({ leaf, t: FALL });
    this.ev.falling(leaf, FALL);
    if (!this.quiet) sound.rustle();
    return true;
  }

  private land(leaf: Placed) {
    this.leaves.push(leaf);
    this.queue.push(leaf);
    if (!this.quiet) sound.pat();
    const s = this.cam.toScreen(leaf.x, leaf.y);
    const rr = leaf.hs * this.cam.zoom;
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * 6.283;
      this.parts.spawn({ x: s.x + Math.cos(a) * rr, y: s.y + Math.sin(a) * rr, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50 - 30,
        size: 2 + Math.random() * 4, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 10, r: 1, g: 0.82, b: 0.42, a: 0.95, life: 1 + Math.random() * 0.6, grav: 120, drag: 2, k: Sprite.Flake });
    }
    this.ev.laid();
  }

  /** Restore from a save: the same leaves, then the finished patches. */
  restore(save: { leaves?: number[][]; done: boolean[] }) {
    for (const l of save.leaves ?? []) {
      const leaf: Placed = { x: l[0], y: l[1], hs: l[2], ang: l[3], seed: l[4], flakes: 0 };
      this.leaves.push(leaf);
      const i = this.patchAt(leaf.x, leaf.y);
      if (i >= 0) this.patches[i].laid = true;
    }
    for (let i = 0; i < this.leaves.length; i += 8) this.sim.step(0, this.leaves.slice(i, i + 8), null, []);
    const fins = this.patches.filter((p, i) => save.done[i] && (p.done = true)).map((p) => [p.x0 - 4, p.y0 - 4, p.x1 + 4, p.y1 + 4]);
    for (let i = 0; i < fins.length; i += 8) this.sim.step(10, [], null, fins.slice(i, i + 8));
    this.doneCount = fins.length;
    this.finished = this.patches.every((p) => p.done);
  }

  // ---- strokes ----
  down(sx: number, sy: number, p: number, kind: string) {
    this.kind = kind;
    this.active = true;
    const w = this.cam.toWorld(sx, sy);
    this.last = w;
    this.layAt(w.x, w.y);
    this.rubs.push({ x0: w.x, y0: w.y, x1: w.x, y1: w.y, p });
  }
  move(sx: number, sy: number, p: number) {
    if (!this.last) return;
    const w = this.cam.toWorld(sx, sy);
    const d = Math.hypot(w.x - this.last.x, w.y - this.last.y);
    const n = Math.max(1, Math.ceil(d / (this.F * 0.15)));
    for (let k = 1; k <= n; k++) this.layAt(this.last.x + ((w.x - this.last.x) * k) / n, this.last.y + ((w.y - this.last.y) * k) / n);
    this.rubs.push({ x0: this.last.x, y0: this.last.y, x1: w.x, y1: w.y, p });
    this.speed += d * this.cam.zoom;
    this.last = w;
  }
  up() {
    this.active = false;
    this.last = null;
    sound.scrub(0, 0, 0);
  }

  update(dt: number) {
    for (const p of this.pending) p.t -= dt;
    while (this.pending.length && this.pending[0].t <= 0) this.land(this.pending.shift()!.leaf);
    const L = this.queue.splice(0, 8);
    const rub = this.rubs.length ? this.mergeRubs(dt) : null;
    this.fin = this.fin.filter((f) => (f.t -= dt) > 0);
    if (this.floodT > 0) {
      this.floodT -= dt;
      this.sim.step(dt, L, null, this.fin.map((f) => f.r), true);
      if (this.floodT <= 0) this.sim.fillAll();
    } else if (L.length || rub || this.fin.length) this.sim.step(dt, L, rub, this.fin.map((f) => f.r));
    if (this.active && this.last) {
      const spd = Math.min(1, this.speed / (30 * Math.max(dt, 1 / 120) * 60));
      this.speed = 0;
      const pi = this.patchAt(this.last.x, this.last.y);
      const pt = pi >= 0 ? this.patches[pi] : null;
      const onGold = !!pt && pt.laid;
      if (!this.quiet) sound.scrub(4, onGold ? Math.max(0.1, spd) : 0, pt?.done ? 1 : Math.min(1, pt?.smooth ?? 0));
      if (onGold && spd > 0.05) this.rubEffects(spd);
    }
    this.readT -= dt;
    if (this.readT <= 0 && !this.finished) {
      this.readT = 0.2;
      this.check(this.sim.readCells());
      this.ev.progress();
    }
  }

  /** Glints trailing the burnisher, gold dust where loose flakes get swept off. */
  private rubEffects(spd: number) {
    const w = this.last!;
    const s = this.cam.toScreen(w.x, w.y);
    if (Math.random() < 0.5 * spd) {
      this.parts.spawn({ x: s.x + (Math.random() - 0.5) * 20, y: s.y + (Math.random() - 0.5) * 20, size: 8 + Math.random() * 14, spin: 3,
        r: 1, g: 0.93, b: 0.7, a: 0.85, add: true, life: 0.35 + Math.random() * 0.3, k: Sprite.Spark });
    }
    for (const l of this.leaves) {
      if (l.flakes <= 0 || Math.hypot(l.x - w.x, l.y - w.y) > l.hs * 1.3) continue;
      l.flakes -= 0.04 * spd;
      for (let k = 0; k < 2; k++) {
        this.parts.spawn({ x: s.x + (Math.random() - 0.5) * 30, y: s.y + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 80,
          size: 1.5 + Math.random() * 3, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 20, r: 1, g: 0.8, b: 0.38, a: 1, life: 1.1, grav: 260, drag: 1.2, k: Sprite.Flake });
      }
    }
  }

  private mergeRubs(dt: number) {
    const a = this.rubs[0], z = this.rubs[this.rubs.length - 1];
    let len = 0;
    for (const r of this.rubs) len += Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
    const pr = this.kind === 'pen' ? 0.6 + 0.7 * z.p : 1;
    this.rubs.length = 0;
    const r = this.F * 0.42;
    return { x0: a.x0, y0: a.y0, x1: z.x1, y1: z.y1, r, amount: (Math.min(len, 1.6 * r) / r) * 0.3 * pr + (this.active ? dt * 0.25 : 0) };
  }

  private check(cells: Uint8Array) {
    this.patches.forEach((p, i) => {
      if (p.done || !p.cells.length) return;
      let g = 0, r = 0;
      for (const c of p.cells) { r += cells[c * 4]; g += cells[c * 4 + 1]; }
      p.cover = r / (255 * p.cells.length);
      p.smooth = r > 0 ? g / r : 0;
      if (p.cover > 0.82 && p.smooth > 0.72) this.finishPatch(i);
    });
    if (!this.finished && this.patches.every((p) => p.done)) {
      this.finished = true;
      this.floodT = 1.3;
      sound.scrub(0, 0, 0);
      this.ev.allDone();
    }
  }

  finishPatch(i: number) {
    const p = this.patches[i];
    if (p.done) return;
    p.done = true;
    p.laid = true;
    this.doneCount++;
    this.fin.push({ r: [p.x0 - 4, p.y0 - 4, p.x1 + 4, p.y1 + 4], t: 1.2 });
    if (this.fin.length > 8) this.fin.shift();
    if (!this.quiet) sound.ding(this.bell++);
    this.glint(p);
    this.ev.patchDone(i, this.doneCount);
  }

  /** The patch that most needs attention (for hints). */
  weakest() {
    let best = -1, bv = 1e9;
    this.patches.forEach((p, i) => { if (!p.done && p.cover * 2 + p.smooth < bv) { bv = p.cover * 2 + p.smooth; best = i; } });
    return best;
  }

  private glint(p: Patch) {
    const a = this.cam.toScreen(p.x0, p.y0), b = this.cam.toScreen(p.x1, p.y1);
    for (let k = 0; k < 8; k++) {
      this.parts.spawn({ x: a.x + Math.random() * (b.x - a.x), y: a.y + Math.random() * (b.y - a.y), size: 12 + Math.random() * 20, spin: 2,
        r: 1, g: 0.9, b: 0.6, a: 1, add: true, life: 0.5 + Math.random() * 0.6, k: Sprite.Spark });
    }
  }

  /** Replay: lay a leaf at a patch (instantly). */
  layPatch(i: number) {
    const p = this.patches[i];
    if (!this.layAt((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, true)) p.laid = true;
  }

  /** Burnish everything left (test skip / replay end). */
  finishAll() {
    this.patches.forEach((_, i) => this.finishPatch(i));
    if (!this.leaves.length) this.sim.fillAll(); else this.floodT = Math.max(this.floodT, 1.3);
    if (!this.finished) { this.finished = true; this.ev.allDone(); }
  }

  saveState() {
    const r = (v: number) => Math.round(v * 100) / 100;
    return { laid: this.patches.map((p) => p.laid), done: this.patches.map((p) => p.done), leaves: this.leaves.map((l) => [r(l.x), r(l.y), r(l.hs), r(l.ang), r(l.seed)]) };
  }
}
