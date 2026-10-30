---
Category: Extending the GitHub pull projection left two exact live-fixture expectations missing the new opener fields
Source: Issue #2127 (2026-10-28)
Level: 2
Safeguard: Existing live GitHub response tests compare the complete projected object and now include opener login and account type
Intercepts: 0
Recurrences: 0
Notes: The first prepush-vitest run reported two failures with openerLogin and openerType as unexpected fields. Keep exact equality to catch projection changes rather than weakening these checks to partial matches.
---
