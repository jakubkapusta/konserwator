// Stage 2: retouch by numbers (Happy Color, variant B: a painted field gets the real painting back, spreading from the touch).
import type { LevelData } from '../data';
import type { PaintingGL } from '../render/renderer';
import type { Particles } from '../render/particles';
import { Sprite } from '../render/particles';
import type { Camera } from './camera';
import { sound } from '../audio/audio';

export interface RetouchEvents {
  painted(region: number, paint: number): void;
  paintDone(paint: number): void;
  wrong(paint: number, sx: number, sy: number): void;
  allDone(): void;
  select(paint: number): void;
}

export class Retouch {
  painted: Uint8Array;
  left: number[];
  order: number[] = [];
  sel = 0;
  selT = 0;
  finished = false;
  private last: { x: number; y: number } | null = null;
  private dragged = false;
  private hintIdx = 0;
  private time = 0;

  constructor(private lv: LevelData, private gpu: PaintingGL, private cam: Camera, private parts: Particles, readonly ev: RetouchEvents) {
    this.painted = new Uint8Array(lv.regions.length);
    this.left = lv.byColor.map((r) => r.length);
  }

  /** Restore painted regions from a save without animation. */
  restore(order: number[], sel: number) {
    for (const i of order) {
      if (this.painted[i]) continue;
      const r = this.lv.regions[i];
      this.painted[i] = 1;
      this.order.push(i);
      this.left[r.c]--;
      this.gpu.reveal(i, r.x, r.y, -100, 0.01);
    }
    this.sel = this.left[sel] > 0 ? sel : this.nextPaint(sel);
    this.finished = this.left.every((n) => n === 0);
  }

  select(c: number, now: number) {
    if (c < 0 || c >= this.left.length || this.left[c] === 0) return;
    this.sel = c;
    this.selT = now;
    this.hintIdx = 0;
    this.ev.select(c);
  }

  nextPaint(from: number) {
    const n = this.left.length;
    for (let k = 1; k <= n; k++) {
      const c = (from + k) % n;
      if (this.left[c] > 0) return c;
    }
    return -1;
  }

  regionAt(x: number, y: number) {
    const { width: W, height: H, map } = this.lv;
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return -1;
    return map[iy * W + ix];
  }

  update(dt: number, now: number) {
    this.time = now;
    void dt;
  }

  // ---- strokes ----
  down(sx: number, sy: number) {
    const w = this.cam.toWorld(sx, sy);
    this.last = w;
    this.dragged = false;
    this.tryPaint(w.x, w.y, false);
  }
  move(sx: number, sy: number) {
    if (!this.last) return;
    const w = this.cam.toWorld(sx, sy);
    const d = Math.hypot(w.x - this.last.x, w.y - this.last.y);
    const step = Math.max(1, 3 / this.cam.zoom);
    const n = Math.min(400, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      this.tryPaint(this.last.x + (w.x - this.last.x) * t, this.last.y + (w.y - this.last.y) * t, true);
    }
    if (d * this.cam.zoom > 6) this.dragged = true;
    this.last = w;
  }
  up(tap: boolean, sx: number, sy: number) {
    if (tap && !this.dragged) {
      const w = this.cam.toWorld(sx, sy);
      const id = this.regionAt(w.x, w.y);
      if (id >= 0 && !this.painted[id]) {
        const c = this.lv.regions[id].c;
        if (c !== this.sel) {
          // forgiving: a field of the selected paint just next to the finger?
          const near = this.nearby(w.x, w.y, 16 / this.cam.zoom);
          if (near >= 0) this.paint(near, w.x, w.y);
          else { sound.tick(); this.ev.wrong(c, sx, sy); }
        }
      } else if (id >= 0) {
        const near = this.nearby(w.x, w.y, 16 / this.cam.zoom);
        if (near >= 0) this.paint(near, w.x, w.y);
      }
    }
    this.last = null;
  }

  private tryPaint(x: number, y: number, drag: boolean) {
    const id = this.regionAt(x, y);
    if (id < 0 || this.painted[id]) return;
    if (this.lv.regions[id].c !== this.sel) return;
    this.paint(id, x, y, drag);
  }

  private nearby(x: number, y: number, r: number) {
    let best = -1, bd = 1e9;
    for (let a = 0; a < 16; a++) for (let k = 1; k <= 3; k++) {
      const rr = (r * k) / 3, ang = (a / 16) * Math.PI * 2;
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
      const id = this.regionAt(px, py);
      if (id >= 0 && !this.painted[id] && this.lv.regions[id].c === this.sel && rr < bd) { bd = rr; best = id; }
    }
    return best;
  }

  paint(id: number, x: number, y: number, drag = false) {
    const r = this.lv.regions[id];
    this.painted[id] = 1;
    this.order.push(id);
    this.left[r.c]--;
    const size = Math.sqrt(r.a);
    const dur = Math.min(1.7, 0.4 + size / 420);
    this.gpu.reveal(id, x, y, this.time, dur);
    sound.dab(r.c, Math.min(1, size / 500));
    this.splash(x, y, r.c, drag);
    this.ev.painted(id, r.c);
    if (this.left[r.c] === 0) {
      sound.paintDone(r.c);
      this.celebratePaint(r.c);
      this.ev.paintDone(r.c);
      const nx = this.nextPaint(r.c);
      if (nx >= 0) this.select(nx, this.time);
      else if (!this.finished) {
        this.finished = true;
        this.ev.allDone();
      }
    }
  }

  private splash(x: number, y: number, c: number, drag: boolean) {
    const s = this.cam.toScreen(x, y);
    const [R, G, B] = this.lv.palette[c].map((v) => v / 255);
    const n = drag ? 3 : 7;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = 40 + Math.random() * 110;
      this.parts.spawn({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 3 + Math.random() * 5, r: R, g: G, b: B, a: 0.95, life: 0.45 + Math.random() * 0.3, drag: 5 });
    }
    this.parts.spawn({ x: s.x, y: s.y, size: 18, grow: 110, r: 1, g: 0.95, b: 0.85, a: 0.3, add: true, life: 0.4, k: Sprite.Ring });
  }

  private celebratePaint(c: number) {
    const regs = this.lv.byColor[c];
    regs.forEach((i, k) => {
      const r = this.lv.regions[i];
      const s = this.cam.toScreen(r.x, r.y);
      if (s.x < -50 || s.y < -50 || s.x > this.cam.vw + 50 || s.y > this.cam.vh + 50) return;
      if (k > 40) return;
      this.parts.spawn({ x: s.x, y: s.y, vy: -20, size: 14 + Math.random() * 14, spin: 2, r: 1, g: 0.92, b: 0.7, a: 0.9, add: true, life: 0.8 + Math.random() * 0.5, k: Sprite.Spark });
    });
  }

  /** Next unpainted field of the selected paint, cycling. */
  hint(): number {
    const regs = this.lv.byColor[this.sel]?.filter((i) => !this.painted[i]) ?? [];
    if (!regs.length) return -1;
    // biggest first is usually what you'd spot; the smallest are the ones people miss -> go smallest first
    regs.sort((a, b) => this.lv.regions[a].a - this.lv.regions[b].a);
    const id = regs[this.hintIdx % regs.length];
    this.hintIdx++;
    return id;
  }

  get total() { return this.lv.regions.length; }
  get done() { return this.order.length; }
}
