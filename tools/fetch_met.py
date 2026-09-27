"""Fetch a public-domain work from The Metropolitan Museum of Art Open Access API (no key) and save it with its
metadata, in the same record format as fetch_rijks.py (source.museum = "met").

  tools/.venv/bin/python tools/fetch_met.py --search "Utagawa Hiroshige" --artist --all-hits
  tools/.venv/bin/python tools/fetch_met.py --search "gold ground" --department "European Paintings" --all-hits
  tools/.venv/bin/python tools/fetch_met.py --id 438754 --slug madonna-duccio

API: https://metmuseum.github.io/ — /search returns object ids, /objects/<id> the record. Only records with
isPublicDomain = true are taken (the Met publishes those as CC0). The image is `primaryImage` (full size),
scaled here to LONG px on the long side. The Met has no IIIF service, so no deep-zoom loupe for these.

Writes work/<slug>/source.jpg (gitignored, re-downloadable) and creates paintings/<slug>.json.
"""
import argparse
import io
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
API = "https://collectionapi.metmuseum.org/public/collection/v1"
UA = "konserwator/0.1 (browser game; public-domain paintings)"
CC0 = "https://creativecommons.org/publicdomain/zero/1.0/"
LONG = 4000
Image.MAX_IMAGE_PIXELS = None


def get_json(url, tries=5):
    import time
    time.sleep(0.15)  # the API sits behind a bot filter that answers 403 to anything hurried
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # the API sits behind a bot filter: back off on 403/429
            if e.code in (403, 429, 503) and k < tries - 1:
                time.sleep(3.0 * (k + 1))
                continue
            raise


def search(q, limit=40, artist=False):
    # /search takes no public-domain filter, and combining q with departmentId returns next to nothing,
    # so everything but the text is filtered per record (see main)
    params = dict(q=q, hasImages="true")
    if artist:
        params["artistOrCulture"] = "true"  # works with the full name ("Utagawa Hiroshige"), not a part of it
    res = get_json(f"{API}/search?" + urllib.parse.urlencode(params))
    return (res.get("objectIDs") or [])[:limit]


def resolve(object_id):
    o = get_json(f"{API}/objects/{object_id}")
    return dict(
        museum="met", met_id=o.get("objectID"), object_number=o.get("accessionNumber"),
        title_en=o.get("title"), creator=o.get("artistDisplayName") or o.get("culture"),
        date=o.get("objectDate"), medium_en=o.get("medium"), dimensions_en=o.get("dimensions"),
        credit_en=o.get("creditLine"), department=o.get("department"),
        rights=[CC0] if o.get("isPublicDomain") else [], open=bool(o.get("isPublicDomain")),
        object=o.get("objectURL"), iiif=None, commons=None, image=o.get("primaryImage") or None,
    )


def download(meta, dest, long_side=LONG):
    if not meta.get("image"):
        sys.exit("the record has no primaryImage")
    req = urllib.request.Request(meta["image"], headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
    s = long_side / max(im.size)
    if s < 1:
        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, quality=92)
    return meta["image"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", type=int, help="Met objectID")
    ap.add_argument("--search", help="free-text query")
    ap.add_argument("--department", help="keep hits from this department, e.g. 'Asian Art', 'European Paintings'")
    ap.add_argument("--artist", action="store_true", help="--search is an artist's name (also filters the hits by it)")
    ap.add_argument("--limit", type=int, default=60, help="how many search hits to look at")
    ap.add_argument("--slug", help="short Polish id (default: from the title)")
    ap.add_argument("--long", type=int, default=LONG)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all-hits", action="store_true", help="list the search hits to pick one")
    a = ap.parse_args()
    if a.id:
        ids = [a.id]
    elif a.search:
        ids = search(a.search, limit=a.limit, artist=a.artist)
    else:
        sys.exit("give --id or --search")
    if not ids:
        sys.exit("nothing found")
    if a.all_hits:
        from concurrent.futures import ThreadPoolExecutor
        def safe(i):
            try:
                return resolve(i)
            except Exception as e:  # noqa: BLE001 - a listing shouldn't die on one bad record
                print(i, "error:", e, file=sys.stderr)
                return None
        # the search matches any text in a record: with --artist keep only that artist's works
        words = a.search.lower().split() if a.artist else []
        with ThreadPoolExecutor(1) as ex:
            for m in ex.map(safe, ids):
                if not m or (words and not all(w in (m["creator"] or "").lower() for w in words)):
                    continue
                if a.department and a.department.lower() not in (m["department"] or "").lower():
                    continue
                if not m["open"] or not m["image"]:
                    continue
                print(m["met_id"], "|", m["creator"], "|", m["title_en"], "|", m["date"], "|", m["medium_en"],
                      "|", m["dimensions_en"])
        return
    meta = resolve(ids[0])
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    if not meta["open"]:
        sys.exit("not public domain - skipping")
    if a.dry_run:
        return
    import re
    sl = a.slug or re.sub(r"[^a-z0-9]+", "-", (meta["title_en"] or str(meta["met_id"])).lower()).strip("-")[:48]
    download(meta, ROOT / "work" / sl / "source.jpg", a.long)
    rec_path = ROOT / "paintings" / f"{sl}.json"
    rec = json.loads(rec_path.read_text()) if rec_path.exists() else {}
    rec["source"] = meta
    rec.setdefault("levels", {"latwy": {}, "sredni": {}, "trudny": {}})
    rec_path.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    print(f"saved work/{sl}/source.jpg and {rec_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
