---
Category: The website and docs named an npm package that does not exist (`npx @xiechimon/cairn` returns 404); visitors copied it and hit the error directly
Source: PR #1568 (2026-10-23)
Level: 2
Safeguard: `scripts/npm-command-gate.mjs` checks the package names used with npx / npm i across README, site/ and the web UI in CI; an npm 404 goes red
Intercepts: 0
Recurrences: 0
Notes: negative control: running the gate against site/index.html containing `npx @xiechimon/cairn` went red and turned green after reverting to `@xiechimon/pacman`; the gate's own first version missed site/ root files in its pathspec, also found by this negative control
---
