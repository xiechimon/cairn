---
Category: Only main was fetched before updating an existing PR, so a completed verification push was rejected because the remote PR head was newer
Source: #1847, PR #1929 (2026-10-27)
Level: 2
Safeguard: Normal fast-forward Git pushes reject an outdated local PR history; fetch the explicit remote PR ref before merging main and beginning expensive verification
Intercepts: 1
Recurrences: 0
Notes: Negative control: the push passed all 25 prepush checks, then Git rejected it with fetch first because remote merge 6b7a08750 was missing locally. A normal merge incorporated that head while preserving the exact tested tree hash. No force push or hook bypass was used
---
