"""Fetch a public-domain painting from Wikimedia Commons (for works no museum publishes openly, e.g. early
modern art: Kandinsky, Klee, Mondrian, Matisse...) in the same record format as fetch_rijks.py
(source.museum = "commons").

  tools/.venv/bin/python tools/fetch_commons.py --search "Kandinsky Composition VIII"          # list files
  tools/.venv/bin/python tools/fetch_commons.py --file "File:Vassily Kandinsky, 1923 - Composition 8, huile sur toile, 140 cm x 201 cm, Musée Guggenheim, New York.jpg" --slug kompozycja-8

Only files Commons marks as not copyrighted (public domain / CC0) are taken. Commons judges public domain
per country; a painter's works are free in Poland/the EU 70 years after the painter's death (Kandinsky 1944,
Matisse 1954 -> free since 2025). Don't take anything newer than that even if a file claims otherwise
(Picasso, Dalí, Pollock are still protected). No IIIF: no deep-zoom loupe.

Writes work/<slug>/source.jpg (gitignored, re-downloadable) and creates paintings/<slug>.json.
"""
import argparse
import html
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://commons.wikimedia.org/w/api.php"
UA = "konserwator/0.1 (browser game; public-domain paintings)"
LONG = 4000


def get(params, tries=6):
    import time
    url = API + "?" + urllib.parse.urlencode(dict(params, format="json"))
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and k < tries - 1:  # Commons rate-limits: wait as long as it asks
                time.sleep(float(e.headers.get("Retry-After") or 5 * (k + 1)))
                continue
            raise


def text(v):
    """extmetadata values are HTML snippets: keep the visible text."""
    v = re.sub(r"<div style=\"display: none;\">.*?</div>", "", v or "", flags=re.S)
    return html.unescape(re.sub(r"<[^>]+>", " ", v)).split("\n")[0].strip() or None


def search(q, limit=15):
    r = get(dict(action="query", list="search", srnamespace=6, srsearch=q, srlimit=limit))
    return [h["title"] for h in r["query"]["search"]]


def resolve(title, long_side=LONG):
    return resolve_many([title], long_side)[0]


def resolve_many(titles, long_side=LONG):
    """One API call for up to 50 files."""
    r = get(dict(action="query", titles="|".join(titles), prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=long_side))
    pages = {p["title"]: p for p in r["query"]["pages"].values()}
    norm = {n["from"]: n["to"] for n in r["query"].get("normalized", [])}
    return [meta_of(pages[norm.get(t, t)]) for t in titles]


def meta_of(page):
    ii = page["imageinfo"][0]
    md = {k: v.get("value") for k, v in ii.get("extmetadata", {}).items()}
    lic = text(md.get("LicenseShortName")) or ""
    free = md.get("Copyrighted") == "False" or lic.lower().startswith(("public domain", "pd", "cc0"))
    # a portrait-format file gets iiurlwidth as width: fine, build.py scales everything anyway
    return dict(
        museum="commons", file=page["title"], object_number=None,
        title_en=text(md.get("ObjectName")), creator=text(md.get("Artist")), date=text(md.get("DateTimeOriginal")),
        credit_en=text(md.get("Credit")), rights=[md.get("LicenseUrl") or lic], license=lic, open=free,
        object=ii.get("descriptionurl"), iiif=None, commons=None,
        image=ii.get("thumburl") or ii.get("url"), size=[ii.get("width"), ii.get("height")],
    )


def download(meta, dest, long_side=LONG):
    req = urllib.request.Request(meta["image"], headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.read())
    return meta["image"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--search")
    ap.add_argument("--file", help='Commons file title, "File:..."')
    ap.add_argument("--slug")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.search:
        ts = search(a.search)
        for t, m in zip(ts, resolve_many(ts, 200) if ts else []):
            print(("PD  " if m["open"] else "--  ") + f'{m["size"][0]}x{m["size"][1]} | {t} | {m["creator"]} | {m["date"]}')
        return
    if not a.file:
        sys.exit("give --search or --file")
    meta = resolve(a.file)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    if not meta["open"]:
        sys.exit("not marked public domain on Commons - skipping")
    if a.dry_run:
        return
    sl = a.slug or re.sub(r"[^a-z0-9]+", "-", (meta["title_en"] or "obraz").lower()).strip("-")[:48]
    download(meta, ROOT / "work" / sl / "source.jpg")
    rec_path = ROOT / "paintings" / f"{sl}.json"
    rec = json.loads(rec_path.read_text()) if rec_path.exists() else {}
    rec["source"] = meta
    rec.setdefault("levels", {"latwy": {}, "sredni": {}, "trudny": {}})
    rec_path.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    print(f"saved work/{sl}/source.jpg and {rec_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
