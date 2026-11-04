---
Category: Historical JSON fixtures loaded in Vitest but lacked the import attribute required by NodeNext
Source: Issue #1783 (2026-10-27)
Level: 2
Safeguard: The server TypeScript check requires JSON import attributes in regression tests
Intercepts: 2
Recurrences: 0
Notes: Both historical fixture imports now specify type json; runtime test success alone does not establish NodeNext compatibility
---
