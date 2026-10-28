---
Category: Complete third-party overlap bodies could exceed the chief context budget
Source: PR #1848 and issue #1834 (2026-10-28)
Level: 2
Safeguard: A pre-repair control requires oversized reports to fail explicitly; report and page-data budgets reject instead of silently truncating bodies
Intercepts: 0
Recurrences: 0
Notes: With valid search responses and no irrelevant file lookup, the pre-repair control returns success and fails because no error exists. The repaired control passes. A separate control rejects unused metadata before projection; projection retains complete candidate bodies and reduces the real lookup from 69,648 to 29,189 compact bytes. The fixture was narrowed before the source repair so an unrelated malformed file response could not serve as a false negative control.
---
