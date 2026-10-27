---
Category: Model roster assigned a hosted GLM model to Mistral, allowing two spellings of GLM to count as independent reviewers
Source: #1855 (2026-10-26)
Level: 2
Safeguard: Roster generation recognizes GLM maker identities before provider defaults and derives spelling aliases; the roster regression test checks maker ownership and independence
Intercepts: 1
Recurrences: 0
Notes: Negative control: the regression fails with Mistral ownership before the fix; installed-catalog snapshot and independence cases pass after it
---
