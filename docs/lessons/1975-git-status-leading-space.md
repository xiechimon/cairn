---
Category: Trimming Git porcelain output rejected updates to an existing result file
Source: Issue #1975 (2026-10-27)
Level: 2
Safeguard: The worker publication tests exercise both added and modified result files against a real bare remote
Intercepts: 1
Recurrences: 0
Notes: The existing-result negative control failed with trim and passed with trimEnd; leading status columns are preserved
---
