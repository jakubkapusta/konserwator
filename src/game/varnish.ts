// Stage 4: varnish. A flat brush as wide as the painting: pull it over the canvas (one long stroke is enough) and
// everything under it deepens and shines; the fresh varnish glistens, then settles.
import type { Camera } from './camera';
import type { Particles } from '../render/particles';
import { Sprite } from '../render/particles';
import { sound } from '../audio/audio';

export const VROWS = 256;

export interface VarnishEvents { progress(): void; allDone(): void }

export class Varnish {
  /** Per row: coverage, time applied. Uploaded as a 1×VROWS RGBA16F texture. */
  rows = new Float32Array(VROWS * 4);
  dirty = true;
  finished = false;
  private lastY: number | null = null;
  private lastX = 0;
  private active = false;
  private speed = 0;
  private time = 0;
  private autoT = -1;

  constructor(private cam: Camera, private parts: Particles, readonly W: number, readonly H: number, readonly ev: VarnishEvents) {
    for (let i = 0; i < VROWS; i++) this.rows[i * 4 + 1] = -1e9;
  }

  get progress() {
    let c = 0;
    for (let i = 0; i < VROWS; i++) c += this.rows[i * 4];
    return c / VROWS;
  }

  /** The row the brush is on right now (for the brush sprite), -1 when idle. */
  brushY = -1;

  down(sx: number, sy: number) {
    const w = this.cam.toWorld(sx, sy);
    this.active = true;
    this.lastY = w.y;
    this.lastX = sx;
    this.paint(w.y, w.y);
  }
  move(sx: number, sy: number) {
    if (this.lastY == null) return;
    const w = this.cam.toWorld(sx, sy);
    this.paint(this.lastY, w.y);
    this.speed += Math.abs(w.y - this.lastY) * this.cam.zoom + Math.abs(sx - this.lastX) * 0.3;
    this.lastY = w.y;
    this.lastX = sx;
  }
  up() {
    this.active = false;
    this.lastY = null;
    this.brushY = -1;
    sound.scrub(0, 0, 0);
  }

  private paint(ya: number, yb: number) {
    const H = this.H;
    const a = Math.floor((Math.min(ya, yb) / H) * VROWS) - 1, b = Math.ceil((Math.max(ya, yb) / H) * VROWS) + 1;
    for (let r = Math.max(0, a); r <= Math.min(VROWS - 1, b); r++) {
      if (this.rows[r * 4] < 1) { this.rows[r * 4] = 1; this.rows[r * 4 + 1] = this.time; this.dirty = true; }
    }
    this.brushY = Math.max(0, Math.min(H, yb));
  }

  /** Replay: brush down to fraction f of the height. */
  sweepTo(f: number, now: number) {
    this.time = now;
    this.paint(0, f * this.H);
    this.brushY = f < 1 ? f * this.H : -1;
  }

  fillAll(now: number, instant = false) {
    for (let r = 0; r < VROWS; r++) if (this.rows[r * 4] < 1) { this.rows[r * 4] = 1; this.rows[r * 4 + 1] = instant ? -100 : now + r * 0.004; }
    this.dirty = true;
  }

  update(dt: number, now: number) {
    this.time = now;
    if (this.active) {
      const spd = Math.min(1, this.speed / (25 * Math.max(dt, 1 / 120) * 60));
      this.speed = 0;
      sound.scrub(5, Math.max(0.12, spd), 0.6);
      // glints along the wet front
      if (this.brushY >= 0 && Math.random() < 0.8) {
        const L = this.cam.toScreen(0, this.brushY), R = this.cam.toScreen(this.W, this.brushY);
        for (let k = 0; k < 2; k++) {
          this.parts.spawn({ x: L.x + Math.random() * (R.x - L.x), y: L.y + (Math.random() - 0.5) * 6, vy: -8, size: 6 + Math.random() * 12, spin: 2,
            r: 1, g: 0.95, b: 0.8, a: 0.8, add: true, life: 0.4 + Math.random() * 0.4, k: Sprite.Spark });
        }
      }
    }
    if (!this.finished) {
      const p = this.progress;
      this.ev.progress();
      // almost everything covered and the brush lifted: the last strips fill in by themselves
      if (!this.active && p > 0.9 && this.autoT < 0) this.autoT = 0.4;
      if (this.autoT >= 0 && (this.autoT -= dt) < 0) { this.fillAll(this.time); }
      if (p >= 0.999) { this.finished = true; this.ev.allDone(); }
    }
  }

  saveState() {
    return Array.from({ length: VROWS }, (_, i) => (this.rows[i * 4] > 0.5 ? 1 : 0));
  }
  restore(cov: number[]) {
    cov.forEach((c, i) => { if (c) { this.rows[i * 4] = 1; this.rows[i * 4 + 1] = -100; } });
    this.dirty = true;
    this.finished = this.progress >= 0.999;
  }
}
