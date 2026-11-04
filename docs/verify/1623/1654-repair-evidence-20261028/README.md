# Checked split autostart repair evidence

Date: 2026-10-28. Issue #1623, PR #1654.

The tests exercised the repaired working tree based on main `90a7e74c654c323eb9fef58e0b4fc40ba31152c3`. The checkpoint commit containing this archive identifies the source under review. Local checkout paths in terminal output are replaced with `<checkout>`.

## Runtime checks

- `final-targeted.log`: 163 tests pass across 13 server/shared files. This includes the pure checker, the real chief-tool path, team settings HTTP requests, database rows and reseeding, fresh initialization and upgrade from main's migration prefix, existing backfill/migration fixtures, and shared wire snapshots. The full command is below.
- `split-e2e.log`: `E2E_PORT=8498 pnpm --filter @cairn/web exec playwright test e2e/split-autostart.spec.ts --workers=1` passes both cases. Ports 8498 and 8499 were checked unused before the run. The spec boots its own real Hono server and scratch data directory; it serves this checkout's fixture-mode compiled assets without a scenario query. It drives actual machine enrollment, chief tool relay, child claim/completion, a dependency wave, and browser transcript visibility. Default human policy remains at confirm.
- The machine/provider boundary is deterministic: a nonresponsive synthetic gateway is registered, machine protocol operations are performed by the test, and no real provider inference or daemon execution is claimed.
- `typecheck-green.log`, `spec-parse.log`, and `lint.log` record the repository checks. Spec collection parses all 1370 browser tests and 50 integration test files. Lint passes with one pre-existing informational finding in `feishu-config.test.ts`.

```sh
pnpm exec vitest run apps/server/test/todo-split-checker.test.ts apps/server/test/persona-split-verify.test.ts apps/server/test/team-autonomy-pause.test.ts apps/server/test/split-policy-migration.test.ts apps/server/test/feishu-migration.test.ts apps/server/test/token-usage-cost-migration.test.ts apps/server/test/first-pr-report.test.ts apps/server/test/legacy-export.test.ts apps/server/test/machine-concurrency-backfill.test.ts apps/server/test/machine-pin.test.ts apps/server/test/agent-skills-split-backfill.test.ts apps/server/test/agent-tool-backfill.test.ts packages/shared/test/snapshot.test.ts
```

## Negative controls

- `path-red.log`: eight protected or unclear path cases pass the original feature checker incorrectly before the extraction repair. The passing final suite checks bare root filenames, directory mentions including `.github/`, Unicode protected names and unsafe paths.
- `quoted-path-red.log`: two paths containing spaces inside quotes still pass the first tokenization repair. Preserving the complete quoted token turns both cases green.
- `behavior-red.log`: with the original optional pause callback, the real chief tool starts under a persisted team pause; the information-card label is also absent from the parent plan. Both fail before the fixes and pass afterward.
- `migration-red.log`: the fresh and upgrade acceptance cases fail before the migration exists. The final run applies the actual migration to fresh databases and main-version databases, preserves data, checks default values, and reruns migration without overwriting saved settings.

## Scope and remaining acceptance

`splitPolicy` defaults to `human`. This repair does not switch any live project policy. The owner decision to observe shadow behavior before enabling auto remains an operational rollout instruction.

`team.autonomyPaused` persists through the existing team settings endpoint and is read from database truth when a split is approved automatically. Paused teams fall back to confirm with a transcript reason. Missing team state also prevents automatic approval. The unpaused control proves auto can dispatch. This checkpoint does not change manual confirmation, already-running child waves, task claim handling, or the existing merge-policy executor. It does not claim a global shutdown of already-running work.

The generated migration is currently `0063_split_policy`, after main's `0062_feishu_binding`, with a later timestamp and a generated snapshot. Its number must be checked again against main at merge time.

The independent protected-path review required by ADR 0026, remote CI on the delivery head, a SHA-pinned PR-body evidence link, and merging remain outside this local checkpoint. No push or remote mutation was performed.
