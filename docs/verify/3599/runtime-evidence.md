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
