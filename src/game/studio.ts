// One painting on the easel: runs the stages (cleaning -> retouch -> ...), drives the scene state for the renderer,
// routes input to the current stage and keeps the save up to date.
import type { CatalogItem, LevelData, LevelId } from '../data';
import type { PaintingGL, Renderer, SceneState } from '../render/renderer';
import type { Tool } from '../render/dirt';
import { Sprite } from '../render/particles';
import type { Camera } from './camera';
import type { PointerKind, ToolHandler } from './input';
import { Cleaning, dirtFor, LAYER_NAMES, TOOLS } from './cleaning';
import { Retouch } from './retouch';
import { idbGet, idbSet, markDone, saveWork, type Stage, type WorkSave } from './save';
import { sound } from '../audio/audio';

export type Phase = 'intro' | 'clean' | 'toRetouch' | 'retouch' | 'finale' | 'done';

export interface StudioUI {
  phase(p: Phase): void;
  cleanProgress(c: Cleaning): void;
  tool(t: Tool): void;
  toast(text: string, ms?: number): void;
  suggestTool(t: Tool): void;
  palette(lv: LevelData, left: number[], sel: number): void;
  paintLeft(c: number, left: number): void;
  select(c: number): void;
  wrong(c: number): void;
  retouchProgress(done: number, total: number): void;
  finale(): void;
  cursor(x: number, y: number, show: boolean, tool: Tool, r: number, kind: PointerKind | null, swabDirt: number): void;
  marker(x: number, y: number, r: number, show: boolean): void;
}

export class Studio {
  phase: Phase = 'intro';
  cleaning: Cleaning;
  retouch: Retouch;
  scene: SceneState;
  time = 0;
  private phaseT = 0;
  private peekTarget = 0;
  private saveT = 0;
  private dirtSaveT = 0;
  private dirty = false;
  private dirtDirty = false;
  private tileBell = 0;
  private hover: { x: number; y: number; kind: PointerKind } | null = null;
  private stroking = false;
  private mark: { x: number; y: number; r: number; t: number } | null = null;
  private webs: [number, number, number, number];

  constructor(
    readonly item: CatalogItem,
    readonly levelId: LevelId,
    readonly lv: LevelData,
    readonly gpu: PaintingGL,
    private renderer: Renderer,
    private cam: Camera,
    private ui: StudioUI,
  ) {
    const W = lv.width, H = lv.height;
    const d = dirtFor(item.slug, levelId, W, H, item.dirt);
    this.webs = d.webs;
    gpu.dirt.init(d.init);
    const parts = renderer.particles;
    this.cleaning = new Cleaning(gpu.dirt, cam, parts, {
      tileDone: (_x, _y, n) => { sound.ding(this.tileBell++); void n; this.dirty = true; },
      layerDone: (c) => {
        if (this.cleaning.finished) return;
        sound.chord(2);
        ui.toast(LAYER_NAMES[c] + ': czysto!');
        this.dirty = true;
      },
      allDone: () => this.startTransition(),
      progress: () => ui.cleanProgress(this.cleaning),
      suggestTool: (t, why) => {
        if (why) ui.toast(why, 4200);
        ui.suggestTool(t);
        const s = this.cleaning.dirtiestSpot();
        if (s && !why) this.showMark(s.x, s.y, TOOLS.find((d) => d.id === t)!.radius * Math.max(W, H) * 1.2);
      },
    });
    this.retouch = new Retouch(lv, gpu, cam, parts, {
      painted: (_id, c) => {
        this.dirty = true;
        ui.retouchProgress(this.retouch.done, this.retouch.total);
        ui.paintLeft(c, this.retouch.left[c]);
      },
      paintDone: (c) => ui.paintLeft(c, 0),
      wrong: (c) => ui.wrong(c),
      allDone: () => this.startFinale(),
      select: (c) => { ui.select(c); this.scene.sel = c; this.scene.selT = this.time; },
    });

    const F = renderer.frameWidth(W, H);
    cam.obj = { x0: -F, y0: -F, x1: W + F, y1: H + F };
    cam.maxZoom = Math.max(4.2, cam.fitZoom() * 7);
    this.scene = {
      time: 0, outline: 0, outlineC: [W / 2, H / 2], outlineR: 0, dirtOn: 1, sel: -1, selT: 0,
      sweep: [-1, 0.12, 0], peek: 0, webs: this.webs, restored: 0, frameDust: 1, numAlpha: 0,
    };
  }

  /** Start fresh or continue from a save. */
  async begin(save: WorkSave | null) {
    const c = this.cleaning;
    if (save && save.stage !== 'clean') {
      // cleaning was finished: no dirt at all
      c.start();
      c.finishAll();
      c.finished = true;
      this.gpu.dirt.step(10, null, [{ u0: 0, v0: 0, u1: 1, v1: 1, rates: [50, 50, 50, 50] }]);
      this.retouch.restore(save.painted ?? [], save.sel ?? 0);
      this.enterRetouch(true);
      if (save.stage === 'done' || this.retouch.finished) this.startFinale(true);
      return;
    }
    if (save?.clean) {
      const snap = await idbGet<{ w: number; h: number; data: Uint8Array }>('dirt:' + this.item.slug);
      if (snap && snap.data) this.gpu.dirt.restore(snap);
      c.start(save.clean.done, save.clean.initTotal, save.clean.init);
      c.tool = (save.clean.tool as Tool) || 1;
    } else c.start();
    this.ui.tool(c.tool);
    this.ui.cleanProgress(c);
    this.setPhase('intro');
    this.cam.fit();
    const v = this.cam.fitView();
    this.cam.zoom = v.zoom * 0.82;
    this.cam.flyTo(v.x, v.y, v.zoom, 1.4, false);
    sound.swish(0.08);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    this.ui.phase(p);
  }

  setTool(t: Tool) {
    this.cleaning.tool = t;
    this.ui.tool(t);
    this.dirty = true;
  }

  setPeek(on: boolean) { this.peekTarget = on ? 1 : 0; }

  /** Test helper: skip the cleaning. */
  skipCleaning() {
    if (this.phase !== 'clean' && this.phase !== 'intro') return;
    this.cleaning.finishAll();
  }

  private startTransition() {
    if (this.phase === 'toRetouch' || this.phase === 'retouch') return;
    this.cleaning.finishAll();
    this.setPhase('toRetouch');
    this.dirty = true;
    this.save();
    sound.chord(0, true);
    this.ui.toast('Obraz oczyszczony. Czas na retusz.', 3200);
    this.cam.fit(1.6);
  }

  private enterRetouch(instant = false) {
    this.scene.dirtOn = 0;
    this.scene.frameDust = 0;
    this.scene.outline = 1;
    this.scene.outlineR = instant ? 1e6 : this.scene.outlineR;
    this.scene.numAlpha = 1;
    const r = this.retouch;
    if (r.sel < 0 || r.left[r.sel] === 0) r.sel = r.nextPaint(-1);
    this.ui.palette(this.lv, r.left, r.sel);
    this.ui.retouchProgress(r.done, r.total);
    r.select(r.sel, this.time);
    this.setPhase('retouch');
    if (instant) this.cam.fit();
  }

  private startFinale(instant = false) {
    this.setPhase('finale');
    this.scene.sel = -1;
    markDone(this.item.slug, this.levelId);
    this.dirty = true;
    this.save();
    if (instant) {
      this.scene.restored = 1;
      this.scene.outline = 0;
      this.scene.numAlpha = 0;
      this.phaseT = 10;
      return;
    }
    sound.chord(-2, true);
    this.cam.fit(2.2);
  }

  showMark(x: number, y: number, r: number) {
    this.mark = { x, y, r, t: 0 };
  }

  /** Find the next field of the selected paint and fly there. */
  hint() {
    const id = this.retouch.hint();
    if (id < 0) return;
    const reg = this.lv.regions[id];
    const [x0, y0, x1, y1] = reg.b;
    const bw = Math.max(40, x1 - x0), bh = Math.max(40, y1 - y0);
    const i = this.cam.insets;
    const aw = this.cam.vw - i.left - i.right, ah = this.cam.vh - i.top - i.bottom;
    let z = Math.min(aw / (bw * 3.5), ah / (bh * 3.5));
    z = Math.max(z, 16 / Math.min(reg.r * 1.3, 80), this.cam.fitZoom());
    this.cam.flyTo(reg.x, reg.y, z, 0.9);
    this.showMark(reg.x, reg.y, Math.max(reg.r * 1.6, 18 / z));
    sound.swish(0.06);
  }

  // ---- input ----
  handler(): ToolHandler | null {
    if (this.phase === 'clean' || this.phase === 'intro') return this.cleanHandler;
    if (this.phase === 'retouch') return this.retouchHandler;
    return null;
  }
  private cleanHandler: ToolHandler = {
    down: (x, y, p, kind) => {
      if (this.phase === 'intro') this.setPhase('clean');
      this.stroking = true;
      this.hover = { x, y, kind };
      this.cleaning.down(x, y, p, kind);
      this.dirtDirty = true;
      this.mark = null;
    },
    move: (x, y, p) => { if (this.hover) { this.hover.x = x; this.hover.y = y; } this.cleaning.move(x, y, p); },
    up: () => { this.stroking = false; this.cleaning.up(); if (this.hover?.kind === 'touch') this.hover = null; },
    cancel: () => { this.stroking = false; this.cleaning.up(); this.hover = null; },
    hover: (x, y, kind) => { this.hover = { x, y, kind }; },
    leave: () => { if (!this.stroking) this.hover = null; },
  };
  private retouchHandler: ToolHandler = {
    down: (x, y) => { this.retouch.down(x, y); this.mark = null; this.lastUp = { x, y }; },
    move: (x, y) => { this.retouch.move(x, y); this.lastUp = { x, y }; },
    up: (tap) => this.retouch.up(tap, this.lastUp.x, this.lastUp.y),
    cancel: () => this.retouch.up(false, 0, 0),
    hover: () => {},
    leave: () => {},
  };
  private lastUp = { x: 0, y: 0 };

  // ---- frame ----
  update(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    const s = this.scene;
    s.time = this.time;
    s.peek += (this.peekTarget - s.peek) * Math.min(1, dt * 10);

    if (this.phase === 'intro' && this.phaseT > 1.5) {
      this.setPhase('clean');
      this.ui.toast(this.cleaning.tool === 1 ? 'Pociągnij pędzlem po obrazie, żeby zmieść kurz' : 'Czyść dalej', 4200);
    }
    if (this.phase === 'intro' || this.phase === 'clean' || this.phase === 'toRetouch') {
      this.cleaning.update(dt);
      s.frameDust = 0.25 + 0.75 * this.cleaning.remaining(0);
    }
    if (this.phase === 'toRetouch') {
      const t = this.phaseT;
      s.sweep = [-0.3 + t * 0.75, 0.14, Math.min(1, t * 2) * 0.22 * Math.max(0, 1 - (t - 1.6) / 0.8)];
      s.frameDust *= Math.max(0, 1 - t / 2);
      if (t > 1.3) {
        s.outline = 1;
        const L = Math.hypot(this.lv.width, this.lv.height);
        s.outlineR = ((t - 1.3) / 1.6) * L;
        s.numAlpha = Math.min(1, (t - 1.8) / 0.8);
      }
      if (t > 2.1) s.dirtOn = Math.max(0, 1 - (t - 2.1) / 0.6);
      if (t > 3.2) { s.sweep[2] = 0; this.enterRetouch(); this.ui.toast('Wybierz farbę i maluj pola z jej numerem', 4200); }
    }
    if (this.phase === 'retouch') this.retouch.update(dt, this.time);
    if (this.phase === 'finale') {
      const t = this.phaseT;
      s.outline = Math.max(0, 1 - t / 1.2);
      s.numAlpha = s.outline;
      s.restored = Math.min(1, t / 1.5);
      if (t < 4) s.sweep = [-0.3 + t * 0.45, 0.16, 0.3 * Math.sin(Math.min(1, t / 3.6) * Math.PI)];
      else s.sweep[2] = 0;
      if (t > 3.4 && t - dt <= 3.4) this.ui.finale();
      if (t > 0.4 && t < 3 && Math.random() < dt * 30) {
        const W = this.lv.width, H = this.lv.height;
        const p = this.cam.toScreen(Math.random() * W, Math.random() * H);
        this.renderer.particles.spawn({ x: p.x, y: p.y, vy: -10, size: 10 + Math.random() * 22, spin: 1, r: 1, g: 0.9, b: 0.7, a: 0.8, add: true, life: 1 + Math.random(), k: Sprite.Spark });
      }
    }
    s.sel = this.phase === 'retouch' ? this.retouch.sel : -1;
    s.selT = this.retouch.selT;

    // tool cursor and hint marker
    if (this.hover && (this.phase === 'clean' || this.phase === 'intro')) {
      const def = this.cleaning.toolDef();
      const r = def.radius * Math.max(this.lv.width, this.lv.height) * this.cam.zoom;
      this.ui.cursor(this.hover.x, this.hover.y, true, this.cleaning.tool, r, this.hover.kind, this.cleaning.swabDirt);
    } else this.ui.cursor(0, 0, false, this.cleaning.tool, 0, null, 0);
    if (this.mark) {
      this.mark.t += dt;
      const p = this.cam.toScreen(this.mark.x, this.mark.y);
      this.ui.marker(p.x, p.y, this.mark.r * this.cam.zoom, this.mark.t < 3.2);
      if (this.mark.t > 3.2) this.mark = null;
    } else this.ui.marker(0, 0, 0, false);

    // saving
    this.saveT += dt;
    this.dirtSaveT += dt;
    if (this.dirty && this.saveT > 3) this.save();
    if (this.dirtDirty && this.dirtSaveT > 12 && !this.stroking) this.saveDirt();
  }

  get stage(): Stage {
    return this.phase === 'retouch' || this.phase === 'toRetouch' ? 'retouch' : this.phase === 'finale' || this.phase === 'done' ? 'done' : 'clean';
  }

  save() {
    this.saveT = 0;
    this.dirty = false;
    const st = this.stage;
    const w: WorkSave = {
      v: 1, slug: this.item.slug, level: this.levelId, stage: st, t: Date.now(),
      progress: st === 'clean' ? this.cleaning.progress : st === 'retouch' ? this.retouch.done / this.retouch.total : 1,
    };
    if (st === 'clean') w.clean = this.cleaning.saveState();
    else { w.painted = this.retouch.order.slice(); w.sel = this.retouch.sel; }
    saveWork(w);
  }

  saveDirt() {
    this.dirtSaveT = 0;
    this.dirtDirty = false;
    if (this.stage !== 'clean') return;
    const snap = this.gpu.dirt.snapshot();
    void idbSet('dirt:' + this.item.slug, snap);
  }

  /** Leaving the easel (menu / page hidden). */
  flush() {
    this.save();
    if (this.stage === 'clean') this.saveDirt();
  }
}
