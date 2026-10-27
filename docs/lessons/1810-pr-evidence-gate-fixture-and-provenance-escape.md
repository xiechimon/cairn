---
Category: The PR evidence gate rejected `?scenario=` fixtures by substring and only on markdown image targets, so three forms slipped past it: `<img src>` (the scanner dropped the attribute query), an extensionless fixture path (never matched as an image at all) and `?theme=dark&scenario=board` (the substring test ran on the truncated image match); the archive rule likewise only looked for `raw.githubusercontent.com` plus `/docs/verify/` anywhere, so an uploaded `user-images.githubusercontent.com` attachment and another repository's `docs/verify/999/` both passed
Source: #1810, review gate on PR #1870 (2026-10-26)
Level: 2
Safeguard: `scripts/pr-evidence-gate.test.mjs` runs the gate as a subprocess over every evidence form with `PR_EVIDENCE_HTTP_CODE=200` (network out of the picture): fixture rules judge the full attribute URL and its query whatever the extension, archive rules compare repository and issue against `PR_REPO`/`PR_TICKET`, and each rule has a green control beside its red ones
Intercepts: 1
Recurrences: 0
Notes: Negative control is the reviewer's own probe: the 8 cases it measured (HTML fixture, extensionless fixture, second query parameter, external upload, wrong archive issue green before the fix) all red now, and the archived control stays green
---
