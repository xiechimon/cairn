# Host the pi-durable Coordinator in the server (D114)

D114 (ian, 2026-11-06) runs the pi-durable Coordinator inside the server process, modifying D72 (sidecar) and reversing D69's "server holds no model SDK". Base: origin/main `4e9e1d54f`. Labels: **measured** (read or run this session), **inferred**.

## Sources

| Source | Files | Used for |
|---|---|---|
| D72 spike (branch `docs/pi-durable-spike`) | `docs/research/pi-durable-spike.md` §2, §9.1, §9.5 | §9.1 recommended Path A, not a sidecar; crash resume keyed on `requestId`; storage upgrades are one-way |
| t3code `6577c6b6` | `apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts:280`, `CheckpointRollbackService.ts:276-292`, `persistence/Migrations/004_ProviderSessionRuntime.ts` | Sessions inside the server; startup reconcile cancels cut-off runs instead of resuming; rollback rewinds the provider thread first |
| cloudroom `d8b3cc3a` | `core/docs/session-lifecycle.md:21,25-28,40` | Shutdown signals every harness under a 5 s budget; idle sessions sleep; unfinished dispatched work is never resent |
| Rakazo `c9bcb3a9` | `packages/adapters/src/pi-session.ts:151-157`, `pi-runtime.ts:385,640-660` | Product history is the truth and seeds each run; steering is claimed from the product DB at the turn boundary, left queued if the run ended |
| pi-durable 1.5.0 README | Storage, Busy Conversations, Reset and Handoff, Persist and Resume | One process per storage, no cross-process lock; `prefix: "pi_"` needs one adapter for Pi and host queries; `whenBusy: "steer"`, `fork()`, `beforeRequest`, `inspect()` |

## Failure modes

| # | Failure | Where today |
|---|---|---|
| F1 | Crash mid-turn | Resumes on the same step id (spike §2) |
| F2 | A stopped, failed or swept step's run resumes on next open | `runtime/harness.ts` calls `harness.resume()` unconditionally |
| F3 | A resumed run's tool calls run under the next step's id | Global `createStepGate` (`runtime/tools.ts`) |
| F4 | Rewind leaves deleted turns in Pi | `rewindChiefThread` (`chief.ts:895-960`) touches server.db only |
| F5 | Steer never delivered | `steerChiefMessage` signals `machineHub`; sidecar has no handler |
| F6 | Per-turn project, route and memory text stored as user input | `chiefClaimPayload` (`machine-claim.ts:307-310`) → `turn.ts` submit |
| F7 | Two owners open one store | `store-lock.ts` check-then-remove race |
| F8 | server.db and store diverge after restore | No reconcile |
| F9 | pi upgrade cannot roll back | Runbook "Upgrading Pi Durable" |
| F10 | Provider key in logs, rows or errors | Key crosses loopback HTTP |
| F11 | Pi commit or summarization stalls HTTP | n/a in a sidecar |
| F12 | Coordinator route resolves to nothing | Falls back to daemon Coordinator |

## 1. Placement

- New module `apps/server/src/coordinator/`: `runtime/` (moved from `apps/coordinator/src/runtime/`), plus `server-api.ts`, `runner.ts`, `reconcile.ts`, `lease.ts`, `credentials.ts`.
- `index.ts` calls `startCoordinator(deps)` after the DB opens and before `scheduler.start()`, only when `CAIRN_COORDINATOR_IN_SERVER` is on (default off until S5).
- One Harness per Coordinator thread, so one per team (#2547), opened lazily by `createThreadHarnesses`. Boot opens only threads with a claimed or pending chief step. Idle harnesses close after 30 min (cloudroom `:25-28`).
- Shutdown: the SIGTERM handler becomes async: `scheduler.stop()`, `await coordinator.close()` under 5 s (cloudroom `:21`), then server and DB close.
- **Triggering without the claim path.** The `step` row stays the durable queue, so queue projection, `chief_turn_usage` and sweeps keep working.
  - `enqueueChiefStep` and the scheduler tick call `deps.coordinator?.wake(threadId)`.
  - The runner claims the head pending step with the conditional `UPDATE` and `hasEarlierLiveChiefStep` ordering of `claimCoordinatorTurn` (`machine-claim.ts:356-397`), with `machineId = null`. It heartbeats `step.lastHeartbeatAt` directly, so `sweepAbandonedChiefSteps` (`chief.ts:1680`) still releases a dead server's claims.
  - Daemons skip these turns: `sidecarTakesTurn` becomes `serverTakesTurn`, keyed on the flag. Digest and summary steps stay on daemons.
- **D60 PR 9 and PR 10.** PR #3077 (open) turns routing on by default but still needs a bound chief agent; PR 10 (#2577) drops `agent`.
  - The runner reads the model only from `routing_rule` `use='coordinator'` (`coordinatorRoute`) and the summary from `use='compaction'`. It never reads `claimed.agent` or `chief.agentId`, so it lands after PR 10 unchanged (the orchestrator's order).
  - `coordinatorRoute` rejects every provider unless `team.claudeUsage='allow-paid'` (measured, `coordinator-route.ts:95-121`). That blocks D113's vani route, so S3 narrows the gate to Anthropic providers.
  - `injectMemories` is keyed by `agentId`; PR 10 rekeys it and the runner passes the chief id.

## 2. In-process adapter

`MachineApi` (`apps/coordinator/src/machine-api.ts`) becomes `CoordinatorServerApi`: function calls, no token, no HTTP. `ownedStep` checks become "claimed, `machineId` null, under this runner's lease".

| `MachineApi` | Replacement | Server code |
|---|---|---|
| `claim()` | `runner.claimHead(threadId)` | Claim and payload logic extracted from `claimCoordinatorTurn` and `chiefClaimPayload` (`machine-claim.ts:268-397`) into `services/coordinator-steps.ts` |
| `recover()` | `reconcile(threadId)` at open | Chief steps claimed with null `machineId`, plus `harness.inspect()` |
| `token()` | `coordinatorProviders(teamId)` | `coordinatorRoute` and `openProviderKey` (`providers.ts:259`) for both rules |
| `heartbeat()` | Timer update | Body of `heartbeatStep` (`machines.ts:481`) minus the machine check |
| `stop()` | `signals.stop(stepId)` → `conversation.abort()` | Called from `stopClaimedChiefStep` (`chief-turns.ts:379`); `stop_pending` stays the durable intent |
| `relayTool()` | Direct | `executeChiefTool` (`chief-tools.ts:311`), context as in `executeRelayToolCall` (`machine-relay.ts:115-148`) |
| `askUser()` | Direct, tool abort signal | `createOrGetQuestion`, `holdForQuestion` (`chief-questions.ts:130,196`); no 70 s retry loop |
| `transcriptRow()` | Direct | `upsertChiefMessage` (`chief.ts:1624`) plus an entry-map row |
| `transcriptDelta()` | Direct | `convHub.publishTextDelta` |
| `done()` | Direct | `finishCoordinatorTurn`, extracted from `finishStepReport`'s chief branch (`machine-finish-step.ts`) |

## 3. Storage

**Choice: separate SQLite per thread at `$CAIRN_HOME/server/coordinator/<threadId>.sqlite`, not `server.db` with `pi_`.**

| Factor | Shared `server.db` + `pi_` | Separate file |
|---|---|---|
| Driver | server.db is better-sqlite3 via drizzle (sync, `db/client.ts`); Pi uses chord `node:sqlite` with async transactions. The README requires one adapter for both, and says direct host calls "may be rolled back with a Pi transaction". A drizzle write during an open Pi transaction hits `SQLITE_BUSY`, and a sync busy-wait blocks the thread Pi needs (inferred) | Independent connections |
| One-way upgrades (spike §9.5) | Rolling back a pi bump means restoring server.db and losing product data | Restore the store only |
| Drizzle | Foreign tables in restore drill and integrity tooling; pi schema churn lands in the owner-routed DB | Untouched |
| Backup | Atomic | `backup-server-db.sh` backs up server.db first, then stores; a store ahead of server.db is a reconcile case |

This departs from t3code's single SQLite. Rakazo's rule keeps the cost small: the store is derived and re-seedable.

**Source of truth.** `chief_message` stays the UI store and the truth (D72 ④). One migration adds:

- `coordinator_conversation(threadId PK, conversationId, lastMirroredEntryId, piVersion, updatedAt)`
- `coordinator_entry(chiefMessageId PK, threadId, conversationId, entryId)`, written in the transaction of the mirrored upsert; user rows are mapped at submit.

**Reconcile at open, before `resume()`:**

1. No store: seed from `chief_summary` plus the newest 100 rows capped at 8,000 characters (`runtime/seed.ts`, spike §9.6).
2. Store beyond `lastMirroredEntryId` (server.db restored): re-mirror mapped turns, then `fork()` at the last entry with a `chief_message`.
3. `conversationId` missing from the store (store restored): re-seed up to the newest `chief_message`.
4. `piVersion` older than the pin: copy the store before opening (F9).

## 4. Defect fixes

| Defect | Fix | Proving test |
|---|---|---|
| Rewind (F4) | Still 409 while a run is active. Map the anchor via `coordinator_entry`, `fork(entryBefore)`, repoint `coordinator_conversation`; re-seed when unmapped. Pi first, then rows (t3code order) | `coordinator/rewind.test.ts`: two turns, rewind to turn 1; the stub model's next request has no turn-2 text |
| Steer (F5) | `steerChiefMessage` calls `signals.steer`. Submit `steer_pending` with `whenBusy:'steer', whenIdle:'reject', requestId: <waiting step id>`, then `ackSteer`. On `ConversationIdle` release the hold so the step runs next (Rakazo `:644`). The fixed `requestId` makes a crash before ack harmless | `steer.test.ts`: tool blocks, steer; next request contains it; waiting step ends `steered`, never runs twice |
| Stop (F6 part) | `signals.stop` aborts the submission; a stop recorded before submit is honoured at submit | `stop.test.ts`: stop mid-stream; step `stopped`, Pi `runFailure aborted`, no later tool call |
| Stale resume (F2, F3) | Open without `resume()`. For each unsettled submission from `inspect()`: adopt if its `requestId` step is claimed or pending, else `submission.abort()`. Then `resume()`. Replace the gate with `Map<conversationId, stepId>` set before submit; an unmapped tool call errors, never waits (t3code `:280`, cloudroom `:40`) | `reconcile.test.ts`: kill during tool A, mark step `stopped`, enqueue step 2, reopen; A does not rerun, step 2's tool rows carry only its id |
| Volatile context (F6) | Submit `step.prompt` only. A `beforeRequest` hook injects project, route and memory sections into that request's last user message, uncommitted. The system prompt stays stable | `volatile.test.ts`: turns in two projects; stored inputs equal raw prompts; request 2 has only project B's section |
| Lock race (F7) | `coordinator_lease` row in server.db taken under `BEGIN IMMEDIATE` (`UPDATE … WHERE owner IS NULL OR heartbeat stale`), atomic across processes | `lease.test.ts`: two handles on one file; second acquire throws until the heartbeat is stale |

## 5. Credentials and models

- `openProviderKey` (secret-box) runs inside pi-ai's `auth.apiKey.resolve` on each request, replacing `InMemoryCredentialStore.setApiKey`. No cache, so rotation needs no restart.
- No key in `step`, `chief_message`, Pi entries, `onReport` or telemetry. Error text passes `redactSecrets`. The resolver lives only in `apps/server/src/coordinator/credentials.ts` (credentials surface, §6). A test asserts a known key appears in no row or captured log after a failing turn.
- D113 models, changed by ian on 2026-11-07 (the vani account had no prepaid balance, HTTP 402):
  - Router: `use='coordinator'`, provider `openai-codex`, model `gpt-6.1-sol`, thinking `low`, because it only routes. The provider row is keyless (machine OAuth). The runtime maps it onto pi-ai's `openai-codex-responses` API at `https://chatgpt.com/backend-api` (`runtime/provider.ts`) and reads the access token from the host's Codex login, `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), on every request (`coordinator/codex-login.ts`). An expired or missing login makes the route unavailable, so daemons claim as before. The runtime never refreshes the token, because rotating the refresh token would race the Codex CLI.
  - Summary: `use='compaction'`, `anthropic/claude-haiku-5-5`. With no Anthropic API connection the summary falls back to the router route, `openai-codex/gpt-6.1-sol`.

## 6. Seam and rule edits (owner route)

`CLAUDE.md`, Safety:

```diff
-- Keep GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`; check the seam before moving files or adding dependencies.
+- Keep GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`; the one exception is the in-server Coordinator runtime, `apps/server/src/coordinator/runtime/` (D114). Check the seam before moving files or adding dependencies.
```

The CLAUDE.md "Keys and encryption" bullet gains `apps/server/src/coordinator/credentials.ts`.

`biome.json`:

- The `@earendil-works/*` message names `apps/server/src/coordinator/runtime/ (the in-server Coordinator, D114)` instead of `apps/coordinator/src/runtime/ (the Coordinator sidecar, D72)`.
- The override `includes` swaps `apps/coordinator/src/runtime/**` and `apps/coordinator/test/**` for `apps/server/src/coordinator/runtime/**` and `apps/server/test/coordinator/**`.
- The four top-level `apps/coordinator/*` includes are dropped.

`packages/shared/merge-gate-paths.json`: add the resolver to `protected` and `humanQueue.credentials`; `merge-gate-paths-json.test.ts` keeps it equal to CLAUDE.md.

## 7. Removal and migration

Removed in S5:

- `apps/coordinator/**` and `scripts/ops/systemd/cairn-coordinator.service`
- `COORDINATOR_UNIT` in `scripts/ops/deploy-self.sh:77,420,433`, with tests
- `docs/ops/coordinator-sidecar.md`, replaced by a section in `docs/ops/control-plane-omarchy.md`
- `CAIRN_COORDINATOR_MACHINE_ID`, `setCoordinatorMachineId`, `coordinatorSidecarEnabled`, the `role:'coordinator'` claim branch (`machine-claim.ts:781`), and the sidecar token file

Boot migration:

- `CAIRN_COORDINATOR_MACHINE_ID` still set: warn and revoke that machine via `machine-revoke.ts`.
- A sidecar store at `$CAIRN_HOME/coordinator/threads/<id>.sqlite` and no destination: move it, then reconcile.
- Otherwise seed (§3).

omarchy never cut over (measured):

- `systemctl --user list-units --all` shows no coordinator unit (`cairn-server`, `cairn-daemon`, `cairn-self-deploy`, `egress-relay` only).
- `~/.cairn/coordinator` does not exist.
- `cairn-server.service` has no `COORDINATOR` variable.
- `server.db` has 0 machine rows named like `coordinator`.

The Mac was not checked.

## 8. Segments

| # | Content | Route | Acceptance |
|---|---|---|---|
| S1 | Move `runtime/*` and tests into `apps/server/src/coordinator/runtime/`; pin pi 1.5.0 in `apps/server/package.json`; §6 edits; nothing wired | **Owner**: `package.json`, lockfile (ian confirms, `CAIRN_ALLOW_LOCKFILE_CHANGE=1`), `biome.json`, `CLAUDE.md` | Lint, typecheck, moved tests pass |
| S2 | Migration for the three tables; extract `coordinator-steps.ts` and `finishCoordinatorTurn` from `machine-claim.ts` and `machine-finish-step.ts`, no behavior change | **Owner**: `**/drizzle/**`, `machine*.ts` | Schema glance; existing chief claim and finish tests unchanged |
| S3 | Adapter, runner, lease, reconcile, resolver, `beforeRequest`, async shutdown, behind the flag | **Owner**: credentials surface | Reconcile, volatile, lease and key-leak tests; stub-model turn on a scratch `CAIRN_HOME` lands in `chief_message`; `/api/health` p99 under 200 ms during a summarization (F11) |
| S4 | Rewind fork, steer and stop signals in `chief.ts`, `chief-turns.ts` | Normal | Rewind, steer, stop tests; e2e rewind then reload shows no stale turn |
| S5 | Flag on by default; §7 removals; stores in `backup-server-db.sh`; boot migration | **Owner**: `scripts/ops/**`, `machine-claim.ts` | omarchy deploy; a real turn on the D113 route; restart mid-turn resumes once; restore drill opens both files |

Through S4, rollback is turning the flag off. S5 is one-way only for the sidecar, which never ran on omarchy.
