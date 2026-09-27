// Deep zoom: when the camera rests zoomed in beyond what the 3000 px texture holds, fetch exactly the visible piece
// of the painting from the museum's IIIF server at full scan resolution and fade it in. Online only; fails quietly.
import type { Camera } from './camera';
import type { PaintingGL, Renderer } from '../render/renderer';

interface Info { width: number; height: number }

export class Loupe {
  private info: Info | null = null;
  private infoP: Promise<Info | null> | null = null;
  private still = 0;
  private lastKey = '';
  private req = 0;
  private fade = 0;
  private target = 0;
  rect: [number, number, number, number] = [0, 0, 0, 0];

  constructor(private iiif: string | undefined, private gpu: PaintingGL, private renderer: Renderer, private cam: Camera) {}

  /** How much of the detail to show (0..1), for the shader. */
  get alpha() { return this.fade; }

  update(dt: number) {
    if (!this.iiif) return;
    this.fade += (this.target - this.fade) * Math.min(1, dt * 6);
    const c = this.cam;
    const moving = c.interacting || c.flying;
    this.still = moving ? 0 : this.still + dt;
    // device px per texture px of the base image
    const W = this.gpu.W, H = this.gpu.H;
    const texPerWorld = this.gpu.imgW / W;
    const ratio = (c.zoom * this.renderer.dpr) / texPerWorld;
    const tl = c.toWorld(0, 0), br = c.toWorld(c.vw, c.vh);
    const u0 = Math.max(0, tl.x / W), v0 = Math.max(0, tl.y / H), u1 = Math.min(1, br.x / W), v1 = Math.min(1, br.y / H);
    // the current detail no longer covers the view: fade it out
    const covers = this.rect[0] <= u0 + 1e-3 && this.rect[1] <= v0 + 1e-3 && this.rect[2] >= u1 - 1e-3 && this.rect[3] >= v1 - 1e-3;
    if (ratio < 1.15 || (!covers && moving)) this.target = 0;
    if (ratio < 1.15 || this.still < 0.35 || u1 <= u0 || v1 <= v0) return;
    const key = [u0, v0, u1, v1].map((v) => v.toFixed(3)).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    void this.fetchDetail(u0, v0, u1, v1, (br.x - tl.x) / W);
  }

  private async fetchDetail(u0: number, v0: number, u1: number, v1: number, viewU: number) {
    const id = ++this.req;
    this.infoP ??= fetch(this.iiif + '/info.json').then((r) => r.json()).then((j) => ({ width: j.width, height: j.height })).catch(() => null);
    this.info = await this.infoP;
    const info = this.info;
    if (!info || id !== this.req) return;
    // a little margin so small pans stay covered
    const pu = (u1 - u0) * 0.12, pv = (v1 - v0) * 0.12;
    u0 = Math.max(0, u0 - pu); v0 = Math.max(0, v0 - pv); u1 = Math.min(1, u1 + pu); v1 = Math.min(1, v1 + pv);
    const x = Math.floor(u0 * info.width), y = Math.floor(v0 * info.height);
    const w = Math.ceil((u1 - u0) * info.width), h = Math.ceil((v1 - v0) * info.height);
    // the scan isn't sharper than the texture we already have here
    if (w <= (u1 - u0) * this.gpu.imgW * 1.15) return;
    // no more pixels than the scan has or the screen shows, capped for memory
    const screenW = (this.cam.vw * this.renderer.dpr * (u1 - u0)) / Math.max(1e-6, viewU);
    const outW = Math.round(Math.min(w, screenW * 1.1, 2048, 2048 * (w / h)));
    if (outW < 64) return;
    const url = `${this.iiif}/${x},${y},${w},${h}/${outW},/0/default.jpg`;
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.src = url;
    try { await im.decode(); } catch { return; }
    if (id !== this.req) return;
    this.gpu.setDetail(im);
    this.rect = [x / info.width, y / info.height, (x + w) / info.width, (y + h) / info.height];
    this.fade = 0;
    this.target = 1;
  }
}
