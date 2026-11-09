# Thread-tag retirement: source audit and migration design

Status: approved by the orchestrator in the task owner's direct session. Issue: [#3481](https://github.com/xiechimon/cairn/issues/3481).

## Evidence and scope

The source audited is `origin/main` at `0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16`. This is removal of an existing capability, not a borrowed product mechanism; the primary source is Cairn's main branch. No external product behavior is proposed.

| Source | Observed behavior | Retirement consequence | Evidence |
| --- | --- | --- | --- |
| Cairn project routes and startup | Observed: project creation and startup seed six fixed categories; GET/POST project tags expose the shared table. | Remove both seed paths and the generic tag routes. | [routes-projects.ts](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/routes-projects.ts), [index.ts](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/index.ts) |
| Cairn GitHub issue import | Observed: repository labels and issue-label associations also occupy `tag` and `todo_tag`. Repository labels absent upstream are deliberately retained locally. | A blanket DROP or DELETE would lose out-of-scope data. Preserve names, colors, ids and associations in dedicated GitHub-label tables. | [github-issues.ts](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/services/github-issues.ts), [tags.ts](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/services/tags.ts) |
| Cairn orchestration and correction | Observed: an imported issue's `bug` label selects the bug workflow; any linked case-insensitive `correction` category activates the correction completion guard. | Preserve GitHub routing and snapshot existing correction classification before removing generic tags. | [orchestrate.ts](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/services/orchestrate.ts), [correction.ts](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/services/correction.ts) |

Recommendation (inference from the observed shared storage): migrate the two unrelated classifications explicitly, then retire the generic thread-tag model. Merely hiding the tab or deleting fixed-vocabulary seeding would not satisfy the issue.

## State and transitions

- Before: projects have generic tags, todos have tag associations, and tags can affect correction or GitHub routing.
- Migration: within one SQLite migration transaction, copy all tag rows belonging to GitHub projects into `github_label`, and their associations into `todo_github_label`, preserving ids and all metadata. Also preserve associations from imported GitHub issues even if their project binding has since changed. Copy all associated vocabulary required to keep those associations valid.
- Before dropping the old tables, snapshot every todo classified as correction into an internal `correctionRequired` boolean. GitHub `correction` labels continue to activate the same guard after migration.
- After: generic `tag` / `todo_tag`, tag record registration, `tagIds` public fields and generic tag mutation inputs no longer exist. Ordinary threads retain their ids, titles, specs, phases, histories, decisions and builds. Dedicated GitHub label records and `githubLabelIds` remain available for GitHub classification only.
- Future local/plain/hosted project creation and startup never recreate categories. The ordinary `set_task_meta` tool only names the task. The GitHub-specific tool continues to use repository label vocabulary and preserves the final-title restriction on imported issues.

## Read/write inventory and proof contract

Each row requires a targeted regression before its implementation is accepted.

| Path | Expected behavior after retirement | Test coverage |
| --- | --- | --- |
| Existing database upgrade, fresh boot and repeated boot | Old generic tables absent; GitHub metadata and associations preserved; correction membership preserved; all unrelated task/build data unchanged; second boot does not recreate categories. | New migration regression, including mixed GitHub/local projects and moved imported issues. |
| REST and Coordinator project creation; startup backfill | No fixed categories created on any path. | Project creation and fresh/repeated boot regressions. |
| GET/POST `/api/projects/:id/tags` | Both routes absent, including for GitHub projects. | `thread-tags-retirement.test.ts`. |
| REST create/patch todo; Coordinator `update_todo`; MCP `update_todo` | No generic tag assignment parameter; stale calls cannot mutate labels or correction classification. | Schema, REST, Coordinator and MCP regressions; strict rejection of stale mutation fields. |
| Todo projection, web mapper, fixtures and shared record registry | No generic `tagIds` or `tag` record; GitHub labels have their own named representation. | Todo API contract, shared schema snapshots and mapper tests. |
| Worker claim, daemon prompt and relay | Ordinary task naming remains; no fixed categories are advertised or assigned. GitHub vocabulary, multi-label assignment and title-final behavior remain. | Updated task-meta tests in shared/server/daemon, plus existing GitHub issue tests. |
| GitHub issue list/import, label sync and orchestration | Labels display and import unchanged; `bug` routing remains; ids, colors and associations survive upgrade. | GitHub issue, orchestration-source and migration tests. |
| Correction classification and completion guard | Existing correction tasks still require evidence for the delivered head; ordinary tasks remain ordinary. | Correction gate binding and loop-feedback regressions, including migration. |
| Project moves and deletion | Moves retain current classification-reset behavior without leaving dangling associations; deletion cascades dedicated GitHub labels only within the deleted project. | Existing project-move tests adapted to dedicated labels; migration foreign-key check. |
| Project settings, unused tag hooks, fixture scenarios, gallery and translations | No thread-tag tab, controls, queries or category-only fixtures. GitHub label chips remain. Status tags and git release tags remain untouched. | Targeted settings/issue-list e2e and reference-versus-live comparison. |
| Feature map, verification registry, recipes and current specs | Retired capability has no active registration or instructions; keep immutable migration history and historical verification evidence. Preserve the untitled-task behavior documented alongside the old category feature. | Regenerate feature maps; registry, spec parser and retirement reference audit. |

## Failure behavior and rollout

A failed database migration rolls back instead of dropping partially copied data. Missing project provenance must not cause a label attached to an imported issue to be discarded. Duplicate names retain distinct existing ids; do not deduplicate by name during the migration. Run `PRAGMA foreign_key_check` after the upgrade in the regression and isolated runtime probe.

Old callers that send generic tag mutations receive an explicit validation error; generic tag routes return 404. Coordinate server and daemon deployment because stale ordinary-task prompts may still call the removed tag argument. Naming without a category remains supported. Do not contact the live instance with writes.

This is a one-way data deletion for ordinary thread categories. Rollback requires a pre-migration database backup; reverting code alone cannot restore deleted assignments. The PR must carry `coordinator-hold` because the migration and MCP/machine entry paths require protected-path handling. Do not use the closing commit keyword until the entire removal is implemented and verified.

## Decisions and ordered delivery

| Decision | Owner | Outcome |
| --- | --- | --- |
| Migration boundary | Orchestrator, direct task session | Approved: dedicated GitHub-label storage, an internal preserved correction flag, then generic thread-tag retirement. |
| Review size | Implementation lane | Deliver independent ordered PRs, each based on main after the preceding PR merges. First isolate correction classification so later label-data deletion cannot bypass its guard; then isolate GitHub labels; then retire generic runtime paths and their remaining documentation/registry consumers. |

The first segment keeps the existing category assignment paths synchronized with the internal correction flag until their replacement lands. It removes the guard's dependency on the generic join, snapshots existing membership in a transaction, and sets the flag for newly imported correction issues. It does not close #3481; only the final segment does.
