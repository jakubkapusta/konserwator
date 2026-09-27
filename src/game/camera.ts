// View onto the easel: world point at the screen centre + zoom (css px per world unit), with pan inertia and fly-to.
import { clamp } from '../core/math';

export interface Insets { top: number; bottom: number; left: number; right: number }

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  vw = 1;
  vh = 1;
  insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  /** Rect that must stay reachable (painting + frame), world. */
  obj = { x0: 0, y0: 0, x1: 1, y1: 1 };
  maxZoom = 8;
  private vx = 0;
  private vy = 0;
  private fly: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t: number; dur: number } | null = null;
  interacting = false;

  setViewport(w: number, h: number) {
    this.vw = w;
    this.vh = h;
  }

  /** Zoom that fits the object into the free area between the UI bars. */
  fitZoom() {
    const i = this.insets;
    const aw = Math.max(50, this.vw - i.left - i.right), ah = Math.max(50, this.vh - i.top - i.bottom);
    return Math.min(aw / (this.obj.x1 - this.obj.x0), ah / (this.obj.y1 - this.obj.y0)) * 0.96;
  }
  get minZoom() { return this.fitZoom() * 0.85; }

  /** Camera centre that puts world point (x, y) at the centre of the free area. */
  private centreFor(x: number, y: number, z: number) {
    const i = this.insets;
    return { x: x - (i.left - i.right) / 2 / z, y: y - (i.top - i.bottom) / 2 / z };
  }

  fitView() {
    const z = this.fitZoom();
    const c = this.centreFor((this.obj.x0 + this.obj.x1) / 2, (this.obj.y0 + this.obj.y1) / 2, z);
    return { x: c.x, y: c.y, zoom: z };
  }

  fit(animate = 0) {
    const v = this.fitView();
    if (animate > 0) this.flyTo(v.x, v.y, v.zoom, animate, false);
    else { this.x = v.x; this.y = v.y; this.zoom = v.zoom; this.fly = null; }
  }

  isFitted() {
    const v = this.fitView();
    return Math.abs(this.zoom / v.zoom - 1) < 0.08;
  }

  toWorld(sx: number, sy: number) {
    return { x: this.x + (sx - this.vw / 2) / this.zoom, y: this.y + (sy - this.vh / 2) / this.zoom };
  }
  toScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom + this.vw / 2, y: (wy - this.y) * this.zoom + this.vh / 2 };
  }

  panBy(dx: number, dy: number) {
    this.fly = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.keepInside();
  }
  /** Release velocity in css px/s. */
  fling(vx: number, vy: number) {
    this.vx = vx;
    this.vy = vy;
  }
  stop() { this.vx = this.vy = 0; }

  zoomAt(sx: number, sy: number, factor: number) {
    this.fly = null;
    const before = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, Math.max(this.maxZoom, this.fitZoom()));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.keepInside();
  }

  /** Fly so world (x, y) is centred in the free area at zoom z. */
  flyTo(x: number, y: number, z: number, dur = 0.8, centre = true) {
    z = clamp(z, this.minZoom, Math.max(this.maxZoom, this.fitZoom()));
    const c = centre ? this.centreFor(x, y, z) : { x, y };
    this.vx = this.vy = 0;
    this.fly = { fx: this.x, fy: this.y, fz: this.zoom, tx: c.x, ty: c.y, tz: z, t: 0, dur };
  }

  get flying() { return !!this.fly; }

  update(dt: number) {
    if (this.fly) {
      const f = this.fly;
      f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // zoom in log space, position so the path looks straight on screen
      const lz = Math.log(f.fz) + (Math.log(f.tz) - Math.log(f.fz)) * e;
      this.zoom = Math.exp(lz);
      this.x = f.fx + (f.tx - f.fx) * e;
      this.y = f.fy + (f.ty - f.fy) * e;
      if (t >= 1) this.fly = null;
      return;
    }
    if (!this.interacting && (Math.abs(this.vx) > 1 || Math.abs(this.vy) > 1)) {
      this.x -= (this.vx * dt) / this.zoom;
      this.y -= (this.vy * dt) / this.zoom;
      const k = Math.exp(-dt * 5);
      this.vx *= k;
      this.vy *= k;
      this.keepInside();
    }
  }

  /** The centre of the free area must stay over the object. */
  private keepInside() {
    const i = this.insets;
    const cx = this.x + (i.left - i.right) / 2 / this.zoom, cy = this.y + (i.top - i.bottom) / 2 / this.zoom;
    const nx = clamp(cx, this.obj.x0, this.obj.x1), ny = clamp(cy, this.obj.y0, this.obj.y1);
    if (nx !== cx) { this.x += nx - cx; this.vx = 0; }
    if (ny !== cy) { this.y += ny - cy; this.vy = 0; }
  }
}
