# Konserwator — notes for agents

Browser game (iPad + Apple Pencil first, phone and laptop too): restore old paintings — clean the dirt (PowerWash), retouch by numbers (Happy Color, variant B: a painted field gets the real painting back), then gild the frame and varnish (M2). Vite + TypeScript, raw WebGL2, no engine. Paintings are real Rijksmuseum public-domain scans prepared offline by the Python pipeline in `tools/`; everything else (dirt, frame, sounds, icons) is procedural. Design doc: `docs/PLAN.md` (Polish, milestones M0–M3). Deployed to GitHub Pages from `dist/` by `.github/workflows/pages.yml`. Pattern projects: `~/code/roj`, `~/code/fala` — copy code from there, don't import it.

## Status (read first)

- **M0 done** (repo, pipeline, 3 paintings: Mleczarka, Uliczka, Zagrożony łabędź).
- **M1 pushed 2026-09-27, waiting for the owner's iPad + Pencil test (STOP)**: cleaning (3 tools, 4 layers, self-finishing tiles with bells, layer chords, tool hints), the transition (light sweep, outlines grow from the centre, numbers fade in), retouch variant B (reveal spreads from the touch with a streaky wet front, then a drying gloss), hint ring, peek (hold the eye), save/restore mid-stage, finale with the painting card. All 3 paintings playable on all 3 levels. Don't start M2 until the owner has given M1 feedback.
- Player-facing text Polish; code and comments English; commit messages Polish. Don't wait for the Pages deploy after a push.

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

URL hash: `#p=<slug>/<level>` opens a painting straight away (`/fresh` drops the save), `#skip` skips the cleaning.
Dev helpers on `window.__k`: `studio`, `cam`, `renderer`, `tick(n)` (run n frames synchronously — the browser pane may be hidden and throttle rAF), `shot(name)` (dev server only: renders and saves the canvas to `work/shots/<name>.png`, DOM overlay not included), `stroke(pts, {type, pressure})`, `zig(x0,y0,x1,y1,rows,steps)`, `tap(x,y)`.

## Painting data (pipeline)

- `paintings/<slug>.json` — the record in the repo: Polish `title/author/date/kind`, `story` (fiction: we restore **copies** from imagined collections — never claim the real painting was somewhere it wasn't), `card` (real facts about the original), per-level segmentation overrides `levels.<level>` (`colors`, `work_long`, `min_area`, `min_radius`, `chroma`, `tv`), optional `dirt` (`soot`, `webs`, `spots` multipliers), `source` (from `fetch_rijks.py`: object number, rights, IIIF/Commons URL).
- `tools/fetch_rijks.py` — Rijksmuseum search → Linked Art → rights check (PD mark / CC0 only) → IIIF (or Wikimedia Commons via Wikidata when the record has no image). Downloads to `work/<slug>/source.jpg` (gitignored).
- `tools/segment.py` — TV denoise → k-means in Lab (chroma weighted) → mode filter → connected regions → merge regions too small/thin for a number → smooth upscale → label points (pole of inaccessibility).
- `tools/build.py` → `public/p/<slug>/`: `image.jpg` (3000 px long side, the texture the retouch reveals), `thumb.jpg`, `<level>.bin` (region map 1600 px long side, RLE u16 pairs), `<level>.json` (palette dark→light, regions `c,x,y,r,a,b`), and `public/p/catalog.json`. Review images in `work/<slug>/review.jpg` — **look at them** after building.
- World units in the game = region-map pixels, y down.

## Code map

- `src/data.ts` — catalog + level loading (RLE decode, regions per paint).
- `src/render/renderer.ts` — `Renderer` (wall → frame → painting → numbers → sprites) and `PaintingGL` (textures of one painting: image mipmapped, region ids `R16UI`, per-region info `RGBA32F` 2 texels/region `[paint, t0, tx, ty] [maxR, dur]`, palette, number instances, the `DirtSim`).
- `src/render/shaders.ts` — `PAINT_FS` is the heart: ghost (faded, flaking state) vs original mixed per region by the reveal (4 region texels sampled for smooth borders, streaky brush front from the touch point), outlines from the bilinear "same region" field (constant screen width), selected-paint hatching, dirt layers (varnish, grime + drips, raised spots, dust, cobwebs), solvent wet sheen, light sweeps. `FRAME_FS` mitered molding profile. `DIRT_*` the dirt sim.
- `src/render/dirt.ts` — dirt on the GPU: RGBA16F (dust, grime, varnish, spots) at half the region resolution + fx (wet, glint), ping-pong MRT step per stroke piece, tile dissolves, 16×16 cell read-back for progress, half-res snapshot for saves.
- `src/game/cleaning.ts` — tools (brush: dust; swab: grime + varnish, also dust slower; scalpel: spots), difficulty dirt presets (`DIRT`), tiles that finish themselves with a bell when <10% left, layer completion, tool suggestions, particles.
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
