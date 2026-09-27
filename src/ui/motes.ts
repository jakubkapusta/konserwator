// Dust motes drifting through the window's light in the studio menu: a small 2D canvas, cheap, pauses when hidden.
import { tilt } from '../game/tilt';

interface Mote { x: number; y: number; z: number; vx: number; vy: number; r: number; ph: number }

export class Motes {
  private ctx: CanvasRenderingContext2D;
  private motes: Mote[] = [];
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 90; i++) this.motes.push(this.spawn(true));
  }

  private spawn(anywhere: boolean): Mote {
    return {
      x: Math.random(), y: anywhere ? Math.random() : -0.05, z: 0.3 + Math.random() * 0.7,
      vx: (Math.random() - 0.3) * 0.006, vy: 0.004 + Math.random() * 0.01, r: 0.6 + Math.random() * 1.8, ph: Math.random() * 6.28,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.draw(Math.min(0.05, (now - this.last) / 1000), now / 1000);
      this.last = now;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private draw(dt: number, t: number) {
    const c = this.canvas, g = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      m.ph += dt * (0.6 + m.z);
      m.x += (m.vx + Math.sin(m.ph) * 0.002) * dt * m.z;
      m.y += m.vy * dt * m.z * 0.6;
      if (m.y > 1.05 || m.x < -0.05 || m.x > 1.05) Object.assign(m, this.spawn(false), { x: Math.random() });
      // the beam comes from the upper left: a diagonal band
      const px = m.x * w + tilt.x * 14 * m.z, py = m.y * h + tilt.y * 10 * m.z;
      const d = (px / w) * 0.8 - (py / h) * 0.55 - 0.05;
      const inBeam = Math.exp(-(d * d) / 0.018);
      const a = (0.08 + 0.75 * inBeam) * m.z * (0.6 + 0.4 * Math.sin(m.ph * 1.7 + t));
      if (a < 0.02) continue;
      const r = m.r * (0.6 + m.z);
      const grd = g.createRadialGradient(px, py, 0, px, py, r * 2.2);
      grd.addColorStop(0, `rgba(255,236,196,${a})`);
      grd.addColorStop(1, 'rgba(255,236,196,0)');
      g.fillStyle = grd;
      g.fillRect(px - r * 2.2, py - r * 2.2, r * 4.4, r * 4.4);
    }
    g.globalCompositeOperation = 'source-over';
  }
}
