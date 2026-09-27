// Gold leaf on the frame, on the GPU: one RGBA texture over the frame's bounding box (leaf, burnish, seed),
// ping-pong updated by leaf stamps, rubbing and patch finishing. Read back in cells for patch progress.
import { Program, type GL } from '../gl/gl';
import { DIRT_REDUCE_FS, FULL_VS, GILT_STEP_FS } from './shaders';
import { texture } from './textures';

export const GCELL = 8;     // texels per read-back cell
export const GSCALE = 3;    // world units per texel

export interface Leaf { x: number; y: number; hs: number; ang: number; seed: number }

export class GiltSim {
  readonly tw: number;
  readonly th: number;
  readonly cw: number;
  readonly ch: number;
  /** World rect of the texture: the frame's bounding box. */
  readonly rect: [number, number, number, number];
  private tex: WebGLTexture[];
  private fbo: WebGLFramebuffer[];
  private cur = 0;
  private stepP: Program;
  private reduceP: Program;
  private cellFbo: WebGLFramebuffer;
  private cellTex: WebGLTexture;
  readonly cells: Uint8Array;
  private float: boolean;

  constructor(private gl: GL, private vao: WebGLVertexArrayObject, W: number, H: number, F: number, private noise: WebGLTexture) {
    this.rect = [-F, -F, W + F, H + F];
    this.tw = Math.ceil((W + 2 * F) / GSCALE);
    this.th = Math.ceil((H + 2 * F) / GSCALE);
    this.cw = Math.ceil(this.tw / GCELL);
    this.ch = Math.ceil(this.th / GCELL);
    this.float = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.tex = [this.mk(), this.mk()];
    this.fbo = this.tex.map((t) => {
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stepP = new Program(gl, FULL_VS, GILT_STEP_FS, 'gilt-step');
    this.reduceP = new Program(gl, FULL_VS, DIRT_REDUCE_FS, 'gilt-reduce');
    this.cellTex = texture(gl, { filter: gl.NEAREST });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.cw, this.ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.cellFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cellTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cells = new Uint8Array(this.cw * this.ch * 4);
  }

  get state() { return this.tex[this.cur]; }

  private mk() {
    const gl = this.gl;
    const t = texture(gl);
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.tw, this.th, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.tw, this.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  step(dt: number, leaves: Leaf[], rub: { x0: number; y0: number; x1: number; y1: number; r: number; amount: number } | null, fin: number[][]) {
    const gl = this.gl;
    const dst = 1 - this.cur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]);
    gl.viewport(0, 0, this.tw, this.th);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    const P = this.stepP.use().tex('u_state', 0, this.tex[this.cur]).tex('u_noise', 1, this.noise)
      .f4('u_rect', ...this.rect).f1('u_dt', dt);
    const L = new Float32Array(32), S = new Float32Array(8);
    const nl = Math.min(8, leaves.length);
    for (let i = 0; i < nl; i++) { const l = leaves[i]; L.set([l.x, l.y, l.hs, l.ang], i * 4); S[i] = l.seed; }
    gl.uniform4fv(P.loc('u_leaf'), L);
    gl.uniform1fv(P.loc('u_leafSeed'), S);
    P.i1('u_nleaf', nl);
    if (rub) P.f4('u_seg', rub.x0, rub.y0, rub.x1, rub.y1).f2('u_rub', rub.r, rub.amount);
    else P.f2('u_rub', 0, 0);
    const R = new Float32Array(32);
    const nf = Math.min(8, fin.length);
    for (let i = 0; i < nf; i++) R.set(fin[i], i * 4);
    gl.uniform4fv(P.loc('u_fin'), R);
    P.i1('u_nfin', nf);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cur = dst;
  }

  readCells() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFbo);
    gl.viewport(0, 0, this.cw, this.ch);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    this.reduceP.use().tex('u_state', 0, this.state).f2('u_srcTexel', 1 / this.tw, 1 / this.th).i1('u_cell', GCELL).f1('u_div', 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.cw, this.ch, gl.RGBA, gl.UNSIGNED_BYTE, this.cells);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.cells;
  }

  /** Fill everything (a finished frame, e.g. when continuing past the gilding). */
  fillAll() {
    const gl = this.gl;
    for (const f of this.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.clearColor(1, 1, 0.5, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    const gl = this.gl;
    this.tex.forEach((t) => gl.deleteTexture(t));
    this.fbo.forEach((f) => gl.deleteFramebuffer(f));
    gl.deleteTexture(this.cellTex);
    gl.deleteFramebuffer(this.cellFbo);
  }
}
