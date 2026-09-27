// Stage 1: cleaning (PowerWash). The dirt itself is simulated on the GPU (render/dirt.ts); here: tools, strokes,
// progress from the read-back, tiles that finish themselves with a bell once almost clean, layer completion.
import type { LevelId } from '../data';
import { makeRng, hashString } from '../core/rng';
import { CELL, MAXV, type Brush, type DirtInit, type DirtSim, type Dissolve, type Tool } from '../render/dirt';
import type { Particles } from '../render/particles';
import { Sprite } from '../render/particles';
import type { Camera } from './camera';
import { sound } from '../audio/audio';

export const CH = { dust: 0, grime: 1, varnish: 2, spots: 3 } as const;
export const LAYER_NAMES = ['Kurz i pajęczyny', 'Sadza i zacieki', 'Pożółkły werniks', 'Zaschnięte plamy'];

export interface ToolDef {
  id: Tool;
  name: string;
  hint: string;
  channels: number[]; // layers it's meant for (progress ring on its button)
  radius: number;     // × long side
  hard: number;       // where the soft edge starts (0..1 of radius)
  rate: number;
}

export const TOOLS: ToolDef[] = [
  { id: 1, name: 'Pędzel', hint: 'Miękki pędzel zmiata kurz i pajęczyny', channels: [CH.dust], radius: 0.075, hard: 0.3, rate: 1 },
  { id: 2, name: 'Wacik', hint: 'Wacik z rozpuszczalnikiem zdejmuje sadzę i stary werniks', channels: [CH.grime, CH.varnish], radius: 0.045, hard: 0.5, rate: 1 },
  { id: 3, name: 'Skalpel', hint: 'Skalpel zeskrobuje zaschnięte krople', channels: [CH.spots], radius: 0.017, hard: 0.75, rate: 1 },
];

interface LevelDirt { amt: [number, number, number, number]; soot: number; drips: number; spots: number; webs: number }
const DIRT: Record<LevelId, LevelDirt> = {
  latwy: { amt: [0.85, 0, 0.9, 0], soot: 0, drips: 0, spots: 0, webs: 1 },
  sredni: { amt: [0.95, 0.6, 1.0, 1], soot: 0.12, drips: 7, spots: 12, webs: 2 },
  trudny: { amt: [1.05, 0.85, 1.15, 1], soot: 0.25, drips: 13, spots: 26, webs: 3 },
};

export function dirtFor(slug: string, level: LevelId, W: number, H: number, over?: Partial<{ soot: number; webs: number; spots: number }>) {
  const d = DIRT[level];
  const rng = makeRng(hashString(slug + level));
  const L = Math.max(W, H);
  const spots: number[] = [];
  const nSpots = Math.round(d.spots * (over?.spots ?? 1));
  for (let i = 0; i < nSpots; i++) {
    // clusters: wax drops, fly specks, splashes of window paint
    const cx = rng.range(0.08, 0.92) * W, cy = rng.range(0.08, 0.92) * H;
    const k = rng.int(1, 3);
    for (let j = 0; j < k && spots.length < 160; j++) {
      spots.push(cx + rng.range(-1, 1) * L * 0.02, cy + rng.range(-1, 1) * L * 0.02, L * rng.range(0.004, 0.011), rng.range(0.8, 1.1));
    }
  }
  const drips: number[] = [];
  for (let i = 0; i < d.drips; i++) {
    const x = rng.range(0.05, 0.95) * W;
    const y0 = rng.range(-0.05, 0.35) * H;
    drips.push(x, y0, rng.range(0.15, 0.55) * H, L * rng.range(0.004, 0.009));
  }
  const webs: [number, number, number, number] = [0, 0, 0, 0];
  const nw = over?.webs ?? d.webs;
  const corners = [0, 1, 2, 3].sort(() => rng() - 0.5);
  for (let i = 0; i < Math.min(4, nw); i++) webs[corners[i]] = rng.range(0.55, 1);
  const init: DirtInit = {
    seed: [rng(), rng()],
    amt: d.amt,
    soot: over?.soot ?? d.soot,
    spots: spots.slice(0, 160),
    drips,
  };
  return { init, webs };
}

export interface CleaningEvents {
  tileDone(x: number, y: number, n: number): void;
  layerDone(ch: number): void;
  allDone(): void;
  progress(): void;
  suggestTool(t: Tool, why: string): void;
}

interface Tile { x0: number; y0: number; x1: number; y1: number; init: number[]; done: boolean[] }

export class Cleaning {
  tool: Tool = 1;
  tiles: Tile[] = [];
  initTotal = [0, 0, 0, 0];
  cur = [0, 0, 0, 0];
  layerDone = [false, false, false, false];
  channels: number[] = []; // layers present at this level
  finished = false;
  private dissolves: (Dissolve & { t: number })[] = [];
  private brush: { x: number; y: number; p: number; kind: string; active: boolean; lastX: number; lastY: number; speed: number } = { x: 0, y: 0, p: 1, kind: 'mouse', active: false, lastX: 0, lastY: 0, speed: 0 };
  private pendingSeg: Brush | null = null;
  private readT = 0;
  private started = false;
  private tilesDoneCount = 0;
  private fxUntil = 0;
  private time = 0;
  swabDirt = 0; // how dirty the current cotton swab is (0..1)
  private suggested = new Set<string>();
  private idleT = 0;

  constructor(private dirt: DirtSim, private cam: Camera, private parts: Particles, readonly ev: CleaningEvents) {
    const { cw, ch } = dirt;
    const aspect = dirt.W / dirt.H;
    const nx = aspect >= 1 ? 5 : 4, ny = Math.max(3, Math.round(nx / aspect));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      this.tiles.push({
        x0: Math.floor((i * cw) / nx), x1: Math.floor(((i + 1) * cw) / nx),
        y0: Math.floor((j * ch) / ny), y1: Math.floor(((j + 1) * ch) / ny),
        init: [0, 0, 0, 0], done: [false, false, false, false],
      });
    }
  }

  get L() { return Math.max(this.dirt.W, this.dirt.H); }
  toolDef(t: Tool = this.tool) { return TOOLS.find((d) => d.id === t)!; }
  get toolsNeeded() { return TOOLS.filter((t) => t.channels.some((c) => this.channels.includes(c))); }

  /** First read-back after the dirt exists: per tile and per layer starting amounts. restoredDone: tiles already done in a save. */
  start(restoredDone?: boolean[][], initTotals?: number[], tileInit?: number[][]) {
    const cells = this.dirt.readCells();
    const sums = this.sumTiles(cells);
    this.tiles.forEach((t, i) => {
      t.init = tileInit?.[i] ?? sums[i];
      if (restoredDone?.[i]) t.done = restoredDone[i].slice();
    });
    for (let c = 0; c < 4; c++) {
      this.initTotal[c] = initTotals?.[c] ?? this.tiles.reduce((a, t) => a + t.init[c], 0);
      if (this.initTotal[c] > 0.5) this.channels.push(c);
    }
    for (const t of this.tiles) for (let c = 0; c < 4; c++) if (t.init[c] < 0.02 * this.initTotal[c] / this.tiles.length || !this.channels.includes(c)) t.done[c] = true;
    this.tilesDoneCount = this.tiles.reduce((a, t) => a + t.done.filter(Boolean).length, 0);
    this.readProgress(cells);
    for (const c of this.channels) this.layerDone[c] = this.tiles.every((t) => t.done[c]);
    this.started = true;
  }

  private sumTiles(cells: Uint8Array) {
    const { cw } = this.dirt;
    return this.tiles.map((t) => {
      const s = [0, 0, 0, 0];
      for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) {
        const o = (y * cw + x) * 4;
        for (let c = 0; c < 4; c++) s[c] += cells[o + c] / 255;
      }
      return s;
    });
  }

  private readProgress(cells: Uint8Array) {
    const sums = this.sumTiles(cells);
    this.cur = [0, 0, 0, 0];
    sums.forEach((s, i) => { for (let c = 0; c < 4; c++) this.cur[c] += this.tiles[i].done[c] ? 0 : s[c]; });
    return sums;
  }

  /** 0..1 remaining for a layer. */
  remaining(c: number) {
    if (!this.channels.includes(c) || this.layerDone[c]) return 0;
    return Math.min(1, this.cur[c] / Math.max(1e-6, this.initTotal[c]));
  }
  get progress() {
    let a = 0, b = 0;
    const wgt = [1, 1.2, 1.4, 0.6];
    for (const c of this.channels) { a += wgt[c] * (1 - this.remaining(c)); b += wgt[c]; }
    return b ? a / b : 1;
  }

  /** Dirt (0..1 of MAXV) under a world point from the last read-back. */
  dirtAt(x: number, y: number) {
    const { cw, ch, cells } = this.dirt;
    const cx = Math.floor(x / 2 / CELL), cy = Math.floor(y / 2 / CELL);
    if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) return [0, 0, 0, 0];
    const o = (cy * cw + cx) * 4;
    return [cells[o] / 255, cells[o + 1] / 255, cells[o + 2] / 255, cells[o + 3] / 255];
  }

  // ---- strokes (screen coordinates in, world inside) ----
  down(sx: number, sy: number, p: number, kind: string) {
    const w = this.cam.toWorld(sx, sy);
    this.brush = { x: w.x, y: w.y, p, kind, active: true, lastX: sx, lastY: sy, speed: 0 };
    this.queue(w.x, w.y, w.x, w.y, p, 0.016);
    this.idleT = 0;
  }
  move(sx: number, sy: number, p: number) {
    const b = this.brush;
    if (!b.active) return;
    const w = this.cam.toWorld(sx, sy);
    this.queue(b.x, b.y, w.x, w.y, p, 0);
    const d = Math.hypot(sx - b.lastX, sy - b.lastY);
    b.speed = Math.max(b.speed, d);
    b.lastX = sx; b.lastY = sy;
    b.x = w.x; b.y = w.y; b.p = p;
  }
  up() {
    this.brush.active = false;
    sound.scrub(0, 0, 0);
  }

  /** Merge stroke pieces between frames into one capsule per frame (long ones are split in update). */
  private segs: { x0: number; y0: number; x1: number; y1: number; p: number }[] = [];
  private queue(x0: number, y0: number, x1: number, y1: number, p: number, _dt: number) {
    this.segs.push({ x0, y0, x1, y1, p });
  }

  update(dt: number) {
    this.time += dt;
    if (!this.started) return;
    const def = this.toolDef();
    const L = this.L;
    const b = this.brush;
    // apply the stroke: every queued piece as its own step (they're short), plus "dwelling" when holding still
    const steps: Brush[] = [];
    const pf = (p: number) => (b.kind === 'pen' ? { size: 0.7 + 0.55 * p, str: 0.55 + 0.75 * p } : { size: 1, str: 1 });
    if (this.segs.length) {
      // coalesce into at most 6 steps per frame
      const n = this.segs.length, k = Math.ceil(n / 6);
      for (let i = 0; i < n; i += k) {
        const a = this.segs[i], z = this.segs[Math.min(n - 1, i + k - 1)];
        const f = pf(z.p);
        const r = def.radius * L * f.size;
        const len = Math.hypot(z.x1 - a.x0, z.y1 - a.y0);
        steps.push({ x0: a.x0, y0: a.y0, x1: z.x1, y1: z.y1, r, amount: def.rate * f.str * (Math.min(len, 1.6 * r) / r) * 0.95, tool: this.tool, hard: def.hard });
      }
      this.segs.length = 0;
    }
    if (b.active) {
      const f = pf(b.p);
      const r = def.radius * L * f.size;
      steps.push({ x0: b.x, y0: b.y, x1: b.x, y1: b.y, r, amount: def.rate * f.str * dt * 0.5, tool: this.tool, hard: def.hard });
      this.fxUntil = this.time + 3;
      this.idleT = 0;
    } else this.idleT += dt;

    // dissolving tiles
    this.dissolves = this.dissolves.filter((d) => (d.t -= dt) > 0);
    const needStep = steps.length > 0 || this.dissolves.length > 0 || this.time < this.fxUntil;
    if (needStep) {
      if (steps.length === 0) this.dirt.step(dt, null, this.dissolves);
      else steps.forEach((s, i) => { const last = i === steps.length - 1; this.dirt.step(last ? dt : 0, s, last ? this.dissolves : []); });
    }
    if (this.dissolves.length) this.fxUntil = Math.max(this.fxUntil, this.time + 1);

    // sound + particles from the stroke
    if (b.active) {
      const under = this.dirtAt(b.x, b.y);
      const rel = def.channels.reduce((a, c) => Math.max(a, under[c] * MAXV), 0) + (this.tool === 2 ? under[0] * 0.5 : 0);
      const spd = Math.min(1, b.speed / (40 * (dt * 60)));
      sound.scrub(this.tool, Math.max(spd, 0.12), Math.min(1, rel));
      this.emit(rel, spd, under);
      if (this.tool === 2) this.swabDirt = Math.min(1, this.swabDirt + rel * spd * dt * 0.35);
      b.speed = 0;
    }

    // read back progress a few times a second
    this.readT -= dt;
    if (this.readT <= 0 && !this.finished) {
      this.readT = 0.2;
      const cells = this.dirt.readCells();
      const sums = this.readProgress(cells);
      this.checkTiles(sums);
      this.ev.progress();
      this.maybeSuggest();
    }
  }

  private emit(rel: number, spd: number, under: number[]) {
    const b = this.brush;
    const s = this.cam.toScreen(b.x, b.y);
    const z = this.cam.zoom;
    const r = this.toolDef().radius * this.L * z;
    const n = Math.random() < rel * (0.3 + spd) * 2.2 ? 1 + Math.floor(rel * 3 * spd) : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * r * 0.8;
      const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
      if (this.tool === 1) {
        const g = 0.62 + Math.random() * 0.15;
        this.parts.spawn({ x, y, vx: (Math.random() - 0.5) * 50, vy: -10 - Math.random() * 30, size: 4 + Math.random() * 9, grow: 14, r: g, g: g * 0.97, b: g * 0.92, a: 0.35, life: 1 + Math.random() * 1.2, drag: 1.5, grav: -6 });
      } else if (this.tool === 2) {
        const dirty = under[1] > under[2] ? [0.2, 0.15, 0.1] : [0.75, 0.55, 0.25];
        this.parts.spawn({ x, y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, size: 2 + Math.random() * 3, r: dirty[0], g: dirty[1], b: dirty[2], a: 0.7, life: 0.5 + Math.random() * 0.4, drag: 3, k: Sprite.Dot });
        if (Math.random() < 0.25) this.parts.spawn({ x, y, size: 5 + Math.random() * 7, grow: 12, r: 1, g: 0.95, b: 0.85, a: 0.35, add: true, life: 0.5, k: Sprite.Ring });
      } else {
        const c = Math.random() < 0.5 ? [0.85, 0.8, 0.65] : [0.15, 0.11, 0.08];
        this.parts.spawn({ x, y, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 120, size: 2.5 + Math.random() * 4, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 20, r: c[0], g: c[1], b: c[2], a: 1, life: 1.4, grav: 700, drag: 0.4, k: Sprite.Flake });
      }
    }
  }

  private checkTiles(sums: number[][]) {
    const { cw, ch } = this.dirt;
    this.tiles.forEach((t, i) => {
      for (const c of this.channels) {
        if (t.done[c]) continue;
        const frac = sums[i][c] / Math.max(1e-6, t.init[c]);
        const area = (t.x1 - t.x0) * (t.y1 - t.y0);
        if (frac < 0.1 || (sums[i][c] / area < 0.004 && frac < 0.35)) this.finishTile(i, c, cw, ch);
      }
    });
    for (const c of this.channels) {
      if (!this.layerDone[c] && this.tiles.every((t) => t.done[c])) {
        this.layerDone[c] = true;
        this.ev.layerDone(c);
      }
    }
    if (!this.finished && this.channels.every((c) => this.layerDone[c])) {
      this.finished = true;
      sound.scrub(0, 0, 0);
      this.ev.allDone();
    }
  }

  private finishTile(i: number, c: number, cw: number, ch: number) {
    const t = this.tiles[i];
    t.done[c] = true;
    const rates: [number, number, number, number] = [0, 0, 0, 0];
    rates[c] = 5;
    this.dissolves.push({ u0: t.x0 / cw, v0: t.y0 / ch, u1: t.x1 / cw, v1: t.y1 / ch, rates, t: 1.4 });
    this.tilesDoneCount++;
    const wx = ((t.x0 + t.x1) / 2) * CELL * 2, wy = ((t.y0 + t.y1) / 2) * CELL * 2;
    this.sparkleTile(t);
    this.ev.tileDone(wx, wy, this.tilesDoneCount);
  }

  private sparkleTile(t: Tile) {
    const s0 = this.cam.toScreen(t.x0 * CELL * 2, t.y0 * CELL * 2), s1 = this.cam.toScreen(t.x1 * CELL * 2, t.y1 * CELL * 2);
    const n = 14;
    for (let k = 0; k < n; k++) {
      const x = s0.x + Math.random() * (s1.x - s0.x), y = s0.y + Math.random() * (s1.y - s0.y);
      this.parts.spawn({ x, y, vy: -12, size: 8 + Math.random() * 16, spin: 1.5, r: 1, g: 0.93, b: 0.75, a: 0.9, add: true, life: 0.6 + Math.random() * 0.7, k: Sprite.Spark });
    }
  }

  /** Clean everything left (end of the stage or the test skip). */
  finishAll() {
    const { cw, ch } = this.dirt;
    this.tiles.forEach((t, i) => { for (const c of this.channels) if (!t.done[c]) this.finishTile(i, c, cw, ch); });
    this.dissolves.push({ u0: 0, v0: 0, u1: 1, v1: 1, rates: [4, 4, 4, 4], t: 2 });
  }

  private maybeSuggest() {
    // point at the right tool once its layer is what's left on top
    const has = (c: number) => this.channels.includes(c) && !this.layerDone[c];
    const dustLeft = this.remaining(CH.dust);
    if (this.tool === 1 && has(CH.dust) === false && (has(CH.grime) || has(CH.varnish)) && !this.suggested.has('swab')) {
      this.suggested.add('swab');
      this.ev.suggestTool(2, 'Kurz zniknął. Teraz wacik z rozpuszczalnikiem: zdejmie ' + (has(CH.grime) ? 'sadzę i ' : '') + 'pożółkły werniks.');
    } else if (this.tool === 1 && dustLeft < 0.35 && (has(CH.grime) || has(CH.varnish)) && !this.suggested.has('swab')) {
      this.suggested.add('swab');
      this.ev.suggestTool(2, 'Pod kurzem jest pożółkły werniks. Weź wacik z rozpuszczalnikiem.');
    } else if (has(CH.spots) && !has(CH.grime) && !has(CH.varnish) && this.tool !== 3 && !this.suggested.has('scalpel')) {
      this.suggested.add('scalpel');
      this.ev.suggestTool(3, 'Zostały zaschnięte krople. Zeskrob je skalpelem.');
    } else if (this.idleT > 7 && !this.suggested.has('idle' + Math.floor(this.time / 30))) {
      this.suggested.add('idle' + Math.floor(this.time / 30));
      this.ev.suggestTool(this.tool, '');
    }
  }

  /** Where the most dirt is left (world), for hints. */
  dirtiestSpot(): { x: number; y: number } | null {
    const { cw, ch, cells } = this.dirt;
    let best = 0, bx = 0, by = 0;
    const chans = this.channels.filter((c) => !this.layerDone[c]);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const o = (y * cw + x) * 4;
      let v = 0;
      for (const c of chans) v += cells[o + c];
      if (v > best) { best = v; bx = x; by = y; }
    }
    return best > 8 ? { x: (bx + 0.5) * CELL * 2, y: (by + 0.5) * CELL * 2 } : null;
  }

  saveState() {
    return { tool: this.tool, done: this.tiles.map((t) => t.done.slice()), init: this.tiles.map((t) => t.init.slice()), initTotal: this.initTotal.slice() };
  }
}
