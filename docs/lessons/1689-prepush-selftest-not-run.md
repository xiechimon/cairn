---
Category: A prepush change was pushed after running only its own tests; `scripts/heavy-slots.test.mjs`, which copies `scripts/prepush.mjs` into a fixture repo and runs in the same CI step, went red because the fixture lacked the new gate script
Source: #1689 (2026-10-25)
Level: 2
Safeguard: `prepushPlan` runs the CI self-test files (`selfTests` in `scripts/prepush.mjs`) whenever a prepush, heavy-slots or English-only gate script changes; `scripts/prepush.test.mjs` pins the list to the CI step
Intercepts: 0
Recurrences: 0
Notes: Negative control: the #1689 fixture without `english-only-gate.mjs` fails `scripts/heavy-slots.test.mjs` (CI run 40171261648)
---
