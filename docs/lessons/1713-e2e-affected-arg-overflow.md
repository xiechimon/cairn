---
Category: `pnpm prepush` handed every changed path to `e2e:affected`; a 3,216-file evidence prune overflowed the argument list (`Argument list too long`)
Source: #1713 push (2026-10-25)
Level: 2
Safeguard: `scripts/prepush.mjs` passes only non-docs paths to `e2e:affected`; `scripts/prepush.test.mjs` plans 5,000 evidence paths and expects only the code path; negative control: the test fails on the old plan
Intercepts: 0
Recurrences: 0
Notes: 
---

