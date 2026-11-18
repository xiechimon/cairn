# Retire todo snooze

Decision (owner, 2026-11-18, #5334): retire todo snooze completely. Archive and schedules cover the real workflows; no Web/iOS/CLI/Coordinator client has a live snooze trigger, and TasksPanel no longer filters snoozed rows.

## State before

`todo.snoozedUntil` / `todo.snoozeMode` (added by 0081) are written by `POST /api/todos/:id/{snooze,unsnooze}` (`services/snooze.ts`, `lib/snooze-time.ts`) and the Coordinator tool `snooze_todos`. Read by `isSilencedTodoPush` (push suppression), `is:snoozed` search, the `sweepSnoozeExpiry` scheduler sweep, and `endSnoozeOn` callers in `schedules.ts` (schedule cleared / scheduled run finished), `owner.ts` (needs-you) and `build-steer.ts` (user message). Dead web surface: `state:snoozed` search filter, `ThreadRow.snoozed`, `BulkBar.onSnooze`, `threadTone` (zero callers), `sidebarSnooze` fixture.

## Change

- Migration `0197_*`: `ALTER TABLE todo DROP COLUMN snoozedUntil; DROP COLUMN snoozeMode` — plain drops, no backfill (the fields carry no state anything else consumes; archive/schedule are the successor mechanisms).
- Schema/records: drop the two columns and the two `todoRecordSchema` fields, delete `records/snooze.ts`, drop `snoozed` from `SEARCH_IS_STATES`, remove the two REST entries, remove `snooze_todos` from the chief vocabulary (`ADDED` → `REMOVED_UNDER_D60` so stale callers get a 410 with a pointer; `CHIEF_TOOL_COUNT` 48 → 47, organize group 16 → 15).
- Server: delete `services/snooze.ts` + `lib/snooze-time.ts`; remove routes, sweep call, `endSnoozeOn` call sites, the `is:snoozed` SQL condition, and the `snooze_todos` switch case / write-tool entry; `isSilencedTodoPush` keeps only `archivedAt`.
- Web: drop `is:snoozed` (shared + local predicates, syntax help and problem copy in both languages), `ThreadRow.snoozed`, `BulkBar.onSnooze`, dead `threadTone`, the `sidebarSnooze` fixture/scenario and `snoozedUntil`/`snoozeMode` fixture fields, the `sidebar-groups` snooze row flag, gallery-only snooze props/copy, and the unused `暂停` translation key.
- Tests: delete `snooze.test.ts`, `snooze-time.test.ts`, `snooze-chief-tool.test.ts`; replace `snooze-migration.test.ts` with an upgrade test that migrates up to `0196_*`, seeds `team/project/todo` rows with populated snooze columns, migrates to head, and asserts the row survives and both columns are gone; strip snooze steps/assertions from `schedule-continue`, `mcp-face`, `thread-owner`, `search-syntax` (server+shared), `chief-tools` and the snapshot file.

## Failure paths

- Upgrade: a DB with `snoozeMode`/`snoozedUntil` set keeps every `todo` row; only the two columns drop. Verified by the new migration test.
- Stale callers (old Coordinator tool lists, scripts): `snooze_todos` answers 410 via `CHIEF_TOOLS_REMOVED_UNDER_D60` pointing at archive/schedule; the REST routes answer 404.
- Search: a stored `is:snoozed` query parses `snoozed` as a title word, never a filter.

## Out of scope

`apps/server/src/legacy/agent-layer/schema.ts` keeps its frozen `snoozedUntil`/`snoozeMode` columns and `import type` (erased at compile; the file is removed by #5347). Historical migrations, snapshots, research docs and epic records stay untouched.
