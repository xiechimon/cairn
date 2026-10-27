---
Category: Acceptance claims relied on a grading module that no non-test path could reach
Source: Issue #1985 (2026-10-27)
Level: 2
Safeguard: grade.mts is the routing grading entry and the boundary-check harness drives executeBounded and gradeBoundedRun end to end, exiting nonzero when any control breaks
Intercepts: 1
Recurrences: 0
Notes: The harness failed closed during development when its oracle control could not run; the model runner stays out of scope and open PR #2014 imports gradeBoundedRun from ./grade.mts to replace its lexical outOfWorkdirReads inspection
---
