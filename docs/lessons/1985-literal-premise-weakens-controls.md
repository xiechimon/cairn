---
Category: Controls asserted outcomes from literal premises instead of real executions
Source: Issue #1985 (2026-10-27)
Level: 2
Safeguard: Grading controls derive oraclePass from a real oracle execution, simulate kernel Landlock absence through the ABI override, and the red log records the pre-fix failures of the final assertions
Intercepts: 1
Recurrences: 0
Notes: The unavailable-helper cases keep oraclePass as a stated premise because no oracle can run there; selfcheck-red.log replaces the earlier red evidence that was recorded against weaker assertions
---
