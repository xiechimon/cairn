---
Category: A deletion parser treated removed content beginning with two dashes as a diff file header, and a rename-only change looked like removal
Source: #1834 (2026-10-26)
Level: 2
Safeguard: `scripts/silent-revert-gate.test.mjs` checks real Git histories for dash-prefixed removals and renames that preserve protected lines
Intercepts: 2
Recurrences: 0
Notes: Negative controls: the dash case reported no removal and the rename-only case reported a false removal; both pass after parsing content only inside hunks and comparing renamed blobs
---
