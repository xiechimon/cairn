# Build restart trigger source

Status: accepted 2026-11-17. Changes the persisted `build.triggerSource` values and the `BuildRecord` wire schema.

## Problem

`build.triggerSource` says who started a build. A restart of a failed build that creates a new build row (`restartFailedBuild`, `apps/server/src/services/build-restart.ts`) always writes `'user'`, whoever asked for the restart:

- Cairn's own automatic retry (`sweepFailedRetries` in `needs-you.ts`, actor `cairn`, origin `automatic`) is recorded as a person. Measured in the Mac app on 2026-11-17: build `01a1e75c…` has `triggerSource=user` and its session step `byPerson=0`.
- A Coordinator message on a failed thread (`deliver` in `thread-message.ts`, origin `automatic`, actor = the Coordinator) is also recorded as `'user'`, while the same Coordinator starting a fresh build through `startThreadBuild` is recorded as `'chief'`.

The autonomy daily budget (`autonomySpentToday`, `autonomy-gates.ts`) counts spend only for `chief` and `schedule` builds, so the spend of these unattended restarts never reaches the budget.

## Decision

1. Add `'retry'` to `triggerSourceSchema` (`user | chief | schedule | retry`): a build Cairn started by itself to retry a failure, with nobody asking. Reusing `chief` would claim the Coordinator decided, which is false and would show the Coordinator marker in the transcript. Inheriting the failed build's value would again say `user`, and for a schedule run would add a phantom run to the schedule history (`schedules.ts` reads `triggerSource = 'schedule'`).
2. Step actions carry who acted, not only whether a person did: `applyBuildStepAction` and `restartFailedBuild` take `origin: 'person' | 'coordinator' | 'retry'` instead of `'person' | 'automatic'`. Every check that read `origin === 'automatic'` reads `origin !== 'person'`. A restart that creates a build writes `triggerSource` from the origin: `person → user`, `coordinator → chief`, `retry → retry`. This is the only mapping; there is no default.
3. `AUTONOMOUS_TRIGGERS` becomes `chief | schedule | retry`, so retry spend counts toward the daily budget.
4. A restart that reuses the failed build (preserved checkpoint, or an open PR) keeps that row's `triggerSource`: the row still records who started the build, and the new step's `byPerson` already records that nobody asked for the rerun. Attributing per-step spend to the budget is out of scope.

## Readers of `build.triggerSource`

| Reader | Effect of `retry` |
|---|---|
| `autonomy-gates.ts` `autonomySpentToday` | counted as autonomous spend (the fix) |
| `schedules.ts` legacy schedule-run history | unchanged; matches only `schedule` |
| `startBuilds` (`build-start.ts`) | `triggerSource !== 'user'` already runs `assertAutomaticRetryAllowed`; restart runs the same check for any non-person origin |
| Web transcript head (`apps/web/src/api/mappers.ts`) | no marker, like `user`; a "retried automatically" marker is a UI follow-up |
| Coordinator thread reads (`coordinator/index.ts`), turn capture (`coordinator-turn-capture.ts`, `z.string()`) | pass the string through |
| `buildRecordSchema` wire parse (web, bundled with the server) | accepts the new value; iOS and the Mac shell do not read the field |
| Trajectory export / pack schema | does not read the field; not touched |

The column is `text NOT NULL` with no CHECK constraint, so the schema needs no DDL.

## Migration of existing rows

A data migration rewrites past automatic retries from `user` to `retry`. A row qualifies only when all three hold, which together match nothing a person or the Coordinator produces:

- `build.triggerSource = 'user'` and `build.prevPhase = 'failed'`;
- an earlier build of the same task has a `build_feedback` row with `kind = 'restart'`, `actor = 'cairn'`, `feedback = ''`, written within 5 seconds before the new build (the sweep writes it in the same transaction);
- the build's first step has `byPerson = 0`.

Past Coordinator restarts are not backfilled: their feedback actor is a display name that cannot be told apart from a person's. They stay `user`.

## Failure behavior

- An older server reading a `retry` row: the TypeScript type is wider but SQLite returns the string; the old web parse would reject a `BuildRecord` with `retry`. Web and server ship together, so this only matters on a rollback, where the deploy's rollback restores the backup taken before the migration.
- The backfill is a single `UPDATE`; if it matches nothing (fresh install) it is a no-op.

## Tests

- `needs-you.test.ts`: an automatic retry sweep creates a build with `triggerSource = 'retry'`, and its token spend counts in `autonomySpentToday`. Fails on the old code (`user`, spend 0).
- A Coordinator message on a failed thread creates a build with `triggerSource = 'chief'`.
- A person's restart through `POST /api/builds/:id/steps` still writes `user` (existing `m7-failed-send-e2e`).
- Migration: a seeded automatic retry row becomes `retry`; a person restart and a Coordinator restart stay `user`.
