# Several Claude subscriptions, one enabled at a time

Status: revision 3, proposed on 2026-11-15 (answers two independent reviews, both FAIL). Owner decisions (mon X, 2026-11-15): save several named Claude subscription tokens; at most one is enabled and all may be off; switching is done on the server atomically and fails safe; a switch is refused while the old account has running or accepted tasks; queued or quota-paused tasks never move to the new account on their own; hitting a quota never switches accounts; after a stop and a manual switch the UI has one "continue" and the backend decides between resuming the old session and starting a new run, with no routine confirmation; every run records its account and session identity; no promise of cache reuse across accounts. Source: the coordination artifact "Cairn dual-engine plan", section 10, revision 5. The page belongs to T-01a1deb7-aa24-75c8-9a0a-a82608edcb36; this document owns the server contract.

"Instance" and "team" coincide in the personal edition (one team), so the uniqueness is per team.

## Delivery in three PRs

| PR | Content |
|---|---|
| A | Schema, migration, binding at claim, token by binding, enabled-only semantics. No new route. |
| B | Enable, disable, rename, delete rules, precheck, rate-limit reset, `GET /:cid/steps`. |
| C | The account hold, new session after a switch, the chief path, `account-switched` queue reason. |

## Today

`claude_subscription` holds one sealed token per row. `activeSubscriptionRow` picks the newest unexpired row, so saving a second token silently replaces the first. `openClaudeSubscription` hands that row's token to any claimed `claude-code` step. `step` records no account. Machine rate-limit state (`machine.claudeRateLimits`) is per machine, not per account.

## Persistent state

| Change | Meaning |
|---|---|
| `claude_subscription.enabledAt` integer, null | null = disabled. Partial unique index on `(teamId)` where `enabledAt is not null`: the database refuses a second enabled row. |
| `step.claudeSubscriptionId` text, null, no foreign key | The stored account a `claude-code` step was claimed with; null when no stored account was enabled (the machine's own login runs) or the step is not `claude-code`. Set in the claim, never later. The id outlives a deleted account as history. |
| Migration backfill | Per team, `enabledAt = createdAt` on the newest unexpired row (today's "newest wins", so an existing install behaves the same). Every currently claimed step with `machineId` not null gets that row's id (SQL cannot tell the runtime; harmless, token delivery also checks the provider; at worst a switch is refused slightly longer). Older history keeps null. Number: next free number on `main` at delivery (0170 today). |

## Semantics of "enabled" (PR A)

`hasActiveClaudeSubscription` and `activeSubscriptionRow` mean: the team has an enabled, unexpired row. Consequences, all intended: with rows present but all disabled there is no stored account (gates such as `claudeUsageGatePasses`, `claudeCodeLoginBlocked`, `step-route` and `machine-routing` then treat the team as having none, exactly as a team with no rows does today); an expired enabled row means none, the next account is never picked automatically. With exactly one enabled row every caller behaves as today. Rows created: enabled if and only if the team has no unexpired enabled row, and the same transaction clears the `enabledAt` of an expired enabled row. So the first token is enabled, a new token replaces an expired enabled one (rotating an expired token works from PR A alone), and the existing end-to-end sequence create, delete, create stays enabled; a token saved next to a live enabled one is disabled. Test fixtures that insert rows directly (`chief-demotion.test.ts`, `capability-route.test.ts`) set `enabledAt`.

## Binding and token delivery (PR A)

- Worker claim: inside the existing claim transaction (`machine-claim.ts`) bind `claudeSubscriptionId` to the enabled unexpired account when the step's effective provider is `claude-code`; the claim `UPDATE` always writes the id or null, so a re-claim on another runtime never keeps a stale binding. Release paths (quota park, abandoned sweep, finish, hand-back) update only the columns they name, so the binding of the run a step lost survives, which the hold needs.
- Chief claim: `claimPendingChiefStep` gains an explicit `bindTeamId` argument passed only by `buildChiefClaim` when the model provider is `claude-code`; the in-server Coordinator call (`machineId` null, no Claude Code) never binds. The binding is a subquery in the same `UPDATE`, filtered on `enabledAt` and expiry.
- Token: `resolveStepCredentials`, `resolveChiefStepCredentials` and `openClaudeSubscription` take the step's bound id and deliver that row's token only, using the same provider rule as the claim (`fallback.model.provider ?? agent.provider`). Null binding, a deleted row or an expired row delivers nothing and never falls back to another account. Delivery stays after the claim, owner-only storage unchanged.

## Switch API (PR B, owner session, team scoped)

All under `/api/teams/:id/claude-subscriptions`.

| Request | Behavior |
|---|---|
| `GET` | Existing fields plus `enabled: boolean` and `enabledAt: number \| null`. |
| `POST` | Creates a row (the create rule above). |
| `PATCH /:cid` `{label}` | Rename; opens the sealed token and applies the existing rule that a label must not contain the token. |
| `POST /:cid/enable` | Switch to this account. Idempotent when already enabled. |
| `POST /:cid/disable` | Disable; refused with the running-task rule when the account has running steps. |
| `DELETE /:cid` | As today; the enabled account with running steps is refused; deleting the enabled account leaves none enabled. |
| `GET /:cid/steps?limit=20` | New: the account's steps by `step.claudeSubscriptionId`, newest first, `AccountStepsPage` shape (`apps/web/src/api/claude-accounts.ts`), outcome `running` for claimed steps. |

`GET /stickiness` is not built: with one enabled account there is no per-thread stickiness; the page treats the 404 as empty.

Errors are `409` with the body `{ error, code, reason?, running? }`, all top level: `code` is `running-tasks` (with `running`: the number of blocking claimed steps; nothing changed), `precheck-failed` (with `reason`: `auth`, `timeout`, `unavailable` or `failed`; the old account stays enabled), `expired`, or `conflict`. `HttpError` gains an optional set of extra body fields for this; `reason` keeps its existing meaning elsewhere.

### Switch transaction

1. Precheck outside the transaction with the lower-level `verifyClaudeSubscription` on the target's token (not the per-connection 10 second window used by the explicit verify route, so a recent explicit verify does not block a switch). Every non-ok result fails closed as `precheck-failed`, including `unavailable` (no `claude` binary on the server host): the old account stays, and the reason tells the user why.
2. One synchronous transaction: re-load the target (it can be deleted or expire during the precheck: 404 or `expired`), count steps with `status = 'claimed'` bound to the currently enabled account; more than zero rolls back with `running-tasks`; otherwise clear the old `enabledAt`, set the target's and reset `claudeRateLimits` of the team's machines to empty, on every enable including from none (the recorded rejection belongs to the old account). A unique-index violation maps to `conflict`.

Claims are synchronous and single process: a step is bound to exactly one account and a switch sees every bound running step. No code path switches accounts on a rate limit.

## The account hold (PR C)

A pending worker step is held, not claimable, when its runtime is `claude-code`, it was not created by a person (`step.byPerson` false), and either of these is non-null and differs from the enabled account (no enabled account counts as differing, so a stale binding never runs on the machine's own login): the step's own stale binding (a released or quota-parked step keeps the id of the run it lost), or, when the step would continue a session, the latest prior step's binding. A null binding means the step ran on the machine's own login or before this feature and stays resumable. Only `claude-code` steps are compared, so pi or Codex priors are ignored, and review, verify and merge steps (fresh sessions, no continuation) are held only by their own stale binding.

- Where: one function `accountHold(db, stepRow)` used by `claimCandidates`, `refreshClaudeRateParks.consider` (a quota-parked step is not released while held) and `step-queue.ts` (new `StepQueueBlocked` kind `account-switched` in shared and web).
- It is evaluated again inside the claim transaction against the enabled account read in that same transaction; if the step became held, or the account the earlier gates used changed, the transaction returns false and the claim retries next tick. The `session` field uses the same fresh-or-continue decision.
- A person-created step (the "continue", a retry, a message after a stop, and `build-confirm`, which gains `byPerson`) is never held. If the prior account differs it starts a new run: `priorSessionOf` returns no prior session and `freshSession`, so the claim says `new`, and the existing blocker handoff text carries the goal; files stay in the workspace.
- Release path: a held step is released by the existing stop followed by the person's continue (a stopped pending step is finished by `applyStoppedStep`, and continue creates a `byPerson` step); the queue reason offers stop. No new supersede logic touches the build or todo phase.
- Chief turns are not held. A thread whose last chief step ran on another account claims with `action: 'new'`; the history carry (#5011) supplies the earlier conversation.

## Every path that reads or writes the changed state

| Path | After |
|---|---|
| Create, rename, enable, disable, delete | as the API table |
| Switch with running bound steps | refused, nothing changed |
| Switch, target fails precheck, is gone or expired | refused, old stays enabled |
| Two switches at once | one wins, the other `conflict` |
| Worker claim | binds the enabled account atomically; re-checks the hold inside the transaction |
| Chief claim (Runner) | binds atomically; new session after a switch |
| In-server Coordinator claim | never binds |
| Step token | bound account only |
| `hasActiveClaudeSubscription` and its callers | enabled-and-unexpired; unchanged with one enabled account |
| Rows exist, all disabled | no stored account |
| Pending automatic step, differing non-null binding | held `account-switched` |
| Pending person step, differing prior | new run, fresh session |
| Held step | released by stop then continue |
| Pending step, null binding or null prior | resumable as before |
| Quota-parked step with a stale binding | stays parked while held |
| Quota rejection recorded for the old account | cleared at every enable |
| Claim running during the migration | backfilled binding keeps its token |
| Existing single-token install | upgraded with that token enabled |

## Tests

PR A: unique index (two enabled rows in a team refused, two teams fine); create rule (first enabled, later disabled, delete then create enabled); binding for worker and Runner chief claims, none for the in-server Coordinator, none when the provider is not `claude-code`; token by binding: a later switch does not change a running step's token, a null or deleted bound account delivers nothing; all-disabled and expired-enabled behave as no account; migration backfill with two rows and a claimed step; regression: `claude-login-claim`, `claude-subscription-verification`, the subscription end-to-end test, `machine-step-token`.

PR B: enable swaps atomically; precheck failure keeps the old (fake verifier), including `unavailable`; running bound step gives `running-tasks` with the count; target deleted or expired during the precheck; idempotent enable; concurrent enables yield one winner; disable and delete rules; rename token check; rate-limit reset lets a parked machine claim; `/steps` shape and outcomes; no response contains a token.

PR C: automatic pending step held after a switch, shown as `account-switched`; person step after a switch starts a new session; null prior and null binding stay resumable; pi prior ignored; review, verify and merge not blocked by a session-less prior; parked step not released while held; a held step is released by stop then continue; `build-confirm` sets `byPerson`; hold re-check inside the claim transaction when a switch lands between the gates and the claim; chief turn after a switch starts a new session.

## Security

Credential path (`claude-subscriptions.ts`, `credentials.ts`, `machine-step-token.ts`) and machine claim (`machine-claim.ts`) change. No list or switch response returns a token; none is logged; delivery stays after the claim, to the machine that owns the step, and narrows to the bound account. The new routes use `requireOwnerSession` like the existing ones and stay blocked for API keys. A head-bound independent security review is done before each PR.

## Not in this change

The page (T-01a1deb7), per-account quota display, any automatic switching, a different account per project or task.
