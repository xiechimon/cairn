---
Category: An archive limit test initially put its output repository inside its source directory
Source: Issue #1783 (2026-10-27)
Level: 2
Safeguard: The archive regression uses sibling source and output directories and requires the specific size-limit diagnostic
Intercepts: 1
Recurrences: 0
Notes: The corrected negative control exited successfully before the limit was implemented and now fails with the 5 MiB diagnostic
---
