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

/** Gold leaf mirroring the studio (needs `uniform vec2 u_tilt` declared before). */
const GOLD = `
vec3 envGold(vec3 N, float sm, float dif) {
  // what the gold mirrors: a room brighter towards the ceiling and the window side, a big softbox up-left,
  // a second window on the right; lobes sharpen as the leaf gets burnished
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), N);
  vec3 key = normalize(vec3(-0.42 + u_tilt.x * 0.75, -0.5 + u_tilt.y * 0.75, 0.75));
  vec3 win = normalize(vec3(0.6 + u_tilt.x * 0.5, -0.3 + u_tilt.y * 0.5, 0.74));
  float ck = dot(R, key), cw = dot(R, win);
  float edgeK = mix(0.25, 0.04, sm), edgeW = mix(0.2, 0.035, sm);
  float box = smoothstep(0.93 - edgeK * 2.0, 0.93, ck) * mix(1.0, 2.2, sm);
  float win2 = smoothstep(0.94 - edgeW * 2.0, 0.94, cw) * mix(0.6, 1.4, sm);
  float room = 0.1 + 0.34 * clamp(-R.y + 0.1, 0.0, 1.0) + 0.14 * clamp(-R.x + 0.2, 0.0, 1.0);
  float e = box + win2 + room + 0.1 * dif;
  vec3 dark = vec3(0.3, 0.16, 0.04), mid = vec3(0.95, 0.68, 0.24), hi = vec3(1.0, 0.92, 0.62);
  vec3 c = mix(dark, mid, clamp(e, 0.0, 1.0));
  c = mix(c, hi, clamp(e - 1.0, 0.0, 1.0));
  c += vec3(1.0, 0.97, 0.88) * clamp(e - 1.9, 0.0, 1.0) * 0.6;
  return c * mix(0.82, 1.0, sm);
}
`;

/**
 * The frame: a mitered molding profile around the painting, lit from the upper left. Worn bole and wood where
 * there's no gold yet; gold leaf from u_gilt (crumpled until burnished, then a mirror of the studio lights that
 * moves with u_tilt). u_style: 0 plain (easy), 1 beaded (medium), 2 carved with corner rosettes (hard).
 */
export const FRAME_FS = HEAD + COMMON + `
in vec2 v_w;
uniform sampler2D u_noise, u_gilt;
uniform vec4 u_giltRect;
uniform vec2 u_size;      // painting W,H
uniform float u_fw;       // frame width (world)
uniform float u_dust;     // dust left on the frame 0..1
uniform float u_pxw;      // world units per device px
uniform float u_time;
uniform int u_style;
uniform vec2 u_tilt;
uniform float u_shine;    // extra sweep of light over the gold (finale)
out vec4 o;

float profile(float u, float along) {
  float h = 0.0;
  h += 0.35 * smoothstep(0.0, 0.05, u);                                  // lip
  h += 0.25 * exp(-pow((u - 0.08) / 0.035, 2.0));                          // inner bead
  h -= 0.25 * smoothstep(0.12, 0.3, u) * (1.0 - smoothstep(0.3, 0.45, u)); // cove
  h += 0.9 * smoothstep(0.35, 0.62, u) * (1.0 - smoothstep(0.72, 0.9, u)); // big ovolo
  h += 0.25 * exp(-pow((u - 0.93) / 0.025, 2.0));                          // outer bead
  h -= 0.4 * smoothstep(0.96, 1.0, u);
  if (u_style >= 1) {
    // pearls along the inner bead
    float f = fract(along / (u_fw * 0.075)) * 2.0 - 1.0;
    float pearl = sqrt(max(0.0, 1.0 - f * f));
    h += 0.16 * exp(-pow((u - 0.085) / 0.03, 2.0)) * (pearl - 0.6);
  }
  if (u_style >= 2) {
    // carved leaves on the ovolo: repeating lobes with a central vein
    float a = along / (u_fw * 0.62);
    float lobe = pow(abs(sin(a * 3.14159)), 0.5) * (0.8 + 0.2 * sin(a * 6.2832 + u * 9.0));
    float band = smoothstep(0.4, 0.47, u) * (1.0 - smoothstep(0.8, 0.87, u));
    float across = sin(clamp((u - 0.4) / 0.47, 0.0, 1.0) * 3.14159);
    float vein = 1.0 - smoothstep(0.0, 0.06, abs(fract(a) - 0.5));
    h += band * (0.22 * lobe * across - 0.08 * vein);
  }
  return h;
}

` + GOLD + `
void main() {
  vec2 p = v_w;
  vec4 s = vec4(-p.x, p.x - u_size.x, -p.y, p.y - u_size.y); // outside distances: left, right, top, bottom
  float t = max(max(s.x, s.y), max(s.z, s.w));
  if (t < 0.0 || t > u_fw) discard;
  bool vert = s.x >= t || s.y >= t;
  vec2 nrm = s.x >= t ? vec2(-1, 0) : s.y >= t ? vec2(1, 0) : s.z >= t ? vec2(0, -1) : vec2(0, 1);
  vec2 tang = vert ? vec2(0, 1) : vec2(1, 0);
  float u = t / u_fw;
  float along = vert ? p.y : p.x;
  float e = 0.004;
  float h = profile(u, along);
  float dhu = (profile(u + e, along) - profile(u - e, along)) / (2.0 * e);
  float ea = u_fw * 0.004;
  float dha = (profile(u, along + ea) - profile(u, along - ea)) / (2.0 * ea) * u_fw;
  // corner rosettes on the carved frame
  if (u_style >= 2) {
    vec2 cc = vec2(p.x < u_size.x * 0.5 ? -u_fw * 0.55 : u_size.x + u_fw * 0.55, p.y < u_size.y * 0.5 ? -u_fw * 0.55 : u_size.y + u_fw * 0.55);
    vec2 dc = (p - cc) / (u_fw * 0.36);
    float r2 = dot(dc, dc);
    if (r2 < 1.0) {
      float ang = atan(dc.y, dc.x);
      float petals = 0.75 + 0.25 * cos(ang * 8.0);
      float bump = (1.0 - r2) * petals;
      h = max(h, 0.7 + 0.6 * bump);
      vec2 g = -dc * 2.0 * petals * 1.2;
      dhu = dot(g, nrm) * 2.0; dha = dot(g, tang) * 2.0;
    }
  }
  float n1 = texture(u_noise, vec2(along / 700.0, u * 0.7) + nrm * 0.31).r;
  float n2 = texture(u_noise, p / 300.0).g;
  float n3 = texture(u_noise, p / 60.0).b;
  vec3 N = normalize(vec3(-(nrm * dhu + tang * dha) * 1.6 + (vec2(n2, n3) - 0.5) * 0.12, 1.0));
  vec3 Ld = normalize(vec3(-0.55, -0.7, 0.75));
  float dif = clamp(dot(N, Ld), 0.0, 1.0);
  // worn wood and bole
  float grain = texture(u_noise, vec2(along / 40.0, u * 9.0)).a;
  vec3 wood = vec3(0.23, 0.14, 0.075) * (0.75 + 0.5 * grain);
  vec3 bole = vec3(0.42, 0.2, 0.12) * (0.9 + 0.15 * n2);
  vec3 oldGold = vec3(0.62, 0.48, 0.24);
  float chip = smoothstep(0.76, 0.79, texture(u_noise, p / 480.0 + 0.7).b * 0.8 + n3 * 0.2 + h * 0.08);
  float remnant = smoothstep(0.6, 0.66, texture(u_noise, p / 900.0 + 0.2).a) * (1.0 - chip) * smoothstep(0.3, 0.7, h);
  vec3 base = mix(bole, wood, chip);
  base = mix(base, oldGold * (0.6 + 0.4 * n3), remnant * 0.55);
  vec3 H = normalize(Ld + vec3(0, 0, 1));
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 24.0) * (0.12 + remnant * 0.9);
  vec3 col = base * (0.28 + 0.95 * dif) + spec * vec3(1.0, 0.85, 0.6);

  // gold leaf
  vec2 guv = (p - u_giltRect.xy) / (u_giltRect.zw - u_giltRect.xy);
  vec4 G = texture(u_gilt, guv);
  float leaf = clamp(G.r, 0.0, 1.0);
  if (leaf > 0.002) {
    float sm = clamp(G.g, 0.0, 1.0);
    float amp = pow(1.0 - sm, 1.2);
    // crumpled foil: ridged noise, gradient by central differences
    float wa = G.b * 31.0;
    mat2 rot = mat2(cos(wa), sin(wa), -sin(wa), cos(wa));
    vec2 q = rot * p / vec2(34.0, 16.0) + G.b * 37.0;   // wrinkles run in one direction per leaf
    float d = 0.12;
    #define CR(v) (abs(texture(u_noise, v).r - 0.5) + 0.5 * abs(texture(u_noise, (v) * 2.7 + 0.3).g - 0.5))
    float c0 = CR(q);
    vec2 gr = vec2(CR(q + vec2(d, 0)) - CR(q - vec2(d, 0)), CR(q + vec2(0, d)) - CR(q - vec2(0, d))) / (2.0 * d);
    // burnishing leaves faint strokes along the side
    float strokeN = texture(u_noise, vec2(along / 90.0, u * 14.0)).g - 0.5;
    vec3 Ng = normalize(N + vec3((rot * gr) * amp * 0.9 + nrm * strokeN * 0.05 * sm, 0.0));
    vec3 gc = envGold(Ng, sm, dif);
    gc *= mix(0.8 + 0.35 * c0, 1.0, sm);
    // edges of the leaves: a thin line where one leaf overlaps another, softer once burnished
    float seamB = clamp(fwidth(G.b) / u_pxw * 5.0, 0.0, 1.0);
    float edgeR = smoothstep(0.55, 0.95, leaf);
    gc *= (0.8 + 0.2 * edgeR) * (1.0 - seamB * mix(0.35, 0.06, sm));
    // finale sweep
    float sw = exp(-pow((dot(p / max(u_size.x, u_size.y), vec2(0.7, 0.5)) - u_shine * 2.0 + 0.4) / 0.08, 2.0));
    gc += vec3(1.0, 0.9, 0.65) * sw * 0.6 * step(0.001, u_shine) * sm;
    col = mix(col, gc, leaf);
    h = mix(h, h + 0.02, leaf);
  }

  // loose flakes of leaf, raised and catching the light, until the burnisher sweeps them off
  float fl = clamp(G.a, 0.0, 1.0);
  if (fl > 0.02) {
    float fn = texture(u_noise, p / 5.0 + 0.3).r;
    float bit = smoothstep(0.5, 0.56, fn * fl + fl * 0.25);
    vec2 fg = vec2(texture(u_noise, p / 5.0 + vec2(0.02, 0.3)).r - fn, texture(u_noise, p / 5.0 + vec2(0.0, 0.32)).r - fn);
    vec3 Nf = normalize(vec3(fg * 14.0, 1.0));
    vec3 fc = envGold(Nf, 0.35, clamp(dot(Nf, Ld), 0.0, 1.0)) * 1.15;
    col = mix(col * (1.0 - 0.3 * bit), fc, bit);
  }

  // dust settles in the hollows
  float hollow = clamp(0.6 - h, 0.0, 1.0);
  float dust = u_dust * clamp(0.3 + hollow * 0.9 + (n1 - 0.5) * 0.4, 0.0, 1.0) * (0.85 + 0.3 * texture(u_noise, p / 40.0).r);
  col = mix(col, vec3(0.5, 0.47, 0.42) * (0.55 + 0.6 * dif), dust * 0.75);
  // ambient occlusion at the sight edge and outer edge
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.03, u);
  col *= 1.0 - 0.35 * smoothstep(0.9, 1.0, u);
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
uniform vec4 u_drops[16];   // bird droppings: x, y, r, hold (cracks 0..1)
uniform vec4 u_dropsB[16];  // seed, popT (-1 there, -100 popped long ago)
uniform int u_ndrops;
uniform vec4 u_tearA[3];    // a.xy, b.xy
uniform vec4 u_tearB[3];    // c.xy, width, length
uniform vec4 u_tearM[3];    // stitch mask (24 bits), closeT (-1 open, -100 closed long ago)
uniform int u_ntears;
uniform sampler2D u_varn;   // 1 x rows: r coverage, g time applied
uniform sampler2D u_detail; // deep zoom: full-resolution piece of the scan
uniform vec4 u_detailRect;  // its uv rect
uniform float u_detailA;
uniform float u_varnOn;
uniform vec2 u_tilt;
uniform sampler2D u_gilt;   // gold leaf (shared with the frame): r leaf, g burnish, b crumple seed
uniform vec4 u_giltRect;
out vec4 o;
const uint GOLD = 65535u;   // region id of the gold ground (medieval panels): gilded, never painted
` + GOLD + `
// The gold ground: bare red bole with the white gesso showing through scratches and a few worn flecks of the
// old gold, until leaf is laid; then leaf like on the frame (crumpled -> burnished mirror), with the tooling of
// the original (punched halos, incised lines) raised from the scan's own luminance.
vec3 goldGround(vec2 w, vec2 uv, vec3 orig, float seamW) {
  // the scan's incised lines and punches, as relief (on the bole too: the tooling is cut into the gesso)
  // (sampled at the mip the screen actually resolves: finer craquelure would only glitter)
  float lod = max(0.8, log2(max(u_pxw * 1.9, 1.0)) + 0.8);
  vec2 e = 1.4 * exp2(lod - 0.8) / u_size;
  float gx = lum(textureLod(u_img, uv + vec2(e.x, 0), lod).rgb) - lum(textureLod(u_img, uv - vec2(e.x, 0), lod).rgb);
  float gy = lum(textureLod(u_img, uv + vec2(0, e.y), lod).rgb) - lum(textureLod(u_img, uv - vec2(0, e.y), lod).rgb);
  // only where the scan shows gold: the photo background around an arched panel has folds, not tooling
  float sat = max(max(orig.r, orig.g), orig.b) - min(min(orig.r, orig.g), orig.b);
  vec2 tool = vec2(gx, gy) * smoothstep(0.06, 0.16, sat);
  gx = tool.x; gy = tool.y;
  float n1 = texture(u_noise, w / 120.0).r;
  vec3 bole = vec3(0.42, 0.17, 0.09) * (0.85 + 0.25 * n1) * (0.93 + 0.14 * texture(u_noise, w / 11.0).g);
  bole *= clamp(1.0 - (gx * 0.8 + gy) * 2.5, 0.6, 1.3);
  float scratch = smoothstep(0.76, 0.8, texture(u_noise, vec2(w.x / 260.0 + w.y / 800.0, w.y / 9.0)).b);
  bole = mix(bole, vec3(0.8, 0.72, 0.6), scratch * 0.35);
  float old = smoothstep(0.66, 0.74, texture(u_noise, w / 60.0 + 0.3).a * 0.7 + texture(u_noise, w / 17.0).r * 0.3);
  bole = mix(bole, orig * vec3(0.9, 0.8, 0.6), old * 0.4);
  vec4 G = texture(u_gilt, (w - u_giltRect.xy) / (u_giltRect.zw - u_giltRect.xy));
  float leaf = clamp(G.r, 0.0, 1.0);
  if (leaf < 0.002) return bole;
  float sm = clamp(G.g, 0.0, 1.0);
  float amp = pow(1.0 - sm, 1.2);
  float wa = G.b * 31.0;
  mat2 rot = mat2(cos(wa), sin(wa), -sin(wa), cos(wa));
  vec2 q = rot * w / vec2(34.0, 16.0) + G.b * 37.0;
  float d = 0.12;
  #define CRG(v) (abs(texture(u_noise, v).r - 0.5) + 0.5 * abs(texture(u_noise, (v) * 2.7 + 0.3).g - 0.5))
  float c0 = CRG(q);
  vec2 gr = vec2(CRG(q + vec2(d, 0)) - CRG(q - vec2(d, 0)), CRG(q + vec2(0, d)) - CRG(q - vec2(0, d))) / (2.0 * d);
  vec3 N = normalize(vec3(-vec2(gx, gy) * 1.7 + (rot * gr) * amp * 0.9, 1.0));
  vec3 Ld = normalize(vec3(-0.55, -0.7, 0.75));
  float dif = clamp(dot(N, Ld), 0.0, 1.0);
  // a flat panel seen from nearby: the view direction changes across it, so the softbox slides over the gold
  // as it tilts; plus the soft, diffuse warmth gold has in any photograph of these panels
  vec2 persp = (uv - vec2(0.42, 0.38)) * 0.6 + u_tilt * 0.35;
  vec3 gc = envGold(normalize(N + vec3(persp, 0.0)), sm, dif);
  vec3 warm = vec3(0.92, 0.7, 0.33) * (0.7 + 0.3 * dif);
  gc = mix(warm, gc, 0.55 + 0.25 * sm);
  gc *= mix(0.8 + 0.35 * c0, 1.0, sm);
  float seamB = clamp(seamW / u_pxw * 5.0, 0.0, 1.0);
  gc *= (0.8 + 0.2 * smoothstep(0.55, 0.95, leaf)) * (1.0 - seamB * mix(0.35, 0.06, sm));
  return mix(bole, gc, leaf);
}

// brushwork relief from the painting's own luminance (0.5 flat, >0.5 ridges facing the upper-left light)
float reliefAt(vec2 uv, float lod) {
  vec2 e = 1.5 / u_size;
  float gx = lum(textureLod(u_img, uv + vec2(e.x, 0), lod).rgb) - lum(textureLod(u_img, uv - vec2(e.x, 0), lod).rgb);
  float gy = lum(textureLod(u_img, uv + vec2(0, e.y), lod).rgb) - lum(textureLod(u_img, uv - vec2(0, e.y), lod).rgb);
  return clamp(0.5 - (gx * 0.8 + gy) * 3.0, 0.0, 1.0);
}

vec4 rA(uint id) { int i = int(id); return texelFetch(u_rinfo, ivec2((i & 255) * 2, i >> 8), 0); }
vec4 rB(uint id) { int i = int(id); return texelFetch(u_rinfo, ivec2((i & 255) * 2 + 1, i >> 8), 0); }
uint regAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(u_size) - 1);
  return texelFetch(u_reg, t, 0).r;
}

// How much of region id is revealed at world point w (0..1); front: the wet leading band.
float reveal(uint id, vec2 w, out float front) {
  front = 0.0;
  if (id == GOLD) return 0.0;
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
  if (u_detailA > 0.001) {
    vec2 duv = (uv - u_detailRect.xy) / (u_detailRect.zw - u_detailRect.xy);
    if (duv.x > 0.0 && duv.y > 0.0 && duv.x < 1.0 && duv.y < 1.0) {
      vec2 e = min(duv, 1.0 - duv);
      float edge = smoothstep(0.0, 0.03, min(e.x, e.y));
      orig = mix(orig, texture(u_detail, duv).rgb, u_detailA * edge);
    }
  }
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
  bool onGold = own == GOLD;
  float seamW = fwidth(texture(u_gilt, (w - u_giltRect.xy) / (u_giltRect.zw - u_giltRect.xy)).b);  // outside any branch
  float gm = (id00 == GOLD ? (1.0 - f.x) * (1.0 - f.y) : 0.0) + (id10 == GOLD ? f.x * (1.0 - f.y) : 0.0)
           + (id01 == GOLD ? (1.0 - f.x) * f.y : 0.0) + (id11 == GOLD ? f.x * f.y : 0.0);
  if (gm > 0.0) col = mix(col, goldGround(w, uv, orig, seamW), uniformCell ? 1.0 : smoothstep(0.5 - k, 0.5 + k, gm));

  // wet paint at the reveal front: the paint's flat color, glossy
  if (front > 0.001 && !onGold) {
    vec4 ra = rA(own);
    vec3 pc = texelFetch(u_pal, ivec2(int(ra.x), 0), 0).rgb;
    col = mix(col, pc, clamp(front * 0.55, 0.0, 0.6));
    col += front * 0.08;
  }
  // fresh paint: a wet gloss that catches the brushwork, drying over a couple of seconds
  if (!onGold) {
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
    if (u_sel >= 0 && !onGold) {
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
      // kind of drop varies smoothly over the canvas (a drop never splits into two colours)
      float kind = texture(u_noise, w / 900.0 + 0.77).b;
      vec3 sc = mix(vec3(0.12, 0.09, 0.06), vec3(0.86, 0.8, 0.62), smoothstep(0.38, 0.46, kind));
      sc = mix(sc, vec3(0.93, 0.92, 0.88), smoothstep(0.62, 0.7, kind));
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

  // ---- tears in the canvas and their stitches ----
  for (int i = 0; i < 3; i++) {
    if (i >= u_ntears) break;
    vec2 A = u_tearA[i].xy, B = u_tearA[i].zw, C = u_tearB[i].xy;
    float tw = u_tearB[i].z, tl = u_tearB[i].w;
    vec2 ab = B - A, bc = C - B;
    float u1 = clamp(dot(w - A, ab) / dot(ab, ab), 0.0, 1.0), u2 = clamp(dot(w - B, bc) / dot(bc, bc), 0.0, 1.0);
    vec2 p1 = A + ab * u1, p2 = B + bc * u2;
    float d1 = distance(w, p1), d2 = distance(w, p2);
    bool first = d1 <= d2;
    float d = min(d1, d2);
    if (d > tw * 7.0) continue;
    float along = first ? u1 * length(ab) : length(ab) + u2 * length(bc);
    vec2 dir = normalize(first ? ab : bc);
    vec2 rel = w - (first ? p1 : p2);
    float across = sign(dir.x * rel.y - dir.y * rel.x) * d;
    float st = along / tl;
    float ct = u_tearM[i].y;
    float close = ct < -50.0 ? 1.0 : ct < 0.0 ? 0.0 : clamp((u_time - ct) / 0.7, 0.0, 1.0);
    float taper = sin(clamp(st, 0.0, 1.0) * 3.14159);
    float jag = texture(u_noise, vec2(along / 70.0, float(i) * 0.37 + 0.1)).r;
    float width = tw * (0.3 + 0.95 * taper) * (0.7 + 0.6 * jag) * (1.0 - close);
    float ac = abs(across + (jag - 0.5) * tw * 0.7);
    float gap = 1.0 - smoothstep(width * 0.7, width + u_pxw, ac);
    float fray = step(0.84, texture(u_noise, vec2(along / 3.0, across / tw * 0.5 + float(i))).g);
    vec3 hole = mix(vec3(0.045, 0.032, 0.022), vec3(0.74, 0.67, 0.52), fray * 0.85);
    col *= 1.0 - 0.4 * (1.0 - smoothstep(width, width * 2.8 + tw * 0.4, ac)) * (1.0 - close) * step(0.001, width);
    col = mix(col, hole, gap);
    // gesso filler where it closed: the retouch paints over it
    float seam = close * (1.0 - smoothstep(tw * 0.25, tw * 0.55, ac)) * (0.3 + 0.7 * taper);
    col = mix(col, vec3(0.9, 0.87, 0.8), seam * (1.0 - rv) * 0.85);
    // stitches: a zigzag of thread in every sewn cell
    int cell = int(clamp(st, 0.0, 0.9999) * 24.0);
    int mask = int(u_tearM[i].x + 0.5);
    if (((mask >> cell) & 1) == 1 && st >= 0.0 && st <= 1.0) {
      // cross-stitches: both diagonals of each stitch cell, thin thread with a darker core and a shadow
      float sp = tw * 1.7;
      float h = tw * 1.55;
      float lx = mod(along, sp);
      float k = sp / sqrt(sp * sp + 4.0 * h * h);
      float d1s = abs(across - (-h + 2.0 * h * lx / sp)) * k;
      float d2s = abs(across - (h - 2.0 * h * lx / sp)) * k;
      float dist = min(d1s, d2s);
      float inside = step(abs(across), h);
      float tt = tw * 0.07 + u_pxw * 0.6;
      float thread = (1.0 - smoothstep(tt, tt + u_pxw, dist)) * inside;
      float core = (1.0 - smoothstep(0.0, tt * 0.5, dist)) * inside;
      float sh = (1.0 - smoothstep(tt, tt + tw * 0.2, min(abs(across - tw * 0.12 - (-h + 2.0 * h * lx / sp)), abs(across - tw * 0.12 - (h - 2.0 * h * lx / sp))) * k)) * inside;
      float fade = 1.0 - smoothstep(0.6, 1.8, (ct < -50.0 ? 10.0 : ct < 0.0 ? 0.0 : u_time - ct));
      col *= 1.0 - 0.35 * sh * fade;
      col = mix(col, mix(vec3(0.95, 0.91, 0.82), vec3(0.78, 0.72, 0.6), core * 0.5), thread * fade);
    }
  }

  // ---- dried bird droppings (spatula) ----
  for (int i = 0; i < 16; i++) {
    if (i >= u_ndrops) break;
    vec4 D = u_drops[i];
    vec2 q = w - D.xy;
    float r = D.z;
    float dd = length(q);
    if (dd > r * 1.6) continue;
    float seed = u_dropsB[i].x, popT = u_dropsB[i].y;
    float gone = popT < -50.0 ? 1.0 : popT < 0.0 ? 0.0 : clamp((u_time - popT) / 0.18, 0.0, 1.0);
    float ang = atan(q.y, q.x);
    float rr = r * (0.72 + 0.4 * texture(u_noise, vec2(ang / 6.2832 * 3.0, seed * 0.13)).r);
    float m = 1.0 - smoothstep(rr * 0.9, rr + u_pxw, dd);
    // a faint ring stays for a moment after it pops
    if (popT >= 0.0) col = mix(col, col * 0.86, (1.0 - smoothstep(rr * 0.7, rr, dd)) * 0.5 * (1.0 - clamp((u_time - popT) / 2.5, 0.0, 1.0)));
    if (gone >= 1.0 || m <= 0.0) continue;
    float cn = texture(u_noise, w / 40.0 + seed).g;
    vec3 dc = mix(vec3(0.93, 0.92, 0.87), vec3(0.29, 0.28, 0.21), smoothstep(rr * 0.6, rr * 0.05, dd + (cn - 0.5) * r * 0.5));
    vec2 n2 = q / max(dd, 1e-3) * smoothstep(rr * 0.3, rr, dd);
    float shade = 0.9 + 0.3 * dot(-n2, normalize(vec2(-0.6, -0.75)));
    float spec = pow(clamp(0.5 + 0.5 * dot(-n2, normalize(vec2(-0.6, -0.75))), 0.0, 1.0), 12.0) * 0.2;
    float hold = D.w;
    float crack = 0.0;
    if (hold > 0.01) {
      float k = abs(fract(ang / 6.2832 * 7.0 + texture(u_noise, vec2(dd / r * 0.6, seed * 0.2)).g * 0.7) - 0.5);
      crack = (1.0 - smoothstep(0.0, 0.03 + u_pxw / max(dd, 1.0), k)) * step(dd, rr * hold * 1.05);
      crack = max(crack, (1.0 - smoothstep(0.0, u_pxw * 1.5, abs(dd - rr * hold * 0.6))) * step(0.3, hold) * 0.6);
    }
    vec3 c = dc * shade * (1.0 - crack * 0.75) + spec;
    col = mix(col, c, m * (1.0 - gone));
  }

  // varnish: deeper, richer colour; wet streaks that settle; a soft gloss that follows the tilt
  if (u_varnOn > 0.0) {
    float vy = uv.y + (texture(u_noise, vec2(uv.x * 2.3, uv.y * 0.4)).r - 0.5) * 0.02;
    vec4 V = texture(u_varn, vec2(0.5, vy));
    float cov = smoothstep(0.3, 0.7, V.r) * u_varnOn;
    if (cov > 0.0) {
      vec3 deep = pow(max(col, 0.0), vec3(1.12)) * 1.06;
      float l = lum(deep);
      deep = mix(vec3(l), deep, 1.2);
      col = mix(col, deep, cov);
      float age = max(u_time - V.g, 0.0);
      float rel = reliefAt(uv, 0.5);
      float wet = cov * exp(-age / 1.8);
      // bristle streaks run along the stroke (top to bottom)
      float streak = texture(u_noise, vec2(w.x / 19.0, w.y / 1700.0)).r * 0.7 + texture(u_noise, vec2(w.x / 7.0, w.y / 900.0)).g * 0.3;
      col += wet * (0.05 + 0.16 * pow(streak, 4.0) + 0.25 * pow(rel, 6.0)) * vec3(1.0, 0.97, 0.9);
      col += cov * exp(-age * 10.0) * 0.18;                                  // the meniscus right at the brush
      vec2 lp = vec2(0.28, 0.22) + u_tilt * 0.4;
      float gl = exp(-dot(uv - lp, uv - lp) * 7.0);
      col += cov * gl * (0.03 + 0.14 * pow(rel, 4.0)) * vec3(1.0, 0.96, 0.88);
    }
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

/** Mean of each CELLxCELL block (divided by u_div, e.g. MAXV) for the progress read-back. */
export const DIRT_REDUCE_FS = HEAD + `
in vec2 v_uv;
uniform sampler2D u_state;
uniform vec2 u_srcTexel;
uniform int u_cell;
uniform float u_div;
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
  o = clamp(acc / float(n * n) / u_div, 0.0, 1.0);
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

// ---------------- gilding: gold leaf on the frame ----------------

/**
 * Gold leaf state over the frame's bounding box: r = leaf coverage, g = burnish (0 crumpled .. 1 mirror),
 * b = leaf seed (varies the crumple). Leaves are stamped (rotated ragged squares), rubbing burnishes.
 */
export const GILT_STEP_FS = HEAD + COMMON + `
in vec2 v_uv;
uniform sampler2D u_state, u_noise;
uniform vec4 u_rect;        // world rect covered by the texture
uniform vec4 u_seg;         // rub segment p0, p1 (world)
uniform vec2 u_rub;         // radius, amount (0 = none)
uniform vec4 u_leaf[8];     // cx, cy, half size, angle
uniform float u_leafSeed[8];
uniform int u_nleaf;
uniform vec4 u_fin[8];      // world rects to burnish fully (and fill small gaps)
uniform int u_nfin;
uniform float u_dt;
uniform float u_flood;      // end of the stage: gold flows into the last gaps
uniform vec2 u_texel;
out vec4 o;
// r leaf, g burnish, b crumple seed, a loose flakes hanging off the edges
void main() {
  vec2 w = mix(u_rect.xy, u_rect.zw, v_uv);
  vec4 s = texture(u_state, v_uv);
  for (int i = 0; i < 8; i++) {
    if (i >= u_nleaf) break;
    vec4 L = u_leaf[i];
    float c = cos(L.w), sn = sin(L.w);
    vec2 d = w - L.xy;
    vec2 l = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y);
    float seed = u_leafSeed[i];
    // torn, irregular leaf: a rounded square whose edge wanders at two scales
    float ang = atan(l.y, l.x);
    float tear = (texture(u_noise, vec2(ang / 6.2832 * 2.0, seed * 0.07)).r - 0.5) * 0.42
               + (texture(u_noise, w / 7.0 + seed).g - 0.5) * 0.22 + (texture(u_noise, w / 2.5 + seed * 0.3).b - 0.5) * 0.08;
    vec2 q = abs(l) / L.z;
    float box = pow(pow(q.x, 5.0) + pow(q.y, 5.0), 0.2);  // superellipse: square with soft corners
    float e = (box - 1.0 - tear) * L.z;
    float m = 1.0 - smoothstep(-1.0, 0.5, e);
    if (m > 0.01) {
      s.g = mix(s.g, 0.0, m * (1.0 - s.r));   // fresh leaf is crumpled, unless over gold already
      s.b = mix(s.b, fract(seed * 0.618) * 0.9 + 0.05, step(0.5, m));  // each leaf its own crumple (and a seam where it overlaps)
      s.r = max(s.r, m);
    }
    // loose bits of leaf sticking out past the edge
    float ring = (1.0 - smoothstep(0.0, L.z * 0.22, abs(e - L.z * 0.05)));
    float bits = step(0.62, texture(u_noise, w / 7.0 + seed * 1.7).b) * ring;
    s.a = max(s.a, bits);
  }
  if (u_rub.y > 0.0) {
    vec2 a = u_seg.xy, b = u_seg.zw, ab = b - a;
    float l2 = dot(ab, ab);
    float t = l2 > 0.0 ? clamp(dot(w - a, ab) / l2, 0.0, 1.0) : 0.0;
    float d = distance(w, a + ab * t);
    float f = 1.0 - smoothstep(u_rub.x * 0.45, u_rub.x, d);
    s.g = min(1.0, s.g + f * u_rub.y * s.r);
    s.a = max(0.0, s.a - f * u_rub.y * 4.0);
  }
  if (u_flood > 0.0) {
    float n = 0.0;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785398;
      n = max(n, texture(u_state, v_uv + vec2(cos(a), sin(a)) * u_texel * 2.0).r);
    }
    if (n > s.r) { s.r = min(1.0, max(s.r, n * 0.995)); s.g = max(s.g, 0.95); }
  }
  for (int i = 0; i < 8; i++) {
    if (i >= u_nfin) break;
    vec4 r = u_fin[i];
    if (w.x >= r.x && w.y >= r.y && w.x <= r.z && w.y <= r.w && s.r > 0.05) {
      s.r = min(1.0, s.r + u_dt * 3.0 * step(0.35, s.r));   // firm up the edges of laid leaves, don't invent gold
      s.g = min(1.0, s.g + u_dt * 2.2);
      s.a = max(0.0, s.a - u_dt * 3.0);
    }
  }
  o = s;
}`;

/**
 * A leaf of gold on its way down (gilding): a thin flexible sheet on a grid, swinging like a falling leaf, bending
 * and fluttering, bigger while it's up (perspective), its shadow converging under it. The last bit it glides in and
 * gets pulled flat onto the size from the middle out, ending exactly in the shape the gilt stamp gives it.
 * a_g: grid coords -1.3..1.3 (leaf-local / half size).
 */
export const LEAF_VS = HEAD + `
layout(location=0) in vec2 a_g;
uniform vec4 u_leaf;      // landing cx, cy, half size, angle
uniform float u_seed, u_t, u_F;
uniform int u_shadow;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_screen;
out vec2 v_w;     // where this bit of leaf lands (world): the shape mask is evaluated there
out vec2 v_l;     // leaf-local, landing orientation
out vec3 v_n;
out float v_h;
float h1(float n) { return fract(sin(n * 91.345) * 47453.5453); }
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// motion state shared by all vertices of the leaf
float T, air, sw, tiltA, spin;
vec2 dir;
// height of the sheet above the frame at grid point g (world units)
float sheet(vec2 g) {
  float hs = u_leaf.z;
  float r = length(g);
  // pulled flat from the middle out at the very end
  float front = smoothstep(0.8, 1.0, T) * 2.2;
  float loose = smoothstep(front - 0.8, front, r);
  float amp = (0.22 + 0.78 * air) * loose;
  float curl = (h1(u_seed + 3.0) - 0.5) * 0.9 * g.x * g.x + (h1(u_seed + 4.0) - 0.4) * 0.5 * g.y * g.y;
  float flap = sin(g.x * 2.3 + g.y * 0.8 + T * 17.0 + u_seed * 5.0) * 0.12 + sin(g.y * 3.1 - T * 11.0 + u_seed) * 0.07;
  float bend = (curl + flap) * hs * amp;
  vec2 p = rot(g * hs, u_leaf.w + spin);
  float tip = sin(tiltA) * dot(p, dir);
  return air * u_F * 2.6 + bend + tip;
}
void main() {
  T = clamp(u_t, 0.0, 1.0);
  air = pow(max(0.0, 1.0 - T / 0.84), 1.35);           // 1 high up .. 0 touching down
  float ph = T * 6.2832 * 1.15 + u_seed * 3.0;
  float da = h1(u_seed) * 6.2832;
  dir = vec2(cos(da), sin(da));
  sw = sin(ph) * air;                                    // side swing, pendulum-like
  tiltA = cos(ph) * 0.95 * air;                          // tilted most at the ends of each swing
  spin = (h1(u_seed + 1.0) - 0.5) * 2.4 * air * air;
  vec2 g = a_g;
  float hs = u_leaf.z;
  vec2 C = u_leaf.xy;
  float h = sheet(g);
  float e = 0.05;
  vec2 grad = vec2(sheet(g + vec2(e, 0.0)) - sheet(g - vec2(e, 0.0)), sheet(g + vec2(0.0, e)) - sheet(g - vec2(0.0, e))) / (2.0 * e);
  // leaf-local gradient -> world gradient
  vec2 gw = rot(grad / hs, u_leaf.w + spin);
  v_n = normalize(vec3(-gw, 1.0));
  vec2 p = rot(g * hs, u_leaf.w + spin);
  p -= dir * dot(p, dir) * (1.0 - cos(tiltA));           // foreshortened across the tilt
  vec2 P = C + p + dir * sw * u_F * 0.6;
  vec2 W;
  if (u_shadow == 1) {
    W = P + vec2(0.55, 0.8) * h * 0.7;                  // key light from the upper left
  } else {
    float D = u_F * 7.0;
    W = C + (P - C) * (D / max(D - h, D * 0.3));
  }
  v_w = C + rot(g * hs, u_leaf.w);
  v_l = g * hs;
  v_h = h;
  vec2 s = (W - u_cam) * u_zoom;
  gl_Position = vec4(s.x / (u_screen.x * 0.5), -s.y / (u_screen.y * 0.5), 0.0, 1.0);
}`;

export const LEAF_FS = HEAD + COMMON + `
in vec2 v_w, v_l;
in vec3 v_n;
in float v_h;
uniform sampler2D u_noise;
uniform vec4 u_leaf;
uniform float u_seed, u_alpha, u_pxw, u_t;
uniform int u_shadow;
uniform vec2 u_tilt;
out vec4 o;
` + GOLD + `
void main() {
  // the torn outline of GILT_STEP_FS stamps, minus its texel-scale jitter (that one is sampled per pixel here
  // and would sparkle); the leaf fades into the stamp when it lands
  vec2 l = v_l;
  float seed = u_seed;
  float ang = atan(l.y, l.x);
  float tear = (texture(u_noise, vec2(ang / 6.2832 * 2.0, seed * 0.07)).r - 0.5) * 0.42
             + (texture(u_noise, vec2(ang / 6.2832 * 5.0, seed * 0.13 + 0.5)).g - 0.5) * 0.2
             + (texture(u_noise, vec2(ang / 6.2832 * 17.0, seed * 0.11 + 0.2)).b - 0.5) * 0.035;
  vec2 q = abs(l) / u_leaf.z;
  float box = pow(pow(q.x, 5.0) + pow(q.y, 5.0), 0.2);
  float e = (box - 1.0 - tear) * u_leaf.z;
  if (u_shadow == 1) {
    float soft = 1.0 + v_h * 0.22;
    float m = 1.0 - smoothstep(-soft, soft, e);
    float a = m * u_alpha * 0.6 * (1.0 - 0.5 * smoothstep(0.0, u_leaf.z * 6.0, v_h));
    o = vec4(0.0, 0.0, 0.0, a);
    return;
  }
  float aa = max(0.6, u_pxw * 1.2);
  float m = 1.0 - smoothstep(-aa, aa * 0.5, e);
  if (m < 0.003) discard;
  // fine crinkles of beaten foil on top of the big bend
  vec2 cq = l / (u_leaf.z * 2.5) + seed * 3.7;
  vec2 cr = vec2(texture(u_noise, cq).r, texture(u_noise, cq + 0.37).g) - 0.5;
  vec3 N = normalize(v_n + vec3(cr * 0.07, 0.0));
  vec3 Ld = normalize(vec3(-0.55, -0.7, 0.75));
  float dif = clamp(dot(N, Ld), 0.0, 1.0);
  vec3 c = envGold(N, 0.4, dif) * 1.08;
  // a flash whenever the sheet swings its face into the key light
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), N);
  vec3 key = normalize(vec3(-0.42 + u_tilt.x * 0.75, -0.5 + u_tilt.y * 0.75, 0.75));
  c += vec3(1.0, 0.95, 0.8) * pow(clamp(dot(R, key), 0.0, 1.0), 90.0) * 1.3;
  // so thin it lets a little green light through where it faces away
  c = mix(c, vec3(0.35, 0.42, 0.18), clamp(-dot(N, Ld) * 0.5 + 0.1, 0.0, 0.25) * step(0.001, v_h));
  // thin bright rim where the torn edge catches the light
  c += vec3(1.0, 0.85, 0.5) * (1.0 - smoothstep(0.0, aa * 1.5, abs(e + aa))) * 0.2;
  float a = m * u_alpha;
  o = vec4(c * a, a);
}`;
