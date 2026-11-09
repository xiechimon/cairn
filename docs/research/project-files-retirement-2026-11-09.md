# Retire the project files surface

Requirement: [#3479](https://github.com/xiechimon/cairn/issues/3479). This is removal of an existing surface, not a new mechanism or borrowed product behavior. Research uses repository main as requested; no external product comparison is needed.

## Primary-source audit

Baseline: [`0719ece9f`](https://github.com/xiechimon/cairn/tree/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16).

| Source | Observed behavior | Trade-off and disposition |
| --- | --- | --- |
| [Project page](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/web/src/pages/project-page.tsx) | Observed: files, directory navigation and commit history share one page; task list and issue import share its shell. | Inferred: remove browsing, keep project tasks and settings. |
| [Project routes](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/routes-projects.ts) and [Git service](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/services/git.ts) | Observed: tree, file and commits readers support this page. Branches and recursive files use separate routes. | Inferred: delete the exclusive readers after their UI consumers. Keep Git hosting and shared diff readers. |
| [Thread mentions](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/web/src/board/use-thread-mentions.ts) | Observed: file mentions consume `useProjectFiles`, not tree or history. | Inferred: preserve recursive `/files` and its limits. |
| [Thread diff hooks](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/web/src/api/hooks.ts) | Observed: thread diffs and full-file reads use build-scoped routes. | Inferred: preserve build changes, full-file reads, daemon file tools and project branches. |

## Recommendation and sequencing

Keep each review under 1000 changed non-generated lines, on the same branch, waiting for main between segments:

1. Remove project commit-history UI, hooks, fixtures and active verification registration. Keep thread run history and diff UI unchanged.
2. Remove project file navigation, route and components. Old URLs leave the surface; project home, task creation, settings and issue import remain.
3. Remove page-exclusive tree, file and commit APIs, schemas and services. Tests prove retired endpoints return 404 and retained thread/project paths still work. Only this segment closes the issue.

No persisted state, execution protocol or concurrency behavior changes. No migration or new dependency is needed. Historical evidence stays historical; obsolete live probes are archived and unregistered.

## UI brief

Surface: project browsing and project tasks. Goal: remove the unused files page rather than conceal it. Rules checked: C2, C3, V10, T1, P5. Draft: exempt, removal of existing controls, no new main-surface feature.

There is no designated project-file-page reference in [the reference library](../design/references/README.md). The owner's [removal decision](https://github.com/xiechimon/cairn/issues/3479) is the acceptance reference; no replacement product is invented.

| Component | States and proof |
| --- | --- |
| History controls | Retired for hosted and local repositories; browser tests assert absence and zero commit requests. Empty/loading/error/long-content history states cease to exist. |
| Files controls | Retired in segment 2; old direct links must leave the page without file requests. |
| Retained tasks | Empty and populated project tasks, settings navigation and new-task action; fixture regression plus isolated live smoke. |
| Viewports and themes | Desktop/mobile and light/dark captures; unproduced states are explicitly listed as not covered. |
| Offline/pending question | Execution state remains owned by threads, not this removed surface; no new rendering path. |
