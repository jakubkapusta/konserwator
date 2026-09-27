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


def kmeans_lab(lab, k, seed=1, iters=25, sample=60000):
    rng = np.random.default_rng(seed)
    px = lab.reshape(-1, 3)
    s = px[rng.choice(len(px), min(sample, len(px)), replace=False)]
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


def merge_small(reg, col, pal_lab, min_area, min_radius):
    """Absorb regions that are too small or too thin (can't hold a number) into the closest-colored neighbor.
    Returns ids compacted to 0..n-1."""
    changed = True
    while changed:
        changed = False
        ids, areas = np.unique(reg, return_counts=True)
        area = dict(zip(ids.tolist(), areas.tolist()))
        objs = ndi.find_objects(reg)
        H, W = reg.shape
        for rid in sorted(area, key=area.get):
            if rid == 0 or objs[rid - 1] is None:
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


def segment(src, colors, work_long, min_area, min_radius, out_size, chroma=1.8, tv=0.06):
    """src: float RGB array (any size). out_size: (width, height) of the region map."""
    ow, oh = out_size
    work_w, h = (work_long, round(work_long * oh / ow)) if ow >= oh else (round(work_long * ow / oh), work_long)
    img = transform.resize(src, (h, work_w), anti_aliasing=True)
    # flatten brush texture and craquelure, keep edges
    smooth = restoration.denoise_tv_chambolle(img, weight=tv, channel_axis=-1)
    lab = color.rgb2lab(smooth)
    # weight chroma so saturated accents (Vermeer's yellow and ultramarine) get their own paints instead of more browns
    w = np.array([1.0, chroma, chroma])
    pal_lab, lbl = kmeans_lab(lab * w, colors)
    pal_lab = pal_lab / w
    # number paints dark -> light
    order = np.argsort(pal_lab[:, 0])
    inv = np.empty(colors, np.int32)
    inv[order] = np.arange(colors)
    pal_lab, lbl = pal_lab[order], inv[lbl]
    lbl = mode_filter(lbl, colors)
    reg, _, col = regions_from_labels(lbl, colors)
    reg, n, col = merge_small(reg, col, pal_lab, min_area, min_radius)
    pal_rgb = np.clip(color.lab2rgb(pal_lab[None])[0], 0, 1)
    # upscale to output size with smooth borders, then clean up specks the smoothing created
    zoom = (oh / h, ow / work_w)
    z = ow / work_w
    reg, _, col = regions_from_labels(smooth_upscale(reg, col, zoom, sigma=z * 0.9), colors)
    reg, n, col = merge_small(reg, col, pal_lab, int(z * z * 12), 0)
    # zoom rounding can be off by a pixel
    if reg.shape != (oh, ow):
        reg = reg[:oh, :ow]
        if reg.shape != (oh, ow):
            reg = np.pad(reg, ((0, oh - reg.shape[0]), (0, ow - reg.shape[1])), mode="edge")
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
    render(reg, col, pal_rgb).save(out / f"preview-{level}-plaski.png")
    im = render(reg, col, pal_rgb, done=set())
    draw_numbers(im, pts, col)
    im.save(out / f"preview-{level}-kontury.png")
    im = render(reg, col, pal_rgb, done=done, texture=tex)
    draw_numbers(im, pts, col, done)
    im.save(out / f"preview-{level}-w-trakcie.png")


if __name__ == "__main__":
    main()
