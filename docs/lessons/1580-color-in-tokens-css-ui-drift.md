---
Category: New color values went into tokens.css while the ui-drift gate ran only in CI, going red only after the push
Source: PR #1580 (2026-10-23)
Level: 2
Safeguard: `scripts/prepush.mjs` shares its list and now includes `ui-drift-gate.mjs`; local pre-push and CI (`pnpm prepush --ci`) use the same entry, pinned by `scripts/prepush.test.mjs`
Intercepts: 0
Recurrences: 0
Notes: Negative control: the first version of #1580's tokens.css with four hex lines goes red (G2) under the gate, green after moving them into shadcn.css
---
