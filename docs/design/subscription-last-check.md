# Subscription last check

A newcomer adds a Claude, Devin or Antigravity subscription in Settings › Model and needs to know two things: does it work, and how much is left. Before this change the detail page said `可用` for any token that had not expired, whether or not anything had ever checked it, and the outcome of the `验证` button lived only in the open page: a refresh forgot it. This change stores the outcome of the last explicit check on the subscription row and makes the status line read from it.

Bug class: a status derived from a missing fact ("no expiry known" read as "works").

## Persisted state

`lastCheck` (JSON, nullable) on `claude_subscription`, `devin_subscription` and `antigravity_subscription`:

| Field | Meaning |
|---|---|
| `at` | server time the check finished |
| `ok` | the vendor accepted the credential |
| `reason` | the verify failure reason (`auth`, `timeout`, `quota`, ...) or null |
| `check` | `model-request` (Claude: `claude -p`) or `sign-in` (Devin ACP authenticate, Antigravity credential check) |
| `command` | the command the server ran, without the credential |
| `model` | the model a model request used, or null |
| `durationMs` | wall time of the check |

`null` means never checked. Nothing in it is secret: the token is passed through the child environment and never appears in `command`.

`models` (JSON, nullable) on `claude_subscription`: the models the owner picked for the subscription. `null` keeps the previous behaviour, every model the Runners report.

## Writes

- `POST …/{vendor}-subscriptions/:cid/verify` runs the vendor check as before, then writes `lastCheck` and returns it as `check` beside `ok`/`reason`. The 10-second rate window still applies; a refused (429) attempt writes nothing.
- An expired token returns `{ ok: false }` without running anything and writes nothing: the status already says `已过期`.
- `PATCH …/claude-subscriptions/:cid` accepts `models` beside `label`.
- `POST …/claude-subscriptions/:cid/test {model}` runs one `claude -p --model <id>` with the subscription token and returns a `ProviderTestResult`. It writes nothing; it shares the verify code path and has its own 10-second window per subscription and model.

## Reads

- The list endpoints send `lastCheck` (and `models` for Claude).
- `getModelSources`: when the team's enabled Claude subscription has `models`, each Runner's Claude Code source keeps only those ids. Dispatch is unchanged: it still checks the Runner's own report.

## Status on the page (one selector, `subscriptionStatusView`)

Precedence: verifying (this page) › expired › exhausted/cooling › the latest outcome, which is this page's result when it has one, else `lastCheck` › `未验证` when there is none. Only a passing check says `可用`.

## Failure behaviour

- A check the browser gave up on (network, client timeout, 429) shows its sentence under the status and leaves `lastCheck` as it was.
- Migration on an existing team: every subscription starts as `未验证` until the owner presses `验证` or adds a new one (adding verifies automatically).

## Tests, one per path

Server: verify writes `lastCheck` with the command and no token; a failed check writes `ok: false` and its reason; an expired token writes nothing; the list sends `lastCheck`; `models` patch round-trips and filters model sources. Web: never-checked reads `未验证`; a stored passing check reads `可用`; a failing one reads its reason; the inline result shows what ran.
