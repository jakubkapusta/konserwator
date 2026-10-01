"""App icons (PWA, home screen): "The Great Wave" in a gilded frame, half still under yellowed varnish and
grime, with the freshly cleaned diagonal where the brush just passed. Drawn with PIL from the collection's
own thumbnail; run after changing the art:  tools/.venv/bin/python tools/make_icons.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"
S = 1024


def lerp(a, b, t):
    return a + (b - a) * t


def art(maskable=False):
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    # walnut wall with a warm pool of light from the upper left
    pool = np.exp(-(((xx - 0.3) ** 2) + ((yy - 0.25) ** 2)) / 0.18)
    base = np.stack([lerp(16, 70, pool), lerp(12, 50, pool), lerp(9, 34, pool)], -1)
    rng = np.random.default_rng(3)
    grain = np.repeat(rng.normal(0, 1, (S, 1)), S, 1) * 0.6 + rng.normal(0, 1, (S, S)) * 0.4
    grain = np.array(Image.fromarray(((grain * 18) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) - 128
    img = (base + grain[..., None] * 0.18).clip(0, 255)
    im = Image.fromarray(img.astype(np.uint8))

    k = 0.8 if maskable else 1.0  # maskable icons keep the art inside the safe zone
    fw, fh = 0.86 * k, 0.66 * k
    x0, y0 = (1 - fw) / 2 * S, (1 - fh) / 2 * S - 0.01 * S
    x1, y1 = x0 + fw * S, y0 + fh * S
    t = 0.085 * S * k  # frame width

    # soft shadow on the wall, down-right
    sh = Image.new("L", (S, S), 0)
    ImageDraw.Draw(sh).rectangle([x0 + 0.03 * S, y0 + 0.045 * S, x1 + 0.03 * S, y1 + 0.045 * S], fill=200)
    sh = sh.filter(ImageFilter.GaussianBlur(0.035 * S))
    im = Image.composite(Image.new("RGB", (S, S), (6, 4, 3)), im, sh)

    # the painting, cropped to the opening
    pic = Image.open(ROOT / "public/p/wielka-fala/thumb.jpg").convert("RGB")
    ow, oh = int(x1 - x0 - 2 * t), int(y1 - y0 - 2 * t)
    pw, ph = pic.size
    s = max(ow / pw, oh / ph) * 1.05
    pic = pic.resize((round(pw * s), round(ph * s)), Image.LANCZOS)
    pic = pic.crop(((pic.width - ow) // 2, (pic.height - oh) // 2, (pic.width - ow) // 2 + ow, (pic.height - oh) // 2 + oh))
    p = np.asarray(pic).astype(np.float32)
    # dirty half: yellowed varnish + grime, below/right of a diagonal; a bright wet streak at the edge
    py, px = np.mgrid[0:oh, 0:ow].astype(np.float32)
    d = (px / ow) * 0.75 + (py / oh) * 0.45 - 0.62
    wob = np.sin(py / oh * 9.0) * 0.012 + np.sin(py / oh * 23.0 + 1) * 0.006
    edge = d + wob
    L = p.mean(-1, keepdims=True)
    dirty = (L * 0.25 + p * 0.75) * np.array([0.78, 0.6, 0.33]) * 0.82
    gn = np.array(Image.fromarray((rng.normal(0, 1, (oh // 6 + 1, ow // 6 + 1)) * 40 + 128).clip(0, 255).astype(np.uint8)).resize((ow, oh), Image.BICUBIC)).astype(np.float32)[..., None]
    dirty = dirty * (0.85 + (gn - 128) / 128 * 0.18)
    m = np.clip(edge / 0.012, 0, 1)[..., None]
    p = p * (1 - m) + dirty * m
    streak = np.exp(-((edge + 0.025) / 0.018) ** 2)[..., None]
    p = p + streak * np.array([255, 245, 220]) * 0.32
    pic = Image.fromarray(p.clip(0, 255).astype(np.uint8))
    im.paste(pic, (int(x0 + t), int(y0 + t)))

    # gilded molding: four mitred sides, lit from the upper left, a bright ridge along the middle of the profile
    fr = np.zeros((S, S, 4), np.float32)
    gy, gx = np.mgrid[0:S, 0:S].astype(np.float32)
    dist = np.minimum.reduce([gx - x0, x1 - gx, gy - y0, y1 - gy])
    inside = (dist >= 0) & (dist < t)
    u = np.clip(dist / t, 0, 1)
    side = np.argmin(np.stack([gx - x0, x1 - gx, gy - y0, y1 - gy]), 0)  # 0 left 1 right 2 top 3 bottom
    lit = np.choose(side, [1.12, 0.72, 1.2, 0.66])
    prof = 0.55 + 0.45 * np.sin(u * np.pi) + 0.18 * np.exp(-((u - 0.18) / 0.06) ** 2) - 0.25 * np.exp(-((u - 0.78) / 0.07) ** 2)
    shine = prof * lit
    gold_dark, gold_mid, gold_hi = np.array([92, 58, 18]), np.array([206, 154, 62]), np.array([255, 238, 170])
    c = np.where(shine[..., None] < 0.8, gold_dark + (gold_mid - gold_dark) * (shine[..., None] / 0.8),
                 gold_mid + (gold_hi - gold_mid) * np.clip((shine[..., None] - 0.8) / 0.5, 0, 1))
    beads = (np.sin((np.where(side < 2, gy, gx)) / (t * 0.16)) > 0.2) & (np.abs(u - 0.18) < 0.05)
    c = np.where(beads[..., None], c * 1.07, c)
    edge_line = (u < 0.03) | (u > 0.97)
    c = np.where(edge_line[..., None], c * 0.45, c)
    fr[..., :3] = c.clip(0, 255)
    fr[..., 3] = inside * 255
    frame = Image.fromarray(fr.astype(np.uint8)).convert("RGBA")
    im.paste(frame, (0, 0), frame)
    # inner shadow of the frame on the canvas
    ins = Image.new("L", (S, S), 0)
    dr = ImageDraw.Draw(ins)
    dr.rectangle([x0 + t, y0 + t, x1 - t, y0 + t + 0.02 * S], fill=120)
    dr.rectangle([x0 + t, y0 + t, x0 + t + 0.016 * S, y1 - t], fill=110)
    ins = ins.filter(ImageFilter.GaussianBlur(0.012 * S))
    im = Image.composite(Image.new("RGB", (S, S), (10, 6, 3)), im, ins)

    # the brush, resting across the frame's lower-right corner, bristles on the clean streak
    br = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    db = ImageDraw.Draw(br)
    cx, cy, ang = 0.7 * S, 0.66 * S, -0.62
    ca, sa = np.cos(ang), np.sin(ang)
    def poly(pts, fill):
        db.polygon([(cx + (px * ca - py * sa) * S * k, cy + (px * sa + py * ca) * S * k) for px, py in pts], fill=fill)
    poly([(-0.035, -0.02), (0.035, -0.02), (0.045, 0.07), (0.0, 0.1), (-0.045, 0.07)], (240, 228, 200, 255))  # bristles
    poly([(-0.03, -0.065), (0.03, -0.065), (0.035, -0.02), (-0.035, -0.02)], (200, 196, 186, 255))            # ferrule
    poly([(-0.022, -0.36), (0.022, -0.36), (0.028, -0.065), (-0.028, -0.065)], (128, 76, 38, 255))           # handle
    poly([(-0.008, -0.35), (0.004, -0.35), (0.006, -0.07), (-0.01, -0.07)], (176, 116, 64, 255))
    shadow = br.split()[3].filter(ImageFilter.GaussianBlur(0.012 * S))
    im = Image.composite(Image.new("RGB", (S, S), (0, 0, 0)), im, shadow.point(lambda v: v * 0.55).transform((S, S), Image.AFFINE, (1, 0, -0.012 * S, 0, 1, -0.02 * S)))
    im.paste(br, (0, 0), br)
    return im


def main():
    a, m = art(), art(maskable=True)
    for size, name, src in ((512, "icon-512.png", a), (192, "icon-192.png", a), (180, "apple-touch-icon.png", a), (512, "icon-maskable-512.png", m)):
        src.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    a.resize((64, 64), Image.LANCZOS).save(ROOT / "work" / "icon-64.png")
    print("icons written")


if __name__ == "__main__":
    main()
