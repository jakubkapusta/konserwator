// Procedural textures made at startup: tileable noise, the digit atlas for region numbers, the sprite atlas.
import type { GL } from '../gl/gl';
import { makeRng } from '../core/rng';

export function texture(gl: GL, opts: { filter?: number; wrap?: number; mips?: boolean } = {}) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  const f = opts.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mips ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap ?? gl.CLAMP_TO_EDGE);
  return t;
}

/** 256² RGBA tileable fbm value noise; the four channels have different base frequencies and seeds. */
export function noiseTexture(gl: GL) {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const freqs = [4, 8, 16, 6];
  for (let ch = 0; ch < 4; ch++) {
    const rng = makeRng(1234 + ch * 77);
    const acc = new Float32Array(N * N);
    let norm = 0;
    for (let oct = 0, amp = 1; oct < 5; oct++, amp *= 0.5) {
      const f = freqs[ch] << oct;
      if (f > N) break;
      const lat = new Float32Array(f * f);
      for (let i = 0; i < lat.length; i++) lat[i] = rng();
      const cell = N / f;
      for (let y = 0; y < N; y++) {
        const gy = y / cell, y0 = Math.floor(gy), ty = gy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        const ya = (y0 % f) * f, yb = ((y0 + 1) % f) * f;
        for (let x = 0; x < N; x++) {
          const gx = x / cell, x0 = Math.floor(gx), tx = gx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const xa = x0 % f, xb = (x0 + 1) % f;
          const a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * sx;
          const b = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * sx;
          acc[y * N + x] += (a + (b - a) * sy) * amp;
        }
      }
      norm += amp;
    }
    // stretch the histogram so thresholds in shaders behave
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < acc.length; i++) { lo = Math.min(lo, acc[i]); hi = Math.max(hi, acc[i]); }
    for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = Math.round(((acc[i] - lo) / (hi - lo)) * 255);
    void norm;
  }
  const t = texture(gl, { wrap: gl.REPEAT, mips: true });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

/** Digits 0-9 in a row, white on black (red channel = coverage), mipmapped. */
export function glyphAtlas(gl: GL, font: string) {
  const cw = 64, ch = 104;
  const c = document.createElement('canvas');
  c.width = cw * 10;
  c.height = ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = `600 ${Math.round(ch * 0.84)}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 10; i++) g.fillText(String(i), i * cw + cw / 2, ch * 0.54);
  const t = texture(gl, { mips: true });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

/** 4 sprite cells of 64²: soft dot, flake, 4-point sparkle, droplet ring. */
export function spriteAtlas(gl: GL) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  // soft dot
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  // flake: irregular polygon
  const rng = makeRng(9);
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = S * (0.25 + rng() * 0.2);
    const x = S + S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.7;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.fill();
  // sparkle
  const cx = S * 2 + S / 2, cy = S / 2;
  const sg = g.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
  sg.addColorStop(0, 'rgba(255,255,255,1)');
  sg.addColorStop(0.15, 'rgba(255,255,255,0.5)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sg;
  g.beginPath();
  g.moveTo(cx, 0); g.quadraticCurveTo(cx, cy, S * 3, cy); g.quadraticCurveTo(cx, cy, cx, S);
  g.quadraticCurveTo(cx, cy, S * 2, cy); g.quadraticCurveTo(cx, cy, cx, 0);
  g.fill();
  // droplet ring
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(S * 3 + S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
  g.stroke();
  const t = texture(gl, { mips: true });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}
