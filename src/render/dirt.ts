// The dirt on the painting lives on the GPU: RGBA (dust, grime, varnish, spots) at half the region-map resolution,
// plus an fx texture (wet solvent, fresh-clean glint). Tools and tile dissolves run as a ping-pong pass.
import { Program, type GL } from '../gl/gl';
import { DIRT_INIT_FS, DIRT_REDUCE_FS, DIRT_STEP_FS, FULL_VS } from './shaders';
import { texture } from './textures';

export const CELL = 16; // dirt texels per read-back cell
export const MAXV = 1.3; // read-back values are v / MAXV

export type Tool = 0 | 1 | 2 | 3; // none, brush, swab, scalpel

export interface DirtInit {
  seed: [number, number];
  amt: [number, number, number, number];
  soot: number;
  spots: number[]; // x, y, r, thickness per spot (world)
  drips: number[]; // x, y0, length, width per drip (world)
}

export interface Brush { x0: number; y0: number; x1: number; y1: number; r: number; amount: number; tool: Tool; hard: number }
export interface Dissolve { u0: number; v0: number; u1: number; v1: number; rates: [number, number, number, number] }

interface Side { fbo: WebGLFramebuffer; state: WebGLTexture; fx: WebGLTexture }

export class DirtSim {
  readonly tw: number;
  readonly th: number;
  readonly cw: number;
  readonly ch: number;
  private sides: Side[];
  private cur = 0;
  private initP: Program;
  private stepP: Program;
  private reduceP: Program;
  private cellFbo: WebGLFramebuffer;
  private cellTex: WebGLTexture;
  private packFbo: WebGLFramebuffer;
  private packTex: WebGLTexture;
  readonly cells: Uint8Array;
  private float: boolean;

  constructor(private gl: GL, private vao: WebGLVertexArrayObject, readonly W: number, readonly H: number, private noise: WebGLTexture) {
    this.tw = Math.ceil(W / 2);
    this.th = Math.ceil(H / 2);
    this.cw = Math.ceil(this.tw / CELL);
    this.ch = Math.ceil(this.th / CELL);
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    this.sides = [this.side(), this.side()];
    this.initP = new Program(gl, FULL_VS, DIRT_INIT_FS, 'dirt-init');
    this.stepP = new Program(gl, FULL_VS, DIRT_STEP_FS, 'dirt-step');
    this.reduceP = new Program(gl, FULL_VS, DIRT_REDUCE_FS, 'dirt-reduce');
    [this.cellFbo, this.cellTex] = this.rgba8(this.cw, this.ch);
    [this.packFbo, this.packTex] = this.rgba8(Math.ceil(this.tw / 2), Math.ceil(this.th / 2));
    this.cells = new Uint8Array(this.cw * this.ch * 4);
  }

  get state() { return this.sides[this.cur].state; }
  get fx() { return this.sides[this.cur].fx; }

  private tex() {
    const gl = this.gl;
    const t = texture(gl);
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.tw, this.th, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.tw, this.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  private side(): Side {
    const gl = this.gl;
    const state = this.tex(), fx = this.tex();
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, fx, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, state, fx };
  }
  private rgba8(w: number, h: number): [WebGLFramebuffer, WebGLTexture] {
    const gl = this.gl;
    const t = texture(gl, { filter: gl.NEAREST });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [f, t];
  }

  private target(side: Side) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, side.fbo);
    gl.viewport(0, 0, this.tw, this.th);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
  }

  init(p: DirtInit) {
    const gl = this.gl;
    const side = this.sides[this.cur];
    this.target(side);
    const P = this.initP.use()
      .tex('u_noise', 0, this.noise)
      .f2('u_size', this.W, this.H)
      .f2('u_seed', p.seed[0], p.seed[1])
      .f4('u_amt', ...p.amt)
      .f1('u_soot', p.soot)
      .i1('u_nspots', Math.min(40, p.spots.length / 4))
      .i1('u_ndrips', Math.min(24, p.drips.length / 4));
    const sp = new Float32Array(160); sp.set(p.spots.slice(0, 160));
    const dr = new Float32Array(96); dr.set(p.drips.slice(0, 96));
    gl.uniform4fv(P.loc('u_spots'), sp);
    gl.uniform4fv(P.loc('u_drips'), dr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  step(dt: number, b: Brush | null, diss: Dissolve[]) {
    const gl = this.gl;
    const src = this.sides[this.cur], dst = this.sides[1 - this.cur];
    this.target(dst);
    const P = this.stepP.use()
      .tex('u_state', 0, src.state)
      .tex('u_fxIn', 1, src.fx)
      .tex('u_noise', 2, this.noise)
      .f2('u_size', this.W, this.H)
      .f1('u_dt', dt);
    if (b) P.f4('u_seg', b.x0, b.y0, b.x1, b.y1).f4('u_brush', b.r, b.amount, b.tool, b.hard);
    else P.f4('u_brush', 0, 0, 0, 0);
    const n = Math.min(8, diss.length);
    const r = new Float32Array(32), c = new Float32Array(32);
    for (let i = 0; i < n; i++) {
      const d = diss[i];
      r.set([d.u0, d.v0, d.u1, d.v1], i * 4);
      c.set(d.rates, i * 4);
    }
    gl.uniform4fv(P.loc('u_diss'), r);
    gl.uniform4fv(P.loc('u_dissCh'), c);
    P.i1('u_ndiss', n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cur = 1 - this.cur;
  }

  /** Mean dirt per CELL² block into this.cells (RGBA8, value = v / MAXV). Synchronous but tiny. */
  readCells() {
    this.reduce(this.cellFbo, this.cw, this.ch, CELL);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFbo);
    gl.readPixels(0, 0, this.cw, this.ch, gl.RGBA, gl.UNSIGNED_BYTE, this.cells);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.cells;
  }

  private reduce(fbo: WebGLFramebuffer, w: number, h: number, cell: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    this.reduceP.use().tex('u_state', 0, this.state).f2('u_srcTexel', 1 / this.tw, 1 / this.th).i1('u_cell', cell);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Half-resolution RGBA8 snapshot for the save file. */
  snapshot() {
    const w = Math.ceil(this.tw / 2), h = Math.ceil(this.th / 2);
    this.reduce(this.packFbo, w, h, 2);
    const gl = this.gl;
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w, h, data: out };
  }

  /** Restore from snapshot(): upsample on the CPU (nearest is fine, the dirt is soft). */
  restore(s: { w: number; h: number; data: Uint8Array }) {
    const gl = this.gl;
    const { tw, th } = this;
    const f = new Float32Array(tw * th * 4);
    for (let y = 0; y < th; y++) {
      const sy = Math.min(s.h - 1, y >> 1);
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(s.w - 1, x >> 1);
        const i = (y * tw + x) * 4, j = (sy * s.w + sx) * 4;
        for (let c = 0; c < 4; c++) f[i + c] = (s.data[j + c] / 255) * MAXV;
      }
    }
    for (const side of this.sides) {
      gl.bindTexture(gl.TEXTURE_2D, side.state);
      if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.FLOAT, f);
      else {
        const b = new Uint8Array(f.length);
        for (let i = 0; i < f.length; i++) b[i] = Math.min(255, Math.round(f[i] * 255));
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
      }
    }
  }

  dispose() {
    const gl = this.gl;
    for (const s of this.sides) { gl.deleteFramebuffer(s.fbo); gl.deleteTexture(s.state); gl.deleteTexture(s.fx); }
    gl.deleteFramebuffer(this.cellFbo); gl.deleteTexture(this.cellTex);
    gl.deleteFramebuffer(this.packFbo); gl.deleteTexture(this.packTex);
  }
}
