---
Category: Local pre-push on #1706 went red in `single-use-helper-gate` on `scripts/generate-icons.mjs`, a file the branch never touched: the gate (and `baseline-ratchet-gate`) diffed against the moving `origin/main` tip, the same bug #1698 fixed in `comment-discipline-gate`
Source: #1706 (2026-10-25)
Level: 2
Safeguard: Both gates default to `git merge-base origin/main HEAD`; `scripts/prepush.test.mjs` fails on any `scripts/*-gate.mjs` that falls back to a bare `'origin/main'`
Intercepts: 0
Recurrences: 0
Notes: Negative control: restoring the old `single-use-helper-gate.mjs` makes the test report "falls back to the origin/main tip"
---

