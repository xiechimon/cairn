# Per-step token usage for daily totals

Status: reviewed (gpt-6.1-sol, read-only, two rounds). Round 1's three P2 findings are folded in: a legacy Coordinator remainder per step and model, a thread-level legacy remainder for digest and non-Pi turns, and a calendar-day window instead of `localMidnight`. Round 2's one P2 finding is folded in too: `mirroredTokens`, so a step whose Pi flag changed across a restart keeps its legacy part on the right day. Serves the sidebar usage heatmap (prototype: owner picked the ink palette on 2026-11-16); the page itself is a later PR.

## Problem

The heatmap needs tokens per local day, split into Coordinator and tasks. Today:

- `token_usage` holds one cumulative row per `(buildId, model)` (`recordStepUsage` in `apps/server/src/services/coordinator-steps.ts` adds each step's usage to it). `buildId` is a build id for task steps and a `chief_thread` id for Coordinator and digest steps. It has no time column, so usage that spans days cannot be split by day.
- `chief_turn_usage` holds one cumulative row per `(stepId, model)` with `createdAt`, but only for Coordinator conversation steps, only when `coordinatorRunsOnPi()`, and never for digest steps.

## Decision

`recordStepUsage` also writes one row per `(stepId, model)` to a new table `step_usage`, for every step kind, with the time it was first recorded. Daily totals read `step_usage` for usage recorded after this change and derive the rest from the two existing tables as remainders. No backfill (coordinator decision, 2026-11-16): legacy usage that cannot be dated more precisely lands whole on its build's or thread's creation day.

Totals count `input + output + cacheRead + cacheWrite` (coordinator decision: cache reads included for now).

Rejected: adding `createdAt` to `token_usage`. It is one cumulative row per build and model, so a timestamp would only say when the last step finished. Rejected: widening `chief_turn_usage` to all steps. Its context columns and its readers (`coordinator-context.ts`, cold resume) are Coordinator-only, and its writes are gated on the Pi runtime.

## Storage

`step_usage` (one drizzle migration, no backfill):

| Column | Type | Notes |
|---|---|---|
| `stepId` | text not null | primary key with `model`; not a foreign key, because steps are deleted (todo and project deletion, coalesced Coordinator turns) and spent tokens stay spent |
| `model` | text not null | as reported, e.g. `claude-code/claude-sonnet-5-5` |
| `teamId` | text not null | from `stepTeamId`; a step whose team cannot be resolved is not written (F2) |
| `buildId` | text not null | the step's `buildId` (a build id, or a Coordinator or digest thread id) |
| `kind` | text not null | the step kind; `chief` counts as Coordinator, every other kind as tasks |
| `input`, `output`, `cacheRead`, `cacheWrite` | integer not null default 0 | |
| `mirroredTokens` | integer not null default 0 | the part of this row's total that was also written to `chief_turn_usage`, added in the same statement under the exact `chief_turn_usage` write predicate (Pi on, `chief` kind, Coordinator conversation, not a digest) |
| `createdAt` | epoch ms not null | server time of the first report for this step and model |

Indexes: `(teamId, createdAt)` for the dated read, `(buildId, model)` and `(stepId, model)` (the primary key) for the remainders.

`recordStepUsage` wraps its existing `token_usage` upsert, its `chief_turn_usage` write and the new `step_usage` write in one `db.transaction`, so both callers (machine finish and the in-server Coordinator `done`) get the same atomicity.

## Daily read

`dailyUsage(db, teamId, { days, tz, now })` in a new `apps/server/src/services/usage-daily.ts`, served by `GET /api/teams/:id/usage/daily?days=<1..371>&tz=<IANA>` behind `requireTeam`. An unknown `tz` (rejected by `Intl.DateTimeFormat`) or `days` out of range is a 400. The response is `{ days, models, projects }`. Each day (ascending, only days with a non-zero total) carries `date`, `coordinator`, `tasks`, the four token types, tokens per model key and per project id, the ids of the todos that used tokens, and `cost` priced from the team's provider rates, or null when a model on that day has none. `models` names each model key with its provider label and `projects` names each project id. Every source keeps the four token types apart (a legacy Coordinator turn's mirrored share is removed in proportion), and a task row's project comes from its todo; Coordinator usage has no project. The zod schema lives in `packages/shared`.

### Window

The window is a set of calendar dates, not a time range. `today = localDay(now, tz)`, an `Intl.DateTimeFormat('en-CA', { timeZone })` date that is correct for any instant; `usage-daily.ts` owns it so it does not depend on the daily report, which may be removed. The window is `today` and the `days - 1` calendar dates before it, computed by stepping the `YYYY-MM-DD` date back one calendar day at a time (`Date.UTC(y, m - 1, d - k)` formatted as a date), never by subtracting 24-hour periods. Every timestamp is assigned `localDay(ms, tz)` and kept only if that date is in the set. `localMidnight` is not used: at a DST change at midnight (America/Havana on 2026-03-08) it returns 23:00 of the previous day, so it cannot bound a day. As a query prefilter only, SQL reads timestamps from `Date.UTC(first date) - 26h` to `now`; the date set decides membership.

Each SQL source groups by a 15-minute slot (`createdAt / 900000`) to cut rows; JavaScript assigns each slot's start to a local day. Every UTC offset and DST shift in the tz database since 1980 is a multiple of 15 minutes, so a slot never straddles a local midnight.

### Sources

All remainders are computed over all time, per key, and only then filtered to the window, so usage outside the window is still subtracted where it belongs. Every remainder is clamped at 0.

1. **New** (class from `kind`): `step_usage` rows of the team, each on the day of its `createdAt`.
2. **Legacy Coordinator turns** (Coordinator): for each `chief_turn_usage` row whose thread belongs to the team, `chief_turn_usage − step_usage.mirroredTokens` of the same `(stepId, model)`, on the day of the `chief_turn_usage.firstReportAt`. A step that reported before and after the rollout keeps its old part here; a new report for another model never suppresses this row; a new report made while the Coordinator was not on Pi never reached `chief_turn_usage`, so it is not subtracted from it.
3. **Legacy Coordinator thread rest** (Coordinator): for each `token_usage` row whose `buildId` is a `chief_thread` of the team, `token_usage − step_usage(buildId, model) − source 2(buildId, model)`, summed over all time, on the day of `chief_thread.createdAt`. This is the pre-change usage of digest steps and of turns run while the Coordinator was not on Pi, which never reached `chief_turn_usage`.
4. **Legacy tasks** (tasks): for each `token_usage` row whose `buildId` is a `build` of a todo of the team, `token_usage − step_usage(buildId, model)`, on the day of `build.createdAt`.

Why nothing counts twice: for a key `(buildId, model)`, `token_usage` is the sum of every report ever made. `step_usage` holds every report made after the change. For a Coordinator thread, source 2 holds the pre-change part of Pi turns, and source 3 the remaining pre-change part. The four sources partition `token_usage` (plus `step_usage` rows whose `token_usage` write cannot fail separately, F1).

## Every path that reads or writes the new state

| # | Path | Behavior |
|---|---|---|
| W1 | `recordStepUsage`, first report of a step and model (machine finish in `machine-finish-step.ts`, in-server Coordinator `done` in `coordinator/server-api.ts`) | inserts a `step_usage` row with the reported counts, `mirroredTokens` = the report's total when the `chief_turn_usage` predicate holds and 0 otherwise, and `createdAt = now`, in the same transaction as the `token_usage` upsert and the `chief_turn_usage` write |
| W2 | `recordStepUsage`, a later report for the same step and model (a reclaimed step, a quota or capacity requeue after usage was recorded, possibly after a restart that changed the Pi flag) | adds the counts and, only when the predicate holds for this report, the report's total to `mirroredTokens`; keeps the first `createdAt` |
| W3 | a report with an empty `usage` array (ACP backends, a step killed before its result) | writes nothing, as for `token_usage` today |
| W4 | step deleted (todo, project, coalesced turn) | `step_usage` rows stay |
| R1 | `dailyUsage` source 1 | as above |
| R2 | `dailyUsage` sources 2 to 4 | remainders over all time per key, so a step is counted once and a step spanning the rollout keeps both parts |
| R3 | existing `token_usage` readers (task cost in `todos.ts`, search, autonomy gates, build usage, trajectory export) and `chief_turn_usage` readers (context ring, cold resume) | unchanged |

## Failure behavior

- F1: process crash or error between statements: the three writes share one transaction, so no table records a report the others lack, and no remainder goes negative or double-counts.
- F2: `stepTeamId` returns null (team gone mid-step): no `step_usage` row; the usage stays in `token_usage` and would surface as a legacy remainder only if its build or thread still resolves to a team.
- F3: an older daemon or an ACP backend reports no usage: nothing written (W3); the day undercounts, and the page says which runtimes do not report.
- F4: a todo is deleted: its new usage stays in `step_usage` and still counts; its legacy remainder disappears with its `build` row. A deleted `chief_thread` drops its legacy sources 2 and 3 the same way. Accepted: legacy data is not backfilled.
- F5: legacy usage that ran across days lands on one day: Pi Coordinator turns on their turn's day, other legacy Coordinator usage on the thread's creation day, legacy tasks on the build's creation day (accepted with the no-backfill decision).
- F6: clock skew between daemon and server does not matter: `createdAt` is server time at record.
- F7: a reclaimed step that reports again on a later day lands wholly on the first report's day (W2). Rare, and it keeps the row cumulative like its neighbours.

## Tests (one per row or case)

- W1 and F1: a finished task step writes one `step_usage` row per model with the team, build, kind and counts. A Coordinator step with Pi enabled whose final write is forced to fail leaves `token_usage`, `chief_turn_usage` and `step_usage` all unchanged.
- W2: a second report for the same step adds counts and keeps `createdAt`.
- W3 and F2: empty usage and an unresolvable team write no row.
- W4 and F4: deleting the todo keeps the step's row and its day still counts.
- Window: `days=1` in `America/Havana` at 2026-03-08 with rows at 2026-03-07 23:30 and 2026-03-08 01:30 local counts only the second; a range across a 23-hour and a 25-hour day returns exactly `days` calendar dates; rows on both sides of a local midnight in `Asia/Singapore` and in `America/St_Johns` land on the right days.
- R2, rollout spanning one step: a Pi Coordinator step with legacy `chief_turn_usage` 100 for model A that then reports 40 more for A counts 100 on the old day and 40 on the new day; the same step reporting 40 for model B instead keeps A's 100 and adds B's 40.
- R2, Pi flag changed across a restart: one step and model, thread created outside the window, reports 100 yesterday with Pi on before the rollout, then 40 today with Pi off after it (`token_usage` 140, `chief_turn_usage` 100, `step_usage` 40 with `mirroredTokens` 0): 100 yesterday, 40 today, 0 on the thread's day. The reverse (Pi off, then on) also counts each part once.
- R2, legacy thread rest: a digest thread with only `token_usage`, and a Coordinator thread whose turns ran while not on Pi, each count on the thread's creation day; a thread with legacy Pi turns, legacy non-Pi usage and new rows counts each part once.
- R2, outside the window: a build whose `step_usage` falls before the window and whose creation day is inside it reports only the legacy remainder, not the full `token_usage`.
- R2, legacy tasks: a build with pre-change `token_usage` plus one new step reports the remainder on the build's day and the new step on its own day.
- Route: 400 on a bad `tz` and on `days` out of range; another team's id is rejected by `requireTeam`.

## Not in scope

The usage page and sidebar entry (waits for the owner's look sign-off), per-user Coordinator splits, cost per day, making ACP backends report usage, and the `localMidnight` DST bug in the daily report window, which goes away with the daily report (owner 2026-11-16; #5250 closed as not planned).
