// Cleaning extras that aren't a layer of dirt but objects on the canvas:
//  - dried bird droppings: hold the spatula on one, cracks spread, it pops off in pieces,
//  - tears in the canvas: run the needle along the tear, zigzag stitches follow, the tear closes.
// Drawn by PAINT_FS from uniform arrays (see Renderer.setRepairs).
import type { LevelId } from '../data';
import type { Camera } from './camera';
import type { Particles } from '../render/particles';
import { Sprite } from '../render/particles';
import { makeRng, hashString } from '../core/rng';
import { sound } from '../audio/audio';

export const MAX_DROPS = 16;
export const MAX_TEARS = 3;
export const STITCHES = 24;

export interface Drop { x: number; y: number; r: number; seed: number; hold: number; popT: number } // popT < 0: still there
export interface Tear { a: [number, number]; b: [number, number]; c: [number, number]; w: number; len: number; mask: number; closeT: number }

const COUNTS: Record<LevelId, { drops: number; tears: number }> = {
  latwy: { drops: 0, tears: 0 },
  sredni: { drops: 5, tears: 1 },
  trudny: { drops: 9, tears: 2 },
};

export interface RepairEvents { popped(i: number): void; stitched(i: number): void; tearDone(i: number): void }

export class Repairs {
  drops: Drop[] = [];
  tears: Tear[] = [];
  time = 0;
  quiet = false;
  private last: { x: number; y: number } | null = null;
  private pressure = 1;
  private holding = -1;

  constructor(slug: string, level: LevelId, W: number, H: number, private cam: Camera, private parts: Particles, readonly ev: RepairEvents) {
    const rng = makeRng(hashString(slug + level + 'repairs'));
    const L = Math.max(W, H);
    const n = COUNTS[level];
    for (let i = 0; i < n.drops; i++) {
      this.drops.push({ x: rng.range(0.1, 0.9) * W, y: rng.range(0.08, 0.85) * H, r: L * rng.range(0.012, 0.022), seed: rng() * 100, hold: 0, popT: -1 });
    }
    for (let i = 0; i < n.tears; i++) {
      const len = L * rng.range(0.13, 0.22);
      const ang = rng.range(-1.2, 1.2) + (rng() < 0.5 ? 0 : Math.PI / 2);
      const cx = rng.range(0.25, 0.75) * W, cy = rng.range(0.25, 0.75) * H;
      const dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
      const bend = rng.range(-0.25, 0.25) * len;
      const a: [number, number] = [cx - dx, cy - dy], c: [number, number] = [cx + dx, cy + dy];
      const b: [number, number] = [cx - Math.sin(ang) * bend + rng.range(-0.1, 0.1) * dx, cy + Math.cos(ang) * bend];
      const real = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
      this.tears.push({ a, b, c, w: L * rng.range(0.006, 0.009), len: real, mask: 0, closeT: -1 });
    }
  }

  get total() { return this.drops.length + this.tears.length; }
  get left() { return this.drops.filter((d) => d.popT < 0).length + this.tears.filter((t) => t.closeT < 0).length; }
  get done() { return this.left === 0; }
  get hasDrops() { return this.drops.length > 0; }
  get hasTears() { return this.tears.length > 0; }
  dropsLeft() { return this.drops.filter((d) => d.popT < 0).length; }
  tearsLeft() { return this.tears.filter((t) => t.closeT < 0).length; }
  /** 0..1 done, for the tool rings. */
  dropsProgress() { return this.drops.length ? 1 - this.dropsLeft() / this.drops.length : 1; }
  tearsProgress() {
    if (!this.tears.length) return 1;
    let a = 0;
    for (const t of this.tears) a += t.closeT >= 0 ? 1 : popcount(t.mask) / STITCHES;
    return a / this.tears.length;
  }

  // ---- tools (world coordinates) ----
  down(tool: number, x: number, y: number, p: number) {
    this.last = { x, y };
    this.pressure = p;
    if (tool === 4) this.holding = this.dropAt(x, y);
    if (tool === 5) this.stitch(x, y, x, y);
  }
  move(tool: number, x: number, y: number, p: number) {
    this.pressure = p;
    if (tool === 4) {
      const i = this.dropAt(x, y);
      if (i !== this.holding) { this.holding = i; }
    }
    if (tool === 5 && this.last) this.stitch(this.last.x, this.last.y, x, y);
    this.last = { x, y };
  }
  up() { this.last = null; this.holding = -1; }

  private dropAt(x: number, y: number) {
    let best = -1, bd = 1e9;
    this.drops.forEach((d, i) => {
      if (d.popT >= 0) return;
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd < d.r * 1.5 && dd < bd) { bd = dd; best = i; }
    });
    return best;
  }

  /** Needle from a to b: every stitch cell of a tear the segment passes close to gets sewn. */
  private stitch(ax: number, ay: number, bx: number, by: number) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    this.tears.forEach((t, i) => {
      if (t.closeT >= 0) return;
      let added = 0;
      for (let k = 0; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps;
        const { d, s } = nearest(t, x, y);
        if (d > t.w * 3.5) continue;
        const cell = Math.min(STITCHES - 1, Math.floor(s * STITCHES));
        const bit = 1 << cell;
        if (!(t.mask & bit)) { t.mask |= bit; added++; }
      }
      if (added) {
        if (!this.quiet) sound.stitch(added);
        this.threadBits(ax, ay, bx, by);
        this.ev.stitched(i);
        if (t.mask === (1 << STITCHES) - 1) this.closeTear(i);
      }
    });
  }

  private threadBits(ax: number, ay: number, bx: number, by: number) {
    const s = this.cam.toScreen(bx, by);
    void ax; void ay;
    this.parts.spawn({ x: s.x, y: s.y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30, size: 3 + Math.random() * 3, r: 0.95, g: 0.9, b: 0.8, a: 0.9, add: true, life: 0.4, k: Sprite.Spark });
  }

  private closeTear(i: number) {
    const t = this.tears[i];
    t.closeT = this.time;
    if (!this.quiet) sound.chord(4);
    // glints along the seam
    for (let k = 0; k < 14; k++) {
      const p = pointAt(t, k / 13);
      const s = this.cam.toScreen(p[0], p[1]);
      this.parts.spawn({ x: s.x, y: s.y, vy: -10, size: 10 + Math.random() * 16, spin: 2, r: 1, g: 0.93, b: 0.75, a: 0.9, add: true, life: 0.6 + Math.random() * 0.6, k: Sprite.Spark });
    }
    this.ev.tearDone(i);
  }

  private pop(i: number) {
    const d = this.drops[i];
    d.popT = this.time;
    d.hold = 1;
    if (!this.quiet) sound.pop();
    const s = this.cam.toScreen(d.x, d.y);
    const r = d.r * this.cam.zoom;
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * 6.283, v = 60 + Math.random() * 170;
      const c = Math.random() < 0.65 ? [0.9, 0.89, 0.84] : [0.35, 0.33, 0.26];
      this.parts.spawn({ x: s.x + Math.cos(a) * r * 0.4, y: s.y + Math.sin(a) * r * 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120,
        size: 2.5 + Math.random() * (r * 0.25 + 3), rot: Math.random() * 6, spin: (Math.random() - 0.5) * 24, r: c[0], g: c[1], b: c[2], a: 1, life: 1.3, grav: 800, drag: 0.5, k: Sprite.Flake });
    }
    this.parts.spawn({ x: s.x, y: s.y, size: r * 1.6, grow: r * 4, r: 1, g: 0.97, b: 0.9, a: 0.45, add: true, life: 0.35, k: Sprite.Ring });
    this.ev.popped(i);
  }

  /** `time` is set by the studio (same clock as the shaders). */
  update(dt: number) {
    const i = this.holding;
    if (i >= 0 && this.last) {
      const d = this.drops[i];
      if (d.popT < 0) {
        d.hold = Math.min(1, d.hold + dt * (0.9 + this.pressure * 1.1));
        if (!this.quiet && Math.random() < dt * 14) sound.crackle(d.hold);
        if (d.hold >= 1) { this.pop(i); this.holding = -1; }
      }
    }
    // an abandoned drop slowly settles back (the cracks close a little)
    for (const d of this.drops) if (d.popT < 0 && this.drops.indexOf(d) !== this.holding) d.hold = Math.max(0, d.hold - dt * 0.15);
  }

  finishAll() {
    this.drops.forEach((d, i) => { if (d.popT < 0) this.pop(i); });
    this.tears.forEach((t, i) => { if (t.closeT < 0) { t.mask = (1 << STITCHES) - 1; this.closeTear(i); } });
  }

  saveState() {
    return { drops: this.drops.map((d) => d.popT >= 0), tears: this.tears.map((t) => (t.closeT >= 0 ? -1 : t.mask)) };
  }
  restore(s: { drops: boolean[]; tears: number[] }) {
    s.drops.forEach((p, i) => { if (p && this.drops[i]) { this.drops[i].popT = -100; this.drops[i].hold = 1; } });
    s.tears.forEach((m, i) => {
      const t = this.tears[i];
      if (!t) return;
      if (m === -1) { t.mask = (1 << STITCHES) - 1; t.closeT = -100; } else t.mask = m;
    });
  }
}

function popcount(n: number) { let c = 0; while (n) { c += n & 1; n >>>= 1; } return c; }

/** Distance to the tear's polyline and the normalized position along it (0..1). */
function nearest(t: Tear, x: number, y: number) {
  const seg = (p: [number, number], q: [number, number]) => {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l2 = dx * dx + dy * dy;
    const u = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / l2));
    return { d: Math.hypot(p[0] + dx * u - x, p[1] + dy * u - y), u, l: Math.sqrt(l2) };
  };
  const s1 = seg(t.a, t.b), s2 = seg(t.b, t.c);
  return s1.d <= s2.d ? { d: s1.d, s: (s1.u * s1.l) / t.len } : { d: s2.d, s: (s1.l + s2.u * s2.l) / t.len };
}

function pointAt(t: Tear, s: number): [number, number] {
  const l1 = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
  const d = s * t.len;
  if (d <= l1) { const u = d / l1; return [t.a[0] + (t.b[0] - t.a[0]) * u, t.a[1] + (t.b[1] - t.a[1]) * u]; }
  const l2 = t.len - l1, u = (d - l1) / l2;
  return [t.b[0] + (t.c[0] - t.b[0]) * u, t.b[1] + (t.c[1] - t.b[1]) * u];
}
