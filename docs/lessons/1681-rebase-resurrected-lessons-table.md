---
Category: Rebasing onto the lessons split resolved the modify/delete conflict by keeping the whole deleted `docs/lessons.md`, so the prepush ledger gate went red on a file main had removed
Source: #1681 CI triage (2026-10-27)
Level: 2
Safeguard: `scripts/lessons-ledger-gate.mjs` fails while `docs/lessons.md` exists; resolve the conflict by deleting the table and porting added rows to `docs/lessons/<ticket>-<short-name>.md`
Intercepts: 1
Recurrences: 0
Notes: Negative control: the resurrected table made the gate exit 1 with the split warning on this branch; deleting the file and porting the two rows as per-entry files turned the gate and its self-tests green
---
