# GitHub-label isolation: ordered cutover design

Status: pending coordinator review of the transitional cutover. The overall separation is approved in [the retirement design](thread-tags-retirement-3481.md); correction independence shipped in [#3727](https://github.com/xiechimon/cairn/pull/3727).

## Primary-source audit

Observed on main `33f96e312cbb63ed5d1866931ea92cb5691f6be6`:

| Source | Observed behavior | Consequence |
| --- | --- | --- |
| [tags.ts](https://github.com/xiechimon/cairn/blob/33f96e312cbb63ed5d1866931ea92cb5691f6be6/apps/server/src/services/tags.ts) and [github-issues.ts](https://github.com/xiechimon/cairn/blob/33f96e312cbb63ed5d1866931ea92cb5691f6be6/apps/server/src/services/github-issues.ts) | Repository labels, retained upstream-deleted labels and imported associations share generic category storage. | Preserve ids, project ownership, names, colors, creation times, versions and associations in dedicated tables. |
| [machine-relay.ts](https://github.com/xiechimon/cairn/blob/33f96e312cbb63ed5d1866931ea92cb5691f6be6/apps/server/src/services/machine-relay.ts) and [machine-claim.ts](https://github.com/xiechimon/cairn/blob/33f96e312cbb63ed5d1866931ea92cb5691f6be6/apps/server/src/services/machine-claim.ts) | GitHub metadata resolves repository names through generic tags; naming claims advertise that vocabulary and imported-title finality. | Switch both sides together; keep the existing names-based worker call contract. |
| [orchestrate.ts](https://github.com/xiechimon/cairn/blob/33f96e312cbb63ed5d1866931ea92cb5691f6be6/apps/server/src/services/orchestrate.ts) | Imported `bug` classification reads generic task ids; correction already reads an internal flag. | Route bugs through dedicated labels without weakening correction evidence. |
| [todos.ts](https://github.com/xiechimon/cairn/blob/33f96e312cbb63ed5d1866931ea92cb5691f6be6/apps/server/src/services/todos.ts) and [projects.ts](https://github.com/xiechimon/cairn/blob/33f96e312cbb63ed5d1866931ea92cb5691f6be6/apps/server/src/services/projects.ts) | Task projection, category replacement, project moves and deletion share the same associations. | Inventory all writers before separating ownership. |

Inference: a temporary dual-writable mirror would add ambiguity to correction resets and need another synchronization protocol. The recommendation is one atomic label cutover, while ordinary generic categories remain until the next retirement segment. Drizzle and SQLite supply migrations, foreign keys and transactions; no dependency or hand-written protocol is needed.

## States and transition

Before: `tag` / `todo_tag` contain both categories and GitHub labels. After this segment: ordinary categories still use those tables; GitHub label readers and writers use `github_label` / `todo_github_label` only. Correction continues to use `todo.correctionRequired`.

The migration creates `github_label` with the existing vocabulary fields and project foreign key, plus `todo_github_label` with a composite task/label key and cascading foreign keys. It selects every vocabulary row owned by a GitHub project, plus every row associated with a GitHub-origin task (`github-issue` or `github-issue-self`) regardless of current project binding. It copies associations only when the vocabulary owner is a GitHub project or the associated task has either GitHub-origin source kind; it copies the vocabulary those associations need. A local vocabulary row shared with an ordinary task is copied, but that ordinary task's unrelated association stays generic. There is no name-based deduplication or ownership reassignment.

The coordinator review requested here is the staged-cutover detail: remove the copied associations from `todo_tag` in that same transaction, but retain old vocabulary rows until generic retirement. Otherwise a stale copied correction association could keep the guard enabled after the GitHub label is removed, or require a dual-write bridge. All label data remains in the dedicated tables; unrelated generic associations and complete task/build rows stay unchanged. This is earlier movement of associations than the final blanket table drop, not deletion of GitHub metadata.

The public task record gains read-only `githubLabelIds`; generic `tagIds` remains temporarily for ordinary categories. No new public label-assignment parameter or route is proposed. Existing generic mutations must not edit dedicated labels. GitHub worker metadata keeps its names-based input and switches its result to the named label ids. The issue-list label chips still use GitHub issue-list data; no UI layout or new user-facing surface is introduced.

## Reader/writer and regression inventory

| Path | Expected behavior | Required regression |
| --- | --- | --- |
| Fresh, upgraded and restarted database | Dedicated tables exist; ids, colors and associations survive; no duplicate copy or unrelated task/build mutation | Migration preservation, whole-row comparison, repeated boot and foreign-key check |
| Moved/imported and self-created GitHub issues | Preserve association provenance even when the current project is local/plain; shared names retain distinct ids; ordinary tasks sharing local vocabulary keep their generic links | Mixed-project migration fixtures and shared-vocabulary negative control |
| Migration failure | Roll back new tables and association movement together | Injected copy/delete failure with old associations intact |
| Repository label synchronization | Insert/update dedicated vocabulary only; normalize colors and retain labels missing upstream | Sync and upstream-removal controls |
| GitHub issue import | Resolve dedicated ids and atomically create task, associations and correction flag; failed association write leaves no task | Import/deduplication and write-failure controls |
| GitHub naming claim and metadata relay | Advertise dedicated vocabulary; accept known multiple labels; reject invalid names before mutation; preserve existing imported-title restriction | Real claim/relay tests and validation rollback |
| Generic REST, Coordinator and MCP mutations | Existing ordinary category behavior remains; these paths cannot assign or replace dedicated labels | Separation controls across all entry paths |
| Task projection, record registry, web mapper and fixtures | Expose named label records/ids without conflating them with generic ids | Shared schema snapshot, API and mapper contracts |
| Correction updates | Require evidence when either active classification requires it; label replacement cannot leave a stale copied generic association | Add/remove correction label and invalid/failing replacement tests |
| Orchestration | Only imported issues with a dedicated case-insensitive `bug` label select the bug workflow | Generic-label negative control and dedicated-label positive control |
| Project move | Preserve existing reset behavior; clear label links unless an internal replacement is validated for the target; task, schedules and classifications change atomically | Move, invalid target and write-failure rollback |
| Project/task deletion | Cascade owned vocabulary/associations without deleting another project's tasks or labels | Cross-project ownership and foreign-key checks |

## Failure and rollout contract

A failed label sync/import/mutation publishes no successful task update; invalid ids or vocabulary fail before changing state. The migration stops rather than dropping an association whose provenance is ambiguous or whose foreign keys cannot be preserved. A project deletion may remove its owned labels and their links, but never reassign them by recency or name.

Deploy the server, daemon contract and shared task representation together. A code-only downgrade cannot restore old association reads after cutover: use a pre-migration backup or a separately verified reverse-copy migration. Do not drop generic tables, remove generic mutation schemas, delete the settings tab or close #3481 in this segment.

The migration number is main's highest plus one at implementation time, not a reserved slot; its generated timestamp must exceed all of main's entries. Regenerate its snapshot from the current predecessor, and retain the evidence-store predecessor regression. Keep `coordinator-hold` while this cutover review is pending and through protected-path implementation review.
