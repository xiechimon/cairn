# Workspace runtime regression evidence

Use the targeted commands below to reproduce the root causes and verify their repairs. The base for the red run was origin/main at f568ed3972aa6dccd20312bc5dcece2061dd170b. All fixture memory and identifiers are synthetic. No production runtime content is included.

## Red controls

| Command | Observed result on base |
| --- | --- |
| `pnpm exec vitest run apps/daemon/test/runner-brief.test.ts apps/daemon/test/workspace-commit-staging.test.ts --maxWorkers=4 -t 'runtime guidance reaches|only setup drift skips'` | Two failures: dirty tracked guidance during session opening; `git commit failed (exit 1): empty-step-hook-ran` for setup-only changes |
| `pnpm exec vitest run apps/daemon/test/workspace-pnpm.test.ts --maxWorkers=4` | Real offline install changed lockfile bytes with unchanged package.json; byte equality assertion failed |

The machine's pnpm launcher also changed the environment section of pnpm-lock.yaml during a version-only invocation, adding 25 lines for its own executable package. The task #132 workspace had the inverse 25-line difference and no manifest changes. Both are package-manager bootstrap changes, not worker dependency edits.

## Real execution boundaries

| Boundary | Observation and assertion |
| --- | --- |
| Real Git worktree, runner and workspace manager; fake model/client | An intentional no-op reports success with hasChanges=false, even when a pre-commit hook would reject a commit. Setup drift is excluded first. |
| Real pnpm, offline, scripts disabled | An unchanged manifest plus frozen installation preserves lockfile bytes. Workspace pmOnFail disables automatic version resolution before install dispatch. |
| Real server, daemon, Pi SDK and SQLite; local model stub | POST /api/projects/:project/builds returns 201. The received model request contains repository and runtime guidance. The first real bash tool checks empty porcelain status before editing README.md. After completion AGENTS.md is byte-identical and status is empty. GET /api/builds/:build/usage returns 200 and matches the SQLite usage row. |
| Skills bridge | The model receives the existing catalog and allowed skill body; denied skills remain blocked. File-brief log assertions were removed with the deleted file delivery path. |

## Commands

Run daemon tests and integration tests separately to keep the integration worker's memory isolated. A combined run had a worker SIGKILL; the isolated Pi policy run passed.

```sh
pnpm exec vitest run apps/daemon/test/brief-file.test.ts apps/daemon/test/runner-brief.test.ts apps/daemon/test/workspace-commit-staging.test.ts apps/daemon/test/workspace-pnpm.test.ts apps/daemon/test/git.test.ts --maxWorkers=4
pnpm exec vitest run integration/test/pi-session-policy.test.ts --maxWorkers=4
pnpm exec vitest run integration/test/skills-inject-e2e.test.ts --maxWorkers=4
pnpm lint
pnpm typecheck
pnpm spec:parse
pnpm prepush
```

## Limits

The model is a deterministic local stub. The Claude repository-guidance fallback is covered through the runner seam and pure composer; this verification does not log in to a real Claude account. Existing contaminated workspaces and previously published commits are not rewritten. Historical marker diagnostics and staging exclusion remain in place. Deployment acceptance requires the deployed daemon SHA and a fresh task workspace after merge.


## Review round 1: incomplete prompt bridge migration

Codex cloud review on 6d1947f80 identified an adapter-only guard in the ACP prompt bridge. That guard dropped Gemini runtime guidance after removal of its file carrier. New, load and resume requests all reproduced the loss: the stdio peer received only `new turn`, instead of the description, memory, project instructions and user prompt. Three tests failed before removing the guard; two no-user-prompt controls passed. The bridge now handles Gemini and adapters through one condition, preserving the absence of a user turn on prompt-free continuation. Targeted coverage includes the existing adapter and runner paths as well as all three Gemini entry paths.

The recurrence safeguard is in the codebase: a shared prompt assembly condition, backed by wire-facing ACP regression tests. No thread reply or resolution is performed; findings are answered in one bot PR summary comment per review round.


## CI round 2: prompt boundary and SDK base preservation

Integration shard 1 on 70c32f4b3 exposed two real prompt-set identity mismatches: extraction continued into SDK context after the file-carrier boundary disappeared. A new real-daemon assertion also failed because systemPromptOverride removed the SDK base prompt. Pi now appends the in-memory brief through appendSystemPromptOverride, preserving the SDK base and existing appends. The existing runtime boundary markers delimit the in-memory string only; no workspace file is written. The unchanged eval ruler and all 17 prompt-set/resume and policy tests pass locally. Every other executable CI job passed on 70c32f4b3; the aggregate failed solely because of these two assertions. No review thread was replied to or resolved.


## Pre-approved final pass: legacy context preflight

The owner approved one final push after review round 3. The lifecycle migration finding is fixed by a read-only guard in the runner's common session entry path, before both createSession and continueSession. It scans all six former context filenames across all harnesses, including ACP adapters without a brief composer. A legacy begin marker, including a block truncated by a crash, fails before model start with filenames only and an instruction to recreate the workspace. Existing guidance and worker edits are preserved byte for byte; no cleanup writer is restored.

Negative control: 48 combinations failed before the guard: six carrier names, four backend/channel choices, and new versus continued sessions. The assertions check zero session opens, a named failure, no stale memory in uploaded output, and unchanged file bytes. The fixed P1 Gemini prompt bridge is retained and rechecked. All 99 targeted tests and 19 integration tests passed locally. The real daemon probe created a task from a legacy-contaminated repository, observed its named failure in SQLite, confirmed zero additional model requests, and read back unchanged guidance with empty Git status. Current main was merged with the separately approved lockfile authorization; no dependency was added or changed by the final fix.


## Coordinator-authorized fixture repair (#3671)

The production preparation paths already establish a real directory: repository worktrees are created or reused, read-only exports create their checkout, and the runner creates a bare task directory for steps without a repository. A missing directory after preparation is a broken workspace and must still fail before a harness session opens. The repair therefore changes the eight fake workspace prepare implementations, rather than swallowing filesystem failures in the legacy-context preflight. Each fake now creates its returned checkout; review tests also replace the shared absolute checkout with a directory owned by that individual test.

Red on e0d4311dc: all eight affected suites ran with --maxWorkers=4 and reported 70 failures, 26 passes. Green after fixture repair: the same eight suites plus runner-brief reported 156 passes across nine files. Existing delivery, stop, timeout, credential, branch, review and legacy-context assertions remain intact. This is a test-fixture contract repair; production behavior, dependencies and lockfile are unchanged.
