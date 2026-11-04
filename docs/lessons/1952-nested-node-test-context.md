---
Category: Nested node test runners inherited a context that skipped assertions
Source: Issue #1952 (2026-10-27)
Level: 2
Safeguard: The runner propagation test clears NODE_TEST_CONTEXT and requires both a failing exit code and the assertion title in stdout
Intercepts: 1
Recurrences: 0
Notes: The inherited context returned zero for a deliberately failing assertion; clearing it makes both local and CI plan probes execute and fail as expected
---
