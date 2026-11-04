---
Category: A dispatched implementer reported "affected e2e passed" but never ran `pnpm prepush`; the push hook then failed on `ui-debt-gate` (bare `<button>`), `ui-drift-gate` (unregistered brand ink) and `single-use-helper-gate`
Source: ui/claude-shell (2026-10-25)
Level: 2
Safeguard: The pre-push hook already blocks the push; dispatch briefs for this repo end with `PREPUSH_BASE_SHA=origin/main pnpm prepush` and "must end with [prepush] PASS"
Intercepts: 0
Recurrences: 0
Notes: The hook output on the first push attempt is the control
---
