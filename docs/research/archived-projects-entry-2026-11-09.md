# Where an archived project is found and unarchived

Requirement: [#3610](https://github.com/xiechimon/cairn/issues/3610). After [#3602](https://github.com/xiechimon/cairn/issues/3602) the sidebar lists only unarchived projects, so the web app has no way to reach an archived project or unarchive it; only `POST /api/projects/:id/unarchive` remains.

## Observed in the reference products

Walked on 2026-11-09 in the owner's signed-in Chrome, read-only (nothing archived, unarchived or deleted). Shots are in [references/archived-projects](../design/references/archived-projects); conversation text in `A04` is blurred.

| Product | Observed | Shot | Borrow or skip |
| --- | --- | --- | --- |
| Claude.ai, Projects page | The Projects page reached from the sidebar lists every project in one grid. Archived ones stay in the grid, dimmed, with `· Archived` after the date. Sorting offers last updated, date created and alphabetical; there is no archived filter. | `A01` | Borrow the archived row with its date. Skip the index page: cairn has no projects index, and the sidebar is the index the owner ruled lists only unarchived projects. |
| Claude.ai, card menu | Hovering an archived card shows a `⋯` button; its menu is `Settings`, `Unarchive`, `Delete`. `Unarchive` acts at once, with no confirmation. | `A02` | Borrow: unarchive is one direct action on the row. |
| Claude.ai, archived project | Opening an archived project shows an `Archived` chip after the name and replaces the composer with a banner `This project is archived. Unarchive it to keep working in this project.` plus an `Unarchive` button. The name menu also lists `Unarchive`. | `A03`, `A04` | Skip for now: cairn has no route that opens an archived project (search and the sidebar hide it). |
| Linear, Settings > Teams | The teams table has a status filter `Active` / `Retired` / `Recently deleted`; retired teams are listed only in settings. | `L02` | Borrow the place: retired containers are managed from a settings list, not the main navigation. |
| Linear, Projects display options | Closed projects stay in the projects list behind `Show closed projects: All`. | `L01` | Skip: a display toggle needs a projects list, which cairn does not have. |

## Options

| Option | Entry | Cost | Disposition |
| --- | --- | --- | --- |
| A. Settings section `项目` listing archived projects, each with `取消归档` | Settings nav | One section on the existing API and mutation | Chosen: matches Linear's settings list, keeps the sidebar rule, one path. |
| B. A Claude.ai-style projects index page | New main route | A new main surface that needs a page draft and duplicates the sidebar | Skipped. |
| C. Archived banner on the project page | Only by URL | Needs a way in first | Skipped until search lists archived projects. |

## Recommendation

Option A, specified in [archived-projects-settings](../design/archived-projects-settings.md).
