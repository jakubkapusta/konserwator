"""Build the game data for paintings from their records in paintings/<slug>.json.

  tools/.venv/bin/python tools/build.py mleczarka                  # all three levels + previews
  tools/.venv/bin/python tools/build.py mleczarka --level trudny   # one level (e.g. after tuning its params)
  tools/.venv/bin/python tools/build.py --all                      # the whole collection (after changing the algorithm)
  tools/.venv/bin/python tools/build.py --catalog                  # only rewrite public/p/catalog.json

Per painting it writes public/p/<slug>/:
  image.jpg          the painting, long side IMAGE_LONG (the texture revealed by the retouch)
  thumb.jpg          small version for menus
  <level>.bin        region map, REGION_LONG on the long side: little-endian u16 pairs (region id, run length),
                     runs go row by row and may wrap to the next row
  <level>.json       palette (dark -> light) and per region: color, label point + inscribed radius, area, bbox
and review images to work/<slug>/ (gitignored): preview-<level>-*.png and review.jpg (all levels side by side).

Level parameters: segment.LEVELS, overridden per painting by paintings/<slug>.json -> levels.<level>
(colors, work_long, min_area, min_radius, chroma, tv).
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_rijks  # noqa: E402
import segment as seg  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REC = ROOT / "paintings"
OUT = ROOT / "public" / "p"
WORK = ROOT / "work"
IMAGE_LONG = 3000
REGION_LONG = 1600
THUMB_LONG = 520
LEVEL_ORDER = ["latwy", "sredni", "trudny"]
Image.MAX_IMAGE_PIXELS = None


def load_record(slug):
    p = REC / f"{slug}.json"
    if not p.exists():
        sys.exit(f"no record {p.relative_to(ROOT)} - fetch the painting first (tools/fetch_rijks.py --slug {slug})")
    return json.loads(p.read_text())


def source_image(slug, rec):
    p = WORK / slug / "source.jpg"
    if not p.exists():
        print(f"{slug}: source missing, downloading again", file=sys.stderr)
        fetch_rijks.download(rec["source"], p, 4000)
    return Image.open(p).convert("RGB")


def rle(reg):
    flat = reg.ravel().astype(np.uint32)
    change = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], change])
    lens = np.diff(np.concatenate([starts, [len(flat)]]))
    vals = flat[starts]
    out = []
    for v, n in zip(vals.tolist(), lens.tolist()):
        while n > 0:
            m = min(n, 65535)
            out.append((v, m))
            n -= m
    return np.array(out, "<u2").tobytes()


def bboxes(reg, n):
    objs = ndi.find_objects(reg + 1)
    return [[o[1].start, o[0].start, o[1].stop, o[0].stop] for o in objs[:n]]


def build_level(slug, rec, level, src, size, tex, previews=True):
    p = dict(seg.LEVELS[level])
    extra = dict(chroma=1.8, tv=0.06)
    for k, v in (rec.get("levels", {}).get(level) or {}).items():
        (p if k in p else extra)[k] = v
    t = time.time()
    reg, n, col, pal_rgb = seg.segment(src, out_size=size, **p, **extra)
    if n > 65535:
        sys.exit("too many regions")
    pts = seg.label_points(reg, n)
    boxes = bboxes(reg, n)
    d = OUT / slug
    (d / f"{level}.bin").write_bytes(rle(reg))
    used = sorted({int(c) for c in col})
    info = dict(level=level, params=dict(p, **extra), width=size[0], height=size[1],
                palette=[[int(v * 255 + .5) for v in c] for c in pal_rgb],
                regions=[dict(c=int(col[i]), x=round(x, 1), y=round(y, 1), r=round(r, 1), a=a_, b=boxes[i])
                         for i, (x, y, r, a_) in enumerate(pts)])
    (d / f"{level}.json").write_text(json.dumps(info, separators=(",", ":")))
    if previews:
        seg.write_previews(WORK / slug, level, reg, col, pal_rgb, pts, tex)
    unused = len(pal_rgb) - len(used)
    print(json.dumps(dict(slug=slug, level=level, colors=len(pal_rgb), regions=n, unused_colors=unused,
                          secs=round(time.time() - t, 1))))
    return dict(colors=len(pal_rgb), regions=n)


def review_sheet(slug, levels):
    """All levels' outline previews and in-progress previews in one image, to look at in one go."""
    ims = []
    for lv in levels:
        a = WORK / slug / f"preview-{lv}-kontury.png"
        b = WORK / slug / f"preview-{lv}-w-trakcie.png"
        if a.exists() and b.exists():
            ims.append((lv, Image.open(a), Image.open(b)))
    if not ims:
        return
    w, h = ims[0][1].size
    s = 700 / max(w, h)
    tw, th = round(w * s), round(h * s)
    sheet = Image.new("RGB", (tw * len(ims), th * 2 + 30), (30, 28, 26))
    dr = ImageDraw.Draw(sheet)
    for i, (lv, a, b) in enumerate(ims):
        sheet.paste(a.resize((tw, th), Image.LANCZOS), (i * tw, 30))
        sheet.paste(b.resize((tw, th), Image.LANCZOS), (i * tw, 30 + th))
        dr.text((i * tw + 8, 6), lv, fill=(240, 230, 210), font=seg.font(18))
    sheet.save(WORK / slug / "review.jpg", quality=85)


def build(slug, levels, previews=True):
    rec = load_record(slug)
    im = source_image(slug, rec)
    d = OUT / slug
    d.mkdir(parents=True, exist_ok=True)
    (WORK / slug).mkdir(parents=True, exist_ok=True)
    W, H = im.size
    s = IMAGE_LONG / max(W, H)
    im.resize((round(W * s), round(H * s)), Image.LANCZOS).save(d / "image.jpg", quality=87, progressive=True, optimize=True)
    s = THUMB_LONG / max(W, H)
    im.resize((round(W * s), round(H * s)), Image.LANCZOS).save(d / "thumb.jpg", quality=82, progressive=True, optimize=True)
    s = REGION_LONG / max(W, H)
    size = (round(W * s), round(H * s))
    src = np.asarray(im.resize((round(W * 1800 / max(W, H)), round(H * 1800 / max(W, H))), Image.LANCZOS)).astype(np.float32) / 255
    tex = np.asarray(im.resize(size, Image.LANCZOS))
    for lv in levels:
        build_level(slug, rec, lv, src, size, tex, previews)
    if previews:
        review_sheet(slug, LEVEL_ORDER)


def catalog():
    """public/p/catalog.json: everything the menus need, in the order of paintings/*.json -> order."""
    items = []
    for p in sorted(REC.glob("*.json")):
        rec = json.loads(p.read_text())
        slug = p.stem
        d = OUT / slug
        levels = {}
        for lv in LEVEL_ORDER:
            f = d / f"{lv}.json"
            if f.exists():
                info = json.loads(f.read_text())
                levels[lv] = dict(colors=len(info["palette"]), regions=len(info["regions"]))
                size = [info["width"], info["height"]]
        if len(levels) < 3 or not (d / "image.jpg").exists():
            print(f"{slug}: not built yet, skipped", file=sys.stderr)
            continue
        src = rec["source"]
        items.append(dict(
            slug=slug, order=rec.get("order", 999), size=size, levels=levels,
            title=rec.get("title") or src.get("title_en"), author=rec.get("author") or src.get("creator"),
            date=rec.get("date") or src.get("date"), objectNumber=src.get("object_number"),
            license="Rijksmuseum, domena publiczna", licenseUrl=(src.get("rights") or [None])[0],
            sourceUrl=src.get("object"), kind=rec.get("kind"),
            story=rec.get("story"), card=rec.get("card"), dirt=rec.get("dirt"),
        ))
    items.sort(key=lambda i: (i["order"], i["slug"]))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "catalog.json").write_text(json.dumps(dict(paintings=items), ensure_ascii=False, indent=1) + "\n")
    print(f"catalog: {len(items)} paintings")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--level", choices=LEVEL_ORDER, action="append")
    ap.add_argument("--no-previews", action="store_true")
    ap.add_argument("--catalog", action="store_true", help="only rewrite the catalog")
    a = ap.parse_args()
    if not a.catalog:
        slugs = [p.stem for p in sorted(REC.glob("*.json"))] if a.all else a.slugs
        if not slugs:
            ap.error("give slugs or --all")
        for s in slugs:
            build(s, a.level or LEVEL_ORDER, not a.no_previews)
    catalog()


if __name__ == "__main__":
    main()
