# Konserwator — notes for agents

Browser game (iPad + Apple Pencil first, phone and laptop too): restore old paintings — clean the dirt (PowerWash), retouch by numbers (Happy Color, variant B: a painted field gets the real painting back), then gild the frame and varnish (M2). Vite + TypeScript, raw WebGL2, no engine. Paintings are real Rijksmuseum public-domain scans prepared offline by the Python pipeline in `tools/`; everything else (dirt, frame, sounds, icons) is procedural. Design doc: `docs/PLAN.md` (Polish, milestones M0–M3). Deployed to GitHub Pages from `dist/` by `.github/workflows/pages.yml`. Pattern projects: `~/code/roj`, `~/code/fala` — copy code from there, don't import it.

## Status (read first)

- **M0 done**, **M1 accepted** 2026-09-27 after the owner's iPad test. Owner feedback applied: peek (hold the eye) stays; "Znajdź" limited to **5 per painting**; the selected paint's fields get a **semi-transparent white/grey checker** (visible on any colour, tiny fields too); pinch zoom-out bug fixed (a finger used as the tool stayed in the touch list); with the Pencil a **finger tap paints** a field; generative **music** (music-box plucks over a pad) with separate music / effects toggles; retouch save restore fixed; the commission card shows the original first, the copy's story below; the collection should include easier paintings (still lifes, prints).
- **M2 accepted** 2026-09-27. Owner: gilding was fast but boring (rectangular leaves) -> reworked in M3; one varnish stroke is enough; hide finished paintings in the studio by default.
- **M3 pushed 2026-09-27, waiting for the owner's test**: gestures (pinch uses the two newest touches: a resting palm no longer blocks zoom; no contact-size palm guessing; `#debug` overlay), new studio menu (window light + dust motes, easel with the current work, commissions hung salon-style, miniatures show dirt / wipe progress / gold; finished hidden unless "Pokaż ukończone"), cleaning variety (scalpel from easy; smaller brush/swab on medium/hard; spatula for bird droppings, needle for tears — `game/repairs.ts`), gilding (free leaf placement, torn crooked leaves fluttering down, loose flakes swept off, burnisher glints + rising note, gold flooding the last gaps), deep-zoom loupe (`game/loupe.ts`, IIIF), offline download of the whole collection (menu button), phone layout.
- **After M3** (owner 2026-09-27: zoom OK, mood fits, new tools stay on medium/hard): music/effects knobs in the studio and gallery corner (synced with the workbench menu), label dots no longer overlap, UI restyled to the studio's materials (paper sheets with foxing and a ruled border, gilt plaques as primary buttons, walnut trays/knobs with brass inlay, paper price-tag filters, ink checkboxes, paper toasts), falling gold leaf redrawn in WebGL (`LEAF_VS/FS`: flexible sheet on a grid, pendulum swing, perspective, converging shadow, glints, pulled flat from the middle out).
- **Collection 59** (2026-09-27): +15 colourful Rijks paintings (Monet, Van Gogh, Fantin-Latour, Verster, Toorop, Israëls, Hart Nibbrig, Jongkind, Mauve, Mondrian, Schwartze, Van der Ast, De Heem), +9 Japanese prints (easy: Hokusai, Hiroshige, Kuniyoshi, Harunobu), +5 **gold-ground panels** (kind `złote tło`: Master of Badia a Isola — Duccio's circle, Fra Angelico, Giovanni di Paolo, Gerini, Jacobello del Fiore). Gold-ground panels: the background is region `GOLD_ID` 65535 (no paint, no number), shown as bare red bole with scratches until leaf is laid in the gilding stage together with the frame (`Gilding` gets `goldAt`, adds a grid of inner patches that count only gold cells), burnished gold keeps the scan's tooling (punched halos, incised lines) as relief (`goldGround()` in `PAINT_FS`). - **Collection 81**: +10 from the Met (`tools/fetch_met.py`: 5 Japanese prints, 5 gold grounds — Duccio, Giotto, Simone Martini, Ugolino ×2) and +12 early modern works from Wikimedia Commons (`tools/fetch_commons.py`, kind `sztuka nowoczesna`: Kandinsky, Matisse, Mondrian, Klee, Marc, Malevich, Macke, Juan Gris). Met API quirks: `/search` has no public-domain filter and `departmentId` + `q` returns next to nothing (filtered per record instead); `artistOrCulture=true` needs the full name; a bot filter answers 403 to hurried requests (the script paces itself). The Met doesn't publish 20th-century art as CC0 — use Commons, and only for painters dead 70+ years (Picasso, Dalí, Pollock are still protected).
- Player-facing text Polish; code and comments English; commit messages Polish. Don't wait for the Pages deploy after a push.

## Stages of one painting (`src/game/studio.ts`)

`intro → clean → toRetouch → retouch → toGild → gild → toVarnish → varnish → finale`. Transitions are timed in `update()` (light sweeps, outlines growing, gold shine). Saves (`WorkSave.stage`): clean | retouch | gild | varnish | done; a save whose region count differs from the level (painting rebuilt) is ignored.
- Gilding (`gilding.ts`, `render/gilt.ts`): the frame ring is split into leaf-sized patches; touching a bare patch lays a crumpled leaf (GPU stamp), rubbing burnishes (G channel); a patch >72 % burnished finishes itself. Frame look in `FRAME_FS`: profile per level (`u_style` 0 plain / 1 pearls / 2 carved + corner rosettes), gold = softbox reflections, sharper as it's burnished, moving with `tilt` (`game/tilt.ts`: DeviceOrientation after a tap on iOS, mouse on laptops, slow drift otherwise).
- Varnish (`varnish.ts`): a full-width flat brush; per-row coverage + time in a 1×256 RGBA16F texture; painting shader deepens colour under it, wet streaks along the stroke dry out, a tilt-driven gloss stays.
- Recording/replay: cleaning strokes (world ints) + paint order are recorded (`rec:<slug>` in IDB while working, `rec-done:<slug>` when finished); the gallery replays them at speed through the same `Studio` (`replay` ctor arg, `quiet` flags).

## Commands

```bash
npm run dev          # vite --host (port 5196)
npx tsc --noEmit     # typecheck after every change
npm run build        # typecheck + static build
npm run icons        # regenerate PWA icons (scripts/icons.mjs)
tools/.venv/bin/python tools/fetch_rijks.py --object-number SK-A-2344 --slug mleczarka   # add a painting
tools/.venv/bin/python tools/build.py mleczarka          # build its data (all levels + previews)
tools/.venv/bin/python tools/build.py --all              # rebuild the whole collection (after changing the algorithm)
```

Python setup once: `python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt`.

URL hash: `#p=<slug>/<level>` opens a painting straight away (`/fresh` drops the save), `#skip` skips the cleaning, `#gallery` opens the gallery. With `#debug` in the address the menu "⋯" also has "Pomiń ten etap (test)" (`studio.skipStage()`). The studio menu ends with "Zacznij grę od nowa" (confirmation sheet, `save.clearAll()`: work, gallery, IndexedDB; prefs stay). Kinds are a dropdown with counts.
Dev helpers on `window.__k`: `studio`, `cam`, `renderer`, `tick(n)` (run n frames synchronously — the browser pane may be hidden and throttle rAF), `shot(name)` (dev server only: renders and saves the canvas to `work/shots/<name>.png`, DOM overlay not included), `stroke(pts, {type, pressure})`, `zig(x0,y0,x1,y1,rows,steps)`, `tap(x,y)`.

## Painting data (pipeline)

To add a painting follow `.claude/skills/dodaj-obraz/SKILL.md`; after algorithm changes `.claude/skills/przelicz-kolekcje/SKILL.md`.


- `paintings/<slug>.json` — the record in the repo: Polish `title/author/date/kind`, `story` (fiction: we restore **copies** from imagined collections — never claim the real painting was somewhere it wasn't), `card` (real facts about the original), per-level segmentation overrides `levels.<level>` (`colors`, `work_long`, `min_area`, `min_radius`, `chroma`, `tv`), optional `dirt` (`soot`, `webs`, `spots` multipliers), `source` (from `fetch_rijks.py`: object number, rights, IIIF/Commons URL).
- `tools/fetch_rijks.py` — Rijksmuseum search → Linked Art → rights check (PD mark / CC0 only) → IIIF (or Wikimedia Commons via Wikidata when the record has no image). Downloads to `work/<slug>/source.jpg` (gitignored).
- Record extras: `crop` `[x0, y0, x1, y1]` fractions of the scan (drop a photographed frame; the loupe maps through it), `gold` block for gold-ground panels → `segment.gold_mask()`: colour gate + random walker between gold seeds (cores of big gold-coloured areas) and "not gold" seeds (clearly other colours + `figures` points you place on faces/bodies, because tempera flesh has the colour of gold in scans); `bg: true` gilds the dark photo background around an arched top (spandrels); tune `min_chroma`, `hue`, `figures`; check `work/<slug>/gold.jpg` (magenta = gold). Missing some gold is fine (it gets painted), gilding a face is not.
- `tools/segment.py` — TV denoise → k-means in Lab (chroma weighted) → mode filter → connected regions → merge regions too small/thin for a number → smooth upscale → label points (pole of inaccessibility).
- `tools/build.py` (`--fit` tunes `work_long` per level towards `TARGETS` and writes it back to the record; paints closer than `MERGE_DE` are merged, k-means samples by detail so flat backgrounds don't eat the palette) → `public/p/<slug>/`: `image.jpg` (3000 px long side, the texture the retouch reveals), `thumb.jpg`, `<level>.bin` (region map 1600 px long side, RLE u16 pairs), `<level>.json` (palette dark→light, regions `c,x,y,r,a,b`), and `public/p/catalog.json` (with content hashes `v`; the game appends `?v=` so the SW's data cache never serves stale files). Review images in `work/<slug>/review.jpg` — **look at them** after building.
- World units in the game = region-map pixels, y down.

## Code map

- `src/data.ts` — catalog + level loading (RLE decode, regions per paint).
- `src/render/renderer.ts` — `Renderer` (wall → frame → painting → numbers → sprites) and `PaintingGL` (textures of one painting: image mipmapped, region ids `R16UI`, per-region info `RGBA32F` 2 texels/region `[paint, t0, tx, ty] [maxR, dur]`, palette, number instances, the `DirtSim`).
- `src/render/shaders.ts` — `PAINT_FS` is the heart: ghost (faded, flaking state) vs original mixed per region by the reveal (4 region texels sampled for smooth borders, streaky brush front from the touch point), outlines from the bilinear "same region" field (constant screen width), selected-paint hatching, dirt layers (varnish, grime + drips, raised spots, dust, cobwebs), solvent wet sheen, light sweeps. `FRAME_FS` mitered molding profile. `DIRT_*` the dirt sim.
- `src/render/dirt.ts` — dirt on the GPU: RGBA16F (dust, grime, varnish, spots) at half the region resolution + fx (wet, glint), ping-pong MRT step per stroke piece, tile dissolves, 16×16 cell read-back for progress, half-res snapshot for saves.
- `src/game/repairs.ts` — objects on the canvas cleaned with their own tools: dried bird droppings (spatula: hold, cracks, pop) and tears (needle: 24 stitch cells per tear, then it closes into a gesso seam the retouch covers). Drawn by `PAINT_FS` from uniform arrays filled in `Studio.fillRepairs()`.
- `src/game/loupe.ts` — deep zoom: when the camera rests zoomed past the base texture, fetches the visible region from the painting's IIIF service at scan resolution into `PaintingGL.detail`.
- `src/game/cleaning.ts` — tools (brush: dust; swab: grime + varnish, also dust slower; scalpel: spots; 4 spatula / 5 needle go to `Repairs`), difficulty dirt presets (`DIRT`), tiles that finish themselves with a bell when <10% left, layer completion, tool suggestions, particles.
- `src/game/retouch.ts` — paint selection, tap / drag across fields of the selected paint, forgiving nearby hit, wrong-paint feedback, paint completion → next paint, hint cycling (smallest fields first).
- `src/game/studio.ts` — one painting: phases `intro → clean → toRetouch (sweep, outlines grow from the centre, numbers fade in) → retouch → finale`, scene state, input routing, saves.
- `src/game/input.ts` — Pencil draws; after a pen is seen fingers only pan/zoom (touches ignored while the pen is down, palm-sized touches ignored); without a pen one finger draws (held 90 ms so a second finger cancels it), two fingers pan/zoom; mouse left draws, right/middle/space-drag pans, wheel zooms.
- `src/game/camera.ts` — centre + zoom, UI insets, fling, fly-to.
- `src/game/save.ts` — `konserwator.work.v1` (per painting: stage, tiles, painted order), `konserwator.done.v1`, `konserwator.prefs.v1`; dirt snapshot in IndexedDB `dirt:<slug>`.
- `src/audio/audio.ts` — all synthesized: scrub noise per tool (speed + dirt under the tool), bells (pentatonic) per cleaned tile, chords, wet dab per paint, ticks.
- `src/ui/ui.ts`, `src/ui/icons.ts`, `src/style.css` — DOM: studio menu, commission card with level choice, HUD (stage + progress, peek eye, fit, sound, menu with the test skip), tool dock, palette, toasts, tool cursor, hint ring, finale card.

## Offline / PWA

`dist/sw.js` from `src/sw.template.js` (plugin in `vite.config.ts`): precaches the app shell, the catalog and thumbnails; painting files are cached the first time they're opened (`konserwator-data` cache, kept across versions). Catalog is network-first.

## Rules that bite

- The full-screen triangle's `v_uv = p` (not `p * 0.5`) — a wrong mapping zooms the dirt sim every step.
- Region ids are integers: `R16UI` + `texelFetch`, NEAREST. Image upload with `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`.
- Hidden screens must not catch taps: `.screen` uses `visibility: hidden` when not `.show`.
- The browser pane may be hidden: rAF stops. Use `__k.tick()` and `__k.shot()` for checks.

## Verifying

Typecheck, build, open `#p=mleczarka/sredni/fresh`, run strokes with `__k.zig`, look at `__k.shot()` images; check the DOM with a normal screenshot. Commit messages in Polish.
