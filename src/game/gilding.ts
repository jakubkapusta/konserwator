// Stage 3: gilding the frame. Touch the bare frame to lay a leaf of gold (it lands crumpled), rub it with the
// burnisher until it turns to a mirror. The frame is split into leaf-sized patches; a patch that's mostly burnished
// finishes itself with a bell and a glint.
import type { Camera } from './camera';
import type { Particles } from '../render/particles';
import { Sprite } from '../render/particles';
import { GCELL, GSCALE, type GiltSim, type Leaf } from '../render/gilt';
import { makeRng, hashString } from '../core/rng';
import { sound } from '../audio/audio';

export interface Patch {
  x0: number; y0: number; x1: number; y1: number;
  leaf: Leaf;
  laid: boolean;
  done: boolean;
  smooth: number;
  cells: number[];
}

export interface GildingEvents {
  laid(i: number): void;
  patchDone(i: number, n: number): void;
  allDone(): void;
  progress(): void;
}

export class Gilding {
  patches: Patch[] = [];
  finished = false;
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
  private time = 0;

  constructor(private sim: GiltSim, private cam: Camera, private parts: Particles, readonly W: number, readonly H: number, readonly F: number, seed: string, readonly ev: GildingEvents) {
    const rng = makeRng(hashString(seed + 'gold'));
    const add = (x0: number, y0: number, x1: number, y1: number) => {
      const hs = (Math.max(x1 - x0, y1 - y0) / 2) * 1.1;
      this.patches.push({ x0, y0, x1, y1, laid: false, done: false, smooth: 0, cells: [],
        leaf: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, hs, ang: rng.range(-0.05, 0.05), seed: rng() * 10 } });
    };
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
    // read-back cells inside each patch
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
    for (const p of this.patches) a += p.done ? 1 : p.laid ? 0.25 + 0.75 * Math.min(1, p.smooth / 0.75) : 0;
    return a / this.patches.length;
  }
  get laidCount() { return this.patches.filter((p) => p.laid).length; }

  patchAt(x: number, y: number) {
    return this.patches.findIndex((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
  }

  /** Restore from a save: laid and done patches, instantly. */
  restore(laid: boolean[], done: boolean[]) {
    const leaves: Leaf[] = [];
    this.patches.forEach((p, i) => { if (laid[i]) { p.laid = true; leaves.push(p.leaf); } });
    for (let i = 0; i < leaves.length; i += 8) this.sim.step(0, leaves.slice(i, i + 8), null, []);
    const fins = this.patches.filter((p, i) => done[i] && (p.done = true)).map((p) => [p.x0, p.y0, p.x1, p.y1]);
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
    this.touch(w.x, w.y);
    this.rubs.push({ x0: w.x, y0: w.y, x1: w.x, y1: w.y, p });
  }
  move(sx: number, sy: number, p: number) {
    if (!this.last) return;
    const w = this.cam.toWorld(sx, sy);
    const d = Math.hypot(w.x - this.last.x, w.y - this.last.y);
    const n = Math.max(1, Math.ceil(d / (this.F * 0.3)));
    for (let k = 1; k <= n; k++) this.touch(this.last.x + ((w.x - this.last.x) * k) / n, this.last.y + ((w.y - this.last.y) * k) / n);
    this.rubs.push({ x0: this.last.x, y0: this.last.y, x1: w.x, y1: w.y, p });
    this.speed += d * this.cam.zoom;
    this.last = w;
  }
  up() {
    this.active = false;
    this.last = null;
    sound.scrub(0, 0, 0);
  }

  /** Entering a bare patch lays a leaf there. */
  private touch(x: number, y: number) {
    const i = this.patchAt(x, y);
    if (i >= 0) this.layPatch(i);
  }

  layPatch(i: number) {
    const p = this.patches[i];
    if (p.laid) return;
    p.laid = true;
    this.queue.push(p.leaf);
    sound.rustle();
    // the leaf flutters down: a few loose flakes of gold
    const s = this.cam.toScreen(p.leaf.x, p.leaf.y);
    const r = p.leaf.hs * this.cam.zoom;
    for (let k = 0; k < 6; k++) {
      this.parts.spawn({ x: s.x + (Math.random() - 0.5) * r * 2, y: s.y + (Math.random() - 0.5) * r * 2, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40,
        size: 2.5 + Math.random() * 4.5, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 8, r: 1, g: 0.8, b: 0.4, a: 0.9, life: 1.2 + Math.random(), grav: 90, drag: 1.5, k: Sprite.Flake });
    }
    this.ev.laid(i);
  }

  update(dt: number) {
    this.time += dt;
    const L = this.queue.splice(0, 8);
    const rub = this.rubs.length ? this.mergeRubs(dt) : null;
    this.fin = this.fin.filter((f) => (f.t -= dt) > 0);
    if (L.length || rub || this.fin.length) this.sim.step(dt, L, rub, this.fin.map((f) => f.r));
    if (this.active) {
      const spd = Math.min(1, this.speed / (30 * Math.max(dt, 1 / 120) * 60));
      this.speed = 0;
      sound.scrub(4, Math.max(0.1, spd), 0.5);
    }
    this.readT -= dt;
    if (this.readT <= 0 && !this.finished) {
      this.readT = 0.2;
      this.check(this.sim.readCells());
      this.ev.progress();
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
      if (!p.laid || p.done || !p.cells.length) return;
      let g = 0, r = 0;
      for (const c of p.cells) { r += cells[c * 4]; g += cells[c * 4 + 1]; }
      p.smooth = r > 0 ? g / r : 0;
      if (p.smooth > 0.72) this.finishPatch(i);
    });
    if (!this.finished && this.patches.every((p) => p.done)) {
      this.finished = true;
      sound.scrub(0, 0, 0);
      this.ev.allDone();
    }
  }

  finishPatch(i: number) {
    const p = this.patches[i];
    if (p.done || !p.laid) return;
    p.done = true;
    this.doneCount++;
    this.fin.push({ r: [p.x0 - 4, p.y0 - 4, p.x1 + 4, p.y1 + 4], t: 1.2 });
    if (this.fin.length > 8) this.fin.shift();
    sound.ding(this.bell++);
    this.glint(p);
    this.ev.patchDone(i, this.doneCount);
  }

  private glint(p: Patch) {
    const a = this.cam.toScreen(p.x0, p.y0), b = this.cam.toScreen(p.x1, p.y1);
    for (let k = 0; k < 8; k++) {
      this.parts.spawn({ x: a.x + Math.random() * (b.x - a.x), y: a.y + Math.random() * (b.y - a.y), size: 12 + Math.random() * 20, spin: 2,
        r: 1, g: 0.9, b: 0.6, a: 1, add: true, life: 0.5 + Math.random() * 0.6, k: Sprite.Spark });
    }
  }

  /** Burnish everything left (test skip / replay end). */
  finishAll() {
    const leaves = this.patches.filter((p) => !p.laid).map((p) => { p.laid = true; return p.leaf; });
    for (let i = 0; i < leaves.length; i += 8) this.sim.step(0, leaves.slice(i, i + 8), null, []);
    const fins = this.patches.filter((p) => !p.done).map((p) => { p.done = true; return [p.x0 - 4, p.y0 - 4, p.x1 + 4, p.y1 + 4]; });
    for (let i = 0; i < fins.length; i += 8) this.fin.push(...fins.slice(i, i + 8).map((r) => ({ r, t: 1.2 })));
    this.fin = this.fin.slice(-8);
    this.sim.fillAll();
    if (!this.finished) { this.finished = true; this.ev.allDone(); }
  }

  saveState() {
    return { laid: this.patches.map((p) => p.laid), done: this.patches.map((p) => p.done) };
  }
}
