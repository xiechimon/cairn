---
Category: An isolated-main Vitest comparison used `--root` from the lane directory and collected no tests
Source: #1782 CI triage (2026-10-26)
Level: 2
Safeguard: Vitest exits nonzero when no tests are collected; run the comparison with its working directory set to the extracted main tree and verify the collected test counts
Intercepts: 0
Recurrences: 0
Notes: Negative control: the original invocation reported no test files; setting the working directory collected 14 tests and reproduced the roster failure on main.
---

