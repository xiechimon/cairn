# Archived projects in Settings

Issue [#3610](https://github.com/xiechimon/cairn/issues/3610). Research: [archived-projects-entry-2026-11-09](../research/archived-projects-entry-2026-11-09.md). References: [references/archived-projects](references/archived-projects) (Claude.ai `A01`, `A02`; Linear `L02`) and the settings references in [references/settings](references/settings).

## Surface

A settings section `项目` (id `projects`, route `/app/settings/projects`, lucide `Archive` icon) in the first nav group after `外观`. Since 2026-11-11 the sidebar's project filter (`已归档` / `全部`, `apps/web/DESIGN.md` Sidebar 6b) is the second entry: it lists archived projects with a `取消归档` / `删除` menu and opens one read-only; this section keeps working unchanged.

## Frontend

One `SettingsCard` titled `已归档项目`. Each row is a `SettingsRow`:

- Label: the project name.
- Hint: `归档于 <relative time>`, from `archivedAt`.
- Action: a secondary `取消归档` button (`data-testid="archived-project-unarchive"`).
- Rows are ordered newest `archivedAt` first.

| State | What shows |
| --- | --- |
| Loading | The `QueryBoundary` loading line `正在加载项目`. |
| Load error | The `QueryBoundary` error card `项目没能加载` with retry. |
| Empty | `EmptyState`: `没有已归档的项目`, hint `在侧栏项目菜单里归档的项目会出现在这里。` |
| Rows | One row per archived project. Active projects are not listed; they are managed from the sidebar and project settings. |
| Unarchiving | That row's button is disabled and reads `取消归档中…` while the request runs. |
| Unarchived | The row leaves the list and the project reappears in the sidebar (the mutation invalidates the shared queries). |
| Unarchive failed | The row stays; a toast titled `取消归档失败，请重试。` with no server detail (UI rule C5). |
| Phone width | Settings collapses to its list; the section is one more entry, and its rows follow the shared `SettingsRow` narrow layout. |

Fixture mode reads `FixtureSet.archivedProjects` (id, name, archivedAt) so the gallery and e2e can show rows without a server.

## Backend

No change. `GET /api/projects?teamId=` already returns archived projects with `archivedAt`, and `POST /api/projects/:id/unarchive` exists.

## Tests

- e2e `settings-archived-projects.spec.ts`: rows listed newest first with the archive hint; `取消归档` posts to `/unarchive`, then the row leaves and the sidebar lists the project; the empty state; a failed unarchive keeps the row and shows the error toast; axe on the section.
- Feature map: the `projects` row gains `settings:projects`, this design and the research note.
