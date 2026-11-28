# Run log window: every run in one window — plan, 2026-11-28

## User scenario

Newcomer first. Someone who installed Cairn today talks to the Coordinator. At the top of the chat sits the Coordinator's spiral; hovering it says `点击查看运行记录`, and after a failed or stopped turn a one-time hint beside it says `点这里看每一轮做了什么`. They need to know nothing else: no account, key, payment or setting is involved, and everything is read from the Cairn server's own database on their machine.

Today pressing the spiral opens a small popover listing only this conversation's turns, filtered by default to the ones that went wrong, with each row's date crammed into the row (`11/26 11:53 AM`) and a red word column. To see a task's run or another conversation they have to know a different entry point; the run window's `上一轮 / 下一轮` arrows only walk this one conversation. On 2026-11-28 the owner asked why the overall run history cannot be viewed and called the card too ugly, asking for a redesign; he picked direction 2 of the grayscale prototype (`run-log-redesign/prototype.html`, key 2).

After this change:

- Pressing the spiral (or the hint) opens the existing run window directly, with the newest turn of this conversation selected and its trace on the right. The popover is gone.
- The window has a left column listing runs, newest first, grouped under `今天` / `昨天` / `11月26日 周四`. A switch `这个对话 / 全部` changes the list to every Coordinator conversation and every task run in the team; a `出问题的` filter, off by default, keeps only failed, stopped and quota-held runs.
- Each row has two lines: a small status icon, the first line of what was sent (a task's title for a task run) and a right-aligned time in tabular figures; below in grey, source · status · tool count · duration. Only `未完成` (rust) and `额度用尽` (ochre) carry colour.
- The list loads twenty runs at a time and more on scroll. The trace on the right is today's run page, unchanged except that its previous/next arrows are removed (the list replaces them); export stays.
- At 390px the list fills the screen; pressing a row pushes to the trace with a back control to the list.
- When the team has no runs at all the window is one sentence `暂无运行记录`, no columns. When only this conversation is empty, the list column stays with `暂无运行记录` and the `全部` switch, so the team's other runs stay one press away.

When it fails: a run's status is read when the list loads; reopening the window or switching scope or filter reloads it. A page cursor is a position (time and id), so a run deleted between pages never blocks the pages after it. The list's first page failing shows `未能加载运行记录` with `重试` in the column; a later page failing shows `未能加载更早的记录` with `重试` at the list end; a run whose trace cannot be found shows `找不到这条运行记录` on the right while the list stays usable.

Why (data): production on 2026-11-27 had 486 Coordinator turns in 11 days and 76 failed or stopped; the owner's tasks run as builds which the popover never listed.

| Situation | What the user sees | What the system does | Wait and cost |
|---|---|---|---|
| Press the spiral | Run window, newest turn of this conversation selected, trace on the right | Navigates to `/app/runs?thread=<tid>`; `GET /api/teams/:id/runs?thread=<tid>` then `GET /api/teams/:id/runs/<newest>` | two requests |
| Press `全部` | List of all conversations' turns and task runs; the run shown on the right stays selected | `GET /api/teams/:id/runs` (no thread) | one request |
| Press `出问题的` | Only failed, stopped, quota rows; pressing again shows all | Same request with `problems=1` | one request |
| Press a row | Its trace on the right (phone: pushed full screen) | URL becomes `/app/runs/<id>?thread=…`; `GET /runs/<id>` | one request |
| Scroll to the list end | Next twenty rows | Same request with `before=<last row time>:<last row id>` | one request |
| A `运行记录` link on a failed turn in chat | The window with that turn selected | `/app/runs/<stepId>`; list scope `这个对话` from the trace's thread | two requests |
| A task's `运行记录` menu item | The window with that task's run selected; list on `全部` | `/app/runs/<buildId>`; the trace has no thread | two requests |
| No runs at all in the team | `暂无运行记录`, one sentence | Empty first page for the conversation, then one team-wide page to tell an empty conversation from an empty team | two requests |
| This conversation has no runs, the team has | List column with `暂无运行记录` and the `全部` switch | Empty first page for the thread | one request |

## Scope

1. New team-level list `GET /api/teams/:id/runs?thread=&problems=0|1&before=&limit=` → `{runs, nextCursor}` (`packages/shared/src/run-trace.ts` `runListPageSchema`). A row is `{id, kind: coordinator | task, threadId, at, status: running | done | failed | stopped | quota, firstLine, woke, source, toolCount, durationMs}`. With `thread`, only that thread's Coordinator turns (404 if the thread is not this team's). Without it, Coordinator turns of every team thread (archived included, the internal `chief-digest-*` / `chief-memory-*` threads excluded) merged with every task build of the team's tasks (archived tasks and projects included), ordered by `(at desc, id desc)`. `source` is the project name of a project channel thread or of a task, else null.
2. Paging: each source is read with `limit + 1` rows below the cursor in one sorted query, the two are merged in the same `(at, id)` order and cut at `limit`; `nextCursor` is `<at>:<id>` of the last row, a position rather than a row reference, so a run deleted or hidden between pages cannot strand the rest of the list; a malformed cursor is 400. Rows are filtered by team before the cursor applies, so a cursor cannot reveal another team's runs. Per row cost is bounded by the page (point and range lookups per row), not by history.
3. Status: Coordinator turn — `quota` if `quotaBlock` is set or the step waits on quota; `stopped`; `failed` (or `quota` when the recorded error classifies as quota, as today); `running` while pending or claimed; else `done`. Task build — `quota` if any step holds or waits on quota; `stopped` if the build has a stop record or a stopped step; `running` while any step is pending or claimed; `failed` if a step failed or the build has an error message; else `done`. `problems=1` keeps rows whose status is `failed`, `stopped` or `quota` (the SQL filter selects the same set the status rule produces, so a page never comes back short because of a post-filter). The run trace on the right reports the same status through the same two functions, so the row and the trace never disagree.
4. Task row: `firstLine` is the task title, `woke` false, `toolCount` counts tool-call rows in the build's transcript, `durationMs` is first claim to last finish when every step finished, else null.
5. The old `GET /api/teams/:id/chief/threads/:tid/turns`, `RunTurnRow`/`RunTurnPage`/`runTurnsQuerySchema`, and `RunTrace.previousId`/`nextId` are deleted with their server code (single path); `protocol/rest.ts` lists the new route instead.
6. Web route `RUN_PATH` becomes `/app/runs/:runId?`. The window (`apps/web/src/runs/run-page.tsx`) is a bleed `RouteDialog`: left column `run-list.tsx`, right the existing `RunBody`. With no `runId`, the newest row of the list is shown on the right (desktop) without changing the URL; changing scope or filter writes the shown run into the URL so it stays selected. Scope and filter changes replace the history entry (back closes the window rather than stepping through filters); a row press pushes. A selected run that the new filter hides stays on the right with no row highlighted. URL search keeps `thread`, `scope=all`, `problems=1` and the fixture `scenario`, so reload and back restore the view.
7. Scope default: `这个对话` when a thread is known (`thread` param, else the selected trace's `threadId`); with no thread (a task run opened from its menu) the list shows `全部` and the switch is not rendered (C25).
8. The spiral button and the hint navigate to the window; `run-turns-popover.tsx` is deleted, `RunTurnsTrigger` replaced by a plain button with the same name, description and tooltip. The `上一轮 / 下一轮` buttons are deleted from the window head.
9. Row: lucide status icon (done `CircleCheck`, stopped `CircleStop`, failed `CircleX` rust `text-destructive`, quota `CircleSlash` ochre `text-(--card-button)`, running `CircleDashed`), `aria-label` the status word; first line truncates; time `HH:mm` tabular; second line grey: source (only in `全部`), status word unless done, `{n} 次工具调用` when above zero, duration (`{s} 秒` / `{n} 分钟`) when finished. Group headings: `今天`, `昨天`, else the locale's month-day-weekday (year added when not this year). Selected row `aria-current="page"` with the active fill; arrow keys move between rows.
10. 390px: no `runId` shows the list full width; a `runId` shows the trace with a `运行记录` back link to the list (keeping search).
11. i18n: new strings in `apps/web/src/i18n/en.ts` (zh is the key). Fixture mode (`?scenario=run-trace`) serves rows from `fixture.runs` filtered by thread and problems with the same paging.
12. Unchanged: the trace content and its export, the run page's `只看报错`, the `运行记录` links in chat, the task menu entry, the hint's once-only storage.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Spiral pressed | Window opens, newest turn of this conversation selected and shown; no popover; no previous/next arrows | `apps/web/e2e/run-trace.spec.ts` | this change |
| `全部` pressed | Rows from another conversation and a task run (task title, project name on line two) appear; pressing the task row shows its trace | `apps/web/e2e/run-trace.spec.ts` | this change |
| `出问题的` on, then off | Only failed/stopped/quota rows, then all again; off by default | `apps/web/e2e/run-trace.spec.ts` | this change |
| No runs at all (new user) | `暂无运行记录`, one sentence, no columns | `apps/web/e2e/run-trace.spec.ts` | this change |
| `出问题的` on with no problem runs | `暂无出问题的记录` in the column; the toggle stays to turn it off | `apps/web/e2e/run-trace.spec.ts` | this change |
| Thousands of runs | First twenty, more on scroll; server reads `limit + 1` per source per page; order stable across pages, no duplicates or gaps when a turn and a build share a timestamp | `apps/server/test/run-trace.test.ts` | this change |
| A run deleted between two pages | The next page still loads from the same position | `apps/server/test/run-trace.test.ts` | this change |
| List row and trace status | Same word on both sides (a build whose step finished but push failed is `未完成` on both) | `apps/server/test/run-trace.test.ts` | this change |
| This conversation empty, team has runs | `暂无运行记录` in the column, `全部` switch shown and lists the team's runs | `apps/web/e2e/run-trace.spec.ts` | this change |
| A run still going | Dashed icon, `运行中`, no duration; problems filter excludes it | `apps/server/test/run-trace.test.ts` | this change |
| Archived thread | Its turns stay in `全部` | `apps/server/test/run-trace.test.ts` | this change |
| Deleted thread (row gone, steps orphaned) or internal digest/memory thread | Its turns are not listed in any scope | `apps/server/test/run-trace.test.ts` | this change |
| Another team's thread or turn | Not listed; `thread=` of another team is 404 | `apps/server/test/run-trace.test.ts` | this change |
| Task run vs Coordinator turn | Task row: title, project as source, tools counted from its transcript, status from its steps and stop/error | `apps/server/test/run-trace.test.ts` | this change |
| Fixture mode `?scenario=run-trace` | Same window, list from fixtures, links keep `scenario` | `apps/web/e2e/run-trace.spec.ts` | this change |
| First page fails, then retry | `未能加载运行记录` + `重试` in the column; retry loads rows | `apps/web/e2e/run-trace.spec.ts` | this change |
| 390px phone width | List fills the screen; pressing a row shows the trace with a back link; no horizontal scroll | `apps/web/e2e/run-trace.spec.ts` | this change |
| A run whose trace is gone | `找不到这条运行记录` on the right, list still usable | `apps/web/e2e/run-trace.spec.ts` | this change |
| Task opened from its menu (no thread) | List on `全部`, switch hidden, the run selected | `apps/web/e2e/run-trace.spec.ts` | this change |
| A later page fails | `未能加载更早的记录` + `重试` at the end, rows above stay | `apps/web/e2e/run-trace.spec.ts` | later: covered by the same code path as first-page retry; no separate spec |

Why the proving tests are red on the parent: `GET /api/teams/:id/runs` has no route on the parent (404 on every positive call in the new server tests); the parent's spiral opens a popover, not `run-page`, so the spec's first assertion (the window with the newest turn selected) fails, and `全部`, the task row and the empty sentence do not exist.

States, readers, writers: no persisted state is added; the list is a React Query infinite cache keyed by (team or fixture, thread or all, problems), so a late response of an old key never renders in the new list; the fixture key includes the scenario name. Writers of the URL: the spiral and the hint (`thread`), row links (run id), the scope switch and the filter (`scope`, `problems`, pinning the shown run), the phone back link (drops the run id). Reader: `RunPage`, which derives thread, scope, filter and selection from it. Selection is the URL (`runId`, else the first row). Writers of the data are unchanged (chief steps, builds, transcripts); the only reader added is `listRuns` in `apps/server/src/services/run-trace.ts`. Failure paths: list error → retry in column; trace 404 → sentence; export failure → toast (unchanged).

## Out of scope

- Search inside the run list, date or project filters (owner picked direction 2, which has only scope and problems).
- A sidebar entry or a separate runs page (directions 1 and 3).
- Changes to the trace content on the right, its `只看报错` or export.
- New database indexes: the list sorts within the team's chief steps and builds. The production latency of the first page, `全部` and `出问题的` is measured in the landing evidence; an index follows only if that measurement is slow.
- Live refresh of a row's status while the window stays open (it refreshes on reopen, scope or filter change).

## Review

- Verdict: PASS
- Plan-SHA256: d9196b0a1e435140f1de87c02f6d666eec25ac6b8ceb11b839f28e264eaa931a
- Author-Model: claude-opus-5-5
- Reviewer: pi, fresh context, one review
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: first pass (medium effort) timed out with no text; second pass (low effort) returned FAIL with 7 findings, all fixed in this plan and the code, no further round:
  1. Empty conversation hid `全部`: the one-sentence window is now only for an empty team; an empty conversation keeps the column and switch (row added, e2e test added).
  2. Cursor of a deleted run stranded later pages: cursor is now a position `<at>:<id>` (row added, server test deletes the boundary run). Status change while the window is open: refreshes on reopen, written in out of scope.
  3. State readers and writers incomplete, selection jumped on scope change, fixture cache shared across scenarios: URL writers and reader listed; scope and filter changes pin the shown run; replace vs push stated; fixture key includes the scenario.
  4. Missing edges and wrong task-menu id: rows added; the task menu passes the build id.
  5. Proving tests: added empty-problems and empty-conversation e2e, memory thread, cursor deletion, trace status; later-page failure stays `later` (same retry control as the first page, different call).
  6. Row status and trace status could disagree: the trace now uses the same status functions as the list.
  7. Performance claim unmeasured: replaced by a production latency measurement in the landing evidence.
