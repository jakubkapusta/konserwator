---
name: dodaj-obraz
description: Add a painting to the Konserwator collection on request (by title, artist or Rijksmuseum object number) - license check, download, three difficulty levels, preview review, Polish card and commission story, catalog, build and commit. Use when the owner asks to add a painting ("dodaj obraz ...", "dorzuć ... do kolekcji").
---

# Adding a painting to Konserwator

Work in `~/code/konserwator`. Python lives in `tools/.venv` (create it once: `python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt`).

## 1. Find it

```bash
tools/.venv/bin/python tools/fetch_rijks.py --title "melkmeisje" --creator Vermeer --all-hits   # lists object numbers
tools/.venv/bin/python tools/fetch_rijks.py --object-number SK-A-2344 --dry-run                   # full record, no download
```

Titles search in Dutch and English. Pick the painting itself (`SK-A-…` / `SK-C-…` for paintings, `RP-P-…` for prints), not a copy or a photo of it. If the owner gave a name only, confirm with `--dry-run` that creator, title and date match.

## 2. License

The script refuses anything that isn't Public Domain Mark or CC0 (`"open": true`). Never work around it. If a record has no image link the script falls back to Wikimedia Commons via Wikidata (same painting, same inventory number) — that's fine.

## 3. Download

```bash
tools/.venv/bin/python tools/fetch_rijks.py --object-number SK-A-2344 --slug mleczarka
```

Slug: short Polish, ascii, hyphens (`wielka-fala`, `zloty-puchar`). This writes `work/<slug>/source.jpg` (gitignored) and creates `paintings/<slug>.json` with a `source` block that includes the museum's own texts (`description_nl/en`, `dimensions_en`, `medium_en`, `provenance_en`, `credit_en`).

## 4. Levels

```bash
tools/.venv/bin/python tools/build.py <slug>
```

Prints colors / regions per level. Rough targets: łatwy 60–140 fields, średni 150–300, trudny 300–550. Dark or very detailed paintings give more.

## 5. Look at the previews — always

Open `work/<slug>/review.jpg` (outlines on top, a half-painted state below, per level). Check:
- fields aren't a sea of slivers (tighten with larger `min_area` / `min_radius`, or smaller `work_long`),
- smooth gradients don't turn into contour-map bands (lower `chroma`, raise `tv` to smooth more before clustering),
- important accents (a red cap, a blue apron) have their own paint (raise `colors` or `chroma`),
- the easy level is really easy: few tiny fields.

Tune per level in `paintings/<slug>.json` → `levels.<level>` (`colors`, `work_long`, `min_area`, `min_radius`, `chroma`, `tv`), rebuild that level (`--level latwy`), look again. Two or three rounds is normal.

## 6. Texts (Polish)

In `paintings/<slug>.json` set:
- `order` (position in the menu; easy paintings early), `title` (Polish, as commonly known in Poland), `author`, `date` (`ok. 1660`, `1642`), `kind` (`martwa natura`, `wnętrze`, `pejzaż`, `portret`, `miasto`, `zwierzęta`, `drzeworyt`…).
- `card`: 2–3 short paragraphs about the **original**: who, what we see, how it's made / why it matters. Facts only — base them on the museum record (`description_*`, `provenance_en`, `credit_en`, dimensions, medium) and well-established art history. If unsure about a fact, leave it out.
- `story`: `{ "client": "...", "text": "..." }` — the fiction: we restore a **copy** (an old copy, a pupil's copy, a replica from an imagined collection) that arrived in bad shape. Where it hung, why it's dirty (kitchen smoke, attic, cellar, church candles…). Must not claim anything about the real painting (the real "Mleczarka" was never in Kraków). Match the dirt to the story if you like: optional `dirt: { soot, webs, spots }` multipliers.
- Optional `medium` / `dimensions` override the Polish ones generated from the record.

Style: plain Polish, short sentences, no clichés, no marketing tone.

## 7. Catalog, build, commit

```bash
tools/.venv/bin/python tools/build.py --catalog
npm run build
```

Open the game (`npm run dev`, `#p=<slug>/latwy/fresh`) and glance at it once. Commit in Polish: `Nowy obraz: <tytuł> (<autor>)`, including `paintings/<slug>.json` and `public/p/<slug>/`. Don't commit `work/`.

## Rebuilding everything

After changing the segmentation algorithm: see the `przelicz-kolekcje` skill.
