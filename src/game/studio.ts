// One painting on the easel: runs the stages (cleaning -> retouch -> gilding -> varnish -> finale), drives the scene
// state for the renderer, routes input to the current stage, records the restoration (for the gallery replay)
// and keeps the save up to date.
import { LEVELS, type CatalogItem, type LevelData, type LevelId } from '../data';
import type { PaintingGL, Renderer, SceneState } from '../render/renderer';
import type { Tool } from '../render/dirt';
import { Sprite } from '../render/particles';
import type { Camera } from './camera';
import type { PointerKind, ToolHandler } from './input';
import { Cleaning, dirtFor, LAYER_NAMES, TOOLS } from './cleaning';
import { Retouch } from './retouch';
import { MAX_DROPS, MAX_TEARS, Repairs } from './repairs';
import { emptyRepairs } from '../render/renderer';
import { Loupe } from './loupe';
import { Gilding } from './gilding';
import { Varnish } from './varnish';
import { askTilt, recentreTilt, tilt } from './tilt';
import { idbGet, idbSet, markDone, saveWork, type Stage, type WorkSave } from './save';
import { sound } from '../audio/audio';

/** "Znajdź" uses per painting. */
export const HINTS = 5;

export type Phase = 'intro' | 'clean' | 'toRetouch' | 'retouch' | 'toGild' | 'gild' | 'toVarnish' | 'varnish' | 'finale' | 'done';

/** What the gallery replays: cleaning strokes (tool, then x, y, pressure×100 triples, world ints) and the paint order. */
export interface Recording { v: 1; level: LevelId; strokes: number[][]; order: number[] }

export interface StudioUI {
  phase(p: Phase): void;
  cleanProgress(c: Cleaning): void;
  progress(p: number): void;
  tool(t: Tool): void;
  toast(text: string, ms?: number): void;
  suggestTool(t: Tool): void;
  palette(lv: LevelData, left: number[], sel: number): void;
  paintLeft(c: number, left: number): void;
  select(c: number): void;
  wrong(c: number): void;
  retouchProgress(done: number, total: number): void;
  hints(left: number): void;
  finale(): void;
  replayDone(): void;
  leafFall(x: number, y: number, size: number, ang: number, seed: number, dur: number): void;
  cursor(x: number, y: number, show: boolean, tool: number, r: number, kind: PointerKind | null, swabDirt: number): void;
  marker(x: number, y: number, r: number, show: boolean): void;
}

export class Studio {
  phase: Phase = 'intro';
  cleaning: Cleaning;
  retouch: Retouch;
  repairs: Repairs;
  gilding: Gilding;
  varnish: Varnish;
  scene: SceneState;
  time = 0;
  hintsLeft = HINTS;
  rec: Recording;
  private loupe: Loupe;
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
  private recStroke: number[] | null = null;
  private lastUp = { x: 0, y: 0 };
  private readonly F: number;
  /** Replay state (gallery): feeds the recording back at speed. */
  private rp: { rec: Recording; s: number; i: number; perFrame: number; paintI: number; gildT: number; varnT: number } | null = null;

  constructor(
    readonly item: CatalogItem,
    readonly levelId: LevelId,
    readonly lv: LevelData,
    readonly gpu: PaintingGL,
    private renderer: Renderer,
    private cam: Camera,
    private ui: StudioUI,
    replay?: Recording,
  ) {
    const W = lv.width, H = lv.height;
    const F = (this.F = renderer.frameWidth(W, H));
    const d = dirtFor(item.slug, levelId, W, H, item.dirt);
    gpu.dirt.init(d.init);
    const parts = renderer.particles;
    this.rec = { v: 1, level: levelId, strokes: [], order: [] };
    this.repairs = new Repairs(item.slug, levelId, W, H, cam, parts, {
      popped: () => { this.dirty = true; this.dirtDirty = true; sound.ding(this.tileBell++); ui.cleanProgress(this.cleaning); },
      stitched: () => { this.dirty = true; ui.cleanProgress(this.cleaning); },
      tearDone: () => { this.dirty = true; if (!this.rp) ui.toast('Rozdarcie zszyte!'); ui.cleanProgress(this.cleaning); },
    });
    this.cleaning = new Cleaning(gpu.dirt, cam, parts, {
      tileDone: () => { sound.ding(this.tileBell++); this.dirty = true; },
      layerDone: (c) => {
        if (this.cleaning.finished || this.rp) return;
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
        const r = this.repairs;
        if (t === 4) { const d = r.drops.find((d) => d.popT < 0); if (d) this.showMark(d.x, d.y, d.r * 1.8); }
        if (t === 5) { const tr = r.tears.find((x) => x.closeT < 0); if (tr) this.showMark(tr.b[0], tr.b[1], tr.len * 0.55); }
      },
    }, this.repairs, levelId);
    this.retouch = new Retouch(lv, gpu, cam, parts, {
      painted: (_id, c) => {
        this.dirty = true;
        ui.retouchProgress(this.retouch.done, this.retouch.total);
        ui.paintLeft(c, this.retouch.left[c]);
      },
      paintDone: (c) => ui.paintLeft(c, 0),
      wrong: (c) => ui.wrong(c),
      allDone: () => this.startGildTransition(),
      select: (c) => { ui.select(c); this.scene.sel = c; this.scene.selT = this.time; },
    });
    this.gilding = new Gilding(gpu.gilt, cam, parts, W, H, F, item.slug, {
      falling: (leaf, dur) => {
        const s = this.cam.toScreen(leaf.x, leaf.y);
        ui.leafFall(s.x, s.y, leaf.hs * 2.1 * this.cam.zoom, leaf.ang, leaf.seed, dur);
      },
      laid: () => { this.dirty = true; },
      patchDone: () => { this.dirty = true; },
      allDone: () => this.startVarnishTransition(),
      progress: () => { if (this.phase === 'gild') ui.progress(this.gilding.progress); },
    });
    this.varnish = new Varnish(cam, parts, W, H, {
      progress: () => { if (this.phase === 'varnish') ui.progress(this.varnish.progress); },
      allDone: () => this.startFinale(),
    });

    cam.obj = { x0: -F, y0: -F, x1: W + F, y1: H + F };
    cam.maxZoom = Math.max(4.2, cam.fitZoom() * 7);
    this.scene = {
      time: 0, outline: 0, outlineC: [W / 2, H / 2], outlineR: 0, dirtOn: 1, sel: -1, selT: 0,
      sweep: [-1, 0.12, 0], peek: 0, webs: d.webs, restored: 0, frameDust: 1, numAlpha: 0,
      style: Math.max(0, LEVELS.findIndex((l) => l.id === levelId)), tilt: [0, 0], shine: 0, varnOn: 0,
      repairs: emptyRepairs(),
      detail: { rect: [0, 0, 0, 0], alpha: 0 },
    };
    this.loupe = new Loupe(item.iiif, gpu, renderer, cam);
    if (replay) {
      const pts = replay.strokes.reduce((a, s) => a + (s.length - 1) / 3, 0);
      this.rp = { rec: replay, s: 0, i: 0, perFrame: Math.max(2, Math.ceil(pts / (8 * 60))), paintI: 0, gildT: 0, varnT: 0 };
      this.cleaning.quiet = true;
      this.retouch.quiet = true;
      this.repairs.quiet = true;
      this.gilding.quiet = true;
    }
  }

  get replaying() { return !!this.rp; }

  /** Start fresh or continue from a save. */
  async begin(save: WorkSave | null) {
    const c = this.cleaning;
    if (this.rp) {
      c.start();
      this.cam.fit();
      this.setPhase('clean');
      return;
    }
    if (save && save.regions && save.regions !== this.lv.regions.length) save = null; // the painting was rebuilt
    const rec = await idbGet<Recording>('rec:' + this.item.slug);
    if (save && rec && rec.level === this.levelId) this.rec = rec;
    if (save && save.stage !== 'clean') {
      // cleaning was finished: no dirt at all
      c.start();
      c.finishAll();
      c.finished = true;
      this.gpu.dirt.step(10, null, [{ u0: 0, v0: 0, u1: 1, v1: 1, rates: [50, 50, 50, 50] }]);
      this.retouch.restore(save.painted ?? [], save.sel ?? 0);
      this.hintsLeft = save.hints ?? HINTS;
      this.scene.dirtOn = 0;
      this.scene.frameDust = 0;
      if (save.stage === 'retouch' && !this.retouch.finished) { this.enterRetouch(true); return; }
      this.scene.restored = 1;
      if (save.gild) this.gilding.restore(save.gild);
      if (save.stage === 'gild' && !this.gilding.finished) { this.cam.fit(); this.enterGild(); return; }
      this.gilding.finishAll();
      this.gpu.gilt.fillAll(); // restored past the gilding: the whole frame at once
      this.scene.varnOn = 1;
      if (save.varnish) this.varnish.restore(save.varnish);
      if (save.stage === 'varnish' && !this.varnish.finished) { this.cam.fit(); this.enterVarnish(); return; }
      this.varnish.fillAll(this.time, true);
      this.startFinale(true);
      return;
    }
    if (save?.clean) {
      const snap = await idbGet<{ w: number; h: number; data: Uint8Array }>('dirt:' + this.item.slug);
      if (snap && snap.data) this.gpu.dirt.restore(snap);
      c.start(save.clean.done, save.clean.initTotal, save.clean.init);
      c.tool = (save.clean.tool as Tool) || 1;
      if (save.clean.repairs) this.repairs.restore(save.clean.repairs);
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
    sound.mood(p === 'retouch' || p === 'gild' ? 1 : p === 'varnish' || p === 'finale' || p === 'done' ? 2 : 0);
    this.phaseT = 0;
    this.ui.phase(p);
  }

  setTool(t: Tool) {
    this.cleaning.tool = t;
    this.ui.tool(t);
    this.dirty = true;
  }

  setPeek(on: boolean) { this.peekTarget = on ? 1 : 0; }

  /** Test helper: skip the current stage. */
  skipStage() {
    if (this.phase === 'clean' || this.phase === 'intro') this.cleaning.finishAll();
    else if (this.phase === 'retouch') {
      for (let i = 0; i < this.lv.regions.length; i++) if (!this.retouch.painted[i]) { const r = this.lv.regions[i]; this.retouch.sel = r.c; this.retouch.paint(i, r.x, r.y, true); }
    } else if (this.phase === 'gild') this.gilding.finishAll();
    else if (this.phase === 'varnish') this.varnish.fillAll(this.time);
  }
  skipCleaning() { if (this.phase === 'clean' || this.phase === 'intro') this.cleaning.finishAll(); }

  // ---- transitions ----
  private startTransition() {
    if (this.phase === 'toRetouch' || this.phase === 'retouch') return;
    this.cleaning.finishAll();
    this.setPhase('toRetouch');
    this.dirty = true;
    this.save();
    sound.chord(0, true);
    if (!this.rp) this.ui.toast('Obraz oczyszczony. Czas na retusz.', 3200);
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
    this.ui.hints(this.hintsLeft);
    this.ui.retouchProgress(r.done, r.total);
    r.select(r.sel, this.time);
    this.setPhase('retouch');
    if (instant) this.cam.fit();
  }

  private startGildTransition() {
    this.setPhase('toGild');
    this.scene.sel = -1;
    this.rec.order = this.retouch.order.slice();
    this.dirty = true;
    this.save();
    sound.chord(-2, true);
    if (!this.rp) this.ui.toast('Obraz odzyskał kolory!', 2600);
    this.cam.fit(2);
  }

  private enterGild() {
    this.scene.outline = 0;
    this.scene.numAlpha = 0;
    this.scene.restored = 1;
    this.setPhase('gild');
    this.ui.progress(this.gilding.progress);
    if (!this.rp) this.ui.toast('Dotknij ramy, żeby położyć płatek złota. Pocieraj go, aż zabłyśnie.', 5000);
  }

  private startVarnishTransition() {
    if (this.phase === 'toVarnish' || this.phase === 'varnish') return;
    this.setPhase('toVarnish');
    this.dirty = true;
    this.save();
    sound.chord(3, true);
    if (!this.rp) this.ui.toast('Rama lśni. Na koniec werniks.', 2800);
  }

  private enterVarnish() {
    this.scene.varnOn = 1;
    this.scene.shine = 0;
    this.setPhase('varnish');
    this.ui.progress(this.varnish.progress);
    if (!this.rp) this.ui.toast('Pociągnij szerokim pędzlem przez cały obraz, z góry na dół.', 5000);
  }

  private startFinale(instant = false) {
    this.setPhase('finale');
    this.scene.sel = -1;
    this.scene.varnOn = 1;
    this.scene.restored = 1;
    this.scene.outline = 0;
    this.scene.numAlpha = 0;
    if (this.rp) { sound.chord(-2, true); this.cam.fit(1.5); return; }
    markDone(this.item.slug, this.levelId);
    this.rec.order = this.retouch.order.slice();
    void idbSet('rec-done:' + this.item.slug, { ...this.rec, date: Date.now() });
    this.dirty = true;
    this.save();
    if (instant) { this.phaseT = 10; return; }
    sound.chord(-2, true);
    this.cam.fit(2.2);
  }

  showMark(x: number, y: number, r: number) {
    this.mark = { x, y, r, t: 0 };
  }

  /** Find the next field of the selected paint and fly there. */
  hint() {
    if (this.hintsLeft <= 0) { this.ui.toast('Podpowiedzi na ten obraz się skończyły. Przybliż i poszukaj krateczki.', 3200); return; }
    const id = this.retouch.hint();
    if (id < 0) return;
    this.hintsLeft--;
    this.ui.hints(this.hintsLeft);
    this.dirty = true;
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
    if (this.rp) return null;
    if (this.phase === 'clean' || this.phase === 'intro') return this.cleanHandler;
    if (this.phase === 'retouch') return this.retouchHandler;
    if (this.phase === 'gild') return this.gildHandler;
    if (this.phase === 'varnish') return this.varnishHandler;
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
      const w = this.cam.toWorld(x, y);
      this.recStroke = [this.cleaning.tool, Math.round(w.x), Math.round(w.y), Math.round(p * 100)];
      this.rec.strokes.push(this.recStroke);
    },
    move: (x, y, p) => {
      if (this.hover) { this.hover.x = x; this.hover.y = y; }
      this.cleaning.move(x, y, p);
      const r = this.recStroke;
      if (r) {
        const w = this.cam.toWorld(x, y);
        const lx = r[r.length - 3], ly = r[r.length - 2];
        if (Math.hypot(w.x - lx, w.y - ly) >= 6) r.push(Math.round(w.x), Math.round(w.y), Math.round(p * 100));
      }
    },
    up: () => { this.stroking = false; this.recStroke = null; this.cleaning.up(); if (this.hover?.kind === 'touch') this.hover = null; },
    cancel: () => { this.stroking = false; this.recStroke = null; this.cleaning.up(); this.hover = null; },
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
    tap: (x, y) => { this.mark = null; this.retouch.down(x, y); this.retouch.up(true, x, y); },
  };
  private gildHandler: ToolHandler = {
    down: (x, y, p, kind) => { askTilt(); this.stroking = true; this.hover = { x, y, kind }; this.gilding.down(x, y, p, kind); },
    move: (x, y, p) => { if (this.hover) { this.hover.x = x; this.hover.y = y; } this.gilding.move(x, y, p); },
    up: () => { this.stroking = false; this.gilding.up(); if (this.hover?.kind === 'touch') this.hover = null; },
    cancel: () => { this.stroking = false; this.gilding.up(); this.hover = null; },
    hover: (x, y, kind) => { this.hover = { x, y, kind }; },
    leave: () => { if (!this.stroking) this.hover = null; },
  };
  private varnishHandler: ToolHandler = {
    down: (x, y, _p, kind) => { askTilt(); this.stroking = true; this.hover = { x, y, kind }; this.varnish.down(x, y); },
    move: (x, y) => { if (this.hover) { this.hover.x = x; this.hover.y = y; } this.varnish.move(x, y); },
    up: () => { this.stroking = false; this.varnish.up(); this.dirty = true; if (this.hover?.kind === 'touch') this.hover = null; },
    cancel: () => { this.stroking = false; this.varnish.up(); this.hover = null; },
    hover: (x, y, kind) => { this.hover = { x, y, kind }; },
    leave: () => { if (!this.stroking) this.hover = null; },
  };

  // ---- replay ----
  private replayStep(dt: number) {
    const rp = this.rp!;
    const c = this.cleaning;
    if (this.phase === 'clean' || this.phase === 'intro') {
      let budget = rp.perFrame;
      while (budget > 0 && rp.s < rp.rec.strokes.length) {
        const st = rp.rec.strokes[rp.s];
        if (rp.i === 0) {
          c.tool = st[0] as Tool;
          c.downW(st[1], st[2], st[3] / 100, 'pen');
          rp.i = 4;
        } else if (rp.i < st.length) {
          c.moveW(st[rp.i], st[rp.i + 1], st[rp.i + 2] / 100);
          rp.i += 3;
        } else {
          c.up();
          rp.s++;
          rp.i = 0;
        }
        budget--;
      }
      if (rp.s >= rp.rec.strokes.length && !c.finished && this.phaseT > 0.5) c.finishAll();
    }
    if (this.phase === 'retouch') {
      const order = rp.rec.order.length ? rp.rec.order : this.lv.regions.map((_, i) => i);
      const per = Math.max(1, Math.ceil(order.length / (7 * 60)));
      for (let k = 0; k < per && rp.paintI < order.length; k++) {
        const id = order[rp.paintI++];
        if (this.retouch.painted[id]) continue;
        const r = this.lv.regions[id];
        this.retouch.sel = r.c;
        this.retouch.paint(id, r.x, r.y, true);
      }
    }
    if (this.phase === 'gild') {
      rp.gildT += dt;
      const P = this.gilding.patches;
      const n = Math.min(P.length, Math.floor(rp.gildT / 0.05));
      for (let i = 0; i < n; i++) if (!P[i].laid) this.gilding.layPatch(i);
      for (let i = 0; i < P.length; i++) if (P[i].laid && !P[i].done && rp.gildT > i * 0.05 + 0.35) this.gilding.finishPatch(i);
    }
    if (this.phase === 'varnish') {
      rp.varnT += dt;
      this.varnish.sweepTo(Math.min(1, rp.varnT / 1.3), this.time);
    }
  }

  // ---- frame ----
  update(dt: number) {
    this.time += dt;
    this.repairs.time = this.time;
    this.phaseT += dt * (this.rp ? 1.5 : 1);
    const s = this.scene;
    s.time = this.time;
    s.tilt = [tilt.x, tilt.y];
    s.peek += (this.peekTarget - s.peek) * Math.min(1, dt * 10);
    if (this.rp) this.replayStep(dt);

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
      if (t > 3.2) { s.sweep[2] = 0; this.enterRetouch(); if (!this.rp) this.ui.toast('Wybierz farbę i maluj pola z jej numerem', 4200); }
    }
    if (this.phase === 'retouch') this.retouch.update(dt, this.time);
    if (this.phase === 'toGild') {
      const t = this.phaseT;
      s.outline = Math.max(0, 1 - t / 1.2);
      s.numAlpha = s.outline;
      s.restored = Math.min(1, t / 1.5);
      s.sweep = [-0.3 + t * 0.6, 0.16, 0.26 * Math.sin(Math.min(1, t / 2.6) * Math.PI)];
      this.sparkles(dt, t < 2.2);
      if (t > 2.6) { s.sweep[2] = 0; recentreTilt(); this.enterGild(); }
    }
    if (this.phase === 'gild' || this.phase === 'toVarnish') this.gilding.update(dt);
    if (this.phase === 'toVarnish') {
      const t = this.phaseT;
      s.shine = Math.min(1, t / 1.6);
      if (t > 2.2) this.enterVarnish();
    }
    if (this.phase === 'varnish' || this.phase === 'finale') this.varnish.update(dt, this.time);
    if (this.varnish.dirty) { this.gpu.uploadVarnish(this.varnish.rows); this.varnish.dirty = false; }
    if (this.phase === 'finale') {
      const t = this.phaseT;
      // raking light across the finished surface, then the gold catches it once more
      if (t < 4.2) s.sweep = [-0.3 + t * 0.4, 0.2, 0.34 * Math.sin(Math.min(1, t / 4) * Math.PI)];
      else s.sweep[2] = 0;
      s.shine = t > 2.5 && t < 4.5 ? (t - 2.5) / 2 : 0;
      this.sparkles(dt, t > 0.4 && t < 3);
      if (t > 3.6 && t - dt * (this.rp ? 1.5 : 1) <= 3.6) { if (this.rp) this.ui.replayDone(); else this.ui.finale(); }
    }
    s.sel = this.phase === 'retouch' ? this.retouch.sel : -1;
    s.selT = this.retouch.selT;
    this.fillRepairs();
    this.loupe.update(dt);
    s.detail.rect = this.loupe.rect;
    s.detail.alpha = this.loupe.alpha;

    this.cursorAndMarker(dt);

    // saving
    if (this.rp) return;
    this.saveT += dt;
    this.dirtSaveT += dt;
    if (this.dirty && this.saveT > 3) this.save();
    if (this.dirtDirty && this.dirtSaveT > 12 && !this.stroking) this.saveDirt();
  }

  private fillRepairs() {
    const R = this.scene.repairs, r = this.repairs;
    R.nd = Math.min(MAX_DROPS, r.drops.length);
    for (let i = 0; i < R.nd; i++) {
      const d = r.drops[i];
      R.drops.set([d.x, d.y, d.r, d.hold], i * 4);
      R.dropsB.set([d.seed, d.popT, 0, 0], i * 4);
    }
    R.nt = Math.min(MAX_TEARS, r.tears.length);
    for (let i = 0; i < R.nt; i++) {
      const t = r.tears[i];
      R.tearA.set([t.a[0], t.a[1], t.b[0], t.b[1]], i * 4);
      R.tearB.set([t.c[0], t.c[1], t.w, t.len], i * 4);
      R.tearM.set([t.mask, t.closeT, 0, 0], i * 4);
    }
  }

  private sparkles(dt: number, on: boolean) {
    if (!on || Math.random() > dt * 30) return;
    const p = this.cam.toScreen(Math.random() * this.lv.width, Math.random() * this.lv.height);
    this.renderer.particles.spawn({ x: p.x, y: p.y, vy: -10, size: 10 + Math.random() * 22, spin: 1, r: 1, g: 0.9, b: 0.7, a: 0.8, add: true, life: 1 + Math.random(), k: Sprite.Spark });
  }

  private cursorAndMarker(dt: number) {
    const h = this.hover;
    if (h && (this.phase === 'clean' || this.phase === 'intro')) {
      const r = this.cleaning.radius() * this.cam.zoom;
      this.ui.cursor(h.x, h.y, true, this.cleaning.tool, r, h.kind, this.cleaning.swabDirt);
    } else if (h && this.phase === 'gild') {
      this.ui.cursor(h.x, h.y, true, 8, this.F * 0.42 * this.cam.zoom, h.kind, 0);
    } else if (h && this.phase === 'varnish') {
      this.ui.cursor(h.x, h.y, true, 9, 0, h.kind, 0);
    } else this.ui.cursor(0, 0, false, this.cleaning.tool, 0, null, 0);
    if (this.mark) {
      this.mark.t += dt;
      const p = this.cam.toScreen(this.mark.x, this.mark.y);
      this.ui.marker(p.x, p.y, this.mark.r * this.cam.zoom, this.mark.t < 3.2);
      if (this.mark.t > 3.2) this.mark = null;
    } else this.ui.marker(0, 0, 0, false);
  }

  get stage(): Stage {
    switch (this.phase) {
      case 'intro': case 'clean': return 'clean';
      case 'toRetouch': case 'retouch': return 'retouch';
      case 'toGild': case 'gild': return 'gild';
      case 'toVarnish': case 'varnish': return 'varnish';
      default: return 'done';
    }
  }

  save() {
    if (this.rp) return;
    this.saveT = 0;
    this.dirty = false;
    const st = this.stage;
    const progress = st === 'clean' ? this.cleaning.progress : st === 'retouch' ? this.retouch.done / this.retouch.total
      : st === 'gild' ? this.gilding.progress : st === 'varnish' ? this.varnish.progress : 1;
    const w: WorkSave = { v: 1, slug: this.item.slug, level: this.levelId, stage: st, t: Date.now(), progress, regions: this.lv.regions.length };
    if (st === 'clean') w.clean = this.cleaning.saveState();
    else {
      w.painted = this.retouch.order.slice();
      w.sel = this.retouch.sel;
      w.hints = this.hintsLeft;
      w.gild = this.gilding.saveState();
      w.varnish = this.varnish.saveState();
    }
    saveWork(w);
  }

  saveDirt() {
    this.dirtSaveT = 0;
    this.dirtDirty = false;
    if (this.rp) return;
    void idbSet('rec:' + this.item.slug, this.rec);
    if (this.stage !== 'clean') return;
    const snap = this.gpu.dirt.snapshot();
    void idbSet('dirt:' + this.item.slug, snap);
  }

  /** Leaving the easel (menu / page hidden). */
  flush() {
    if (this.rp) return;
    this.save();
    this.saveDirt();
  }
}
