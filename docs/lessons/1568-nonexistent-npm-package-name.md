---
Category: The website and docs named an npm package that does not exist (`npx @xiechimon/cairn` returns 404); visitors copying it hit an error directly
Source: PR #1568 (2026-10-23)
Level: 2
Safeguard: `scripts/npm-command-gate.mjs` checks in CI the package names used with npx / npm i in the README, site/, and the web UI; an npm 404 goes red
Intercepts: 0
Recurrences: 0
Notes: Negative control: running the gate on a site/index.html containing `npx @xiechimon/cairn` is red, green after reverting to `@xiechimon/pacman`; the gate's first version also missed site/ root files in its pathspec, found by this same negative control
---
