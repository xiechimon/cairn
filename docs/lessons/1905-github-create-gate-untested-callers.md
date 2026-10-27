---
Category: A new file-backed, env-configured seam (`github-create-gate`, 3s default spacing, shared `CAIRN_HOME` state) was adopted by `githubCreateIssue`, but only the two new test files were isolated; existing tests that POST issues through the gate were not enumerated, so ci-loop's reconciliation test timed out deterministically in CI and orchestration-source survived on worker ordering
Source: PR #1905 (2026-10-27)
Level: 2
Safeguard: Every server test file that POSTs through `githubCreateIssue` stubs `CAIRN_HOME` to a temp dir and `CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS` to 0 (github-writeback, github-create-throttle, ci-loop, orchestration-source); negative control: at the branch head the ci-loop reconciliation test times out at 5008ms with the real-home trace in `~/.cairn/github-create/state.json` (5 timestamps, 3s apart), with the stubs the file's 37 tests pass in ~5s
Intercepts: 0
Recurrences: 0
Notes: Level 1 upgrade possible in its own ticket: route the gate through the `bootServer` test seam like `githubFetch` instead of process env, so a test file cannot forget the isolation; grep every consumer of a new process-wide seam before declaring its tests green, not just the files written in the same commit
---

