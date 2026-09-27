// WebGL2 renderer: studio wall -> frame -> painting (ghost / retouch / dirt) -> numbers -> particles.
import { Program, type GL } from '../gl/gl';
import type { Camera } from '../game/camera';
import type { LevelData } from '../data';
import { BG_FS, FRAME_FS, NUM_FS, NUM_VS, PAINT_FS, SPRITE_FS, SPRITE_VS, WORLD_VS } from './shaders';
import { glyphAtlas, noiseTexture, spriteAtlas, texture } from './textures';
import { DirtSim } from './dirt';
import { GiltSim } from './gilt';
import { VROWS } from '../game/varnish';
import { Particles } from './particles';

/** t0 of a region nobody has painted yet (shaders test < -1e8). */
const UNPAINTED = -1e9;

export interface SceneState {
  time: number;
  outline: number;
  outlineC: [number, number];
  outlineR: number;
  dirtOn: number;
  sel: number;
  selT: number;
  sweep: [number, number, number];
  peek: number;
  webs: [number, number, number, number];
  restored: number;
  frameDust: number;
  numAlpha: number;
  style: number;
  tilt: [number, number];
  shine: number;
  varnOn: number;
}

/** GPU side of one painting at one level. */
export class PaintingGL {
  img: WebGLTexture;
  reg: WebGLTexture;
  rinfo: WebGLTexture;
  pal: WebGLTexture;
  info: Float32Array; // 8 floats per region: [c, t0, tx, ty], [maxR, dur, 0, 0]
  private rows: number;
  private dirty = true;
  numBuf: WebGLBuffer;
  numVao: WebGLVertexArrayObject;
  numCount = 0;
  dirt: DirtSim;
  gilt: GiltSim;
  varn: WebGLTexture;
  readonly W: number;
  readonly H: number;

  constructor(private gl: GL, quad: WebGLBuffer, fullVao: WebGLVertexArrayObject, noise: WebGLTexture, image: HTMLImageElement, readonly level: LevelData, F: number) {
    const W = (this.W = level.width), H = (this.H = level.height);
    this.img = texture(gl, { mips: true });
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

    this.reg = texture(gl, { filter: gl.NEAREST });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, W, H, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, level.map);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    const n = level.regions.length;
    this.rows = Math.max(1, Math.ceil(n / 256));
    this.info = new Float32Array(512 * this.rows * 4);
    level.regions.forEach((r, i) => {
      const o = ((i >> 8) * 512 + (i & 255) * 2) * 4;
      this.info[o] = r.c;
      this.info[o + 1] = UNPAINTED;
      this.info[o + 4] = Math.hypot(r.b[2] - r.b[0], r.b[3] - r.b[1]);
      this.info[o + 5] = 0.5;
    });
    this.rinfo = texture(gl, { filter: gl.NEAREST });
    this.upload();

    this.pal = texture(gl, { filter: gl.NEAREST });
    const pd = new Uint8Array(64 * 4);
    level.palette.forEach((c, i) => pd.set([c[0], c[1], c[2], 255], i * 4));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pd);

    // numbers: one instance per digit: pos(2), digit, offset, region, size
    const inst: number[] = [];
    level.regions.forEach((r, i) => {
      const s = String(r.c + 1);
      const size = Math.min(r.r * 1.3, 80);
      for (let k = 0; k < s.length; k++) inst.push(r.x, r.y, +s[k], k - (s.length - 1) / 2, i, size);
    });
    this.numCount = inst.length / 6;
    this.numVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.numVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.numBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.numBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 24, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.dirt = new DirtSim(gl, fullVao, W, H, noise);
    this.gilt = new GiltSim(gl, fullVao, W, H, F, noise);
    this.varn = texture(gl);
    this.uploadVarnish(new Float32Array(VROWS * 4));
  }

  uploadVarnish(rows: Float32Array) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.varn);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, VROWS, 0, gl.RGBA, gl.FLOAT, rows);
  }

  /** Start revealing region i from world point (x, y) at time t0 over dur seconds. */
  reveal(i: number, x: number, y: number, t0: number, dur: number) {
    const o = ((i >> 8) * 512 + (i & 255) * 2) * 4;
    this.info[o + 1] = t0;
    this.info[o + 2] = x;
    this.info[o + 3] = y;
    // farthest bbox corner from the start point, so the front always covers the region
    const b = this.level.regions[i].b;
    this.info[o + 4] = Math.max(Math.hypot(b[0] - x, b[1] - y), Math.hypot(b[2] - x, b[1] - y), Math.hypot(b[0] - x, b[3] - y), Math.hypot(b[2] - x, b[3] - y));
    this.info[o + 5] = dur;
    this.dirty = true;
  }
  resetReveal(i: number) {
    const o = ((i >> 8) * 512 + (i & 255) * 2) * 4;
    this.info[o + 1] = UNPAINTED;
    this.dirty = true;
  }

  upload() {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.rinfo);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 512, this.rows, 0, gl.RGBA, gl.FLOAT, this.info);
    this.dirty = false;
  }

  dispose() {
    const gl = this.gl;
    for (const t of [this.img, this.reg, this.rinfo, this.pal, this.varn]) gl.deleteTexture(t);
    this.gilt.dispose();
    gl.deleteBuffer(this.numBuf);
    gl.deleteVertexArray(this.numVao);
    this.dirt.dispose();
  }
}

export class Renderer {
  gl: GL;
  dpr = 1;
  w = 1;
  h = 1;
  noise: WebGLTexture;
  private glyphs: WebGLTexture | null = null;
  private atlas: WebGLTexture;
  private quad: WebGLBuffer;
  private quadVao: WebGLVertexArrayObject;
  readonly fullVao: WebGLVertexArrayObject;
  private bgP: Program;
  private frameP: Program;
  private paintP: Program;
  private numP: Program;
  private spriteP: Program;
  private spriteBuf: WebGLBuffer;
  private spriteVao: WebGLVertexArrayObject;
  private spriteData = new Float32Array(1500 * 9);
  particles = new Particles();
  painting: PaintingGL | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 niedostępny');
    this.gl = gl;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fullVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);
    this.noise = noiseTexture(gl);
    this.atlas = spriteAtlas(gl);
    this.bgP = new Program(gl, WORLD_VS, BG_FS, 'bg');
    this.frameP = new Program(gl, WORLD_VS, FRAME_FS, 'frame');
    this.paintP = new Program(gl, WORLD_VS, PAINT_FS, 'paint');
    this.numP = new Program(gl, NUM_VS, NUM_FS, 'num');
    this.spriteP = new Program(gl, SPRITE_VS, SPRITE_FS, 'sprite');
    this.spriteVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.spriteBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.spriteData.byteLength, gl.DYNAMIC_DRAW);
    const st = 36;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, st, 32); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
  }

  /** The digit atlas needs the web font loaded first. */
  setFont(font: string) {
    if (this.glyphs) this.gl.deleteTexture(this.glyphs);
    this.glyphs = glyphAtlas(this.gl, font);
  }

  load(image: HTMLImageElement, level: LevelData) {
    this.painting?.dispose();
    this.painting = new PaintingGL(this.gl, this.quad, this.fullVao, this.noise, image, level, this.frameWidth(level.width, level.height));
    return this.painting;
  }
  unload() {
    this.painting?.dispose();
    this.painting = null;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.w = w;
    this.h = h;
    const cw = Math.round(w * this.dpr), ch = Math.round(h * this.dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  frameWidth(W: number, H: number) { return Math.max(W, H) * 0.085; }

  render(cam: Camera, s: SceneState) {
    const gl = this.gl;
    const p = this.painting;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0.05, 0.04, 0.035, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!p) return;
    p.upload();
    const W = p.W, H = p.H, F = this.frameWidth(W, H);
    const pxw = 1 / (cam.zoom * this.dpr);
    const cm = (P: Program, rect: [number, number, number, number]) =>
      P.use().f4('u_rect', ...rect).f2('u_cam', cam.x, cam.y).f1('u_zoom', cam.zoom).f2('u_screen', this.w, this.h);
    gl.bindVertexArray(this.quadVao);

    // wall: a big quad around everything visible
    const tl = cam.toWorld(0, 0), br = cam.toWorld(this.w, this.h);
    cm(this.bgP, [tl.x - 10, tl.y - 10, br.x + 10, br.y + 10])
      .tex('u_noise', 0, this.noise).f4('u_obj', -F, -F, W + F, H + F).f1('u_zoom', cam.zoom).f1('u_shadow', F * 0.9);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    cm(this.frameP, [-F, -F, W + F, H + F])
      .tex('u_noise', 0, this.noise).tex('u_gilt', 1, p.gilt.state).f4('u_giltRect', ...p.gilt.rect)
      .f2('u_size', W, H).f1('u_fw', F).f1('u_dust', s.frameDust).f1('u_pxw', pxw).f1('u_time', s.time)
      .i1('u_style', s.style).f2('u_tilt', s.tilt[0], s.tilt[1]).f1('u_shine', s.shine);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    cm(this.paintP, [0, 0, W, H])
      .tex('u_img', 0, p.img).tex('u_dirt', 1, p.dirt.state).tex('u_fx', 2, p.dirt.fx).tex('u_noise', 3, this.noise)
      .tex('u_pal', 4, p.pal).tex('u_rinfo', 5, p.rinfo).tex('u_reg', 6, p.reg)
      .f2('u_size', W, H).f2('u_dirtTexel', 1 / p.dirt.tw, 1 / p.dirt.th).f1('u_time', s.time).f1('u_pxw', pxw)
      .f1('u_outline', s.outline).f2('u_outlineC', s.outlineC[0], s.outlineC[1]).f1('u_outlineR', s.outlineR)
      .f1('u_dirtOn', s.dirtOn).i1('u_sel', s.sel).f1('u_selT', s.selT).f4('u_sweep', s.sweep[0], s.sweep[1], s.sweep[2], 0)
      .f1('u_peek', s.peek).f4('u_webs', ...s.webs).f1('u_restored', s.restored)
      .tex('u_varn', 7, p.varn).f1('u_varnOn', s.varnOn).f2('u_tilt', s.tilt[0], s.tilt[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.glyphs && s.numAlpha > 0 && s.peek < 0.5) {
      gl.bindVertexArray(p.numVao);
      this.numP.use().tex('u_rinfo', 0, p.rinfo).tex('u_glyphs', 1, this.glyphs)
        .f2('u_cam', cam.x, cam.y).f1('u_zoom', cam.zoom).f2('u_screen', this.w, this.h).f1('u_time', s.time)
        .i1('u_sel', s.sel).f1('u_alpha', s.numAlpha).f1('u_minPx', 8.5);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.numCount);
    }

    // particles: normal, then additive
    gl.bindVertexArray(this.spriteVao);
    this.spriteP.use().tex('u_atlas', 0, this.atlas).f2('u_screen', this.w, this.h);
    for (const add of [false, true]) {
      const n = this.particles.fill(this.spriteData, add);
      if (!n) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.spriteData, 0, n * 9);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
