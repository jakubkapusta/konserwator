// Thin WebGL2 helpers: programs with cached uniforms, render targets, dynamic buffers.

export type GL = WebGL2RenderingContext;

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: GL, vs: string, fs: string, name: string) {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`link ${name}: ${gl.getProgramInfoLog(p)}`);
    }
    this.prog = p;
  }
  use() {
    this.gl.useProgram(this.prog);
    return this;
  }
  loc(name: string) {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }
  f1(n: string, a: number) { this.gl.uniform1f(this.loc(n), a); return this; }
  f2(n: string, a: number, b: number) { this.gl.uniform2f(this.loc(n), a, b); return this; }
  f3(n: string, a: number, b: number, c: number) { this.gl.uniform3f(this.loc(n), a, b, c); return this; }
  f4(n: string, a: number, b: number, c: number, d: number) { this.gl.uniform4f(this.loc(n), a, b, c, d); return this; }
  v3(n: string, v: ArrayLike<number>) { this.gl.uniform3f(this.loc(n), v[0], v[1], v[2]); return this; }
  i1(n: string, a: number) { this.gl.uniform1i(this.loc(n), a); return this; }
  tex(n: string, unit: number, t: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(this.loc(n), unit);
    return this;
  }
}

function compile(gl: GL, type: number, src: string, name: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    console.error(numbered);
    throw new Error(`compile ${name}: ${log}`);
  }
  return s;
}

export class Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w = 0;
  h = 0;
  constructor(private gl: GL, private hdr: boolean) {
    this.fbo = gl.createFramebuffer()!;
    this.tex = gl.createTexture()!;
  }
  resize(w: number, h: number) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
  }
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
  }
}

/** Growable float vertex buffer with a VAO describing interleaved attributes. */
export class DynBuffer {
  vao: WebGLVertexArrayObject;
  buf: WebGLBuffer;
  data: Float32Array;
  n = 0; // floats written
  private cap = 0;
  constructor(
    private gl: GL,
    readonly stride: number,
    attribs: { loc: number; size: number; offset: number; divisor?: number }[],
    initialFloats = 4096,
    setupExtra?: (gl: GL) => void,
  ) {
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    this.data = new Float32Array(initialFloats);
    gl.bindVertexArray(this.vao);
    setupExtra?.(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (const a of attribs) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride * 4, a.offset * 4);
      if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
    }
    gl.bindVertexArray(null);
  }
  reset() { this.n = 0; }
  ensure(extra: number) {
    if (this.n + extra <= this.data.length) return;
    let len = this.data.length;
    while (len < this.n + extra) len *= 2;
    const d = new Float32Array(len);
    d.set(this.data.subarray(0, this.n));
    this.data = d;
  }
  get count() { return this.n / this.stride; }
  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (this.data.length > this.cap) {
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      this.cap = this.data.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n);
  }
}
