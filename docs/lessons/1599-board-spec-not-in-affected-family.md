---
Category: After changing board column styles only the board-dnd spec was run, and the first fix broke cds-board's "columns at rest have no rounded corners" assertion; digging in showed the e2e:affected family table for board.tsx did not include cds-board and 3 other board specs, so prepush could not catch it either
Source: drag column square-corner fix (2026-10-24)
Level: 2
Safeguard: `scripts/e2e-affected.mjs` BOARD family adds cds-board / paper-board- / paper-card / quota-wait-board
Intercepts: 0
Recurrences: 0
Notes: Negative control: `--dry-run -- apps/web/src/board/board.tsx` selects 0 of these 4 with the old table and 4 with the new one; `--check-coverage` still reports 32 specs without a family, to be raised: #1599 completes it and wires the coverage check into prepush
---
