"""Fetch a public-domain painting from the Rijksmuseum (no API key) and save it with its metadata.

Chain: search API -> object (Linked Art) -> VisualItem (rights) -> DigitalObject -> IIIF image.
Some records have no DigitalObject link (e.g. SK-A-2860); then the image comes from Wikimedia Commons,
found on Wikidata by the Rijksmuseum inventory number.

  tools/.venv/bin/python tools/fetch_rijks.py --object-number SK-A-2344 --slug mleczarka
  tools/.venv/bin/python tools/fetch_rijks.py --title "melkmeisje" --creator Vermeer --dry-run

Writes work/<slug>/source.jpg (gitignored, re-downloadable) and creates paintings/<slug>.json
(the painting's record in the repo) with the source metadata if it doesn't exist yet.
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

UA = "konserwator/0.1 (browser game; public-domain paintings)"
SEARCH = "https://data.rijksmuseum.nl/search/collection"
EN, NL = "http://vocab.getty.edu/aat/300388277", "http://vocab.getty.edu/aat/300388256"
PREFERRED = "http://vocab.getty.edu/aat/300404670"
OBJECT_NUMBER = "http://vocab.getty.edu/aat/300312355"
CREATOR_TEXT = "http://vocab.getty.edu/aat/300435416"
WIKIDATA = "https://www.wikidata.org/w/api.php"
# referred_to_by text types (Getty AAT)
DESCRIPTION, DIMENSIONS, MEDIUM, PROVENANCE, CREDIT = (
    "http://vocab.getty.edu/aat/300435452", "http://vocab.getty.edu/aat/300435430",
    "http://vocab.getty.edu/aat/300435429", "http://vocab.getty.edu/aat/300444174",
    "http://vocab.getty.edu/aat/300026687")
RIJKSMUSEUM_QID = "Q190804"
OPEN_RIGHTS = ("creativecommons.org/publicdomain/mark", "creativecommons.org/publicdomain/zero")


def get_json(url, ld=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Accept": "application/ld+json"} if ld else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def langs(node):
    return {l.get("id") for l in node.get("language", [])}


def classes(node):
    return {c.get("id") for c in node.get("classified_as", [])}


def name(obj, lang):
    names = [n for n in obj.get("identified_by", []) if n.get("type") == "Name" and lang in langs(n)]
    pref = [n for n in names if PREFERRED in classes(n)]
    return (pref or names or [{}])[0].get("content")


def search(params):
    res = get_json(SEARCH + "?" + urllib.parse.urlencode(params), ld=False)
    return [i["id"] for i in res.get("orderedItems", [])]


def resolve(obj_url):
    obj = get_json(obj_url)
    number = next((i["content"] for i in obj.get("identified_by", [])
                   if i.get("type") == "Identifier" and OBJECT_NUMBER in classes(i)), None)
    prod = obj.get("produced_by", {})
    creator = next((t["content"] for t in prod.get("referred_to_by", []) if CREATOR_TEXT in classes(t)), None)
    date = next((n["content"] for n in prod.get("timespan", {}).get("identified_by", []) if EN in langs(n)), None)
    texts = {}
    for t in obj.get("referred_to_by", []):
        for kind, key in ((DESCRIPTION, "description"), (DIMENSIONS, "dimensions"), (MEDIUM, "medium"),
                          (PROVENANCE, "provenance"), (CREDIT, "credit")):
            if kind in classes(t):
                lang = "en" if EN in langs(t) else "nl" if NL in langs(t) else "x"
                texts.setdefault(f"{key}_{lang}", t.get("content"))
    vis = get_json(obj["shows"][0]["id"])
    rights = [c["id"] for r in vis.get("subject_to", []) for c in r.get("classified_as", [])]
    iiif = commons = None
    if vis.get("digitally_shown_by"):
        digital = get_json(vis["digitally_shown_by"][0]["id"])
        iiif = re.sub(r"/full/.*$", "", digital["access_point"][0]["id"])  # was .../full/max/0/default.jpg
    elif number:
        commons = commons_image(number)
    return dict(object_number=number, title_en=name(obj, EN), title_nl=name(obj, NL), creator=creator, date=date,
                rights=rights, open=any(any(o in r for o in OPEN_RIGHTS) for r in rights),
                object=obj_url, iiif=iiif, commons=commons, **texts)


def commons_image(number):
    # Wikidata search API rather than SPARQL: the query service rate-limits hard
    q = f"haswbstatement:P217={number} haswbstatement:P195={RIJKSMUSEUM_QID}"
    hits = get_json(WIKIDATA + "?" + urllib.parse.urlencode(
        dict(action="query", list="search", srsearch=q, format="json")), ld=False)["query"]["search"]
    if not hits:
        return None
    claims = get_json(WIKIDATA + "?" + urllib.parse.urlencode(
        dict(action="wbgetclaims", entity=hits[0]["title"], property="P18", format="json")), ld=False)["claims"]
    if not claims.get("P18"):
        return None
    file = claims["P18"][0]["mainsnak"]["datavalue"]["value"]
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(file)


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:48] or "obraz"


def download(meta, dest, long_side):
    if meta.get("iiif"):
        url = f"{meta['iiif']}/full/!{long_side},{long_side}/0/default.jpg"
    elif meta.get("commons"):
        url = f"{meta['commons']}?width={long_side}"
    else:
        sys.exit("no downloadable image found (neither Rijksmuseum IIIF nor Wikimedia Commons)")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.read())
    return url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--object-number")
    ap.add_argument("--title")
    ap.add_argument("--creator")
    ap.add_argument("--slug", help="short Polish id, e.g. mleczarka (default: from the English title)")
    ap.add_argument("--long", type=int, default=4000, help="long side in px (IIIF scales on the server)")
    ap.add_argument("--dry-run", action="store_true", help="only print what would be downloaded")
    ap.add_argument("--all-hits", action="store_true", help="print every search hit (to pick the right one)")
    a = ap.parse_args()
    params = {k: v for k, v in dict(objectNumber=a.object_number, title=a.title, creator=a.creator).items() if v}
    if not params:
        sys.exit("give --object-number or --title/--creator")
    hits = search(params)
    if not hits:
        sys.exit(f"nothing found for {params}")
    if a.all_hits:
        for h in hits[:20]:
            m = resolve(h)
            print(m["object_number"], "|", m["creator"], "|", m["title_en"], "|", m["date"], "| open" if m["open"] else "| NOT OPEN")
        return
    if len(hits) > 1:
        print(f"{len(hits)} hits, taking the first; narrow the query (or --all-hits) if it's the wrong one", file=sys.stderr)
    meta = resolve(hits[0])
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    if not meta["open"]:
        sys.exit("image is not public domain / CC0 - skipping")
    if a.dry_run:
        return
    sl = a.slug or slug(meta["title_en"] or meta["object_number"])
    url = download(meta, ROOT / "work" / sl / "source.jpg", a.long)
    rec_path = ROOT / "paintings" / f"{sl}.json"
    rec = json.loads(rec_path.read_text()) if rec_path.exists() else {}
    rec["source"] = dict(meta, image=url)
    rec.setdefault("levels", {"latwy": {}, "sredni": {}, "trudny": {}})
    rec_path.parent.mkdir(parents=True, exist_ok=True)
    rec_path.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    print(f"saved work/{sl}/source.jpg and {rec_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
