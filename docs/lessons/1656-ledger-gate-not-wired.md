---
Category: The ledger gate was only mentioned in the retro skill text and never wired into prepush or CI, so a bad entry on main (a note saying "pending upgrade" without a ticket number) sat undetected until the migration validation found it while splitting the ledger
Source: #1656 (2026-10-25)
Level: 2
Safeguard: `scripts/lessons-ledger-gate.mjs` is in the required checks of `scripts/prepush.mjs` (shared by local pre-push and CI `pnpm prepush --ci`), and a docs-only push touching `docs/lessons/` entries also runs it; pinned by `scripts/prepush.test.mjs`
Intercepts: 1
Recurrences: 0
Notes: negative control: the old gate running against the old table reported "pending upgrade must carry a ticket number" red on the row "new web source missing from e2e-affected" (the old table was already on main) and turned green after filling in #1599; the real-bad-entry case in `scripts/lessons-ledger-gate.test.mjs` keeps the original text
---
