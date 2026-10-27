---
Category: Screenshots sent to ian showed the phone needs-you row cutting its title with an ellipsis and running cards with only a faint breathing icon; ian caught both, not a check
Source: ui/claude-shell (2026-10-25)
Level: 2
Safeguard: `e2e/board-shell.spec.ts` fails when a 390px needs-you title overflows or its actions leave the row; `e2e/paper-card.spec.ts` and `board-queued-column.spec.ts` require the running footer icon to have `animation-name: spin`
Intercepts: 0
Recurrences: 0
Notes: Negative control: with `truncate` restored the title spec reports `clipped: true`; the old breathing icon reports `card-breath` instead of `spin`
---

