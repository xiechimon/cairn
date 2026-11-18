# Retire `tag` / `todo_tag` tables and the `tagIds` wire field (#5344, closes #3481)

## Existing state

Tag routes and `services/tags.ts` are already gone. What remains is the
staged-retirement residue:

- `tag` and `todo_tag` tables in `apps/server/src/db/schema.ts`, still read by
  `services/todos.ts` (record projection + `correctionFromTags`) and deleted
  inside `deleteProject`.
- `TodoRecord.tagIds` on the wire (`todoRecordSchema`), populated as `[]` for
  new todos; machine-relay echoes it back from `set_task_meta`.
- `categoryFreeTaskInputSchema` (`{ tagIds: z.never() }.passthrough()`) wrapped
  around `createTodoBodySchema` / `patchTodoBodySchema` and `parseWith`'d in
  `mcp-face` and `coordinator-request`, so `tagIds` currently fails with 400.
- `machine-relay.ts` rejects `tag`/`tags`/`tagIds` params in the local (non
  GitHub) `set_task_meta` form; `tag`/`tags` stay rejected there because they
  are live GitHub-form params, `tagIds` becomes an ordinary ignored key.
- Correction state: `todo.correctionRequired`, set at creation from
  `correctionRequired ?? correctionFromGithubLabels(...)` and recomputed on
  label change or project move. Since the 0139 cutover, no code path writes
  `todo_tag`; only reads remain.
- GitHub labels (`github_label` / `todo_github_label`) are the live mechanism
  and stay untouched.

## Removal

- Migration `0202_retire_tag_tables`: backfill any `todo` row linked to a tag
  named `correction` (case-insensitive) onto `todo.correctionRequired = 1`,
  then `DROP TABLE todo_tag` and `DROP TABLE tag`.
- `services/todos.ts`: drop the `tags` relations query, `tagIds` from the
  record, `correctionFromTags`, the `todoTag` delete on project move, and the
  two `categoryFreeTaskInputSchema` guards. On a label change or project move
  `correctionRequired` recomputes from GitHub labels only; on a move with no
  labels it becomes `0`, same as today.
- `services/projects.ts`: drop `tx.delete(tag)` from `deleteProject`.
- `services/machine-relay.ts`: drop `tagIds` from the local-form reject list
  and from the `set_task_meta` response.
- `services/mcp-face.ts`, `services/coordinator-request.ts`: drop the
  `categoryFreeTaskInputSchema` guards.
- `routes-helpers.ts`, `records/todo.ts`: unwrap `patchTodoBodySchema` and
  `createTodoBodySchema` into plain objects; remove `tagIds` from
  `todoRecordSchema`.
- `packages/shared/src/task-input.ts`: delete (its only export is removed).
- `packages/shared/src/tables.ts`: drop `tag`, `todo_tag` from `DB_TABLES` and
  `todo_tag` from `JOIN_ONLY_TABLES`.
- `apps/web/src/api/mappers.ts` + fixtures/e2e: remove `tagIds` fields.
- `CONTEXT.md`: update the Tag row — backend tables and wire field are gone.
- Feature map: remove the `thread-tags` entry and `features/tags.md`.

## Behavior change

`tagIds` is no longer a recognized key anywhere. Requests carrying it are
handled like any other unknown field (stripped by zod object schemas, ignored
by passthrough inputs) instead of a dedicated 400. The retired-input
rejection contract in `category-assignment-retirement.test.ts` and
`wire.test.ts` retires with it; the MCP/tool schema assertions that `tagIds`
is not offered stay.

## Migration and upgrade behavior

The backfill runs inside the migration transaction before the drops, so a
failed backfill rolls back cleanly and the tables remain. Rows already
classified by the 0139 migration are unaffected (the backfill only sets
`correctionRequired = 1`, never clears it). `github_label`,
`todo_github_label` and all other tables are untouched. Fresh installs never
create the tables; upgrades drop them.

## Failure / rollback

- Backfill failure → migration transaction aborts, server refuses to boot
  with the same error as any failed migration; no partial state.
- Rollback to a pre-0202 server is not supported after the migration runs
  (same contract as every table drop this cycle); the deploy flow's backup
  covers restore.
- `todo_tag` had `ON DELETE CASCADE` from `todo` and `tag`; dropping both
  tables leaves no orphaned references.

## Replacement

GitHub labels remain the only label vocabulary. Correction tasks are flagged
solely by `todo.correctionRequired` (written by github-label classification
or the backfill) and enforced by `isCorrectionTask` / `assertCorrectionDone`.
The dedicated tag surface is superseded by those paths; no new UI or API is
introduced.
