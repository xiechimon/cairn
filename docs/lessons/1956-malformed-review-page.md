---
Category: A malformed GitHub review page crashed the weekly report instead of disclosing unavailable evidence
Source: Issue 1956 (2026-10-28)
Level: 2
Safeguard: CLI regression fixtures supply null records for both review and gate pages and assert unknown classification with unavailable totals
Intercepts: 0
Recurrences: 0
Notes: The test failed with a null state dereference before implementation; response-page validation now rejects non-object records before classification
---
