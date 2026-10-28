---
Category: An unsafe numeric credential timestamp survived parsing but could fail the integer wire schema
Source: #1845 (2026-10-27)
Level: 2
Safeguard: Credential parsing rejects unsafe timestamps with a regression test
Intercepts: 1
Recurrences: 0
Notes: Negative control: docs/verify/1845/unsafe-red.log shows the parser returning an unsafe value
---
