---
Category: Shared recording policy imports were missing from isolated verification CLI fixtures
Source: Issue #1783 (2026-10-27)
Level: 2
Safeguard: The verification CLI selftest fixture links workspace packages alongside node_modules
Intercepts: 41
Recurrences: 0
Notes: The original isolated fixtures passed 30 of 71 checks after adding the import; the same full selftest verifies the dependency closure
---
