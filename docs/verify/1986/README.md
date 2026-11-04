# Routing session enforcement

The programmatic runner uses the existing daemon backend and the #1985 execution boundary. No CLI, resumable execution, aggregate reporting, backend behavior, benchmark, or oracle changes are included.

## Failure modes considered before implementation

- Planner write, edit, redirection, and programmatic shell writes alter task files.
- Planner reads executor data or external answers through a file tool or shell.
- Executor external reads reach the model before a later replay detects them.
- File tools follow symlinks outside the task workspace, including allowed runtime resources.
- Planner implementation survives handoff and lets an idle executor pass.
- Empty plans, provider errors, model lookup failures, and timeouts lose failure attribution or become successful runs.
- Handoff leaks planner tool history or loses the original task, clean seeds, usage, or duration.

## Enforcement

Both roles use local tool definitions supplied through `SessionOpts.localTools`. Planner write, edit, and all shell execution are rejected before execution. The planner inspects seeded files using the read tool. Disabling shell execution avoids treating an incomplete shell command blacklist as a read-only security boundary.

Permitted file operations and executor shell commands execute inside `executeBounded` at tool execution time. File tools additionally check workspace containment and canonical ancestor paths, so runtime resource allowances cannot authorize explicit task-data reads. The runner grades the actual executions from both roles and preserves denied attempts even when a session errors or emits an empty plan. Executor tools are never replayed after execution.

Planner and executor use separate seeded task directories and fresh backend sessions. Only emitted plan text is added to the original executor task. Existing separate usage and duration fields remain attributable, including session creation failures.

## Measured evidence

- `red-planner-write.log`: before enforcement, a planner Node command changed the seeded implementation to `planner changed this`.
- `red-session-creation.log`: an unknown executor model escaped as an exception instead of a failed result.
- `red-runtime-read.log`: an explicit external read used a runtime allowance and incorrectly received `pass`.
- `related.log`: 84 tests passed across sessions, driver, boundary, and benchmark suites.
- `prepush-vitest.log`: the required changed-test runner passed all 31 selected tests, including the new session suite.

The stub relay assertions inspect actual model requests and denied tool responses. They verify unchanged planner files, fresh executor seeds, original task and plan handoff, absence of external sentinel content, separate token totals, failed oracles for idle executors, and failures despite passing oracles after either role violates the boundary.

## Where the read-only planner guarantee lives

The planner's read-only role rests on two layers, and only the second is in this diff. The tool set that reaches the model comes from `builtinToolNames(readOnly)` in `apps/daemon/src/backend/pi.ts`, which returns a mutating-free builtin list for a read-only session; the runner passes `readOnly: true` for the planner. The eval tree then replaces every tool with a local definition from `sessionTools`, which denies each non-read call before execution and records the denial as graded boundary evidence.

That dependency is asserted, not assumed: `routing-driver.test.ts` pins `builtinToolNames(true)` against `write` and `edit` and denies every non-read tool through `sessionTools`, and the controls in `review-negative-controls.log` include readings that fail when the planner guard is bypassed. The eval tree itself is not published in any package's `files`, so it is run from this workspace tree and resolves the backend at `apps/daemon/src/backend/pi.ts`; running it against an installed bundle is out of scope and would not carry this branch's invariants.

## Red evidence scope

The red logs in this directory are pre-implementation and pre-fix reds: each records the branch's own new test failing before the corresponding change. They are not behavioural reds on `origin/main`, because nothing on `main` runs the routing runner, and the routing runner's sibling modules (`bench.mts`, `boundary.mts`, `grade.mts`) exist only on `main`.

## Compatibility

The existing Linux x86_64, GCC, and Landlock requirements of #1985 still apply; unavailable enforcement fails closed. Recently merged #2014 and #2018 files are unchanged. The pre-edit open-PR inventory contained no overlap with the routing files changed here. The requested open and last-30 merged inventories were repeated before this correction; neither contained an open routing overlap.

## Review corrections

The mutation controls now compare the complete planner and executor implementation files with their seed. The executor-directory read control plants a distinct private payload in the executor directory while the planner is running, then checks the complete denial response. Handoff assertions require exactly a system message and the original user task plus plan, with no planner tool messages or private call ID. The executor read response must equal the complete seeded implementation.

Explicit planner reads of `/etc/passwd` and `/dev/null` already failed the workspace containment check at the start of this correction. New relay controls pin both runtime-allowed paths and require graded denial evidence, rather than relying on raw-file fragments.

Tool denials now produce `BoundaryExecution` records consumed by `gradeBoundedRun`. Result rows retain `planner_boundary` and `executor_boundary`, including raw execution violations and runtime denials; the combined violation list includes both roles even on early session errors. The executor is seeded once, after a nonempty plan, while stale executor data is removed before planning.

Negative controls deliberately append a payload while preserving the stub, replace a denied read with an empty result, and inject seed text into the executor prompt. The strengthened assertions reject all three mutations. A fourth negative control bypasses planner workspace checks and confirms both runtime-allowance read tests fail. Each temporary mutation is removed before the green run.

The review's historical CLI observation is recorded without a CLI change: the current HEAD and `origin/main` trees contain no `integration/eval/routing/run.mts`. This correction changes only the programmatic runner and its evidence. The benchmark and execution-boundary files from #2014 and #2018 remain byte-identical to `origin/main`.

Correction evidence:

- `review-negative-controls.log`: partial-write, empty-read, prompt-leak, and runtime-allowance bypass mutations each fail before restoration.
- `review-related.log`: all 86 routing session, driver, boundary, and benchmark tests pass after the corrections.
- `review-prepush-vitest.log`: the mandatory changed-test runner passes 33 tests.
- `review-gates.log`: lint, full workspace typecheck, spec parse, language, helper, comment, and lessons checks pass.

## Round 1 review-gate corrections

The gate returned BLOCK on `8cdcc936` with two blocking findings. Both are addressed here; the four suggestions in the same review are folded in where they were real defects in these files.

- Lesson entry history. `docs/lessons/1986-relay-wire-assumptions.md` recorded a wrong-role-request-index correction and a trailing-newline mismatch that this branch's diff does not contain. A probe measured a handoff run at three requests with the executor at index 2, and no trailing-newline assertion exists. The entry now claims only what the branch supports.
- Read-only planner guarantee. The guard is not in the eval tree: it is `builtinToolNames(readOnly)` in `apps/daemon/src/backend/pi.ts`, which the runner reaches through the workspace source path. `routing-driver.test.ts` now asserts that the read-only builtin set carries no mutating tool and that `sessionTools` denies every non-read tool, so the dependency is pinned rather than assumed.
- Platform guard. `routing-sessions.test.ts` asserted `pass` and `oracle_pass` without a toolchain guard. Ten cases need real enforcement; all ten now skip when the native toolchain is absent, and the nine sandbox-free cases keep running.
- Planner violation snapshot. `planner_violations` was the same array object as `planner_boundary.violations`. It is now a copy taken after the planner session completes, matching the executor branch.

Round 1 evidence:

- `round1-negative-controls.log`: each finding's control goes red and the same test goes green after restoration.
- `round1-gates.log`: language, comment, helper, lessons, lint, typecheck, and the changed-test runner pass.
