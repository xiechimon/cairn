# Legacy categories and title-only worker metadata

The legacy `tag`/`todo_tag` tables and `tagIds` wire fields are removed. Ordinary workers name tasks only. GitHub labels and Git release tags are separate capabilities.

## Sub-features

- Ordinary naming: the first implementation step receives title-only metadata schema/instructions; `tag`/`tags`/`tagIds` arguments are rejected before mutation, including through the real Claude Code SDK host bridge.
- Data removal: the migration backfills `correction` membership into `todo.correctionRequired`, drops `tag`/`todo_tag`, preserves every `todo` row and all `github_label`/`todo_github_label` state, and rolls back on failure.
- Protocol removal: shared records, tool schemas and REST/Coordinator/MCP surfaces expose no `tagIds`; stale `tagIds` arguments are ignored or rejected before writes per surface.
- GitHub label classification: correction membership and the `correction`-name GitHub label drive `correctionRequired` and orchestration bug routing.

## How to get to it (user POV)

Dispatch an ordinary task. Its authenticated machine claims the first implementation step and calls `set_task_meta({title})`. The task title updates; `tag`/`tags` keys fail. Later steps cannot rename sealed owner tasks.

## Driving it with verify-cairn

Preconditions: use an isolated server, an enrolled test machine and a first implementation step. No real model or GitHub account is needed for this contract.

1. Run `apps/server/test/category-assignment-retirement.test.ts`: shared schemas, REST/MCP stale-input handling and published tool catalogs.
2. Run `apps/server/test/category-vocabulary-retirement.test.ts`: absent vocabulary routes, no category seeding and preserved correction rows.
3. Run `apps/server/test/task-meta.test.ts`: claim, naming, stale metadata keys and full-state atomicity for ordinary and sealed-owner tasks.
4. Run `apps/daemon/test/task-meta-prompt.test.ts` and `worker-meta-sdk.test.ts`: title-only prompt/schema and real SDK argument forwarding to canonical validation.
5. Run `apps/server/test/retire-tag-tables-migration.test.ts` and `correction-classification.test.ts`: backfill, table drops, rollback and dedicated-label classification.
6. Run `apps/server/test/github-issues.test.ts` and `github-writeback.test.ts`: dedicated label selection and imported-title finality remain intact.
7. Run `apps/daemon/test/tag-tool.test.ts` and `runner-create-tag.test.ts` for the unrelated Git release tool.

For a complete scoped run, pass the named files explicitly without `--changed`. For the changed subset, put `--changed` last: `vitest run <files> --changed`; otherwise its optional since-ref can consume the first filename. Confirm a non-empty reported test count before calling either run green.

These are automated regressions. Live acceptance additionally drives authenticated claim/metadata HTTP endpoints and real SDK `tools/call` against the isolated server, reading SQLite before/after; record provider mode and limits alongside evidence.

## Gotchas

Generic category vocabulary, seeding/backfill, assignment writers and legacy read/storage compatibility are all removed; `github_label`/`todo_github_label` are the only label state. The local metadata surface still rejects `tag`/`tags` because those names mean GitHub label names on GitHub tasks.

`node .claude/skills/verify-cairn/scripts/vp.mjs drive tags fixed-vocab-untitled` is **stale**, targeting retired board filters/chips. Use current task-creation e2e for placeholder naming instead of forcing this historical category driver. Historical evidence under `docs/verify/309/` is retained.
