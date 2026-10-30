---
Category: Moving ancestry checks to a read-only API removed deployment object fetching
Source: Ticket 1408 (2026-10-30)
Level: 2
Safeguard: Deployment fetches after the gate and a fixture requires fetch before release worktree creation while check fixtures reject tool writes
Intercepts: 0
Recurrences: 0
Notes: fetch-red.log captures the missing-fetch regression. The gate remains read-only and deploy retains responsibility for obtaining release objects.
---
