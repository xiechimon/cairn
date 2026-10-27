---
Category: The in-product merge-gate test created the project with the default `human` merge policy, so the first evaluation blocked `policy-human` before the scenario's own assertions
Source: #1794 CI (2026-10-26)
Level: 2
Safeguard: `merge-gate-product.test.ts` seeds the project with `mergePolicy: 'autonomous'`, the policy the gate product run assumes
Intercepts: 1
Recurrences: 0
Notes: Negative control: the committed `postProject(s.app, 'gate')` reds `expected true to be false` at the `policy-human` check; the autonomous seed passes
---
