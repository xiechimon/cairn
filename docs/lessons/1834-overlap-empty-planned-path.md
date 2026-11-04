---
Category: An empty planned path silently skipped same-file PR detection
Source: #1834 (2026-10-26)
Level: 2
Safeguard: `scripts/github-overlap.test.mjs` requires rejection before any GitHub request when a planned path is blank
Intercepts: 1
Recurrences: 0
Notes: Negative control: the empty-path case reported Missing expected rejection before validation; all 10 script cases pass after rejecting empty planned paths
---
