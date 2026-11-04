---
Category: `prepush.mjs` and `e2e-affected.mjs` gained a new import of `heavy-slots.mjs`, but the copy-scripts-into-a-fixture-repo tests did not carry the new file, so the copied-repo cases for the `reach.test.mjs` and `prepush.test.mjs` wired in by #1653 went red
Source: #1628 (2026-10-25)
Level: 2
Safeguard: The copy-scripts tests now carry `scripts/heavy-slots.mjs`; the copied-repo cases are themselves the gate — when a script gains an import and the manifest does not follow, `node --test` goes red
Intercepts: 1
Recurrences: 0
Notes: Negative control: dropping heavy-slots from the copy manifest gives `ERR_MODULE_NOT_FOUND`, all 36 green after adding it; the manifest is still hand-written, so future new imports are found by these cases, not auto-derived
---
