# Issue #1949 verification

Closes fixture-directory leaks in `bootServer`, `bootRealServer`, and chief model homes by routing allocations through `makeTestTempDir`, releasing owned dirs on dispose/close (including startup failure and Vitest `onTestFinished` fallback), and removing attachments, skill-sources, and fixture-owned MCP config from integration close after the HTTP server has finished closing.

## Artifacts

- `server-lifecycle-red.log`: failing lifecycle cases on the old helpers (startup leak + missing `cairn-test-<runId>-` fallback ownership).
- `integration-lifecycle-red.log`: failing close coverage (attachments/skill-sources survive; ordering; twenty-cycle leftovers).
- `server-lifecycle-green.log` / `integration-lifecycle-green.log`: the same suites after the fix.
- `server-chief-green.log`: chief suite plus lifecycle (119 passed).
- `lint.log` / `typecheck.log`: required gates.
- `tmpdir-counts.txt`: `cairn-test-` entry counts before and after the focused server lifecycle run (both 0).

## Limits

Evidence is fixture/stub lifecycle only. No live provider, daemon, or full e2e suite. Remaining one-off allocations and CI sweep enforcement stay in #1951 / #1954.
