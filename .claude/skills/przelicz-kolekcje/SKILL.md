---
name: przelicz-kolekcje
description: Rebuild all paintings' game data after changing the segmentation algorithm or build parameters in tools/ - rebuild, compare field counts, review previews, commit. Use when tools/segment.py or tools/build.py changed or the owner asks to recompute the collection.
---

# Rebuilding the whole collection

1. Note the current numbers: `git show HEAD:public/p/catalog.json | grep -A3 levels` or keep the old catalog around.
2. Rebuild (sources missing in `work/` are downloaded again automatically):

   ```bash
   tools/.venv/bin/python tools/build.py --all
   ```

3. Compare colors / regions per level with the old catalog. Big jumps (±30 %) mean the change affects difficulty — check those paintings first.
4. Look at `work/<slug>/review.jpg` for every painting whose numbers moved (all of them if the algorithm changed visibly). Fix per-painting overrides in `paintings/<slug>.json` where needed and rebuild those (`build.py <slug>`).
5. Saved games keep region ids: a rebuilt level invalidates in-progress retouch saves of that painting. That's acceptable; mention it in the commit message.
6. `npm run build`, commit in Polish (`Przeliczona kolekcja: …`).
