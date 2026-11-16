# Coordinator on Claude Code (subscription)

Status: revision 4, proposed on 2026-11-15. Owner decision (mon X, 2026-11-15): the Coordinator must also run on Claude Code and use the stored Claude subscription, not only tasks. Pi never uses the subscription (ruled out on 2026-11-14: Anthropic terms and #1846). Revision 4 answers two independent reviews and one CI failure: the worker-cap change is dropped, the queue explanation claim is narrowed, and the history replay is dropped. A replay in the system prompt put user and issue text at system trust, which `issue-fence.test.ts` forbids; the loss is recorded as a limit below.

## What already works

With the production flags (`coordinatorInServer` on, so `coordinatorRunsOnPi()` is true) and a stored `coordinator` routing rule whose provider is `claude-code`:

- `coordinatorRoute()` is `null` for that rule: no provider row named `claude-code` exists, so `serverTakesTurn()` is false and the in-server runtime never claims the chief step. Both sides read the stored rule with `coordinatorProfile(db, teamId)` without the default, so a default rule can never resolve to `claude-code` and no step is claimed by both or by neither. `claimPendingChiefStep` is a compare-and-set on `status = 'pending'`.
- `claimChiefTurn()` lets the Runner that owns the rule (`routingRule.machineId`, else the team's sole or default machine) claim the step after `runtimeGatePasses`, `claudeUsageGatePasses` and `claudeCodeLoginBlocks`, and builds the payload in `chiefClaimPayload()`: system prompt with memories, instruction, relay tools, session continue or new.
- The stored token reaches the claude process through `resolveChiefStepCredentials()` and the machine step token, only after the claim.
- The daemon runs the turn on the Claude Code backend with `isChief` and `lockedDown`: built-in claude tools stay off, relay tools are the only way to act. Steer and stop use `steerPending` and work for Runner turns.

Proved offline by `integration/test/coordinator-claude-code-e2e.test.ts`: real server and real daemon, fake `claude` binary, stored token, claude-code Coordinator rule, production flags on. Two turns on one thread each produce one `done` chief step claimed by the Runner, one reply each, no token in messages or daemon log.

## Gaps and decisions

| # | Gap | Decision |
|---|---|---|
| 1 | `coordinatorRouteVerdict()` treats `claude-code` as a provider without a row and returns `rule-provider-missing`. For a chief step without a home machine the queue then says "Coordinator provider missing" about a rule that works. | The verdict returns `null` ("not the server's turn") when the rule's provider is exactly `claude-code`. The queue then falls through to its machine checks (`machine-offline`, `runtime-disabled`, `capability-missing`). Claude login, usage and rate-limit reasons are claim-time checks that the queue does not model; this change does not add them. `step-queue.ts` also stops recomputing the verdict for every row when it is `null`. `gemini` is not touched: `isBackendRuntimeId` includes it but the Coordinator gate maps it differently. |
| 2 | Context after switching to Claude Code. A thread that ran on the in-server runtime has `sessionId = ''`, so Runner turns hold only the system prompt, memories and what the claude session itself has seen. The Coordinator forgets the earlier conversation. | Not changed here. A replay inside the system prompt was built and removed: it put user and issue text at system trust, and `issue-fence.test.ts` requires the chief system prompt to contain none. A later change must carry history as fenced data in the user turn without writing it into the transcript row or journal; it needs its own design. |
| 3 | Runner worker cap. `claimChiefTurn()` stops when `machineRunningCount >= workerCapOf()`, so a Coordinator reply can wait behind tasks. | Unchanged. This is the deliberate #1260 behavior (`machine-concurrency-chief.test.ts`). Recorded as a known limitation: with the Runner full of tasks the Coordinator reply waits for a free slot. |
| 4 | Session lost on the Runner (other machine, cleaned session files). The daemon falls back to a new session with system prompt and latest message only. | Unchanged and recorded as a known loss. Fixing it needs a wire field plus a daemon prefix that must stay out of the journal and the transcript row; not worth it before real use shows the need. |
| 5 | Latency: one claude process per turn, `resume` of the session. | Unchanged. Baseline: Runner chief turns claimed in a median of 75 ms and ran a median of 88 s including tools. Measured on a real run after the Runner runtime is available. |
| 6 | Runner offline. | The turn waits. No silent fallback to an API key or the server runtime: it would spend a different bill than the owner chose. |
| 7 | A Coordinator tool schema outside the Claude Code backend's vocabulary. `decide_report_suggestion` (added on main) used `enum`; the backend fails closed on it, so every Claude Code Coordinator turn failed before the first message. Found by the end-to-end test after rebasing. | The `decision` parameter is a plain string whose description names the two values; the server already rejects anything else (`chief-router-tools.ts`). A daemon test converts every Coordinator tool schema through the backend's `parametersToShape`, so a later tool cannot silently break the Claude Code Coordinator again. The backend's fail-closed vocabulary is unchanged. |

## Persistence and protocol

No tables, columns, migrations, wire fields, shared schema or snapshot changes. Token delivery, `machine-step-token.ts`, `credentials.ts` and the secret channel are not touched.

## Every path that reads or writes the changed behavior

| Path | After the change |
|---|---|
| Verdict for a pi provider rule | Unchanged. |
| Verdict for a `claude-code` rule | `null`; in-server never claims, the Runner does. |
| Verdict for missing provider row or missing key | Unchanged refusals. |
| `coordinator/credentials.ts` | Unchanged: it already returns nothing for a `null` route. |
| Queue projection, unpinned chief step, `claude-code` rule | `machine-offline` or the machine-side reason instead of "provider missing". |

## Tests

1. Verdict: `claude-code` rule is `null`; a pi rule without a key still refuses; the unpinned queue projection no longer reports `coordinator-provider-missing`.
2. Claim: the Runner claims the chief step of a `claude-code` rule and the server does not.
3. End to end (`integration/test/coordinator-claude-code-e2e.test.ts`): real server and daemon, fake `claude`, stored token, production flags: two turns, one reply each, one done chief step per turn on the Runner, token absent from messages and daemon log.
4. Regression controls: `claude-login-claim`, `coordinator/runner`, `machine-concurrency-chief`, `capability-pending-reason` and the Claude Code task e2e stay green.

## Security

No credential path changes and no change to what a Runner receives: `machine-claim.ts` is untouched. The change is the routing verdict, a queue cache, one tool schema and tests.

## Not in this change

The Runner runtime toggle removal (another thread), real-account acceptance, multi-subscription.
