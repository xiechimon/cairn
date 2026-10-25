---
Category: A new color value went into tokens.css and the ui-drift gate only ran in CI, so it went red after the push
Source: PR #1580 (2026-10-23)
Level: 2
Safeguard: the shared list in `scripts/prepush.mjs` gained `ui-drift-gate.mjs`, so local pre-push and CI (`pnpm prepush --ci`) use the same entry; pinned by `scripts/prepush.test.mjs`
Intercepts: 0
Recurrences: 0
Notes: negative control: the four hex lines in the first version of #1580's tokens.css went red (G2) under the gate and turned green after moving them into shadcn.css
---
