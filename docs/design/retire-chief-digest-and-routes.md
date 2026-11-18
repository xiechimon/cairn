# Retire the chief-digest pipeline, chief_summary, dormant coordinator routes, and the sidecar boot migration

Issue #5349. With `CAIRN_COORDINATOR_SERVER_CONTEXT` the dormant threshold digest in `chief-digest.ts` is the only remaining producer of `chief-digest-%` turns; `seed-summary.ts` keeps a rolling `chief_summary` per thread so a reseed can prepend a compacted block; `readCoordinatorPage` serves a `/coordinator` REST surface nothing calls; `migrateSidecarState` still moves legacy sidecar SQLite files and revokes `CAIRN_COORDINATOR_MACHINE_ID` on every boot.

## What survives

- Historical `chief-digest-*` chief_message rows keep rendering-or-hiding exactly as today (`chiefDigestContentSchema`, `CHIEF_DIGEST_*` prefixes in shared, the web mapper skip, the e2e spec that proves digest rows stay out of chat). The system-prompt digest section in `chief.ts` is retired with the pipeline: no new digest rows can be produced, so injecting frozen ones would pin stale lines into every future prompt.
- `chief-digest-*` chief_thread rows stay hidden by the existing `isChiefDigestThreadId`/`chiefDigestThreadId` filters in `step-queue`, `mcp-threads`, `chief-history`, `chief.ts`.
- The live runtime compaction (`coordinatorCompactionExtension` → `foldSummary`/`summaryBatches`/`summarizerFor`, `memory-flush`, `background-compaction`, `providers.summary`) is untouched.
- `CAIRN_COORDINATOR_IN_SERVER` stays and still gates `coordinatorInServerEnabled()`, `serverTakesTurn`, `coordinatorRunsOnPi()`.

## What changes

1. `services/chief-digest.ts`, `coordinator/seed-summary.ts`, `coordinator/boot-migration.ts`, `services/coordinator.ts`: deleted. `chiefTranscriptLines`, `conversational`, `strictlyAfter`, `RowPosition` move into `chief-claim-history.ts`, their only surviving consumer; that file drops the `chiefSummary` read so claim history is transcript-only.
2. `coordinator/index.ts`: `factsFor.seed` drops the `chiefSummary` lookup and `unsummarized` window; the seed is the newest `SEED_MAX_ROWS` conversational rows, `summary` removed from `ReconcileSeed` and from `seedCoordinator`'s signature (no more CompactionEntry on reseed). `prepareSummary`, `preparing`, `laggingSeedWindowStart`/`seedSummary`/`summarizerFor`/`createCoordinatorModels` uses go with it; `idle()` only drains `draining`. `isChiefDigestStep` checks in `wake`/`liveThreads` go (no digest steps can exist live).
3. `machine-claim.ts`: `serverTakesTurn` loses the digest exclusion; `chiefTurnLocked` is mail-only; `chiefClaimPayload` loses the digest remote-tools branch; `claimChiefTurn` loses the digest sort and keeps the ≥0.2.2 CLI gate for mail turns under a renamed constant.
4. `machine-finish-step.ts`, `machine-relay.ts`, `coordinator-steps.ts`, `scheduler.ts`: digest branches, `assertChiefDigestTool`, `finishChiefDigest`, `planChiefDigests`, `CHIEF_DIGEST_SYSTEM_PROMPT`, the `digest` flag in `chiefTurnContext` all removed.
5. Routes: `GET /api/teams/:id/coordinator` and `POST /api/teams/:id/coordinator/messages` removed with `services/coordinator.ts`; callers switch to `POST /api/teams/:id/chief/threads`. Shared `coordinatorSendBodySchema`/`coordinatorPageQuerySchema`/`coordinatorMessageSchema`/`coordinatorPageResponseSchema`/`projectCoordinatorResponseSchema`/`COORDINATOR_PAGE_LIMIT` removed.
6. Env/config: `CAIRN_COORDINATOR_SERVER_CONTEXT` and `CAIRN_COORDINATOR_MACHINE_ID` removed from `ENV_VARS` and `serverConfigSchema`; `index.ts` stops calling `setCoordinatorServerContextEnabled` and `migrateSidecarState`. `coordinatorRunsOnPi()` reads the in-server flag only; tests that need that state call `setCoordinatorInServer`.
7. Routing: `'digest'` leaves `ROUTE_USES`, `USE_DISPLAY_NAMES`, `GRAPH_USES`, `ROUTE_USE_LABELS`, `STORED_ONLY_USES`, and the settings-page label; migration deletes stored `use='digest'` rules so nothing stale reaches the wire enum.
8. `failure-report.ts` loses the `seed-summary`/`summary-model` stage literals.

## Migration 0204

```sql
UPDATE step SET status='stopped', finishedAt=<epoch_ms>
  WHERE kind='chief' AND status IN ('pending','claimed') AND buildId LIKE 'chief-digest-%';
DELETE FROM routing_rule WHERE use='digest';
DROP TABLE `chief_summary`;
```

Leftover `claimed` digest steps settling post-upgrade fall through to `finishCoordinatorTurn` (`chief-digest-*` still matches `isChiefConversation`), which just closes them as ordinary turns. `0089_chief_summary.sql` stays in history; `legacy/agent-layer/schema.ts` is the frozen oracle and keeps its `chief_summary` definition.

## Tests

- New `retire-chief-digest-migration.test.ts`: upgrade from pre-0204 stops live digest steps, deletes digest rules, drops `chief_summary`, preserves `chief_*` rows and ordinary steps; fresh DB has no `chief_summary`; failed first statement leaves `chief_summary` intact.
- Deleted: `chief-digest.test.ts`, `coordinator/seed-summary.test.ts`, `coordinator/boot-migration.test.ts`.
- `chief-summary-removed.test.ts` now asserts the scheduler never produces `chief-digest-*` steps and `chief_summary` is absent from the schema.
- `send-never-waits.test.ts` drops `chiefSummary` seeds and asserts the send path seeds the raw window with no summary call.
- `compaction-failures.test.ts` and `otel.test.ts` drop `seed-summary`/`summary-model` stage assertions.
- `chief-claim-history.test.ts` drops `chiefSummary` seeds and asserts transcript-only history.
- Tests posting `/api/teams/:id/coordinator/messages` switch to `/chief/threads` (same `sendChiefMessageFromComposer` path, same `clientMessageId` stamping).
- `coordinator-tool-parity.test.ts` drops the digest-tools parity test.
- Vocabulary/table counts and shared snapshot regenerated.
