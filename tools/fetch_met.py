"""Fetch a public-domain work from The Metropolitan Museum of Art Open Access API (no key) and save it with its
metadata, in the same record format as fetch_rijks.py (source.museum = "met").

  tools/.venv/bin/python tools/fetch_met.py --search "Hiroshige" --department 6 --all-hits   # Asian Art
  tools/.venv/bin/python tools/fetch_met.py --search "Duccio" --department 11 --all-hits     # European Paintings
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


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def search(q, department=None, limit=40):
    params = dict(q=q, hasImages="true", isPublicDomain="true")
    if department:
        params["departmentId"] = department
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
    ap.add_argument("--department", type=int, help="6 Asian Art, 11 European Paintings, 10 Egyptian Art, ...")
    ap.add_argument("--slug", help="short Polish id (default: from the title)")
    ap.add_argument("--long", type=int, default=LONG)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all-hits", action="store_true", help="list the search hits to pick one")
    a = ap.parse_args()
    if a.id:
        ids = [a.id]
    elif a.search:
        ids = search(a.search, a.department)
    else:
        sys.exit("give --id or --search")
    if not ids:
        sys.exit("nothing found")
    if a.all_hits:
        for i in ids[:30]:
            m = resolve(i)
            print(m["met_id"], "|", m["creator"], "|", m["title_en"], "|", m["date"], "|", m["medium_en"],
                  "| open" if m["open"] else "| NOT OPEN")
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
