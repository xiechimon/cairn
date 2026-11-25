# Runner claim operation fencing

A claim is identified by `(machineId, stepId, claimedAt)`. A same-machine reclaim changes `claimedAt`; a shared mutable client must never promote an older runner to the new claim.

## States and transitions

Pending becomes claimed with a strictly increasing generation. Release invalidates claim-scoped operations. Reclaim creates a new identity. Completion retains its existing explicit generation and terminal-report handling. Repository archive requests are machine-scoped snapshot grants, not step claims; they retain their separate request authorization.

The daemon creates an immutable client per claim. Every claim-scoped HTTP request carries generation in the query. Orb binds its host-known claim before forwarding any operation; worker arguments cannot choose a different generation. Upload grants retain the issuing generation and revalidate after reading the body.

The server checks machine ownership, claimed status, and generation in an immediate transaction with synchronous mutations. Asynchronous relay operations carry a claim assertion: repeat authorization before applying writes or initiating subsequent effects after an await. No transaction holds an asynchronous operation open. Completion keeps its existing preparation and final fenced transactions.

## Routes

| Route in `routes-machine.ts` | Classification and authorization |
| --- | --- |
| `POST /enroll`, `/enroll/start`, `/enroll/poll`, `/enroll/confirm` | Enrollment keys or the pending enrollment challenge; no claim exists yet. |
| `GET /me` | Current machine credential. |
| `POST /orbs/closed` | Current machine and its conversation ownership, not an executing claim. |
| `POST /presence`, `/offline`, `/rate-limit` | Current machine; effects describe the host, not a step claim. |
| `POST /recover`, `/tasks/claim` | Current machine; recovery releases existing work, claim creates a new generation. |
| `GET /stream` | Current machine connection and connection identity. |
| `GET /steer`, `POST /steer/ack`, `GET /stop` | Query `stepId` and immutable claim generation; scoped database mutations. |
| `POST /heartbeat/:stepId` | Current claim; heartbeat and first-step provenance share one fenced transaction. Missing rows retain 410; released rows retain 404. |
| `POST /tool/:stepId` reports | Current claim before dispatch; covers tool rows, transcript/thinking deltas, activity, agent todos, background tasks and transcript rows. |
| `POST /tool/:stepId` relays | Current claim before dispatch; scoped write builders and hubs recheck ownership, status, generation and credential in immediate transactions. GitHub/MCP/connector transports recheck before subsequent outbound effects. |
| `POST /tool/:stepId` computer forwarding | Current claim on entry; scoped dependencies also fence writes and signals made by the asynchronous forwarder. |
| `POST /ask/:stepId` | Current claim; question writes are scoped and returning a held answer rechecks the claim. |
| `GET /token/:stepId` | Existing explicit generation, repository pin and credential revalidation. |
| `GET /skills/:stepId`, `/skills/:stepId/file` | Current claim before listing or reading. |
| `GET /attachment/:stepId/:attachmentId` | Current claim plus existing team and human-text attachment grants. |
| `POST /upload-urls/:stepId` | Current claim for plan, transcript and session grants; independently authorized repository-archive requests remain machine-scoped snapshot grants. |
| `PUT /upload/:uploadId` | Opaque one-use grant binds machine and issuing generation; recheck after body read inside the storage transaction. Repository archives retain snapshot-request authorization. |
| `GET /session/:stepId` | Current claim before session reads. |
| `POST /local-merge-recheck/:stepId` | Current claim plus existing landing instruction/state checks. |
| `POST /done/:stepId` | Existing explicit generation; preparation and final application each fence the report. |
| `POST /computer/:callId` | Current responding machine and its pending computer call; not the step runner's claim credential. |
| `POST /im/:connId/event` | Current machine and the IM connection it hosts; not a step claim. |

Paths above are relative to `/api/machine`, except opaque upload paths. `scopeMachineClaim` checks before entry, at each synchronous write terminal (`run`, `get`, `all`, `execute`, or promise execution), inside explicit transactions, and before hub methods. The assertion uses the original database, so an asynchronous operation cannot accidentally authorize itself against its old snapshot. No transaction spans an await. Scoped database aliases register their original identity, so schedule-clock listeners and thread-presence push suppression still address the same database as owner-side requests.

## Settlement effects

State, usage, verdicts, push ledger records, notification records, schedules and retry rows are transactional. Hub publication, wake/steer/stop signals use fenced hub scheduling. Runtime spans, provider outcomes/liveness/probes, coordinator snapshots and IM notifications use `runAfterCommit`. Report attachment writes and computer tab/call cleanup use the same after-commit queue. Push provider sends and effect draining must start after the outermost commit. Verdict digest enrichment, including credential resolution and GitHub requests, must start after the outermost commit. Async GitHub discovery and repository landing performed before final settlement remain pre-settlement work; the claim is checked again before state application.

| Outbound settlement effect | Deferral boundary |
| --- | --- |
| Team/conversation publication, machine wake, steer and stop signals | `withFencedTransaction` supplies deferred hubs; nested fences forward their queues to the parent. |
| Step/build runtime spans | `machine-finish-step`, `build-rows`, `build-step-failure`, `build-stop`, `ci-loop-rows`, and `coordinator-steps` call `runAfterCommit`. |
| Provider outcome, dead-model marking and probe reservation | `machine-finish-step` and `model-fallback` call `runAfterCommit`. |
| Coordinator turn snapshot and IM turn completion | `coordinator-steps` calls `runAfterCommit`. |
| IM notification delivery | `notifications` records state, then schedules `imNotice` through `runAfterCommit`; question helpers preserve the caller's commit-effects context. |
| Owner/question/mail push | All `pushToUserSafely` callers pass commit effects; ledger creation is transactional, provider execution and draining use `dispatchPush` after commit. Mail is an independent entry path, not completion settlement. |
| Retired gate digest enrichment | `build-gate-verdict` defers the entire task, including credential lookup, GitHub compare/PR/branch requests and in-flight registration. |
| Report attachment bytes | `info-handoff` schedules `writeInfoReport`. |
| Browser tab closure and computer-call waiter cleanup | `machine-computer` schedules `browser_close_tab` and `settleComputerCall`. |
| Delivered-plan confirmation | `build-step-complete` schedules `confirmDeliveredPlan`. |
| Schedule clock wake | `schedules` forwards commit effects to `notifyScheduleClock`; retry and schedule rows stay transactional. |
| PR discovery, merge/space landing | Async preparation outside the final settlement; final state application revalidates the claim, not network I/O inside a SQLite transaction. |

Nested transaction effects join the parent queue. Rollback discards that queue, leaves no provider sends or digest requests, and exposes the real failure. A workflow-permission refusal is permanent and takes precedence over quota/capacity fallback metadata.

## Credential retention

A step-local registry deduplicates plaintext, removes expired entries, has a fixed capacity, and rejects further live entries rather than evicting a still-live secret. Cleanup clears the registry and its pruning timer. Dynamic redaction reads the current registry, while GitHub token-format redaction protects historical installation tokens without retaining their plaintext.

## Verification

Use same-machine G1-to-G2 reclaim tests for missing/stale requests, stale upload grants and asynchronous relay application; assert G2 rows remain unchanged. Use nested rollback tests with mocked push providers and GitHub transport. Verify permission refusal with simultaneous quota metadata. Exercise registry expiry, capacity, live-secret redaction and cleanup. The preservation integration fixture must carry the generation it actually claimed, without weakening production authorization.

## Protocol skew

A runner built before claim generations sends none. A server that demanded one answered every claim-scoped call from it with 409 after handing it the claim, so the step stayed `claimed` and the Coordinator thread blocked until the 30-minute turn cap. Claim-then-409 is never allowed.

The runner declares `capabilities.claimGeneration: true` in its enroll and presence reports; the server stores it in the machine row (`machine-capabilities.ts`). `claimGenerationAccepted` (`machine-claim-scope.ts`) is the one rule every fence uses: `assertMachineClaim`, `fenceClaimSnapshot` and `fenceLiveClaim` in `machine-step-token.ts`, and `prepareStepReport` in `machine-finish-step.ts`.

| Request | Runner declares `claimGeneration` | Result |
| --- | --- | --- |
| Carries a generation | Either | Accepted only when it equals the step's `claimedAt` |
| Carries none | Yes | 409: this runner speaks the protocol, so a missing generation is a stale or broken caller |
| Carries none | No (older runner) | Machine ownership, claimed status and token decide, as before generations |

Generation is a staleness fence, not an authorization boundary: the token holder receives the generation in the claim response, so accepting a missing one from an older runner grants nothing the token did not. The alternative, refusing to hand claims to runners without the flag, was rejected: it keeps every older runner's Coordinator down until the user updates, and it needs a new claim-body marker that runners speaking generations today do not send. The runners list shows "Needs a Cairn update" on an online runner whose stored capabilities lack the flag (`runnerNeedsUpdate`).

## Dead claims

A claim is dead when its runner no longer runs the step. The server cannot ask; it reads the evidence it has.

| Evidence | Where it is read | Effect |
| --- | --- | --- |
| No heartbeat for 45 s (`DEAD_TURN_MS`; runners beat every 30 s, and a beat rejected by a fence never lands), or the owning machine was removed | `claimIsDead` in `dispatch-timeouts.ts`, on an owner stop | The first stop settles the turn as stopped; no grace |
| Same evidence, or the runner is offline or silent since its channel dropped | `endDeadChiefTurn` in `chief-turns.ts`, on a new message to the thread | The turn ends and the message starts the next one |
| Stop delegated to a live runner that never answers | `sweepOverlongChiefTurns`, 2 min after the stop | Settled as stopped |
| Chief step claimed by an online runner, no heartbeat since the claim for 2 min | `sweepAbandonedChiefSteps` | Released to pending; the third such release stops the turn, so a runner that drops it every time cannot loop it |
| Chief step on an offline runner, stale for 2 min | `sweepAbandonedChiefSteps` | Released to pending (unchanged; offline is suspension, not death) |
| Runner's `runStep` throws after the claim | `reportCrash` in the daemon's `runner.ts` | Reports `failed` with the error at once; if that report fails, the abandoned sweeps above apply |

A stop broadcast reaches every runner of the team; runners that do not own the step get 404 "not yours" and drop it. That 404 is not evidence about the owner and settles nothing.

## Credentials of another server

`machine.json` belongs to the server its `serverUrl` names. The installed desktop app shares `~/.cairn` with the CLI runner; when that home already holds a registration for a different server, the desktop runs its runner in its own `runner-home` instead of enrolling over it (`localRunnerHome` in `apps/desktop/src/runner-home.ts`). The CLI runner enrolls only when no valid `machine.json` exists. A runner whose stored credentials get 401 at startup logs which server they belong to and how to re-enroll, then waits until `machine.json` changes and restarts once, instead of exiting into a launchd crash loop.
