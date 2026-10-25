---
Category: `prepush.mjs` and `e2e-affected.mjs` gained a new import of `heavy-slots.mjs`, but the copy-script-into-a-scratch-repo tests did not copy the new file, so the copied-repo cases in `reach.test.mjs` (wired into prepush by #1653) and `prepush.test.mjs` went red
Source: #1628 (2026-10-25)
Level: 2
Safeguard: the copy-script tests now also copy `scripts/heavy-slots.mjs`; the copied-repo cases are themselves the gate — `node --test` goes red when a script gains an import the copy list does not follow
Intercepts: 1
Recurrences: 0
Notes: negative control: removing heavy-slots from the copy list gave ERR_MODULE_NOT_FOUND, all 36 green after adding it; the list is still hand-written, so the next import growth is found by these cases, not derived automatically
---
