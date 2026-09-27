// All GLSL. World units = region-map pixels, y DOWN (image convention). The painting spans [0,W]x[0,H].

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

/** Quad in world space (a_q in 0..1 spans u_rect = x0,y0,x1,y1) through the camera. */
export const WORLD_VS = HEAD + `
layout(location=0) in vec2 a_q;
uniform vec4 u_rect;
uniform vec2 u_cam;
uniform float u_zoom;   // css px per world unit
uniform vec2 u_screen;  // css px
out vec2 v_w;
void main() {
  v_w = mix(u_rect.xy, u_rect.zw, a_q);
  vec2 s = (v_w - u_cam) * u_zoom;
  gl_Position = vec4(s.x / (u_screen.x * 0.5), -s.y / (u_screen.y * 0.5), 0.0, 1.0);
}`;

/** Full-screen triangle; v_uv 0..1 with y down (texel rows = uv.y). */
export const FULL_VS = HEAD + `
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

/** Studio wall behind the painting: warm dark plaster, a pool of light, the frame's soft shadow. */
export const BG_FS = HEAD + COMMON + `
in vec2 v_w;
uniform sampler2D u_noise;
uniform vec4 u_obj;      // x0,y0,x1,y1 of painting + frame (world)
uniform float u_zoom;
uniform float u_shadow;  // world units of blur
out vec4 o;
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main() {
  vec2 c = (u_obj.xy + u_obj.zw) * 0.5;
  vec2 hs = (u_obj.zw - u_obj.xy) * 0.5;
  float L = max(hs.x, hs.y);
  vec2 q = (v_w - c) / L;
  // light pool from above-left
  float pool = exp(-dot(q - vec2(-0.15, -0.35), q - vec2(-0.15, -0.35)) * 0.55);
  vec3 wall = mix(vec3(0.050, 0.041, 0.034), vec3(0.20, 0.165, 0.13), pool);
  float n = texture(u_noise, v_w / 900.0).r * 0.6 + texture(u_noise, v_w / 180.0).g * 0.4;
  wall *= 0.9 + 0.2 * n;
  // soft shadow of the frame, cast down-right
  float d = sdBox(v_w - c - vec2(0.018, 0.03) * L, hs);
  float sh = 1.0 - smoothstep(-u_shadow * 0.4, u_shadow, d);
  wall *= 1.0 - 0.72 * sh;
  o = vec4(pow(wall, vec3(1.0 / 1.15)), 1.0);
}`;

/**
 * The frame: a mitered molding profile around the painting, lit from the upper left.
 * Old and worn: red bole, chipped to the wood, a few tarnished gold remnants, dust in the hollows.
 */
export const FRAME_FS = HEAD + COMMON + `
in vec2 v_w;
uniform sampler2D u_noise;
uniform vec2 u_size;      // painting W,H
uniform float u_fw;       // frame width (world)
uniform float u_dust;     // dust left on the frame 0..1
uniform float u_pxw;      // world units per device px
uniform float u_time;
out vec4 o;

// molding height along the profile, u: 0 at the sight edge .. 1 outside
float prof(float u) {
  float h = 0.0;
  h += 0.35 * smoothstep(0.0, 0.05, u);                                  // lip
  h += 0.25 * exp(-pow((u - 0.08) / 0.035, 2.0));                          // inner bead
  h -= 0.25 * smoothstep(0.12, 0.3, u) * (1.0 - smoothstep(0.3, 0.45, u)); // cove
  h += 0.9 * smoothstep(0.35, 0.62, u) * (1.0 - smoothstep(0.72, 0.9, u)); // big ovolo
  h += 0.25 * exp(-pow((u - 0.93) / 0.025, 2.0));                          // outer bead
  h -= 0.4 * smoothstep(0.96, 1.0, u);
  return h;
}
void main() {
  vec2 p = v_w;
  vec4 s = vec4(-p.x, p.x - u_size.x, -p.y, p.y - u_size.y); // outside distances: left, right, top, bottom
  float t = max(max(s.x, s.y), max(s.z, s.w));
  if (t < 0.0 || t > u_fw) discard;
  vec2 nrm = s.x >= t ? vec2(-1, 0) : s.y >= t ? vec2(1, 0) : s.z >= t ? vec2(0, -1) : vec2(0, 1);
  float u = t / u_fw;
  float e = 0.004;
  float dh = (prof(u + e) - prof(u - e)) / (2.0 * e);
  // along-the-side coordinate for grain
  float along = nrm.x != 0.0 ? p.y : p.x;
  float n1 = texture(u_noise, vec2(along / 700.0, u * 0.7) + nrm * 0.31).r;
  float n2 = texture(u_noise, p / 300.0).g;
  float n3 = texture(u_noise, p / 60.0).b;
  vec3 N = normalize(vec3(-nrm * dh * 1.6 + (vec2(n2, n3) - 0.5) * 0.12, 1.0));
  vec3 Ld = normalize(vec3(-0.55, -0.7, 0.75));
  float dif = clamp(dot(N, Ld), 0.0, 1.0);
  float h = prof(u);
  // materials
  float grain = texture(u_noise, vec2(along / 40.0, u * 9.0)).a;
  vec3 wood = vec3(0.23, 0.14, 0.075) * (0.75 + 0.5 * grain);
  vec3 bole = vec3(0.42, 0.2, 0.12) * (0.9 + 0.15 * n2);
  vec3 gold = vec3(0.62, 0.48, 0.24);
  float chip = smoothstep(0.76, 0.79, texture(u_noise, p / 480.0 + 0.7).b * 0.8 + n3 * 0.2 + h * 0.08);
  float remnant = smoothstep(0.6, 0.66, texture(u_noise, p / 900.0 + 0.2).a) * (1.0 - chip) * smoothstep(0.3, 0.7, h);
  vec3 base = mix(bole, wood, chip);
  base = mix(base, gold * (0.6 + 0.4 * n3), remnant * 0.55);
  vec3 H = normalize(Ld + vec3(0, 0, 1));
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 24.0) * (0.12 + remnant * 0.9);
  vec3 col = base * (0.28 + 0.95 * dif) + spec * vec3(1.0, 0.85, 0.6);
  // dust settles in the hollows
  float hollow = clamp(0.6 - h, 0.0, 1.0);
  float dust = u_dust * clamp(0.3 + hollow * 0.9 + (n1 - 0.5) * 0.4, 0.0, 1.0) * (0.85 + 0.3 * texture(u_noise, p / 40.0).r);
  col = mix(col, vec3(0.5, 0.47, 0.42) * (0.55 + 0.6 * dif), dust * 0.75);
  // ambient occlusion at the sight edge and outer edge
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.03, u);
  col *= 1.0 - 0.35 * smoothstep(0.9, 1.0, u);
  // anti-aliased outer edge
  float edge = clamp((u_fw - t) / u_pxw, 0.0, 1.0);
  o = vec4(col * edge, 1.0);
}`;

/**
 * The painting. Layers, bottom to top:
 *   original (u_img) / ghost = faded, flaking state, mixed per region by the retouch reveal
 *   outlines + highlight of the selected paint (retouch)
 *   varnish (yellow), grime + drips (dark), spots (raised), dust (grey), cobwebs  -- u_dirt channels
 *   wet sheen of the solvent, fresh-clean glint (u_fx), light sweeps, frame shadow
 */
export const PAINT_FS = HEAD + COMMON + `
precision highp usampler2D;
in vec2 v_w;
uniform sampler2D u_img, u_dirt, u_fx, u_noise, u_pal, u_rinfo;
uniform usampler2D u_reg;
uniform vec2 u_size;
uniform vec2 u_dirtTexel;   // 1 / dirt texture size
uniform float u_time;
uniform float u_pxw;        // world units per device pixel
uniform float u_outline;    // 0..1 outlines (drawn in at the start of the retouch)
uniform vec2 u_outlineC;    // world point the outlines grow from
uniform float u_outlineR;   // world radius reached by the outline reveal
uniform float u_dirtOn;
uniform int u_sel;          // selected paint, -1 none
uniform float u_selT;       // when it was selected
uniform vec4 u_sweep;       // x: position -0.3..1.3 along the diagonal, y: width, z: strength
uniform float u_peek;       // hold-to-preview the finished painting
uniform vec4 u_webs;        // cobwebs per corner (TL, TR, BL, BR) 0..1 size
uniform float u_restored;   // 0..1 fully restored look (end of retouch: no ghost anywhere)
out vec4 o;

vec4 rA(uint id) { int i = int(id); return texelFetch(u_rinfo, ivec2((i & 255) * 2, i >> 8), 0); }
vec4 rB(uint id) { int i = int(id); return texelFetch(u_rinfo, ivec2((i & 255) * 2 + 1, i >> 8), 0); }
uint regAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(u_size) - 1);
  return texelFetch(u_reg, t, 0).r;
}

// How much of region id is revealed at world point w (0..1); front: the wet leading band.
float reveal(uint id, vec2 w, out float front) {
  front = 0.0;
  vec4 a = rA(id);
  if (a.y < -1e8) return 0.0;
  vec4 b = rB(id);
  float p = clamp((u_time - a.y) / b.y, 0.0, 1.0);
  if (p >= 1.0) return 1.0;
  float e = 1.0 - pow(1.0 - p, 1.6);
  float d = distance(w, a.zw);
  // streaky front: noise stretched along a per-region brush direction
  float ang = hash12(vec2(float(id), 7.0)) * 3.14159;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 q = vec2(dot(w, dir), dot(w, vec2(-dir.y, dir.x)));
  float amp = clamp(b.x * 0.35, 6.0, 70.0);
  float n = texture(u_noise, vec2(q.x / 900.0, q.y / 60.0)).r * 0.7 + texture(u_noise, w / 70.0).g * 0.3;
  float R = e * (b.x + amp * 1.2) - n * amp * (1.0 - e * 0.6);
  float soft = max(2.0, amp * 0.15);
  float k = smoothstep(-soft, soft, R - d);
  front = k * (1.0 - smoothstep(0.0, amp * 0.9 + 6.0, R - d)) * (1.0 - p);
  return k;
}

float web(vec2 w, vec2 corner, vec2 dir, float size) {
  // corner web: radial threads + sagging spiral in the quarter plane
  vec2 l = (w - corner) * dir;           // both components >= 0 inside the painting
  if (l.x < 0.0 || l.y < 0.0) return 0.0;
  float r = length(l);
  if (r > size) return 0.0;
  float a = atan(l.y, l.x);              // 0..pi/2
  float lw = u_pxw * 0.9;
  float rays = 5.0;
  float ai = a / (1.5708 / rays);
  float ray = abs(fract(ai) - 0.5) * 2.0;   // 1 at a ray... 0 between
  float rd = (1.0 - ray) * r * (1.5708 / rays) * 0.5; // distance to nearest ray, world
  float w1 = 1.0 - smoothstep(lw * 0.5, lw * 1.5, rd);
  float seg = fract(ai);
  float sag = 1.0 - 0.18 * sin(seg * 3.14159);
  float rr = r / sag;
  float sp = size * 0.16;
  float ring = abs(fract(rr / sp) - 0.5) * sp;
  float w2 = (1.0 - smoothstep(lw * 0.4, lw * 1.2, ring)) * step(size * 0.12, r) * 0.7;
  float broken = step(0.35, texture(u_noise, w / 140.0 + corner / 997.0).b);
  float fade = 1.0 - smoothstep(size * 0.7, size, r);
  return clamp(w1 * 0.8 + w2 * broken, 0.0, 1.0) * fade;
}

void main() {
  vec2 w = v_w;
  vec2 uv = w / u_size;
  vec3 orig = texture(u_img, uv).rgb;
  vec3 blur = textureLod(u_img, uv, 3.5).rgb;
  vec4 N = texture(u_noise, w / 256.0);
  vec4 N2 = texture(u_noise, w / 1100.0 + 0.37);

  // ---- ghost: the faded, flaking painting under the dirt ----
  float L = lum(orig);
  vec3 paper = vec3(0.925, 0.895, 0.835);
  vec3 g = mix(vec3(L), orig, 0.4) * vec3(1.0, 0.98, 0.94);
  g = mix(paper, g, 0.47) + (orig - blur) * 0.4;            // keep brush texture and craquelure
  // uneven damage: brownish water stains and a milky bloom, so even pale passages look worn
  float stain = smoothstep(0.45, 0.8, texture(u_noise, w / 780.0 + 0.61).r * 0.75 + texture(u_noise, w / 190.0).g * 0.25);
  g = mix(g, g * vec3(0.86, 0.8, 0.7), stain * 0.55);
  float bloom = smoothstep(0.35, 0.75, texture(u_noise, w / 1300.0 + 0.23).a);
  g = mix(g, vec3(0.9, 0.9, 0.88), bloom * 0.2);
  // paint loss: islands where the ground shows through
  float lossN = texture(u_noise, w / 520.0 + 0.13).b * 0.7 + texture(u_noise, w / 97.0).a * 0.3;
  float edgeW = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float lossT = 0.77 - 0.07 * (1.0 - smoothstep(0.0, 0.08, edgeW));
  float loss = smoothstep(lossT, lossT + 0.012, lossN);
  float lossRim = smoothstep(lossT - 0.02, lossT, lossN) - loss;
  float weave = 0.5 + 0.25 * (sin(w.x * 3.3) + sin(w.y * 3.1));
  vec3 ground = vec3(0.88, 0.84, 0.76) * (0.93 + 0.07 * weave);
  g = mix(g, ground, loss);
  g *= 1.0 - 0.18 * lossRim;

  // ---- retouch: per region reveal, sampled on the 4 nearest region texels for smooth borders ----
  vec2 tp = w - 0.5;
  ivec2 i0 = ivec2(floor(tp));
  vec2 f = tp - vec2(i0);
  uint id00 = regAt(i0), id10 = regAt(i0 + ivec2(1, 0)), id01 = regAt(i0 + ivec2(0, 1)), id11 = regAt(i0 + ivec2(1, 1));
  uint own = regAt(ivec2(floor(w)));
  float fr00, fr10, fr01, fr11;
  float r00 = reveal(id00, w, fr00);
  float r10 = id10 == id00 ? r00 : reveal(id10, w, fr10);
  float r01 = id01 == id00 ? r00 : reveal(id01, w, fr01);
  float r11 = id11 == id00 ? r00 : reveal(id11, w, fr11);
  if (id10 == id00) fr10 = fr00;
  if (id01 == id00) fr01 = fr00;
  if (id11 == id00) fr11 = fr00;
  float rvb = mix(mix(r00, r10, f.x), mix(r01, r11, f.x), f.y);
  float front = mix(mix(fr00, fr10, f.x), mix(fr01, fr11, f.x), f.y);
  // sharpen across region borders to ~1 device px
  float k = 0.5 * clamp(u_pxw, 0.08, 1.0);
  float rv = smoothstep(0.5 - k, 0.5 + k, rvb);
  bool uniformCell = id00 == id10 && id00 == id01 && id00 == id11;
  if (uniformCell) rv = r00;
  rv = max(rv, u_restored);

  vec3 col = mix(g, orig, rv);

  // wet paint at the reveal front: the paint's flat color, glossy
  if (front > 0.001) {
    vec4 ra = rA(own);
    vec3 pc = texelFetch(u_pal, ivec2(int(ra.x), 0), 0).rgb;
    col = mix(col, pc, clamp(front * 0.55, 0.0, 0.6));
    col += front * 0.08;
  }
  // fresh paint: a wet gloss that catches the brushwork, drying over a couple of seconds
  {
    vec4 a = rA(own);
    if (a.y > -1e8) {
      float t = u_time - a.y - rB(own).y * 0.6;
      if (t > -0.5 && t < 3.0) {
        vec2 e = 1.5 / u_size;
        float gx = lum(textureLod(u_img, uv + vec2(e.x, 0), 0.5).rgb) - lum(textureLod(u_img, uv - vec2(e.x, 0), 0.5).rgb);
        float gy = lum(textureLod(u_img, uv + vec2(0, e.y), 0.5).rgb) - lum(textureLod(u_img, uv - vec2(0, e.y), 0.5).rgb);
        float relief = clamp(0.5 - (gx * 0.8 + gy) * 3.0, 0.0, 1.0);
        float wetk = exp(-max(t, 0.0) * 1.4) * rv;
        col = mix(col, col * col * 1.25 + col * 0.05, wetk * 0.25);        // deeper while wet
        col += vec3(1.0, 0.96, 0.88) * pow(relief, 8.0) * 0.22 * wetk;      // gloss on the ridges
        col += vec3(1.0, 0.95, 0.8) * 0.06 * exp(-max(t, 0.0) * 4.0) * rv;
      }
    }
  }

  // outlines where any neighbour is still unpainted
  if (u_outline > 0.0) {
    float s = (id00 == own ? (1.0 - f.x) * (1.0 - f.y) : 0.0) + (id10 == own ? f.x * (1.0 - f.y) : 0.0)
            + (id01 == own ? (1.0 - f.x) * f.y : 0.0) + (id11 == own ? f.x * f.y : 0.0);
    float a00 = id00 == own ? 1.0 : 0.0, a10 = id10 == own ? 1.0 : 0.0, a01 = id01 == own ? 1.0 : 0.0, a11 = id11 == own ? 1.0 : 0.0;
    vec2 gr = vec2(mix(a10 - a00, a11 - a01, f.y), mix(a01 - a00, a11 - a10, f.x));
    float gl = length(gr);
    if (!uniformCell && gl > 1e-4) {
      float dpx = (s - 0.5) / gl / u_pxw;
      float lw = 0.75;
      float line = 1.0 - smoothstep(lw - 0.6, lw + 0.6, abs(dpx));
      float unrev = 1.0 - min(min(r00, r10), min(r01, r11));
      float grow = smoothstep(u_outlineR, u_outlineR - 120.0, distance(w, u_outlineC) + N.r * 80.0);
      col = mix(col, vec3(0.36, 0.32, 0.28), line * unrev * u_outline * grow * 0.85 * (1.0 - u_restored));
    }
    // highlight of the selected paint's unpainted regions
    if (u_sel >= 0) {
      vec4 a = rA(own);
      if (int(a.x) == u_sel && rv < 1.0) {
        // semi-transparent white/grey checker: stands out on any colour, even in tiny fields.
        // Cell ≈ 5 device px, snapped to powers of two in world units so it stays put while panning.
        float cell = exp2(floor(log2(u_pxw * 5.0) + 0.5));
        vec2 cc = floor(w / cell);
        float chk = mod(cc.x + cc.y, 2.0);
        float pulse = 0.85 + 0.15 * sin((u_time - u_selT) * 3.2);
        float intro = smoothstep(0.0, 0.35, u_time - u_selT);
        vec3 hl = mix(vec3(0.97, 0.96, 0.94), vec3(0.5, 0.5, 0.52), chk);
        col = mix(col, hl, (1.0 - rv) * 0.62 * pulse * intro * u_outline);
      }
    }
  }

  // ---- dirt ----
  if (u_dirtOn > 0.0) {
    vec4 D = texture(u_dirt, uv);
    // yellowed varnish: warm, darker, flatter
    float v = clamp(D.b, 0.0, 1.0);
    vec3 varn = col * vec3(0.84, 0.64, 0.33) * (0.93 - 0.14 * N2.r);
    varn = mix(varn, vec3(lum(varn)) * vec3(1.0, 0.8, 0.5), 0.25);
    col = mix(col, varn, smoothstep(0.0, 0.55, v) * (0.75 + 0.25 * v));
    // grime and soot: thins into specks, not a uniform fade
    float gth = clamp(D.g, 0.0, 1.0);
    float gn = texture(u_noise, w / 157.0).g * 0.6 + texture(u_noise, w / 611.0 + 0.5).b * 0.4;
    float gv = smoothstep(0.08 + 0.4 * gn, 0.4 + 0.4 * gn, gth);
    vec3 grime = vec3(0.17, 0.125, 0.08) * (0.65 + 0.7 * texture(u_noise, w / 53.0).a) * (0.8 + 0.4 * N2.g);
    col = mix(col, grime, gv * 0.93);
    // spots: raised drops, shaded by their own gradient
    float sa = D.a;
    if (sa > 0.02) {
      float sx = texture(u_dirt, uv + vec2(u_dirtTexel.x, 0)).a - texture(u_dirt, uv - vec2(u_dirtTexel.x, 0)).a;
      float sy = texture(u_dirt, uv + vec2(0, u_dirtTexel.y)).a - texture(u_dirt, uv - vec2(0, u_dirtTexel.y)).a;
      float sv = smoothstep(0.12, 0.3, sa + (N.r - 0.5) * 0.12);
      float kind = hash12(floor(w / 90.0) + 3.0);
      vec3 sc = kind < 0.4 ? vec3(0.1, 0.075, 0.05) : kind < 0.75 ? vec3(0.86, 0.8, 0.62) : vec3(0.93, 0.92, 0.88);
      float shade = clamp(0.5 - (sx * 0.8 + sy * 1.0) * 2.5, 0.0, 1.0);
      sc *= 0.65 + 0.7 * shade;
      sc += pow(shade, 6.0) * 0.25;
      col = mix(col, sc, sv);
    }
    // dust: light grey felt, fine grain over the (large-scale) thickness from the init
    float du = clamp(D.r, 0.0, 1.0);
    float fine = texture(u_noise, w / 70.0).b;
    float med = texture(u_noise, w / 413.0 + 0.3).g;
    float dv = smoothstep(0.03, 0.95, du * (0.72 + 0.45 * fine + 0.35 * (med - 0.5)));
    vec3 dust = vec3(0.69, 0.67, 0.63) * (0.9 + 0.18 * fine);
    col = mix(col, dust, dv * 0.8);
    // cobwebs go with the dust
    float wb = 0.0;
    float big = max(u_size.x, u_size.y) * 0.3;
    wb = max(wb, web(w, vec2(0, 0), vec2(1, 1), big * u_webs.x));
    wb = max(wb, web(w, vec2(u_size.x, 0), vec2(-1, 1), big * u_webs.y));
    wb = max(wb, web(w, vec2(0, u_size.y), vec2(1, -1), big * u_webs.z));
    wb = max(wb, web(w, u_size, vec2(-1, -1), big * u_webs.w));
    col = mix(col, vec3(0.86, 0.85, 0.82), wb * smoothstep(0.15, 0.5, du) * 0.8);

    // solvent: wet sheen that evaporates, and a glint where dirt just came off
    vec4 F = texture(u_fx, uv);
    float wet = clamp(F.r, 0.0, 1.0);
    vec3 wc = mix(col, col * col * 1.35, 0.5);
    col = mix(col, wc, wet * 0.6);
    vec2 nn = (vec2(N.g, N.b) - 0.5) * 2.0;
    float sp = pow(clamp(0.5 + 0.5 * dot(normalize(vec3(nn * 0.6, 1.0)), normalize(vec3(-0.4, -0.5, 0.8))), 0.0, 1.0), 30.0);
    col += wet * sp * 0.35;
    col += clamp(F.g, 0.0, 1.0) * vec3(1.0, 0.96, 0.86) * 0.18;
  }

  // light sweep across the painting, catching the relief of the brushwork
  if (u_sweep.z > 0.0) {
    float x = dot(uv, normalize(vec2(1.0, 0.6))) / 1.17;
    float band = exp(-pow((x - u_sweep.x) / u_sweep.y, 2.0));
    vec2 e = 1.5 / u_size;
    float gx = lum(textureLod(u_img, uv + vec2(e.x, 0), 1.0).rgb) - lum(textureLod(u_img, uv - vec2(e.x, 0), 1.0).rgb);
    float gy = lum(textureLod(u_img, uv + vec2(0, e.y), 1.0).rgb) - lum(textureLod(u_img, uv - vec2(0, e.y), 1.0).rgb);
    float relief = clamp(0.5 - (gx + gy) * 4.0, 0.0, 1.0);
    col += band * u_sweep.z * (0.35 + 0.9 * relief) * vec3(1.0, 0.95, 0.84);
  }

  col = mix(col, orig, u_peek);

  // studio light and the frame's shadow on the canvas edge (light from the upper left)
  col *= 0.93 + 0.1 * (1.0 - distance(uv, vec2(0.3, 0.2)));
  float lip = max(u_size.x, u_size.y) * 0.012;
  float shT = 1.0 - smoothstep(0.0, lip, w.y), shL = 1.0 - smoothstep(0.0, lip, w.x);
  float shB = 1.0 - smoothstep(0.0, lip * 0.35, u_size.y - w.y), shR = 1.0 - smoothstep(0.0, lip * 0.35, u_size.x - w.x);
  col *= 1.0 - 0.45 * max(max(shT, shL), max(shB, shR) * 0.6);
  o = vec4(col, 1.0);
}`;

// ---------------- dirt simulation (render-to-texture, ping-pong) ----------------

/** Initial dirt. Channels: r dust, g grime (+drips), b yellowed varnish, a spots. Thickness 0..1+. */
export const DIRT_INIT_FS = HEAD + COMMON + `
in vec2 v_uv;
uniform sampler2D u_noise;
uniform vec2 u_size;
uniform vec2 u_seed;
uniform vec4 u_amt;          // dust, grime, varnish, spots
uniform float u_soot;        // extra grime towards the top (smoke)
uniform vec4 u_spots[40];    // x, y, r, thickness (world)
uniform int u_nspots;
uniform vec4 u_drips[24];    // x, y0, length, width (world)
uniform int u_ndrips;
layout(location=0) out vec4 o;
layout(location=1) out vec4 o2;
float fbm(vec2 p) {
  return texture(u_noise, p).r * 0.5 + texture(u_noise, p * 2.03 + 0.17).g * 0.3 + texture(u_noise, p * 4.1 + 0.51).b * 0.2;
}
void main() {
  vec2 w = v_uv * u_size;
  float L = max(u_size.x, u_size.y);
  vec2 p = w / L;
  // dust: fluffy, heavier along the top edge and in blotches
  float dust = u_amt.x * (0.62 + 0.55 * (fbm(p * 1.7 + u_seed) - 0.5) + 0.35 * (1.0 - smoothstep(0.0, 0.18, v_uv.y)));
  // grime: large blotches, darker near the edges and (smoke) towards the top
  float edge = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
  float grime = u_amt.y * (0.35 + 0.8 * (fbm(p * 0.9 + u_seed.yx) - 0.45) + 0.35 * (1.0 - smoothstep(0.0, 0.2, edge)));
  grime += u_soot * (1.0 - v_uv.y) * 0.7;
  for (int i = 0; i < 24; i++) {
    if (i >= u_ndrips) break;
    vec4 d = u_drips[i];
    float t = (w.y - d.y) / d.z;
    if (t < -0.02 || t > 1.08) continue;
    float wob = (texture(u_noise, vec2(d.x / 511.0, w.y / 1400.0)).r - 0.5) * d.w * 7.0;
    float width = d.w * (1.35 - 0.7 * t) + d.w * 0.9 * exp(-pow((t - 1.0) / 0.03, 2.0));
    float dx = abs(w.x - d.x - wob);
    float m = (1.0 - smoothstep(width * 0.2, width, dx)) * smoothstep(-0.02, 0.03, t) * (1.0 - smoothstep(1.0, 1.05, t));
    grime = max(grime, m * (0.45 + 0.25 * u_amt.y) * (0.8 + 0.4 * t));
  }
  // varnish: even, with brush streaks from whoever varnished it last
  float streak = texture(u_noise, vec2(p.x * 0.4, p.y * 6.0) + u_seed).r;
  float varnish = u_amt.z * (0.82 + 0.25 * (streak - 0.5) + 0.12 * fbm(p * 2.0));
  float spots = 0.0;
  for (int i = 0; i < 40; i++) {
    if (i >= u_nspots) break;
    vec4 s = u_spots[i];
    vec2 q = w - s.xy;
    float a = atan(q.y, q.x);
    float rr = s.z * (0.8 + 0.35 * texture(u_noise, vec2(a / 6.2832, s.x / 777.0)).g);
    float m = 1.0 - smoothstep(rr * 0.75, rr, length(q));
    spots = max(spots, m * s.w * (0.85 + 0.3 * (1.0 - length(q) / rr)));
  }
  o = vec4(max(dust, 0.0), clamp(grime, 0.0, 1.3), max(varnish, 0.0), spots);
  o2 = vec4(0.0);
}`;

/**
 * One step: the tool along a segment (capsule) + tile dissolves + fx decay.
 * Out 0: dirt, out 1: fx (r wet, g fresh-clean glint).
 */
export const DIRT_STEP_FS = HEAD + COMMON + `
in vec2 v_uv;
uniform sampler2D u_state, u_fxIn, u_noise;
uniform vec2 u_size;
uniform vec4 u_seg;        // p0, p1 (world)
uniform vec4 u_brush;      // radius, amount, tool (0 none, 1 brush, 2 swab, 3 scalpel), hardness
uniform vec4 u_diss[8];    // uv rect of a dissolving tile
uniform vec4 u_dissCh[8];  // per channel rate
uniform int u_ndiss;
uniform float u_dt;
layout(location=0) out vec4 o;
layout(location=1) out vec4 o2;
void main() {
  vec4 s = texture(u_state, v_uv);
  vec4 fx = texture(u_fxIn, v_uv);
  vec4 s0 = s;
  vec2 w = v_uv * u_size;
  int tool = int(u_brush.z);
  if (tool > 0) {
    vec2 a = u_seg.xy, b = u_seg.zw;
    vec2 ab = b - a;
    float l2 = dot(ab, ab);
    float t = l2 > 0.0 ? clamp(dot(w - a, ab) / l2, 0.0, 1.0) : 0.0;
    float d = distance(w, a + ab * t);
    float R = u_brush.x;
    if (d < R * 1.3) {
      vec2 dir = l2 > 0.0 ? ab / sqrt(l2) : vec2(1, 0);
      float jag = texture(u_noise, w / 60.0).g - 0.5;
      float f = 1.0 - smoothstep(R * u_brush.w, R, d + jag * R * 0.25);
      float k = f * u_brush.y;
      if (tool == 1) {
        // bristles: streaks along the stroke
        float br = texture(u_noise, vec2(dot(w, vec2(-dir.y, dir.x)) / 14.0, dot(w, dir) / 700.0)).r;
        k *= 0.45 + 1.1 * br;
        s.r -= k * 1.0;
        s.g -= k * 0.04;
      } else if (tool == 2) {
        s.r -= k * 0.5;
        s.g -= k * 0.95 * (1.0 - 0.6 * clamp(s.r, 0.0, 1.0));
        s.b -= k * 0.6 * (1.0 - 0.85 * clamp(s.g, 0.0, 1.0)) * (1.0 - 0.6 * clamp(s.r, 0.0, 1.0));
        fx.r = max(fx.r, f * 0.95);
      } else {
        s.a -= k * 1.3;
        s.r -= k * 0.25;
        s.g -= k * 0.1;
      }
    }
  }
  for (int i = 0; i < 8; i++) {
    if (i >= u_ndiss) break;
    vec4 r = u_diss[i];
    vec2 m = smoothstep(r.xy - 0.01, r.xy + 0.004, v_uv) * (1.0 - smoothstep(r.zw - 0.004, r.zw + 0.01, v_uv));
    vec4 rate = u_dissCh[i] * m.x * m.y;
    s = s * exp(-rate * u_dt) - rate * u_dt * 0.06;
  }
  s = max(s, 0.0);
  float removed = dot(max(s0 - s, 0.0), vec4(1.0, 1.4, 0.8, 1.2));
  fx.r *= exp(-u_dt / 1.1);
  fx.g = max(fx.g * exp(-u_dt / 0.22), clamp(removed * 7.0, 0.0, 1.0));
  o = s;
  o2 = fx;
}`;

/** Mean of each CELLxCELL block (as 0..1 of MAXV) for the progress read-back. */
export const DIRT_REDUCE_FS = HEAD + `
in vec2 v_uv;
uniform sampler2D u_state;
uniform vec2 u_srcTexel;
uniform int u_cell;
out vec4 o;
void main() {
  vec2 base = floor(gl_FragCoord.xy) * float(u_cell);
  vec4 acc = vec4(0.0);
  int n = u_cell / 2;
  for (int y = 0; y < 16; y++) {
    if (y >= n) break;
    for (int x = 0; x < 16; x++) {
      if (x >= n) break;
      acc += texture(u_state, (base + vec2(x, y) * 2.0 + 1.0) * u_srcTexel);
    }
  }
  o = clamp(acc / float(n * n) / 1.3, 0.0, 1.0);
}`;

// ---------------- numbers and sprites ----------------

/** Region numbers: one instance per digit. Hidden when too small on screen or once the region is painted. */
export const NUM_VS = HEAD + `
layout(location=0) in vec2 a_q;
layout(location=1) in vec2 a_pos;     // label point (world)
layout(location=2) in vec4 a_d;       // digit, char offset (in char widths), region id, base size (world)
uniform sampler2D u_rinfo;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_screen;
uniform float u_time;
uniform int u_sel;
uniform float u_alpha;
uniform float u_minPx;
out vec2 v_uv;
out float v_a;
out float v_sel;
void main() {
  int id = int(a_d.z);
  vec4 ra = texelFetch(u_rinfo, ivec2((id & 255) * 2, id >> 8), 0);
  float gone = ra.y < -1e8 ? 0.0 : clamp((u_time - ra.y) / 0.22, 0.0, 1.0);
  float px = min(a_d.w * u_zoom, 34.0);
  float a = smoothstep(u_minPx, u_minPx + 4.0, px) * (1.0 - gone) * u_alpha;
  bool sel = int(ra.x) == u_sel;
  v_sel = sel ? 1.0 : 0.0;
  float grow = 1.0 + gone * 0.6 + (sel ? 0.08 : 0.0);
  px *= grow;
  vec2 c = (a_pos - u_cam) * u_zoom;          // css px from the screen centre
  vec2 g = vec2(0.62, 1.0) * px;
  vec2 s = c + vec2(a_d.y * g.x * 0.92, 0.0) + (a_q - 0.5) * g;
  v_uv = vec2((a_d.x + a_q.x) / 10.0, a_q.y);
  v_a = a;
  gl_Position = vec4(s.x / (u_screen.x * 0.5), -s.y / (u_screen.y * 0.5), 0.0, 1.0);
  if (a <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

export const NUM_FS = HEAD + `
in vec2 v_uv;
in float v_a;
in float v_sel;
uniform sampler2D u_glyphs;
out vec4 o;
void main() {
  float m = texture(u_glyphs, v_uv).r;
  vec3 c = mix(vec3(0.33, 0.29, 0.25), vec3(0.12, 0.09, 0.07), v_sel);
  float a = m * v_a * mix(0.8, 1.0, v_sel);
  o = vec4(c * a, a);
}`;

/** Screen-space sprites (particles, sparkles). Premultiplied alpha; additive when color.a is 0. */
export const SPRITE_VS = HEAD + `
layout(location=0) in vec2 a_q;
layout(location=1) in vec4 a_p;   // x, y (css px), size, rotation
layout(location=2) in vec4 a_c;   // premultiplied rgba
layout(location=3) in float a_k;  // sprite cell
uniform vec2 u_screen;
out vec2 v_uv;
out vec4 v_c;
void main() {
  vec2 q = a_q - 0.5;
  float c = cos(a_p.w), s = sin(a_p.w);
  vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * a_p.z;
  vec2 p = a_p.xy + r;
  v_uv = vec2((a_k + a_q.x) / 4.0, a_q.y);
  v_c = a_c;
  gl_Position = vec4(p.x / u_screen.x * 2.0 - 1.0, 1.0 - p.y / u_screen.y * 2.0, 0.0, 1.0);
}`;

export const SPRITE_FS = HEAD + `
in vec2 v_uv;
in vec4 v_c;
uniform sampler2D u_atlas;
out vec4 o;
void main() {
  float m = texture(u_atlas, v_uv).r;
  o = v_c * m;
}`;
