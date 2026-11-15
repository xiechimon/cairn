# Several Claude subscriptions, one enabled at a time

Status: revision 1, proposed on 2026-11-15. Owner decisions (mon X, 2026-11-15): save several named Claude subscription tokens; at most one is enabled for the whole instance and all may be off; switching is done on the server atomically and fails safe; a switch is refused while the old account has running or accepted tasks; queued or quota-paused tasks never move to the new account on their own; hitting a quota never switches accounts; after a stop and a manual switch the UI has one "continue" and the backend decides between resuming the old session and starting a new run, with no routine confirmation; every run records its account and session identity; no promise of cache reuse across accounts. Source of the decisions: the coordination artifact "Cairn dual-engine plan", section 10, revision 5. The page belongs to T-01a1deb7-aa24-75c8-9a0a-a82608edcb36; this document owns the server contract.

## Today

`claude_subscription` holds one sealed token per row. `activeSubscriptionRow` picks the newest unexpired row, so saving a second token silently replaces the first. `openClaudeSubscription` hands that row's token to any claimed `claude-code` step. `step` records no account. Machine rate-limit state (`machine.claudeRateLimits`) is per machine, not per account.

## Persistent state

| Change | Meaning |
|---|---|
| `claude_subscription.enabledAt` integer, null | null = disabled. Partial unique index on `(teamId)` where `enabledAt is not null`: the database refuses a second enabled row, so no race can store two. |
| `step.claudeSubscriptionId` text, null, no foreign key | The stored account a `claude-code` step was claimed with; null when no stored account was enabled (the machine's own login runs). Set in the claim itself, never later. The id outlives a deleted account as history. |
| Migration backfill | For each team, `enabledAt = createdAt` on the newest unexpired row (exactly today's "newest wins", so an existing install behaves the same). Every currently claimed `claude-code` step gets that row's id. Number: next free number on `main` at delivery (0170 today; 0167 to 0169 are taken). |

Enabled and expired: an expired enabled row counts as no account; the next account is never picked automatically.

## Server API (owner session, team scoped)

All under `/api/teams/:id/claude-subscriptions`.

| Request | Behavior |
|---|---|
| `GET` | Existing fields plus `enabled: boolean` and `enabledAt: number \| null`. |
| `POST` | Creates a disabled row, except the first row of a team, which is enabled. |
| `PATCH /:cid` `{label}` | Rename. |
| `POST /:cid/enable` | Switch to this account (below). Idempotent when already enabled. |
| `POST /:cid/disable` | Disable. Refused with the same running-task rule when the account has running tasks. |
| `DELETE /:cid` | As today; refused with the running-task rule when this is the enabled account with running tasks; a deleted enabled account leaves none enabled. |

Errors are `409` with the body `{ error, code, reason?, running? }`, all top level (the web client reads `error` and `reason` from the body): `code` is `running-tasks` (with `running`: the number of blocking running steps; nothing changed), `precheck-failed` (with `reason`: `auth`, `timeout`, `unavailable` or `failed`; the old account stays enabled), `expired`, or `conflict` (a concurrent change won; retry). `HttpError` gains an optional set of extra body fields so these routes use it; `reason` keeps its existing meaning for other routes. `429` from the verification window passes through. The page lists the blocking runs with `GET /:cid/steps?limit=20` (the existing `AccountStepsPage` shape, outcome `running`), which this change backs with `step.claudeSubscriptionId`. `GET /stickiness` is not built: with one enabled account there is no per-thread account stickiness, and the page treats the 404 as empty.

### Switch transaction

1. Load the target; unknown is 404; expired is `409 expired`; already enabled returns 200.
2. Precheck outside the transaction: `verifyClaudeSubscription` on the target's token. A failure is `409 precheck-failed` and nothing changes, so the old account stays enabled.
3. One synchronous transaction: count steps with `status = 'claimed'` and `claudeSubscriptionId` equal to the currently enabled account. More than zero rolls back with `409 running-tasks`. Otherwise clear the old `enabledAt`, set the target's, and reset `claudeRateLimits` of the team's machines to empty (the recorded rejection belongs to the old account and would otherwise park the new one). A unique-index violation maps to `409 conflict`.

Claims run in synchronous transactions in the same process, so the claim and the switch are serialized: a step is bound to exactly one account and a switch sees every bound running step.

## Binding and credentials

- Worker claim (`machine-claim.ts`, inside its existing claim transaction) and chief claim (`claimPendingChiefStep`, as a subquery in the same `UPDATE`) set `claudeSubscriptionId` to the enabled unexpired account when the effective runtime is `claude-code`, else leave it null.
- `openClaudeSubscription` delivers the token of the step's bound account only; null binding or a deleted or expired bound row delivers nothing and never falls back to another account. Token delivery stays after the claim and owner-only storage is unchanged.

## Moving work between accounts

`priorSessionOf` (the one place that decides continue or new for worker steps) also reads the latest prior step's `claudeSubscriptionId` and takes the team id. When that prior account differs from the enabled one:

| Step | Result |
|---|---|
| Created by a person (`step.byPerson`: the one "continue", retry or message after a stop) | claims normally on the enabled account with `freshSession = true` and no prior session, so a new run starts and the existing blocker/handoff text carries the goal and progress; the files stay in the workspace. |
| Automatic (queued behind it, quota resume, auto retry) | not claimable: it stays pending with queue reason `account-switched`; it never runs on the new account by itself and never gets its old session on the new account. |

Chief turns: a thread whose last chief step ran on another account claims with `action: 'new'` (the Coordinator history carry, #5011, supplies the earlier conversation), so replies are never blocked by a switch.

No code path switches accounts on a rate limit; the quota parking code is untouched.

## Every path that reads or writes the changed state

| Path | After |
|---|---|
| Create, rename, enable, disable, delete | as the API table |
| Switch with running bound steps | refused, nothing changed |
| Switch, target fails precheck | refused, old stays enabled |
| Two switches at once | one wins, the other `conflict` |
| Worker claim | binds the enabled account atomically |
| Chief claim | binds atomically; new session after a switch |
| Step token | bound account only |
| `hasActiveClaudeSubscription` and callers (`claudeUsageGatePasses`, login gates, step routing) | true when an unexpired enabled account exists; behavior with exactly one enabled account is unchanged |
| Pending step with prior account different, automatic | held with `account-switched` |
| Pending step with prior account different, by a person | new run on the enabled account |
| Quota rejection recorded for the old account | cleared at switch |
| Claim already running during the migration | backfilled binding keeps its token |
| Existing single-token install | upgraded with that token enabled, same behavior |

## Tests

1. Unique index: two enabled rows in a team cannot be stored; two teams can each have one.
2. Enable: success swaps atomically; precheck failure keeps the old account (fake verifier); running bound step gives `running-tasks` and changes nothing; expired target; idempotent enable; concurrent enables yield one winner; disable and delete follow the rule; first row is enabled, later rows are disabled.
3. Binding: worker and chief claims record the enabled account; a claim after a switch records the new one; a step with no enabled account records null and receives no token; token delivery uses the bound account even if a different one is enabled later; a deleted bound account delivers nothing.
4. Moving work: a person step after a switch gets a new session on the new account; an automatic pending step is held and shown as `account-switched`; a chief turn after a switch starts a new session.
5. Machine rate-limit reset on switch lets a previously parked machine claim again.
6. Migration: a team with two rows and a claimed step is backfilled as specified.
7. Regression: `claude-login-claim`, `claude-subscription-verification`, the subscription end-to-end test, `machine-step-token`, and the one-account behavior of every caller of `hasActiveClaudeSubscription`.

## Security

Credential path (`claude-subscriptions.ts`, `credentials.ts`, `machine-step-token.ts`) and machine claim (`machine-claim.ts`) change. No token is returned by any list or switch response, none is logged, and delivery still happens only to the machine that owns the claimed step. The change narrows delivery (bound account only). A head-bound independent security review is done before the PR.

## Not in this change

The page (T-01a1deb7), per-account quota display, any automatic switching, using a different account per project or task.
