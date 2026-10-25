---
Category: After changing the board column styles only the board-dnd spec was run; the first fix broke the cds-board "columns still, no radius" assertion, and digging found that board.tsx's e2e:affected family table did not include cds-board and 3 other board specs at all, so prepush could not catch it either
Source: drag-column square-corner fix (2026-10-24)
Level: 2
Safeguard: the BOARD family in `scripts/e2e-affected.mjs` gained cds-board / paper-board- / paper-card / quota-wait-board
Intercepts: 0
Recurrences: 0
Notes: negative control: `--dry-run -- apps/web/src/board/board.tsx` selected 0 of these 4 specs with the old table and 4 with the new one; `--check-coverage` still reported 32 specs without a family; pending upgrade: #1599 fills in the rest and wires the coverage check into prepush
---
