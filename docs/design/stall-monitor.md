# Server-Side Stall Monitor — plan, 2026-11-27

## User scenario

A first-time Cairn user meets this feature whenever they start a task or send a message to the Coordinator, switch away, and the running turn stops making progress (waiting on an unanswered question or approval card, retrying in a quota/rate-limit loop, running an ACP session without Cairn host tools, or sitting silent after a runner or stream failure). Previously, Cairn only tracked process heartbeats and machine online state, plus a 30-minute notification-only `worker-watchdog` flag for tasks — nothing diagnosed why a turn stalled, nothing healed recoverable causes, and Coordinator turns were not checked for progress silence.

With this change, the user needs no new accounts, API keys, environment variables, or settings. Cairn inspects durable step progress (`lastProgressAt`), current-turn waiting cards (`ask_user` and `actionProposal` cards created in the active turn), persisted activity (`stallState` JSON on the existing `step` table), and machine connectivity across every runtime. When a turn stalls:

| User situation | Quiet window | What the system does | What the user sees |
|---|---|---|---|
| Waiting on pending `ask_user` or approval card from this turn | Per-runtime quiet window | Never interrupts the turn (and prevents `sweepAbandoned*` from cancelling live/in-server waits); posts one deduped plain-line notice (+ `watchdog_flag` for tasks) | One clear chat note naming what input/approval is awaited |
| ACP session missing Cairn host tools | 30s grace (`MISSING_TOOLS_GRACE_MS`) | Stops old turn, requeues once (`freshSession: true`, `recoveryCount: 1`), wakes runner; if it recurs (`recoveryCount >= 1`), stops/fails and reports once | Plain note that host tools failed to attach and a fresh session started (or failure report if repeated) |
| Quota / rate-limit retry loop | 60s grace (`QUOTA_LOOP_GRACE_MS`) | Stops retrying turn; if user's routing settings configure an eligible fallback model, switches to fallback and requeues (`freshSession: true`); otherwise parks task (`waiting_quota`) or holds Coordinator (`holdReason: 'quota'`) | Plain note naming the model switch or quota wait in the thread |
| Runner offline / dead mid-turn | 60s grace (`DEAD_RUNNER_GRACE_MS` > 45s offline grace) | Requeues once (`recoveryCount: 1`), wakes runner; if replacement dies again (`recoveryCount >= 1`), fails task / stops Coordinator turn | Plain note that the previous runner stopped responding and a retry started (or failure report if repeated) |
| Silent live turn (no tool call, output, or step change) | Coordinator: 3m (`antigravity`/`devin`/`pi`), 4m (`claude-code`), 5m (default); Worker: 6m (`antigravity`/`devin`/`pi`), 8m (`claude-code`), 15m (default) | Stops old turn, requeues once (`freshSession: true`, `recoveryCount: 1`), wakes; if replacement stalls again (`recoveryCount >= 1`), reports once without looping | Plain note that the silent turn was restarted (or one plain alert if the replacement also stalls) |

## Scope

1. **Progress tracking & activity persistence**:
   - Keep `step.lastProgressAt` updated (throttled to 30s via `markProgress`) on tool calls, transcript deltas/rows, thinking deltas, background task updates, and progress activity phases (`thinking`, `responding`, `tool`, `compacting`) when `stallSignal` is absent.
   - Call `markProgress` for in-server Coordinator tool relays (`relayTool` and `relayComputer` in `apps/server/src/coordinator/server-api.ts`).
   - Persist `step.stallState.activity` in `apps/server/src/services/machines.ts` (`reportActivity`): record `{ phase, stallSignal, attempt, detail, firstSeenAt, at }`, preserving `firstSeenAt` across repeated reports of the same `(phase, stallSignal)` so grace timers expire reliably instead of resetting on each 5s repeat. Clear `stallState.activity`, `reportedFingerprint`, and `reportedAt` whenever genuine progress resumes.
   - As backward-compatible fallback for older daemons, `reportTool` detects missing Cairn host tool errors (`call.isError === true` on a Cairn host/relay tool whose output matches `MISSING_HOST_TOOL_RE`) and records `stallState.activity` with `stallSignal: 'missing_tools'` (preserving `firstSeenAt`); a subsequent successful tool call clears it and calls `markProgress`.
2. **Shared protocol & daemon signal emission**:
   - Extend `stepActivityReportSchema` in `packages/shared/src/records/step.ts` with optional `stallSignal: z.enum(['quota', 'capacity', 'missing_tools', 'permission']).optional()` and `detail: z.string().max(400).optional()`.
   - Forward `stallSignal` and `detail` through `ActivityTracker` (`apps/daemon/src/activity.ts`).
   - In `apps/daemon/src/step-pass-events.ts`: on `auto_retry_start`, classify `s.lastModelError ?? s.lastError` BEFORE clearing it; emit `stallSignal: 'quota'` or `'capacity'` with truncated `detail` only when `classifyAgentFailure` returns `'quota'` or `'capacity'` (never from bare `attempt >= 2` alone). On ACP missing host tool error or host-tool `toolcall_end` missing-tool failure, emit `activity.setPhase('tool', { stallSignal: 'missing_tools', detail })`.
   - In `apps/daemon/src/machine-loop.ts` (`deliverStop`): when `client.stop(stepId)` rejects with HTTP `404`, `409`, or `410` (claim released/reassigned), immediately call `run.deliver({ discard: false })` and record `deliveredStops.add(stepId)` instead of waiting for the next 30s heartbeat.
3. **Database schema (`step.stallState`)**:
   - Add nullable JSON column `stallState: json<StepStallMeta>('stallState')` on `step` in `apps/server/src/db/schema.ts` with a generated Drizzle migration under `apps/server/drizzle/`.
   - `StepStallMeta` stores `{ recoveryCount?: number; lastCause?: StepStallCause; lastRecoveredAt?: number; lastRecoveredFromMachineId?: string; reportedAt?: number; reportedFingerprint?: string; activity?: StepStallActivity }`.
4. **Server-side stall monitor (`apps/server/src/services/stall-monitor.ts`)**:
   - Add `sweepStallMonitor(deps: BuildDeps, now?: number)` and wire it into `apps/server/src/services/scheduler.ts` before `sweepAbandonedChiefSteps` and `sweepAbandonedBuildSteps`.
   - Scan all `status = 'claimed'` steps across active worker builds (`queued`, `planning`, `building`, `review`, excluding archived/closed/done/superseded builds) and Coordinator `chief` turns (excluding `chief-digest-*`, `chief-memory-*`, and memory-edit turns).
   - Resolve runtime conservatively: explicit `antigravity`, `devin`, `claude-code`, `pi` (and configured HTTP providers for Coordinator) get their runtime window; `null` or `unknown` gets `default` (`5m` Coordinator, `15m` Worker, matching `STALL_AFTER_MS`).
   - Diagnostics supported per execution path: runner-backed worker/chief steps support all 5 causes (`permission_wait`, `missing_tools`, `quota`, `dead_turn`, `silent_turn`); in-server Coordinator (`machineId === null`) supports `permission_wait` and `silent_turn` (in-server Pi uses direct extension tools, not ACP MCP, and has no separate runner heartbeat).
   - Diagnosis priority: `permission_wait` -> `missing_tools` (30s) -> `quota` (60s, requires `stallSignal` `'quota'` or `'capacity'`) -> `dead_turn` (60s heartbeat/claim silence + offline/`silentSinceDrop` past `DEAD_RUNNER_GRACE_MS = 60_000`) -> `silent_turn` (runtime quiet window).
   - Quota uses existing `planModelFallback` + `tried` chain and `applyQuotaWaitStep` / `holdReason: 'quota'` without consuming `recoveryCount`; requeuing clears `ranModel: null` so fallback routes take effect on both runner and in-server Coordinator turns.
   - Same-model/session/dead-turn auto-restarts are capped at `recoveryCount < 1` per step; `"local-merge"` steps are never auto-restarted (reported once instead).
5. **Clean cancellation, generation fencing & sweep coordination**:
   - On requeue of a connected runner (`machineHub.isConnected(oldMachineId)`) or in-server Coordinator (`machineId === null`), set `holdReason: 'stall_recovery'` and `holdUntil: now + STALL_STOP_SETTLE_MS` (`35_000`, strictly greater than the 30s runner heartbeat) so an older runner/turn cannot overlap with a new claim; clear `holdReason`/`holdUntil` immediately in `prepareStepReport` / `server-api.done` when the old turn reports stop/exit, and wake the team/Coordinator.
   - To prevent a late `done`, `tool`, `transcript`, `activity`, or `heartbeat` from a previous attempt from ever mutating state after recovery or re-claim:
     - Record `lastRecoveredAt: now` and `lastRecoveredFromMachineId: row.machineId` in `stallState` on every stall recovery.
     - In `apps/server/src/routes-machine.ts`, pass `stepId` to `claimDeps(c, row, stepId)` on `heartbeat/:stepId`, `tool/:stepId`, and `done/:stepId` so `scopeMachineClaim` wraps all runner writes (`heartbeat`, `tool`, `transcriptDelta`, `thinkingDelta`, `activity`, `transcriptRow`, `agentTodo`, `bg_task`, `done`, `stop`, `steer`) inside immediate SQLite transactions fenced by `claimGenerationAccepted`.
     - In `claimGenerationAccepted` (`apps/server/src/services/machine-claim-scope.ts`) and `apps/server/src/services/machine-claim.ts`: whenever `stallState?.lastRecoveredAt != null`, require an explicit `generation === claimedAt` on every runner step call (refusing un-generationed requests with `409 Conflict`), and refuse re-claiming a recovered step onto a legacy daemon lacking `capabilities.claimGeneration === true`.
     - In `apps/server/src/services/machine-finish-step.ts` (`prepareStepReport`), reject any late `done` on a step with `stallState.lastRecoveredAt != null` when `status !== 'claimed'` with `409 Conflict` instead of running `failUnpublishedDeliverables` or `noteDeliveredPlanResidual`.
     - In `apps/server/src/coordinator/server-api.ts`: implement `forGeneration(stepId, generation)` on `MachineApi` (used by `apps/server/src/coordinator/runtime/turn.ts` at turn start) so every Coordinator read/write (`heartbeat`, `transcriptRow`, `mapUserEntry`, `transcriptDelta`, `resetLive`, `canSuggestReplies`, `suggestReplies`, `relayTool`, `relayComputer`, `askUser`, `steer`, `reusedInstructions`, and `done`) verifies `status === 'claimed' && machineId === null && claimedAt === generation` inside immediate DB transactions before mutating state or calling `recordStepUsage`, and re-verifies the claim generation after any `await` before persisting post-tool state; reject `body.generation === undefined` in `done` when `owned.stallState?.lastRecoveredAt != null`; and in `stop`, return `false` (`!== null`) when `!claimed` or `machineId !== null` so `turn.ts` aborts immediately.
   - Export `isStepWaitingPermission(db, row)` from `stall-monitor.ts`; `sweepAbandonedChiefSteps` (`chief.ts`) skips `machineId === null && isStepWaitingPermission(...)` and `sweepAbandonedBuildSteps` (`build-abandoned-sweep.ts`) skips `live && isStepWaitingPermission(...)` so abandoned sweeps never interrupt or cancel active `permission_wait` turns.
6. **Chat rendering, wait ownership & watchdog deduplication**:
   - Current-turn wait ownership: `isStepWaitingPermission` matches pending `worker_question` rows (`workerQuestionRows`) with `createdAt >= (row.claimedAt ?? row.createdAt) - 1_000` for worker steps, and pending non-card `chiefMessage` `ask_user_question` rows or pending `actionProposal` approval cards (`approval-<proposalId>`) with `createdAt >= (row.claimedAt ?? row.createdAt) - 1_000` for Coordinator steps.
   - Worker task chat notes are written as plain `role: 'system'` strings in `message` (mapped to `note` items by `apps/web/src/api/mappers.ts`).
   - Coordinator thread chat notes are written as `role: 'system'` JSON with `CHIEF_NOTICE_KIND` (`{ kind: 'chief_notice', message, provenance: 'stall-monitor' }`) in `chiefMessage` (mapped to visible `robot` items by `apps/web/src/api/mappers.ts`).
   - Dedupe fingerprint includes the active wait identity (`permission_wait:${waitIds.join(',')}` or `${cause}:${recoveryCount}:${Math.floor(progressAt)}`); deterministic row IDs (`stall-recover-${stepRow.id}-${recoveryCount}`, `stall-report-${stepRow.id}-${cause}-${shortHash(fingerprint)}`) ensure idempotency across ticks while emitting a fresh notice for a second distinct wait in the same turn.
   - `apps/server/src/services/worker-watchdog.ts` skips claimed steps where `row.stallState?.reportedAt != null` for `stuckReason`, leaving `gateReason` (BLOCK rounds / repeated failures) intact.

## Concurrency model (states, transitions, readers, writers, failure paths)

- **States & transitions**:
  - `step.status` values: `'pending' | 'claimed' | 'done' | 'failed' | 'stopped' | 'waiting_quota'`.
  - `sweepStallMonitor` acts only on `step.status = 'claimed'`. Every mutation branch (requeue, quota fallback, quota park/hold, terminal fail/stop, and chat-notice reporting) runs inside `withFencedTransaction(deps, (txDeps) => ...)` (`behavior: 'immediate'`), re-reading `step`, verifying `status === 'claimed' && claimedAt === expected`, no user `stopPending`, and re-evaluating the stall/wait/progress condition inside that same transaction before writing or scheduling post-commit effects on `txDeps`.
  - Recoverable stall (`missing_tools`, `quota` with fallback, `dead_turn`, `silent_turn` with `recoveryCount < 1`): CAS-updates `step` (`WHERE id = ? AND status = 'claimed' AND claimedAt = ?`) to `status = 'pending'`, `machineId = null`, `sessionId = null`, `ranModel = null`, `mcpGrant = null`, `lastProgressAt = null`, `stallState = { ...next, activity: undefined, reportedAt: undefined, reportedFingerprint: undefined }`, `holdReason` / `holdUntil` (`'stall_recovery'` for 35s if old runner connected or in-server, else `null`).
  - Exhausted `quota` (no fallback): worker re-verifies CAS (`changes === 1` on `stallState` under `status = 'claimed' AND claimedAt = ?`) and calls `applyQuotaWaitStep(txDeps, ...)`; Coordinator CAS-updates `step` to `pending` with `holdReason = 'quota'`, `holdUntil = now + QUOTA_PROBE_BASE_MS` (`60_000 > 35_000`), `holdCount + 1`, `machineId = null`, `sessionId = null`, `ranModel = null`.
  - Exhausted `dead_turn` / `missing_tools` (`recoveryCount >= 1`): worker re-verifies CAS and calls `failStepWithEvents(txDeps, ...)`; Coordinator CAS-updates `step` to `stopped` (`endChiefStepAsStopped` semantics + plain error notice, leaving `coordinatorInput` replay/release intact). Both `applyQuotaWaitStep(txDeps, ...)` and `failStepWithEvents(txDeps, ...)` enqueue their SSE/hub/notification effects into `txDeps`'s shared `withFencedTransaction` post-commit queue, so rollback emits zero events.
  - `permission_wait` and exhausted `silent_turn`: `step.status` stays `'claimed'`; `stallState.reportedFingerprint` and `stallState.reportedAt` update atomically under the same `claimedAt` CAS.
- **Readers & writers**:
  - Writers of `step.status` / `step.claimedAt`: `claimStep` / `claimPendingChiefStep`, `finishStep` / `serverApi.done`, `applyStoppedStep`, `sweepStallMonitor` (all fenced by `claimedAt` or `status = 'claimed'`).
  - Writers of `step.lastProgressAt` & `step.stallState.activity`: `reportTool`, `reportTranscriptDelta`, `reportTranscriptRow`, `reportThinkingDelta`, `reportBackgroundTask`, `reportActivity`, `server-api.ts` `relayTool`/`relayComputer` (all fenced by `ownedStep`).
  - Readers: `sweepStallMonitor`, `sweepWorkerWatchdog`, `sweepAbandonedChiefSteps`, `sweepAbandonedBuildSteps`, `listSteps` / web mappers.
- **Failure paths**:
  - **Concurrent completion or user stop**: CAS predicate (`status = 'claimed' AND claimedAt = ?`) or `stopPending` re-check inside `withFencedTransaction` aborts cleanly — zero duplicate messages, zero post-commit SSE/wake effects.
  - **Post-commit stop delivery crash or legacy daemon**: `deliverStop` handles `404/409/410` immediately on current daemons; legacy daemons stop within 30s on `heartbeat` 404 while `holdReason: 'stall_recovery'` (`35s`) prevents overlapping claims.
  - **In-server Coordinator unwinding**: `coordinator/index.ts` `drain(threadId)` awaits `runStep(row)` before looping to `claimHead`, and `coordinatorInput` with `renew = true` preserves user messages without duplicating completed tool entries.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Pending current-turn `ask_user` (worker or Coordinator) or current-turn `actionProposal` card vs stale card from an earlier turn | Current-turn wait is never interrupted (even across full `createScheduler.tick`); one plain notice posts per distinct wait; stale card from prior turn does not block diagnosis of a new turn | `apps/server/test/stall-monitor.test.ts` | this change |
| ACP host tools missing (`stallSignal: 'missing_tools'` or legacy `reportTool` error matching `MISSING_HOST_TOOL`) past 30s grace | Old turn stops (`deliverStop` handles 404), step requeues once with `freshSession: true`, chat shows plain note; host tool success before 30s clears signal; `recoveryCount >= 1` ends step with one error note | `apps/server/test/stall-monitor.test.ts` | this change |
| Quota/rate-limit retry loop (`stallSignal` `'quota'` or `'capacity'`) past 60s vs non-quota `attempt >= 2` retry | Quota signal switches to eligible fallback (`ranModel` cleared, `freshSession: true`) or parks (`waiting_quota` / `holdReason: 'quota'`); non-quota retry without quota signal is NOT falsely parked as quota; repeated `activity` repeats preserve `firstSeenAt` | `apps/server/test/stall-monitor.test.ts` | this change |
| Runner dead/offline (`!online` or `silentSinceDrop`) past 60s grace vs live reconnecting runner (`admitPresence`) | Dead turn requeues once (`recoveryCount: 1`) with plain note; runner reconnecting within grace is untouched; second dead turn (`recoveryCount >= 1`) fails worker / stops Coordinator cleanly | `apps/server/test/stall-monitor.test.ts` | this change |
| Live runner or in-server Coordinator silent past per-runtime quiet window (`antigravity` 3m/6m vs `claude-code` 4m/8m vs `unknown`/null 5m/15m) vs active tool progress | Long active progress stays untouched; first silence restarts once (`freshSession: true`, inputs preserved for in-server Coordinator); second silence reports once deduped; resumption of progress clears `reportedFingerprint` so a later stall can report again | `apps/server/test/stall-monitor.test.ts` | this change |
| Concurrent `finishStep` / `done` / user `stopPending` races with `sweepStallMonitor`, rollback drops post-commit events, and late runner or Coordinator calls after recovery | `withFencedTransaction` emits zero ghost notifications/wakes on CAS miss; user `stopPending` wins; late runner `done` gets 409 (clears `stall_recovery` hold) without residual side effects; late Coordinator `transcriptRow`/`done` writes zero rows or usage | `apps/server/test/stall-monitor.test.ts` | this change |
| `"local-merge"` step stalls, or step belongs to archived/closed/done todo, superseded build, side chief thread (`chief-digest-*`, `chief-memory-*`), or memory-edit step | `"local-merge"` is never auto-restarted (reported once); archived/closed/done/superseded/side/memory-edit steps are ignored | `apps/server/test/stall-monitor.test.ts` | this change |
| Deduplication with `sweepWorkerWatchdog`, scheduler wiring, and web chat mapper rendering | `sweepWorkerWatchdog` skips duplicate stuck alert after `reportedAt` while preserving `gateReason`; `createScheduler.tick` runs `sweepStallMonitor`; worker note and Coordinator `CHIEF_NOTICE_KIND` map to visible chat items | `apps/server/test/stall-monitor.test.ts` | this change |
| Daemon `ActivityTracker` forwarding + `consumeStepPassEvent` emission + `deliverStop` 404/409 handling | Daemon forwards `stallSignal`/`detail` on quota/capacity retries and host-tool failures, dedupes identical reports, and `deliverStop` stops live session on 404/409 claim release | `apps/daemon/test/stall-monitor-signals.test.ts` | this change |

## Out of scope

- Any new user-facing settings, preferences, or `CAIRN_*` environment variables.
- Replacing or altering `apps/daemon/src/stream-watchdog.ts` low-level stream timeouts.
- Removing `apps/server/src/services/worker-watchdog.ts` gate/verdict loop and repeated-error detection.
- Web UI layout or visual component changes under `apps/web/src/`.

## Review

- Verdict: PASS
- Plan-SHA256: 7c57d199d71d4b261a3a2365daa1717c8d07ac1032375ddfa637207be6e3c124
- Author-Model: gemini-4-neon
- Reviewer: pi-codex-high
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 0 blocking remaining; 11 findings from high review resolved and confirmed

