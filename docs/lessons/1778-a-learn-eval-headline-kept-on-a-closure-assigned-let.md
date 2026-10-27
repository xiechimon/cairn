---
Category: A learn-eval headline kept on a closure-assigned let stayed nullable, so spreading it failed typecheck
Source: #1778 (2026-10-26)
Level: 1
Safeguard: `finishedTurn` returns `TurnEvidence` after the null check; `pnpm --filter @cairn/integration typecheck` rejects the spread
Intercepts: 1
Recurrences: 0
Notes: Negative control: spreading `headline` after a null throw reported TS2698 because the closure assignment blocks narrowing. The helper return type spreads cleanly.
---
