// Pointer handling for iPad + Pencil first, then fingers and the mouse.
//  - Pencil draws; once a pen has been seen, fingers only pan/zoom (palm rejection: touches are ignored while the pen is down).
//  - Fingers without a pen: one finger draws, two fingers pan/zoom. A one-finger stroke is held back for a moment so a
//    second finger landing right after cancels it instead of leaving a mark.
//  - Mouse: left draws, right/middle button or space+drag pans, wheel (and trackpad pinch) zooms.
import type { Camera } from './camera';

export type PointerKind = 'pen' | 'touch' | 'mouse';

export interface ToolHandler {
  down(x: number, y: number, pressure: number, kind: PointerKind): void;
  move(x: number, y: number, pressure: number): void;
  up(tap: boolean): void;
  cancel(): void;
  hover(x: number, y: number, kind: PointerKind): void;
  leave(): void;
}

const PENDING_MS = 90;
const TAP_PX = 12;
const TAP_MS = 380;

interface Pt { x: number; y: number; t: number; p: number }

export class Input {
  penSeen = false;
  enabled = true;
  private tool: { id: number; kind: PointerKind; sx: number; sy: number; t0: number; moved: number; pending: Pt[] | null; timer: number } | null = null;
  private touches = new Map<number, { x: number; y: number; ignore: boolean }>();
  private cam = new Map<number, { x: number; y: number }>();
  private gesture: { cx: number; cy: number; d: number; vx: number; vy: number; t: number } | null = null;
  private mousePan: { id: number; x: number; y: number; vx: number; vy: number; t: number } | null = null;
  private space = false;
  private penDown = false;
  /** Called on any camera change made by the user. */
  onCamera: () => void = () => {};
  onAnyDown: () => void = () => {};

  constructor(private el: HTMLElement, private camera: Camera, private handler: () => ToolHandler | null) {
    el.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.handler()?.leave(); });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions);
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') this.space = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
  }

  private pos(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.onAnyDown();
    if (!this.enabled) return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const p = this.pos(e);
    const now = performance.now();
    if (e.pointerType === 'pen') {
      this.penSeen = true;
      this.penDown = true;
      if (this.tool && this.tool.kind === 'touch') this.cancelTool();
      this.gesture = null;
      this.startTool(e.pointerId, 'pen', p.x, p.y, pressureOf(e), false);
      return;
    }
    if (e.pointerType === 'mouse') {
      if (e.button === 0 && !this.space) this.startTool(e.pointerId, 'mouse', p.x, p.y, 0.65, false);
      else { this.camera.interacting = true; this.camera.stop(); this.mousePan = { id: e.pointerId, x: p.x, y: p.y, vx: 0, vy: 0, t: now }; }
      return;
    }
    // touch
    // palm rejection only in pen mode: some browsers report wide contact sizes for plain fingers
    const palm = this.penSeen && ((e.width || 0) > 70 || (e.height || 0) > 70);
    const ignore = this.penDown || palm;
    this.touches.set(e.pointerId, { x: p.x, y: p.y, ignore });
    if (ignore) return;
    const live = [...this.touches.entries()].filter(([, t]) => !t.ignore);
    if (!this.penSeen && live.length === 1 && !this.tool) {
      this.startTool(e.pointerId, 'touch', p.x, p.y, 0.65, true);
      return;
    }
    // a second finger: whatever the first one was doing becomes a camera gesture
    if (this.tool && this.tool.kind === 'touch') {
      if (this.tool.pending) this.discardTool();
      else this.endTool(false);
    }
    this.cam.clear();
    for (const [id, t] of live.slice(0, 2)) this.cam.set(id, { x: t.x, y: t.y });
    this.beginGesture();
  }

  private move(e: PointerEvent) {
    e.preventDefault();
    const p = this.pos(e);
    const h = this.handler();
    if (this.tool && e.pointerId === this.tool.id) {
      const evs = (e.getCoalescedEvents?.() ?? []);
      const list = evs.length ? evs : [e];
      for (const ce of list) {
        const q = this.pos(ce);
        this.toolMove(q.x, q.y, this.tool.kind === 'pen' ? pressureOf(ce) : 0.65);
      }
      return;
    }
    if (this.mousePan && e.pointerId === this.mousePan.id) {
      const m = this.mousePan;
      const now = performance.now(), dt = Math.max(1, now - m.t) / 1000;
      this.camera.panBy(p.x - m.x, p.y - m.y);
      m.vx = m.vx * 0.6 + ((p.x - m.x) / dt) * 0.4;
      m.vy = m.vy * 0.6 + ((p.y - m.y) / dt) * 0.4;
      m.x = p.x; m.y = p.y; m.t = now;
      this.onCamera();
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (t) {
      t.x = p.x; t.y = p.y;
      if (this.penDown || t.ignore) return;
      const c = this.cam.get(e.pointerId);
      if (c) { c.x = p.x; c.y = p.y; this.updateGesture(); }
      else if (this.penSeen && !this.tool && this.cam.size === 0) {
        this.cam.set(e.pointerId, { x: p.x, y: p.y });
        this.beginGesture();
      }
      return;
    }
    if ((e.pointerType === 'mouse' || e.pointerType === 'pen') && h) h.hover(p.x, p.y, e.pointerType as PointerKind);
  }

  private up(e: PointerEvent, cancelled: boolean) {
    if (e.pointerType === 'pen') this.penDown = false;
    if (this.tool && e.pointerId === this.tool.id) {
      if (cancelled && this.tool.kind !== 'pen') this.cancelTool();
      else {
        const dur = performance.now() - this.tool.t0;
        this.endTool(this.tool.moved < TAP_PX && dur < TAP_MS);
      }
      return;
    }
    if (this.mousePan && e.pointerId === this.mousePan.id) {
      const m = this.mousePan;
      if (performance.now() - m.t < 80) this.camera.fling(m.vx, m.vy);
      this.mousePan = null;
      this.camera.interacting = false;
      return;
    }
    this.touches.delete(e.pointerId);
    if (this.cam.delete(e.pointerId)) {
      if (this.cam.size === 0) {
        const g = this.gesture;
        if (g && performance.now() - g.t < 80) this.camera.fling(g.vx, g.vy);
        this.gesture = null;
        this.camera.interacting = false;
      } else this.beginGesture(); // one finger left: keeps panning
    }
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.enabled) return;
    const p = { x: e.clientX - this.el.getBoundingClientRect().left, y: e.clientY - this.el.getBoundingClientRect().top };
    let dy = e.deltaY * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 300 : 1);
    if (e.ctrlKey) dy *= 4; // trackpad pinch sends small deltas with ctrl
    dy = Math.max(-200, Math.min(200, dy));
    this.camera.zoomAt(p.x, p.y, Math.exp(-dy * 0.0022));
    this.onCamera();
  }

  // ---- tool strokes ----
  private startTool(id: number, kind: PointerKind, x: number, y: number, pr: number, hold: boolean) {
    this.camera.stop();
    this.tool = { id, kind, sx: x, sy: y, t0: performance.now(), moved: 0, pending: hold ? [{ x, y, t: 0, p: pr }] : null, timer: 0 };
    if (hold) this.tool.timer = window.setTimeout(() => this.flush(), PENDING_MS);
    else this.handler()?.down(x, y, pr, kind);
  }
  private toolMove(x: number, y: number, pr: number) {
    const t = this.tool!;
    t.moved = Math.max(t.moved, Math.hypot(x - t.sx, y - t.sy));
    if (t.pending) t.pending.push({ x, y, t: 0, p: pr });
    else this.handler()?.move(x, y, pr);
  }
  private flush() {
    const t = this.tool;
    if (!t || !t.pending) return;
    const pts = t.pending;
    t.pending = null;
    const h = this.handler();
    if (!h) return;
    h.down(pts[0].x, pts[0].y, pts[0].p, t.kind);
    for (let i = 1; i < pts.length; i++) h.move(pts[i].x, pts[i].y, pts[i].p);
  }
  private endTool(tap: boolean) {
    const t = this.tool;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.pending) this.flush();
    this.tool = null;
    this.handler()?.up(tap);
  }
  private discardTool() {
    if (this.tool) clearTimeout(this.tool.timer);
    this.tool = null;
  }
  private cancelTool() {
    const t = this.tool;
    if (!t) return;
    clearTimeout(t.timer);
    this.tool = null;
    if (!t.pending) this.handler()?.cancel();
  }

  // ---- camera gestures ----
  private centroid() {
    let x = 0, y = 0;
    for (const c of this.cam.values()) { x += c.x; y += c.y; }
    const n = Math.max(1, this.cam.size);
    x /= n; y /= n;
    let d = 0;
    if (this.cam.size >= 2) {
      const [a, b] = [...this.cam.values()];
      d = Math.hypot(a.x - b.x, a.y - b.y);
    }
    return { x, y, d };
  }
  private beginGesture() {
    const c = this.centroid();
    this.gesture = { cx: c.x, cy: c.y, d: c.d, vx: 0, vy: 0, t: performance.now() };
    this.camera.interacting = true;
    this.camera.stop();
  }
  private updateGesture() {
    const g = this.gesture;
    if (!g) return;
    const c = this.centroid();
    const now = performance.now(), dt = Math.max(1, now - g.t) / 1000;
    if (g.d > 0 && c.d > 0) this.camera.zoomAt(c.x, c.y, c.d / g.d);
    this.camera.panBy(c.x - g.cx, c.y - g.cy);
    g.vx = g.vx * 0.6 + ((c.x - g.cx) / dt) * 0.4;
    g.vy = g.vy * 0.6 + ((c.y - g.cy) / dt) * 0.4;
    g.cx = c.x; g.cy = c.y; g.d = c.d; g.t = now;
    this.onCamera();
  }
}

function pressureOf(e: PointerEvent) {
  const p = e.pressure;
  if (!p || p <= 0) return 0.5;
  return Math.min(1, Math.max(0.08, p));
}
