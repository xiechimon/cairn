# Split `machine-claim.ts` into Cycle-Free Lease Kernel (`step-lease.ts`), Payload Builder (`machine-claim-payload.ts`), and Versioned Claim Protocol (`claim-payload.ts`) — plan, 2026-11-28

## User scenario

A user installs Cairn today (the desktop app with an embedded runner, or a standalone CLI runner on another Mac). When the Cairn server upgrades ahead of an already-running runner, or a runner connects across versions, tasks continue to claim, heartbeat, recover, and finish with zero extra accounts, API keys, storage migrations, or visible interruptions. Compatibility negotiation uses `machine.capabilities` (`runnerProtocolVersion` and `MIN_SUPPORTED_RUNNER_PROTOCOL` per `docs/design/version-skew.md` §2B) *before* claiming; `ClaimedStep.payloadVersion` (`1`) is an additive version marker on the shared claim payload contract. Any future breaking `payloadVersion >= 2` MUST be capability-gated before `status = 'claimed'` is written; `claimedStepSchema`'s `z.literal(1)` acts as a fail-closed parser guard rather than claim-time negotiation.

## Scope

1. **Versioned claim payload protocol (`packages/shared/src/protocol/claim-payload.ts`, `machine-wire.ts`, `index.ts`, `packages/shared/test/__snapshots__/snapshot.test.ts.snap`)**:
   - Driven by #35 (decoupling `machine-claim.ts` with an explicit versioned claim payload contract while preserving existing `runnerProtocolVersion` skew handling).
   - Define `CLAIM_PAYLOAD_VERSION = 1 as const`, `claimPayloadVersionSchema = z.literal(CLAIM_PAYLOAD_VERSION)`, `claimedStepV1Schema` (adding optional `payloadVersion: claimPayloadVersionSchema.optional()`), `claimedStepSchema = claimedStepV1Schema`, `claimPayloadVersionOf`, `machineClaimBodySchema`, `machineClaimResponseSchema`, `LOCAL_TOOL_CREATE_TAG`, and the two command value schemas embedded inside `ClaimedStep` (`localMergeCommandSchema`, `localFolderActionCommandSchema`). Prompt parsing (`localMergeInstructionSchema`, `localFolderActionInstructionSchema`, `parseLocalMergeInstruction`, `parseLocalFolderActionInstruction`), merge recheck, and done-report schemas stay in `machine-wire.ts`.
   - Re-export all moved symbols from `machine-wire.ts` and `protocol/index.ts`; update `snapshot.test.ts.snap` only for `claimedStep.json` and `machineClaimResponse.json`.
2. **Cycle-free pure lease kernel (`apps/server/src/services/step-lease.ts`, `apps/server/src/lib/errors.ts`, `builds.ts`)**:
   - Own the DB-level step lease transitions with zero imports from `chief.ts`, `coordinator-steps.ts`, `build-abandoned-sweep.ts`, `machine-claim.ts`, `machine-claim-payload.ts`, or `machines.ts` (avoiding any transitive cycle through `chief.ts` / `machine-deps.ts` verified by `node scripts/import-cycle-gate.mjs`):
     - **Claim CAS primitives**: `pendingClaimPredicate`, `nextClaimGeneration`, `acquireWorkerStepLease`, `acquireChiefStepLease` (used by `claimPendingChiefStep` in `coordinator-steps.ts`).
     - **Heartbeat**: `heartbeatStep(deps, machineId, stepId)` moved from `machines.ts` (410 on deleted step, `NotFoundError` 404 on unowned or non-claimed step, `lastHeartbeatAt` update). `NotFoundError` lives in `lib/errors.ts` and is re-exported by `builds.ts` so `instanceof NotFoundError` stays identical everywhere without importing `builds.ts` into `step-lease.ts`.
     - **Release CAS**: `releaseStepLease(db, stepId, { claimCount?, expectedMachineId?, expectedClaimedAt? })` atomically transitions `status: 'claimed' -> 'pending'`, clears `machineId: null` and `mcpGrant: null`, preserves `claimedAt` so the next claim generation remains strictly monotonic, compares `expectedMachineId` (including explicit `null` for in-server Coordinator) and `expectedClaimedAt`, and returns `boolean`.
   - Migrate `build-abandoned-sweep.ts` (`releaseClaimedStep`) and `chief.ts` (`sweepAbandonedChiefSteps`) to pass `{ claimCount: claims, expectedMachineId: row.machineId, expectedClaimedAt: row.claimedAt }` to `releaseStepLease` and skip `publishStep` / `wake` / `cancelPendingQuestions` whenever `releaseStepLease` returns `false`.
3. **Payload builder (`apps/server/src/services/machine-claim-payload.ts`)**:
   - Own assembling versioned `ClaimedStep` payloads (`payloadVersion: CLAIM_PAYLOAD_VERSION`) with zero imports from `step-lease.ts`, `machine-claim.ts`, or `machines.ts`: `buildWorkerClaimPayload`, `buildChiefClaimPayload`, `workerSkillInjection`, `injectWorkerStepMemories`, `workerRemoteTools`, `claimLocalTools`, `TASK_SEGMENTS_MIN_CLI_VERSION`, `CHIEF_MAIL_MIN_CLI_VERSION`, `cliVersionAtLeast`, `meetsMcpVersionGate`, `stepMcpGrant`, `chiefTurnLocked`.
   - Freeze claim-time `mcpServers` (computed once at claim time and stored on `step.mcpGrant`) so post-await payload assembly matches token issuance (`machine-step-token.ts`) even if machine capabilities change mid-claim, and fence `step.memoryTrace` writes by `status = 'claimed'` and `claimedAt` so a late payload build cannot overwrite a newer generation's trace.
4. **Claim orchestrator & facade compatibility (`apps/server/src/services/machine-claim.ts`, `coordinator-steps.ts`, `machines.ts`, `machine-step-token.ts`)**:
   - `machine-claim.ts` retains orchestration (`claimStep`, `tryClaim`, `claimCandidates`, `claimChiefCandidates`, `claimChiefTurn`, `buildChiefClaim`, `serverTurnModel`, `serverTakesTurn`, `failPendingClaim`, `resolveClaimRepoId`), delegates lease writes to `step-lease.ts` and payload assembly to `machine-claim-payload.ts`, and re-exports `heartbeatStep`, `releaseStepLease`, and payload helpers.
   - `coordinator-steps.ts` delegates its `step` claim update in `claimPendingChiefStep` to `acquireChiefStepLease` in `step-lease.ts`.
   - `machines.ts` re-exports `heartbeatStep` from `step-lease.js` (alongside `claimStep` and `meetsMcpVersionGate` from `machine-claim.js`), preserving `Object.keys(machines).sort()` and function identity unchanged.
   - `machine-step-token.ts` imports `stepMcpGrant` from `./machine-claim-payload.js`.
5. **TLC model coverage (`.claude/skills/verify-step-claim/SKILL.md`)**:
   - Add `apps/server/src/services/step-lease.ts` to the coverage record and update action-to-code correspondence (`acquireWorkerStepLease`, `heartbeatStep`, `releaseStepLease` in `step-lease.ts`; `tryClaim`, `claimStep`, `claimCandidates` in `machine-claim.ts`). Keep `StepClaim.tla` and `expected.txt` unchanged.
   - Verify `.claude/skills/verify-step-claim/scripts/run.sh` on `macmini`: **8 positive configs PASS and 4 negative-control configs FAIL with their exact expected counterexample traces in `expected.txt`** (TLC is a safety invariant guard for worker step claims, not a liveness proof or Coordinator attachment-wait proof).
6. **Unchanged behavior**:
   - No DB schema changes, no HTTP route path/status changes, no wire field removals, `{ step: null }` response unchanged, and all existing claim tests remain completely unmodified.

## States, Readers, Writers & Failure Paths

- **Step lease states & transitions**:
  - Created `pending` via `enqueueStep` (`builds.ts`) or Coordinator turn creation (`chief.ts`), and held/retried as `pending` or non-terminal `waiting_quota` (`quota-wait.ts`, `claude-rate-limit.ts`).
  - `pending -> claimed`:
    - Worker claim: `tryClaim` (`machine-claim.ts`) -> `acquireWorkerStepLease` (`step-lease.ts`) inside `withFencedTransaction`, setting `status = 'claimed'`, `machineId`, strictly increasing `claimedAt` (`nextClaimGeneration`), `lastHeartbeatAt`, `skillInjection`, `blockerHandoff`, subscription IDs, `ranModel`, `fallback`, `mcpGrant`, and failover provenance.
    - Chief claim (both daemon `machineId` and in-server Pi Coordinator `machineId: null`): `claimPendingChiefStep` (`coordinator-steps.ts`) -> `acquireChiefStepLease` (`step-lease.ts`) with `notInArray(step.id, pending coordinatorInput)`.
  - `claimed -> claimed` (heartbeat):
    - Daemon `POST /api/machine/heartbeat/:stepId` (`routes-machine.ts`) -> `scopeMachineClaim` -> `heartbeatStep` (`step-lease.ts`).
    - In-server Coordinator (`apps/server/src/coordinator/server-api.ts`) -> `heartbeatStep(deps, null, stepId)`.
  - `claimed -> pending` (lease release / requeue):
    - Abandoned worker sweep (`build-abandoned-sweep.ts`) & abandoned chief sweep (`chief.ts`) -> `releaseStepLease(db, id, { claimCount, expectedMachineId, expectedClaimedAt })` (leaving `claimedAt` intact so the next claim gets a strictly higher generation; skipping publish/wake/question-cancel if CAS returns `false`).
    - Model-fallback / stall / quota requeue (`machine-finish-step.ts`, `stall-monitor.ts`, `quota-wait.ts`, `claude-rate-limit.ts`).
  - `claimed -> done | failed | stopped | waiting_quota`: terminal/parked settlement (`machine-finish-step.ts`, `build-step-complete.ts`, `build-step-failure.ts`, `build-stop.ts`, `chief-turns.ts`, `quota-wait.ts`). Note `waiting_quota` is non-terminal and returns to `pending` via `sweepQuotaWaitSteps` / `retryQuotaWaitNow`.
- **Readers & writers**:
  - `step.{status, machineId, claimedAt, lastHeartbeatAt, claimCount, mcpGrant}`: written by `step-lease.ts`, `builds.ts`, `machine-finish-step.ts`, `build-stop.ts`, `build-step-complete.ts`, `build-step-failure.ts`, `quota-wait.ts`, `stall-monitor.ts`, `claude-rate-limit.ts`, `chief-turns.ts`; read by `step-lease.ts`, `machine-claim.ts`, `machines.ts` (`recoverSteps`), `routes-machine.ts`, `machine-claim-scope.ts`, `machine-step-token.ts`, `coordinator/index.ts`, `coordinator/server-api.ts`, `scheduler.ts`, `dispatch-timeouts.ts`, `build-abandoned-sweep.ts`, `chief.ts`, `step-queue.ts`.
  - `ClaimedStep.payloadVersion`: written by `machine-claim-payload.ts` (`1`); validated by `packages/shared/src/protocol/claim-payload.ts` (`claimedStepSchema`, `machineClaimResponseSchema`) in `apps/daemon/src/machine-client.ts` and tests.
- **Failure paths**:
  - Pre-claim: `401` revoked machine token; `426` (`runner-out-of-window`) when below `MIN_SUPPORTED_RUNNER_PROTOCOL` (while already-claimed in-flight steps still finish); capacity full / ineligible / missing model / missing attachment-verify / mail-CLI gate returns `{ step: null }` after hold/wake; local-merge or folder-action authorization refusal fails the pending step; GitHub repo lookup refusal fails pending step with `503` (missing credential) or retryable error (429/probe error).
  - Post-commit: DB commit followed by response loss / abort / token revocation leaves `step` `claimed` (daemon recovers via journal or reports `failed` if journal missing; abandoned sweep releases after 120s); chief attachment staging failure continues without staged text; chief stop/reclaim during `await stageTurnAttachments` skips stale `memoryTrace` write via `claimedAt` fence; same-machine reclaim rejects old heartbeat/done with `409`; archive/close/superseded build stops rather than re-dispatching; permission wait skips abandoned release; worker quarantines after 3 no-progress claims; chief stop cancels pending questions.
  - Version rejection: a legacy v0/pre-versioning runner strips unknown `payloadVersion` and completes normally. If a future misconfigured server ever emitted `payloadVersion: 2` after committing `claimed`, a v1 runner rejects at Zod parse, logs and backs off without starting or journaling; normal steps sit `claimed` until the 120s abandoned sweep releases and quarantines after 3 claims, whereas `local-merge` / `local-folder-action` steps are skipped by abandoned release and stay visibly stalled until server/runner alignment — which is why pre-claim capability gating is mandatory before introducing any `payloadVersion >= 2`.

## Edge cases

All rows below are proven by newly added tests that FAIL against parent `origin/main` (red first) and PASS on this change:

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Versioned v1 payload round-trip, unversioned legacy fallback (`1`), and unsupported `payloadVersion` (`2`, `0`, `'1'`) rejection | Valid v1 and legacy payloads parse cleanly retaining `payloadVersion: 1`; unsupported versions fail Zod validation immediately before launching a step | `packages/shared/test/claim-payload.test.ts` | this change |
| Frozen pre-v1 schema strips `payloadVersion` and real HTTP `POST /api/machine/tasks/claim` emits `payloadVersion: 1` for worker & chief and finishes through heartbeat/token/done | Older runners claim and complete tasks without `409` or parse errors while the server emits versioned payloads | `packages/shared/test/claim-payload.test.ts` and `apps/server/test/machine-claim-split.test.ts` | this change |
| Chief claim freezes `mcpGrant` before async attachment staging and fences `memoryTrace` updates by `claimedAt` | Tools offered in the payload always match token grant, and an interrupted/reclaimed chief turn never writes stale `memoryTrace` onto a newer claim | `apps/server/test/machine-claim-split.test.ts` | this change |
| `heartbeatStep` refreshes `lastHeartbeatAt`, throws `410` on deleted step, and throws `NotFoundError` (`404`) on unowned/released step | Live tasks stay healthy; deleted or lost claims stop immediately | `apps/server/test/machine-claim-split.test.ts` | this change |
| `releaseStepLease` CAS fence on `(status='claimed', expectedMachineId, expectedClaimedAt)` (including `expectedMachineId: null`), preserves `claimedAt`, and sweeps skip publish/wake/question-cancel when CAS misses | Concurrent re-claim or finish cannot be clobbered by a stale sweep, and the UI never receives false `pending` or cancelled-question events | `apps/server/test/machine-claim-split.test.ts` | this change |
| Abandoned worker & chief sweeps release via `releaseStepLease`, quarantine at limit, and module boundaries remain cycle-free with identical `machines` / `machine-claim` facade exports | Abandoned tasks recover or quarantine cleanly with zero import cycles and zero caller breakage | `apps/server/test/machine-claim-split.test.ts` | this change |

## Preservation guards (existing unchanged tests)

Pre-claim refusal/wait and post-commit abort/recovery behaviors remain unchanged and are verified by running these unmodified existing test suites on `macmini`:

| Scenario | Existing unchanged test file |
|---|---|
| Empty queue / wake / hold timeout, runner & project concurrency caps, pool failover | `apps/server/test/machine-pool-claim.test.ts`, `apps/server/test/machine-concurrency.test.ts`, `apps/server/test/project-concurrency.test.ts` |
| `401` revoked token & request abort / deploy-lease draining, response loss / zombie claim | `apps/server/test/machine-zombie-claim.test.ts`, `apps/server/test/deploy-lease.test.ts` |
| `426` below-floor protocol refusal & in-flight finish; pre-`claimGeneration` runner skew | `apps/server/test/machine-claim-window.test.ts`, `apps/server/test/machine-claim-protocol-skew.test.ts` |
| Same-machine reclaim `409`, report ownership, daemon recovery & crash reporting | `apps/server/test/machine-claim-generation.test.ts`, `apps/server/test/step-claim-report.test.ts`, `apps/daemon/test/machine-recover.test.ts`, `apps/daemon/test/machine-claim.test.ts` |
| Local-merge / folder-action auth refusal, GitHub `503` / probe failures, permission wait, quarantine, archive/close/quota requeue | `apps/server/test/local-merge-landing.test.ts`, `apps/server/test/credentials.test.ts`, `apps/server/test/build-abandoned-sweep.test.ts`, `apps/server/test/chief-abandoned-sweep.test.ts`, `apps/server/test/archive.test.ts`, `apps/server/test/quota-hold.test.ts` |
| Facade export keys, identity, and no facade back-imports | `apps/server/test/machines-module-split.test.ts`, `apps/server/test/machine-wire.test.ts` |

## Out of scope

- Raising `RUNNER_PROTOCOL_VERSION` or `MIN_SUPPORTED_RUNNER_PROTOCOL`, or implementing `payloadVersion >= 2` capability negotiation.
- Changing DB schema, HTTP routes, or daemon runtime behavior.
- Refactoring `machine-finish-step.ts`, `stall-monitor.ts`, or `quota-wait.ts` beyond lease release behavior.
- Info-card pipeline changes (already retired on `main` by `d48c2bcf0`).

## Review

- Verdict: PASS
- Plan-SHA256: b42de893e9989ded38161cca6202d685dcef2b4d606449a606eb4b641170c23b
- Author-Model: gemini-4-neon
- Reviewer: openai-codex/gpt-6.2-sol (pi-review)
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 8 initial plan-review findings fixed (cycle-free 3-layer split with step-lease.ts, releaseStepLease CAS + caller guards, claim-time mcpGrant & fenced memoryTrace, v2 rejection & pre-claim capability gate, pre-claim/post-commit edges, red-on-parent proving test separation, accurate TLC wording) and confirmed YES.

