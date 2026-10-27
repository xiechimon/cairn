---
Category: `single-use-helper-gate` diffed a moved file against nothing, so every helper in `src/overlays/*` counted as newly added when the folder merged into `src/overlay/`
Source: overlay folder merge (2026-10-26)
Level: 2
Safeguard: `scripts/single-use-helper-gate.mjs` diffs renamed files against their old path (`-M`); `scripts/single-use-helper-gate.test.mjs` moves a file with a helper and expects green; negative control: the test fails on the old gate
Intercepts: 0
Recurrences: 0
Notes: 
---

