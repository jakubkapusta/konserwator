"""Turn a painting into a color-by-number page: smooth -> k-means in Lab -> regions -> merge small -> outlines + numbers.

Library used by build.py (which writes the game data). The CLI here is for quick experiments on one image:

  tools/.venv/bin/python tools/segment.py work/mleczarka/source.jpg --level sredni --previews --out work/try
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage import color, restoration, transform

FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
GOLD_ID = 65535  # region id of the gold ground in the map: not painted in the retouch, gilded with leaf instead
GOLD_LAB = np.array([72.0, 9.0, 48.0])


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()

# Sizes are the LONG side of the working image. Tried on "The Milkmaid": a starting point, not a rule;
# per-painting overrides live in paintings/<slug>.json -> levels.<level>.
LEVELS = {
    "latwy": dict(colors=16, work_long=470, min_area=90, min_radius=4.5),
    "sredni": dict(colors=24, work_long=620, min_area=70, min_radius=4.0),
    "trudny": dict(colors=36, work_long=800, min_area=55, min_radius=3.5),
}


def kmeans_lab(lab, k, seed=1, iters=25, sample=60000, weights=None):
    """weights: per-pixel sampling weight (detail), so big flat areas don't eat the palette."""
    rng = np.random.default_rng(seed)
    px = lab.reshape(-1, 3)
    p = None
    if weights is not None:
        wv = weights.ravel().astype(np.float64)
        p = wv / wv.sum()
    s = px[rng.choice(len(px), min(sample, len(px)), replace=False, p=p)]
    # k-means++ init
    c = [s[rng.integers(len(s))]]
    for _ in range(1, k):
        d = np.min(((s[:, None, :] - np.array(c)[None]) ** 2).sum(-1), axis=1)
        c.append(s[rng.choice(len(s), p=d / d.sum())])
    c = np.array(c)
    for _ in range(iters):
        lbl = np.argmin(((s[:, None, :] - c[None]) ** 2).sum(-1), axis=1)
        for j in range(k):
            m = lbl == j
            if m.any():
                c[j] = s[m].mean(0)
    out = np.empty(len(px), np.int32)
    for i in range(0, len(px), 200000):
        out[i:i + 200000] = np.argmin(((px[i:i + 200000, None, :] - c[None]) ** 2).sum(-1), axis=1)
    return c, out.reshape(lab.shape[:2])


def detail_weights(lab):
    """0.2 in flat areas .. 1.2 where there is detail (local density of luminance edges)."""
    g = ndi.gaussian_gradient_magnitude(lab[..., 0], 1.5)
    g = ndi.uniform_filter(g, 9)
    return 0.2 + np.clip(g / (np.percentile(g, 90) + 1e-6), 0, 1)


def merge_close(pal, lbl, de):
    """Merge paints closer than de (CIE76 in Lab): two near-identical browns are no fun to paint."""
    pal = pal.copy()
    while len(pal) > 2:
        d = np.sqrt(((pal[:, None] - pal[None]) ** 2).sum(-1))
        np.fill_diagonal(d, 1e9)
        i, j = np.unravel_index(d.argmin(), d.shape)
        if d[i, j] >= de:
            break
        ci, cj = (lbl == i).sum(), (lbl == j).sum()
        pal[i] = (pal[i] * ci + pal[j] * cj) / max(1, ci + cj)
        lbl[lbl == j] = i
        pal = np.delete(pal, j, 0)
        lbl[lbl > j] -= 1
    return pal, lbl


def mode_filter(lbl, k, size=5, rounds=2):
    for _ in range(rounds):
        votes = np.stack([ndi.uniform_filter((lbl == j).astype(np.float32), size) for j in range(k)])
        lbl = votes.argmax(0).astype(np.int32)
    return lbl


def regions_from_labels(lbl, k):
    """Connected components per color. Ids start at 1."""
    reg = np.zeros(lbl.shape, np.int32)
    n = 0
    for j in range(k):
        r, c = ndi.label(lbl == j)
        m = r > 0
        reg[m] = r[m] + n
        n += c
    col = np.zeros(n + 1, np.int32)
    col[reg.ravel()] = lbl.ravel()
    return reg, n, col


def merge_small(reg, col, pal_lab, min_area, min_radius, fixed=None):
    """Absorb regions that are too small or too thin (can't hold a number) into the closest-colored neighbor.
    fixed: a color (the gold ground) whose regions are never absorbed and only take in specks with no other
    neighbor. Returns ids compacted to 0..n-1."""
    changed = True
    while changed:
        changed = False
        ids, areas = np.unique(reg, return_counts=True)
        area = dict(zip(ids.tolist(), areas.tolist()))
        objs = ndi.find_objects(reg)
        H, W = reg.shape
        for rid in sorted(area, key=area.get):
            if rid == 0 or objs[rid - 1] is None or (fixed is not None and col[rid] == fixed):
                continue
            sl = objs[rid - 1]
            y0, y1 = max(sl[0].start - 2, 0), min(sl[0].stop + 2, H)
            x0, x1 = max(sl[1].start - 2, 0), min(sl[1].stop + 2, W)
            sub = reg[y0:y1, x0:x1]
            m = sub == rid
            if not m.any():
                continue
            a = int(m.sum())
            small = a < min_area
            if not small and min_radius > 0 and a < min_area * 12:
                small = ndi.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1].max() < min_radius
            if not small:
                continue
            ring = ndi.binary_dilation(m) & ~m
            nb, cnt = np.unique(sub[ring], return_counts=True)
            if fixed is not None and len(nb) > 1:
                keep = col[nb] != fixed
                if keep.any():
                    nb, cnt = nb[keep], cnt[keep]
            if len(nb) == 0:
                continue
            # closest color, tie-broken by shared border length
            dist = np.array([np.sum((pal_lab[col[n]] - pal_lab[col[rid]]) ** 2) for n in nb])
            score = dist - 0.5 * cnt / cnt.max() * dist.std()
            sub[m] = int(nb[np.argmin(score)])
            changed = True
    ids = np.unique(reg)
    remap = np.zeros(ids.max() + 1, np.int32)
    remap[ids] = np.arange(len(ids))
    newcol = np.zeros(len(ids), np.int32)
    newcol[remap[ids]] = col[ids]
    return remap[reg], len(ids), newcol


def smooth_upscale(reg, col, zoom, sigma):
    """Upscale with smooth borders. Region borders are color borders, so blur each color's mask and take the max."""
    lbl = col[reg]
    best = arg = None
    for j in np.unique(lbl):
        u = ndi.gaussian_filter(ndi.zoom((lbl == j).astype(np.float32), zoom, order=1), sigma)
        if best is None:
            best, arg = u, np.full(u.shape, j, np.int32)
        else:
            b = u > best
            best[b] = u[b]
            arg[b] = j
    return arg


def label_points(reg, n):
    """Pole of inaccessibility per region: where the number goes and how big it can be."""
    objs = ndi.find_objects(reg + 1)
    pts = []
    for rid in range(n):
        sl = objs[rid]
        m = reg[sl] == rid
        dt = ndi.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]
        y, x = np.unravel_index(dt.argmax(), dt.shape)
        pts.append((sl[1].start + x + 0.5, sl[0].start + y + 0.5, float(dt.max()), int(m.sum())))
    return pts


def render(reg, col, pal_rgb, done=None, texture=None, paper=(246, 241, 230), line=(150, 140, 128)):
    """done: set of palette indices already painted (None = everything, no outlines). texture: reveal the painting."""
    H, W = reg.shape
    rgb = (pal_rgb * 255).round().astype(np.uint8)
    cidx = col[reg]
    fill = np.ones(len(pal_rgb), bool) if done is None else np.isin(np.arange(len(pal_rgb)), list(done))
    msk = fill[cidx]
    img = np.empty((H, W, 3), np.uint8)
    img[:] = paper
    img[msk] = rgb[cidx[msk]] if texture is None else texture[msk]
    if done is None:
        return Image.fromarray(img)
    edge = np.zeros((H, W), bool)
    e = reg[:, 1:] != reg[:, :-1]
    edge[:, 1:] |= e
    edge[:, :-1] |= e
    e = reg[1:, :] != reg[:-1, :]
    edge[1:, :] |= e
    edge[:-1, :] |= e
    img[edge & ~msk] = line
    if texture is None:
        img[edge & msk] = (img[edge & msk] * 0.85).astype(np.uint8)
    return Image.fromarray(img)


def draw_numbers(im, pts, col, done=(), min_px=12, max_px=34):
    d = ImageDraw.Draw(im)
    for rid, (x, y, r, _) in enumerate(pts):
        if col[rid] in done:
            continue
        size = int(min(max_px, max(min_px, r * 0.9)))
        d.text((x, y), str(col[rid] + 1), fill=(90, 82, 74), font=font(size), anchor="mm")


def gold_mask(rgb, p=None):
    """Gold ground of a medieval panel (and halos), from the scan. rgb: float HxWx3 at region resolution.
    Colour alone can't tell gold leaf from tempera flesh, so it's a seeded, edge-aware split (random walker):
    clearly non-gold colours are "not gold" seeds, the cores of big gold-coloured areas are gold seeds
    (plus `seeds`), and `figures` ([x, y] fractions on faces, bodies...) mark gold-coloured things that
    aren't gold. Missing a bit of gold is fine (it gets painted in the retouch); gilding a face is not.
    p (record -> gold): min_L, min_chroma, hue [lo, hi], seeds, figures, core, beta,
    bg (the dark photo background around an arched top becomes gilded spandrels)."""
    from skimage.segmentation import random_walker
    p = p or {}
    H, W = rgb.shape[:2]
    lab = color.rgb2lab(ndi.gaussian_filter(rgb, (1.0, 1.0, 0)))
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    hue = np.degrees(np.arctan2(b, a))
    lo, hi = p.get("hue", (62, 100))
    gate = (L > p.get("min_L", 32)) & (L < 95) & (C > p.get("min_chroma", 30)) & (hue > lo) & (hue < hi)
    gate = ndi.binary_closing(gate, iterations=2)
    # work small: the walker solves a big linear system
    k = min(1.0, 520 / max(H, W))
    h, w = max(8, round(H * k)), max(8, round(W * k))
    small = transform.resize(lab, (h, w), anti_aliasing=True)
    gs = transform.resize(gate.astype(np.float32), (h, w), order=1) > 0.5
    # sure "not gold": clearly outside the colour gate; sure gold: the core of big gold-coloured areas
    Ls, As, Bs = small[..., 0], small[..., 1], small[..., 2]
    Cs, Hs = np.hypot(As, Bs), np.degrees(np.arctan2(Bs, As))
    far = (Cs < p.get("min_chroma", 30) - 8) | (Hs < lo - 8) | (Hs > hi + 8) | (Ls < p.get("min_L", 32) - 8)
    lbl = np.where(far, 2, 0).astype(np.int32)
    core = ndi.binary_erosion(gs, iterations=max(2, round(max(h, w) * p.get("core", 0.02))))
    lbl[core] = 1
    yy, xx = np.mgrid[0:h, 0:w]
    rad = max(3, round(max(h, w) * 0.012))
    for fx, fy in p.get("seeds", []):
        lbl[((yy - fy * h) ** 2 + (xx - fx * w) ** 2 < rad * rad) & gs] = 1
    figs = np.zeros((h, w), bool)
    for fx, fy in p.get("figures", []):
        figs |= (yy - fy * h) ** 2 + (xx - fx * w) ** 2 < (rad * 1.8) ** 2
    # a gold-coloured core that a figure point falls into is that figure, not gold
    cr, _ = ndi.label(lbl == 1)
    bad = np.unique(cr[figs & (cr > 0)])
    lbl[np.isin(cr, bad) & (cr > 0)] = 0
    lbl[figs] = 2
    if not (lbl == 1).any():
        return np.zeros((H, W), bool)
    rw = random_walker(small / np.array([100.0, 60.0, 60.0]), lbl, beta=p.get("beta", 600), mode="cg_j", channel_axis=-1, tol=1e-3)
    g = transform.resize((rw == 1).astype(np.float32), (H, W), order=1) > 0.5
    g &= ndi.binary_dilation(gate, iterations=2)
    if p.get("bg"):
        # the dark, colourless photo background connected to the top corners (outside an arched top)
        dark = ndi.binary_closing((C < 16) & (L < 45), iterations=3)
        rr, _ = ndi.label(dark)
        for cy, cx in ((8, 8), (8, W - 9)):
            # (inset: the closing eats the picture's edge) and only above the lower third, so it can't run
            # into a dark robe
            if rr[cy, cx]:
                comp = rr == rr[cy, cx]
                comp[int(H * 0.66):] = False
                comp[:12] |= (C[:12] < 16) & (L[:12] < 45)
                g |= ndi.binary_dilation(comp, iterations=4)
    # punches, cracks and small losses inside the gold are gold too
    holes = ndi.binary_fill_holes(g) & ~g
    hr, hn = ndi.label(holes)
    if hn:
        ha = ndi.sum(holes, hr, np.arange(1, hn + 1))
        g |= np.isin(hr, np.flatnonzero(ha < H * W * p.get("max_hole", 0.0008)) + 1)
    g = ndi.binary_opening(g, iterations=2)
    r, n = ndi.label(g)
    if n:
        area = ndi.sum(g, r, np.arange(1, n + 1))
        g = np.isin(r, np.flatnonzero(area >= H * W * 0.0015) + 1)
    return g


def segment(src, colors, work_long, min_area, min_radius, out_size, chroma=1.8, tv=0.06, merge_de=6.0, gold=None):
    """src: float RGB array (any size). out_size: (width, height) of the region map.
    gold: bool mask at out_size; those pixels get region id GOLD_ID and no paint."""
    ow, oh = out_size
    work_w, h = (work_long, round(work_long * oh / ow)) if ow >= oh else (round(work_long * ow / oh), work_long)
    img = transform.resize(src, (h, work_w), anti_aliasing=True)
    gw = transform.resize(gold.astype(np.float32), (h, work_w), order=1) > 0.5 if gold is not None and gold.any() else None
    # flatten brush texture and craquelure, keep edges
    smooth = restoration.denoise_tv_chambolle(img, weight=tv, channel_axis=-1)
    lab = color.rgb2lab(smooth)
    # weight chroma so saturated accents (Vermeer's yellow and ultramarine) get their own paints instead of more browns
    w = np.array([1.0, chroma, chroma])
    dw = detail_weights(lab)
    if gw is not None:
        dw = dw * np.where(gw, 1e-4, 1.0)
    pal_lab, lbl = kmeans_lab(lab * w, colors, weights=dw)
    pal_lab = pal_lab / w
    pal_lab, lbl = merge_close(pal_lab, lbl, merge_de)
    colors = len(pal_lab)
    # number paints dark -> light
    order = np.argsort(pal_lab[:, 0])
    inv = np.empty(colors, np.int32)
    inv[order] = np.arange(colors)
    pal_lab, lbl = pal_lab[order], inv[lbl]
    # the gold ground is one extra pseudo-paint that never merges with the others
    fixed, K, pal_x = None, colors, pal_lab
    if gw is not None:
        lbl[gw] = colors
        fixed, K, pal_x = colors, colors + 1, np.vstack([pal_lab, GOLD_LAB])
    lbl = mode_filter(lbl, K)
    reg, _, col = regions_from_labels(lbl, K)
    reg, n, col = merge_small(reg, col, pal_x, min_area, min_radius, fixed)
    pal_rgb = np.clip(color.lab2rgb(pal_lab[None])[0], 0, 1)
    # upscale to output size with smooth borders, then clean up specks the smoothing created
    zoom = (oh / h, ow / work_w)
    z = ow / work_w
    reg, _, col = regions_from_labels(smooth_upscale(reg, col, zoom, sigma=z * 0.9), K)
    reg, n, col = merge_small(reg, col, pal_x, int(z * z * 12), 0, fixed)
    # zoom rounding can be off by a pixel
    if reg.shape != (oh, ow):
        reg = reg[:oh, :ow]
        if reg.shape != (oh, ow):
            reg = np.pad(reg, ((0, oh - reg.shape[0]), (0, ow - reg.shape[1])), mode="edge")
    if fixed is not None:
        g = col[reg] == fixed
        keep = np.unique(reg[~g])
        remap = np.zeros(n, np.int32)
        remap[keep] = np.arange(len(keep))
        out = np.full(reg.shape, GOLD_ID, np.int32)
        out[~g] = remap[reg[~g]]
        reg, col, n = out, col[keep], len(keep)
    return reg, n, col, pal_rgb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--level", choices=LEVELS, default="sredni")
    ap.add_argument("--colors", type=int)
    ap.add_argument("--work-long", type=int)
    ap.add_argument("--min-area", type=int)
    ap.add_argument("--min-radius", type=float)
    ap.add_argument("--chroma", type=float, default=1.8)
    ap.add_argument("--out-long", type=int, default=1600)
    ap.add_argument("--out")
    ap.add_argument("--previews", action="store_true")
    a = ap.parse_args()
    p = dict(LEVELS[a.level])
    for k in p:
        if getattr(a, k) is not None:
            p[k] = getattr(a, k)
    out = Path(a.out or Path(a.image).parent)
    out.mkdir(parents=True, exist_ok=True)
    t = time.time()
    im = Image.open(a.image).convert("RGB")
    s = a.out_long / max(im.size)
    size = (round(im.size[0] * s), round(im.size[1] * s))
    src = np.asarray(im).astype(np.float32) / 255
    reg, n, col, pal_rgb = segment(src, out_size=size, chroma=a.chroma, **p)
    pts = label_points(reg, n)
    if a.previews:
        tex = np.asarray(im.resize(size, Image.LANCZOS))
        write_previews(out, a.level, reg, col, pal_rgb, pts, tex)
    print(json.dumps(dict(level=a.level, colors=len(pal_rgb), regions=n, secs=round(time.time() - t, 1))))


def write_previews(out, level, reg, col, pal_rgb, pts, tex):
    k = len(pal_rgb)
    done = set(np.random.default_rng(3).choice(k, size=int(k * 0.55), replace=False).tolist())
    if (reg == GOLD_ID).any():
        # the gold ground shows as flat gold, never numbered
        cx = np.full(GOLD_ID + 1, k, np.int32)
        cx[:len(col)] = col
        col, pal_rgb = cx, np.vstack([pal_rgb, np.clip(color.lab2rgb(GOLD_LAB[None, None])[0], 0, 1)])
        done.add(k)
    base = {k} if len(pal_rgb) > k else set()
    render(reg, col, pal_rgb).save(out / f"preview-{level}-plaski.png")
    im = render(reg, col, pal_rgb, done=base)
    draw_numbers(im, pts, col)
    im.save(out / f"preview-{level}-kontury.png")
    im = render(reg, col, pal_rgb, done=done, texture=tex)
    draw_numbers(im, pts, col, done)
    im.save(out / f"preview-{level}-w-trakcie.png")


if __name__ == "__main__":
    main()
