# Subscription quota on the wire

The subscription detail UI already reads `windows`, `plan`, `state`, `cooldownUntil`, `lastUsedAt` and `stepsLast24h` on the list wire (`ClaudeSubscriptionWire`, `DevinSubscriptionWire` in `apps/web/src/api/`). The server never sent them, so every account renders "可用 / 还没用过 / 还没有额度读数". This change populates them from two real sources: rate-limit events reported by the Runner while it runs a step bound to the subscription, and the `step` rows the claim path already binds via `step.claudeSubscriptionId` / `step.devinSubscriptionId`.

Bug class: wire fields declared but never populated.

## Persisted state

`claude_subscription.quotaWindows` (new JSON column, `ClaudeRateLimitWindow[] | null`, same row shape as `machine.claudeRateLimits`): the last report seen per window name for this subscription. `null` means no attributed report yet. No devin column — devin has no window source today.

A report writes the union of windows the event carries:

- Daemon: one `rate_limit_event` emits one `ClaudeRateLimitNotice` per entry in `rate_limit_info.unifiedWindows` (each carries the event's top-level `status`, since the map has no per-window status) plus the existing top-level notice when its rate limit type is absent from `unifiedWindows`. Dedupe is by subscription key within one event; `unifiedWindows` wins for a shared name because it holds the window's own utilization/reset.
- `ClaudeRateLimitReport` gains optional `stepId`. Old daemons omit it (old servers tolerate it; the field is optional in `claudeRateLimitReportSchema`).
- Daemon `forwardClaudeRateLimit` sends the running step's `stepId` (already in `StepPassControlsInput`).

## Write path

`POST /api/machine/rate-limit` → `recordClaudeRateLimit` (unchanged machine write + `refreshClaudeRateParks`; dispatch gating keeps reading `machine.claudeRateLimits` only), then attribution:

1. `body.stepId` resolves a `step` row claimed by this machine (`step.machineId === machine.id`, the `ownedStep` rule — `machineId` survives `done`/`failed`/`stopped`, so a report arriving after the step finished still attributes).
2. The step's `claudeSubscriptionId` names the account; the report is upserted into `quotaWindows` via `applyClaudeRateLimit` (same per-key replace as the machine column, `reportedAt` = server receive time).

Attribution needs both: a `stepId` naming a step this machine claimed, and a non-null `claudeSubscriptionId` on that step. Anything else writes machine windows only.

## Read path

`GET /api/teams/:id/claude-subscriptions` enriches each record:

- `windows`: stored rows mapped to `{name, utilization, resetsAt, observedAt: reportedAt}`. Rows with `utilization: null` are kept in storage (they still decide `state`) but left out of `windows` — the wire type and the bar need a number.
- `state: 'exhausted'` + `cooldownUntil` only when `claudeRateBlock(quotaWindows, now) !== null` (`cooldownUntil` is `block.until`, null when the reset is unknown). Otherwise `state` is omitted so the client keeps computing `ok`/`expired` from `expiresAt`.
- `lastUsedAt`: max `step.claimedAt` among steps bound to the subscription that ran (`claimedAt` not null, status in `claimed|done|failed|stopped` — same predicate as the `/steps` endpoint).
- `stepsLast24h`: same predicate with `claimedAt` in the last 24h; `null` when the subscription was never used so the client renders "还没用过".
- `plan`: not sent (not detectable today).

`GET /api/teams/:id/devin-subscriptions` fills `lastUsedAt`/`stepsLast24h` the same way via `step.devinSubscriptionId`. No `windows`/`state`/`cooldownUntil`/`plan` for devin: nothing reports devin windows, and there is no block source.

Usage stats come from one grouped aggregate per list call (few subscriptions per team); the windows and state are read off the row already fetched.

## Transitions and failure behavior

- Old daemon (no `stepId`) → machine windows only; `quotaWindows` unchanged. The endpoint stays compatible both directions.
- `stepId` unknown, unbound (`claudeSubscriptionId` null — step ran on the Runner's own login), or claimed by a different machine → machine windows only. The machine check is the security boundary on a machine-surface route: a Runner can only annotate steps it claimed, and `quotaWindows` feeds display, never dispatch.
- Report after the step finished → still attributes; `machineId`/`claudeSubscriptionId` persist on the stored row. A step handed back or requeued (`machineId` cleared) no longer attributes — the observation predates the next claim anyway.
- Rejected window whose `resetsAt` has passed → `claudeRateBlock` is null at read time → `state` omitted; the stored row stays as the last reading (windows are never deleted by the reader).
- An `allowed`/`allowed_warning` report overwrites the window → block lifts immediately.
- Switching the enabled subscription does not clear `quotaWindows`: the windows describe that account's token, which keeps its own truth; the existing `machine.claudeRateLimits` clear on switch is unchanged.
- Event without `unifiedWindows`, with an empty object, or whose top-level type is not a window name → exactly the notices it carried before this change (top-level notice emitted once).
- Events on a session not bound to a step (subscription verification, ad-hoc runs) report no `stepId` → machine windows only.

## Fields that stay unfilled, by design

- `plan` on both vendors — the token does not expose the plan.
- `state: 'cooling'` — reserved for a temporary, still-usable slowdown; `allowed_warning` keeps the account usable so it maps to `ok`, and `rejected` maps to `exhausted`. Nothing produces `cooling` today.
- devin `windows`/`state`/`cooldownUntil` — no devin window source exists; the devin wire fields are the same declared-but-unpopulated class, intentionally left for a future source.
- `windows` entries with unknown utilization are stored but not sent (see read path).

## Tests, one per path

Daemon (`map-claude-event.test.ts`, `claude-quota-trip.test.ts`, `step-pass-controls.test.ts`): unifiedWindows emits one notice per named window incl. `five_hour` with the event's status; shared name dedupes to the unified entry; top-level-only event emits one notice; window-less type beside unifiedWindows keeps both; report carries `stepId`; controls pass the running step's id.

Server (`claude-rate-limit.test.ts`, `claude-subscriptions.test.ts`, `devin-subscriptions.test.ts`): bound stepId upserts `quotaWindows` and still writes machine windows; missing/unbound/foreign-machine stepId writes machine windows only; post-finish report still attributes; list maps windows/state/cooldownUntil/lastUsedAt/stepsLast24h; expired `resetsAt` returns to ok; never-used sends nulls; devin list sends usage stats without window fields.
