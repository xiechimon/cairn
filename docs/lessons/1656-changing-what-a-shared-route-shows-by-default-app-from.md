---
Category: Changing what a shared route shows by default (`/app` from the board to home) was checked against specs found by grepping `goto(` lines; 57 cases in 19 specs reached the board through URL constants (`const BOARD = '/app?scenario=01'`), a sidebar label key went dead, and both were caught only by `e2e:affected` and `pnpm prepush`
Source: home PR (2026-10-26)
Level: 2
Safeguard: `e2e:affected` falls back to the full suite for shared surfaces and the i18n liveness test reds dead keys; before changing a route default, grep `/app` across `apps/web/e2e` and `integration/test` (CI caught four integration browser tests the local run had missed) including constants and template strings, not only `goto(` lines
Intercepts: 1
Recurrences: 0
Notes: Negative control is this run: 57 red before the URL constants carried `view=board`, green after
---
