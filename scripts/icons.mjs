// Generates the PWA icons (PNG) procedurally: a gilded frame with a half-cleaned painting on a dark wall.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function pixel(u, v, maskable) {
  const s = maskable ? 0.8 : 1; // maskable icons keep the art inside the safe zone
  const x = (u - 0.5) / s + 0.5, y = (v - 0.5) / s + 0.5;
  // wall
  let r = 26 - 10 * v, g = 21 - 8 * v, b = 17 - 7 * v;
  const fx0 = 0.2, fx1 = 0.8, fy0 = 0.16, fy1 = 0.84, fw = 0.075;
  const inFrame = x > fx0 && x < fx1 && y > fy0 && y < fy1;
  if (inFrame) {
    const d = Math.min(x - fx0, fx1 - x, y - fy0, fy1 - y);
    if (d < fw) {
      // gilded molding: bright ridge in the middle of the profile, light from the top left
      const t = d / fw;
      const ridge = Math.sin(t * Math.PI);
      const lit = (x - fx0 < fw || y - fy0 < fw) && !(fx1 - x < d + 1e-9 || fy1 - y < d + 1e-9) ? 1.15 : 0.8;
      r = (150 + 105 * ridge) * lit; g = (105 + 90 * ridge) * lit; b = (40 + 50 * ridge) * lit;
    } else {
      // the painting: warm figure on a pale wall, the right half still under yellow varnish
      const px = (x - fx0 - fw) / (fx1 - fx0 - 2 * fw), py = (y - fy0 - fw) / (fy1 - fy0 - 2 * fw);
      let pr = 214, pg = 205, pb = 186;
      const fig = Math.hypot((px - 0.52) / 0.2, (py - 0.62) / 0.32);
      if (fig < 1) { pr = 44; pg = 64; pb = 120; }
      if (Math.hypot((px - 0.52) / 0.1, (py - 0.28) / 0.1) < 1) { pr = 232; pg = 214; pb = 180; }
      if (py > 0.82) { pr = 120; pg = 82; pb = 50; }
      const dirty = smooth(0.52, 0.58, px + (py - 0.5) * 0.15);
      r = pr * (1 - dirty) + pr * 0.55 * dirty + 30 * dirty;
      g = pg * (1 - dirty) + pg * 0.42 * dirty + 18 * dirty;
      b = pb * (1 - dirty) + pb * 0.18 * dirty;
      // the swab's clean edge sparkle
      const edge = Math.exp(-Math.pow((px + (py - 0.5) * 0.15 - 0.55) / 0.012, 2));
      r += edge * 60; g += edge * 50; b += edge * 30;
    }
  } else {
    // soft shadow of the frame
    const dx = Math.max(fx0 - x, 0, x - fx1 - 0.02), dy = Math.max(fy0 - y, 0, y - fy1 - 0.03);
    const sh = Math.exp(-(dx * dx + dy * dy) / 0.002);
    r *= 1 - 0.6 * sh; g *= 1 - 0.6 * sh; b *= 1 - 0.6 * sh;
  }
  let a = 255;
  if (!maskable) {
    const cr = 0.18, qx = Math.max(Math.abs(u - 0.5) - (0.5 - cr), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - cr), 0);
    const dd = Math.hypot(qx, qy) - cr;
    a = clamp(255 * (1 - smooth(-0.004, 0.004, dd)));
  }
  return [clamp(r), clamp(g), clamp(b), a];
}

writeFileSync('public/icon-192.png', png(192, (u, v) => pixel(u, v, false)));
writeFileSync('public/icon-512.png', png(512, (u, v) => pixel(u, v, false)));
writeFileSync('public/icon-maskable-512.png', png(512, (u, v) => pixel(u, v, true)));
writeFileSync('public/apple-touch-icon.png', png(180, (u, v) => pixel(u, v, true)));
console.log('icons written');
