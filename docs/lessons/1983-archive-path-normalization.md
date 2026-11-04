---
Category: Archive validation accepted traversal in the raw URL ref segment
Source: Issue #1983 (2026-10-27)
Level: 2
Safeguard: Archive validation rejects empty and dot segments throughout the decoded path, with an HTTP-200 regression control
Intercepts: 1
Recurrences: 0
Notes: The negative control using a dot-dot ref passed before the fix and fails afterward; encoded traversal is also covered
---
