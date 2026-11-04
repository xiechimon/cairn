---
Category: A merge request used a manually entered commit id that did not match the current PR head
Source: PR #1906 and PR #1776 review (2026-10-28)
Level: 2
Safeguard: Derive the full argument with git rev-parse HEAD in the candidate checkout and retain GitHub match-head-commit validation
Intercepts: 2
Recurrences: 1
Notes: GitHub rejected both mismatched inputs without merging; the corrected command reads the revision directly instead of reconstructing it from a shortened display
---
