# Routines: event triggers, wake-ahead and the missed-run window

Seq 31. Today a `schedule` row fires only on a clock (`once`, `hourly`,
`daily`, `weekly`, `cron`). This adds two trigger kinds, an explicit
catch-up window on late runs, and a desktop keep-awake window keyed on
`nextRunAt`. The firing path is unchanged: every trigger lands on
`fireSchedule`, which steers the todo's latest build or starts a fresh one.

## Model

`schedule.kind` gains `'event'` and `'webhook'`. Both are "triggered"
kinds: they hold no cadence and no `at`/`cron`, and `nextRunAt` is `null`
while idle. A trigger "claims" a run by writing `nextRunAt = now`; the
existing `dueSchedules`/`due_event` mirror and `runSchedule` then deliver
it, and `fireSchedule` clears `nextRunAt` back to `null` after firing.
`isRecurring` now means "has a clock cadence" and excludes both new kinds,
so a trigger claim behaves like a `once` row everywhere downstream
(steer stale-wake guard, run-now, due mirror, skipped bookkeeping).

New `schedule` columns, one migration:

- `triggerSpec` (json, null) — for `event`, `{topic}` where topic is
  `todo.build.completed`: the schedule fires when its own todo's latest
  build goes quiet. The enum is intentionally one value; new topics or a
  cross-todo bus are follow-ups.
- `webhookTokenHash` (text, unique, null), `webhookMasked` (text, null),
  `webhookDeliveries` (json string[], null) — the intake secret and the
  persistent delivery-id dedup list (last 50).
- `webhookLastUsedAt` (epochMs, null) — the ops tracing bit the 1137
  receiver also kept.
- `missedRunWindowMs` (int, null) — per-schedule catch-up cap;
  `null` falls back to the 12h constant.
- `createdAt` (epochMs, null) — when the row was written; the missed-run
  rule measures armed time from it. Existing rows stay `null`, which the
  rule reads as "armed at their `nextRunAt`".

## Webhook intake

`POST /api/webhook/schedule/:token`, exempt from session auth in
`isExempt` (token-in-path is the credential, like the 1137 receiver).
The handler hashes the token (sha256), looks up the schedule by
`webhookTokenHash`, and always answers:

- 401 — unknown token.
- 202 `{result: 'duplicate', deliveryId}` — the delivery id (the
  `x-cairn-delivery` header, falling back to `x-github-delivery`, else a
  fresh id) is already in `webhookDeliveries`.
- 202 `{result: 'ignored', deliveryId}` — schedule paused, or its
  todo/project is archived. Nothing is written.
- 202 `{result: 'fired', deliveryId}` — the delivery id is appended to
  `webhookDeliveries` (cap 50, oldest dropped), `webhookLastUsedAt` and
  `nextRunAt = now` are written, the schedule clock listener is poked.
  The run then lands through the normal claim path.

A second delivery while a claim is still pending rewrites `nextRunAt`
to its own `now`; the run fires once — deliveries coalesce into one
routine run, which is the routine semantic. The steer transaction's
existing stale-wake guard (`current.nextRunAt > wake.at` → 409, ignored
by the stale-check in `runSchedule`'s catch) is what makes coalescing
safe. The plaintext token is returned exactly once, in the `POST
/api/schedules` response (`webhookToken` + `webhookUrl`); only the hash
is stored. Re-saving the todo's schedule rotates the token.

## Event dispatch

`finishScheduledStep` already runs on every step-settle path. Before its
`scheduleId === null` early return it now also checks: the settled step's
build is the todo's `latestBuildId`, the todo is not archived, the build
has no remaining ACTIVE steps (pending/claimed/waiting_quota), and an
enabled `kind='event'` schedule on that todo has `triggerSpec.topic ===
'todo.build.completed'` — then the schedule claims `nextRunAt = now`.

Loop guard: a settle whose `stepRow.scheduleId === row.id` never
re-triggers its own schedule (a routine's own run is not an "event").
Follow-up steps the routine's turn spawns (ci-fix and friends) do not
carry `scheduleId`, so a chained flow can re-trigger the routine;
`fireSchedule` caps all triggered kinds at
`WORKER_SCHEDULE_RUN_LIMIT` (10) consecutive schedule-initiated runs
without a human message and then pauses the schedule — the same brake
worker schedules already have.

## Missed-run window

`runSchedule` checks lateness before `fireSchedule`:
`armedAt = max(row.nextRunAt, row.createdAt ?? row.nextRunAt)` and the
run is missed when `now - armedAt > (row.missedRunWindowMs ?? 12h)`.

- `once`/`event`/`webhook`: `nextRunAt = null`,
  `lastRunStatus = 'skipped'`, `lastRunError = 'missed the run window'`,
  `retryNotBefore = null`.
- recurring kinds: `nextRunAt` rolls to the next occurrence at-or-after
  `now` without firing; the same `skipped` fields mark the dropped run.

The `max(nextRunAt, createdAt)` form is what keeps a schedule created
already-overdue (an API-created `once` whose `at` is in the past)
firing immediately instead of being born "missed": its armed time is
its creation, not its anchor. A laptop asleep through an 8am run wakes
with `now - 8am` of armed lateness — inside the window it fires once,
past it the run is skipped (one-shot) or rolled forward (recurring),
never a burst. The check lives in `runSchedule`, so both delivery paths
(the `schedule` due_event handler and the `runTick` `dueSchedules` sweep)
share it.

## Desktop wake-ahead

`powerSaveBlocker` cannot wake a sleeping machine; it can only refuse
idle sleep. The desktop therefore holds a blocker across the window in
which a due run should start: while
`now ∈ [nextRunAt - 15min, nextRunAt + 5min]` for the earliest enabled
`nextRunAt` reported by `GET /api/schedules` on localhost (owner Bearer
token, polled every 60s, re-polled on `powerMonitor` `resume`). Failures
keep the last computed state. `createKeepAwake` gains a second input —
the tray switch stays a manual override (`manual on` always holds) and
`isOn()` reports either source for the icon. If the machine sleeps
through the whole window anyway, the server-side missed-run policy above
decides the outcome.

## UI

`ScheduleTrigger` gains `webhook` and `event` (labeled "Webhook trigger" and "Event trigger" in the editor).
The editor hides date/time/cron inputs for them and shows a one-line
hint; for `webhook`, the saved response's one-time `webhookUrl` +
`webhookToken` is shown in the popover until it closes (it is never
shown again — re-saving rotates it). Cadence/summary helpers print
trigger wording for the new kinds, and a triggered schedule with
`nextRunAt = null` reads as waiting-for-trigger, not "no next run".

## Failure behaviors

- unknown token → 401 (the only non-202 answer; senders must not learn
  which tokens exist).
- disabled / archived / missing todo or project → 202 `ignored`, no
  writes; a retried delivery gets the same answer.
- delivery id replay (crash-retry or duplicate fan-out) → 202
  `duplicate`, no second run. Dedup is persistent, no time window.
- claim pending when another delivery lands → coalesced into one run;
  the stale-wake guard inside the steer transaction drops the loser and
  `runSchedule`'s stale-check swallows the 409 without recording failure.
- `fireSchedule` throws on a triggered claim → the shared catch records
  the failure / pauses exactly as for clock kinds.
- routine throws `BuildContinuationPhaseError` (thread busy) → claim
  stays; the due handler reschedules at `nextRunAt` and retries until
  the thread drains or the missed-run window lapses.
- event schedule on a build that never quiets → no claim, nothing to
  age out.
- server restart: claims are rows (`nextRunAt`), so a pending fire
  survives; `syncDueSources` re-mirrors on boot. `webhookDeliveries`
  persists, so replay-after-restart is still `duplicate`.
- desktop offline or server down: wake-ahead keeps its last state; the
  next successful poll re-arms.
