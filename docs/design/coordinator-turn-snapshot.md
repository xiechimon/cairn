# Coordinator turn snapshot

Refs [#3809](https://github.com/xiechimon/cairn/issues/3809) and [#3742](https://github.com/xiechimon/cairn/pull/3742). Design only; coordinator approval precedes migrations, runtime changes and the separately owner-reviewed eval consumer change. Evidence: **Observed** means read first-hand; **Inferred** means derived; **Proposed** means a decision for review.

## Prior art and decision

Read with [the existing research](../research/eval-on-langfuse-2026-11-09.md) and [eval design](eval-on-langfuse.md). This focused comparison is the research record for this design.

| Source | Mechanism and trade-off | Evidence |
| --- | --- | --- |
| [Langfuse datasets](https://langfuse.com/docs/evaluation/experiments/datasets#create-items-from-production-data), [deployed v4.68 schema](https://github.com/langfuse/langfuse/blob/v4.68.0/packages/shared/prisma/schema.prisma#L752-L778) | Items hold input, expected output, metadata and source trace/observation IDs; timestamp versions preserve edits. Readers must pin a version rather than use latest. | Observed |
| [OpenAI Evals](https://developers.openai.com/api/docs/guides/evals) | Schema-validated JSONL items, referenced by file ID, supply replay prompt templates. External database state must be included in the input. | Observed mechanism; Inferred database requirement |
| [OTel GenAI](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md#capturing-instructions-inputs-and-outputs) | Large or sensitive content may live outside spans, with references and separate access control; storage and retention remain application decisions. | Observed |
| Cairn | One immutable local table row per turn; trace carries identity/digest only. Independent of trace-export delivery, but requires capture and retention code. | Proposed |

**Recon (Observed):** #3742 `state.mts` at `58391f8d3add66e09db13d034a2896ee3885b72a` reads live tables and requires both timestamps on every project/todo/build. Local project/todo lack them and build lacks `updatedAt`. **Single path (Proposed):** replace live harvesting with exact-key snapshot reads; do not add timestamps, backfill historical worlds or retain a live fallback.

## Capture contract and states

**Proposed:** `absent -> collecting (turn-local memory) -> sealed (one committed row)` or `unusable` (reason only). Seal at every terminal Coordinator outcome, after awaited tool calls and their database commits, before publishing completion/starting the next turn. Failed/stopped turns may retain diagnostic snapshots but are ineligible for scoring. Crash/lease-loss recovery never reconstructs a missing snapshot from current tables.

Persist at turn end, but capture inputs when read: collect the initial complete routing world at claim/context assembly and ordered tool-boundary read views, each with call ID, input/output, logical time, pre-call world and committed effects. The live handler and capture share the same short database transaction/read view; never hold a transaction across model/network waits. Deduplicate equal projections. The final post-tool world is audit data, not replay's starting state: a newly created todo must not exist before its replayed `create_todo`. Preserve negative lookups, empty collections, ordering, provenance and time-dependent inputs. Concurrent changes between calls belong to the corresponding views; unrepresentable interleavings make the case unusable. Candidate calls use captured state through real handlers, never canned successful tool responses; uncaptured reads fail closed. No claim that one end-time query reproduces earlier reads.

| Read boundary (source files under `apps/server/src/services/`) | Required captured closure, scoped to this team and reachable records |
| --- | --- |
| Context and `chief-tools.ts:projects` | Source request, ordered input/steered message IDs and text, thread/team/project chip, supplied context; all project routing fields including archive/configuration and todos needed for counts. |
| `chief-tools.ts:todos` -> `todos.ts` | List/detail/filter/page inputs; todos including request/siblings/dependencies/archive/order; all build history; steps and quota/hold/fallback state; `todoTag`, tags, GitHub label links; token usage; schedule state; ownership inputs from `owner.ts` (messages/questions, projects, builds, steps, gate state); verification verdict/head/digest from `verified.ts`. |
| `chief-router-tools.ts:open_thread` -> `thread-message.ts` -> `builds.ts` | Team/archive checks, latest/historical builds and steps (`stoppedBeforeFirstRun`), retry parking/failure windows, prior errors, retry lessons (feedback, plans, messages, gate digests/verdicts and referenced research), routing rules/work policies, research prerequisite/deduplication state and dependencies. |
| `chief-tools.ts:create_todo` -> `coordinator-request.ts` -> `todos.ts` and the same start-build path | Cited owner/answered-question messages, source todo segments, split siblings, referenced dependencies, attachment authorization metadata, sequence/order allocation, tags/labels and project configuration; include post-create detail reads and auto-created research work as effects, not initial rows. |
| Shared routing/availability dependencies | Machine online/runtime/capability/quota projections, stored step routes, model catalog, team usage policy, active-subscription availability/expiry as a boolean/time projection, and captured clocks. Never subscription tokens or credential rows. |

Each row is a versioned schema contract, not permission to dump whole rows. Record complete collections where alternate tool arguments may read them. Uncaptured memory/history, filesystem, attachments' contents or external services remain ineligible under the eval design; reference metadata alone does not enable replay. A new read dependency must extend capture, seeding and its parity test together.

## Storage, paths and failures

**Proposed:** `coordinator_turn_snapshot` stores `teamId`, unique `turnId` (step ID), unique `sourceTraceId = otlpTraceIdOfTurn(turnId)`, schema version, terminal outcome, `capturedAt`, expiry, status/reason, redaction count, payload bytes, SHA-256 of canonical redacted JSON and nullable payload. Insert once; identical completion retries return the row, conflicting retries report unusable without replacing it. Schema/identity/digest must agree; capture time is not a surrogate row timestamp.

| Path | Behavior and failure |
| --- | --- |
| Claim/context and the four tool boundaries above | Collect bounded allowlisted projections; collection/serialization failure records an unusable reason and releases payload memory, while tools keep their existing behavior. |
| `coordinator/server-api.ts:done` and legacy `machine-finish-step.ts`, converging on `coordinator-steps.ts:finishCoordinatorTurn` | Sole sealer after tool commits, before terminal publication; use a separate snapshot transaction. Write/validation/redaction failure rolls back only that transaction: the turn still succeeds. Emit a payload-free reason metric/log; best-effort unusable row, otherwise absence is authoritative. No delayed live reread retry. |
| Trace emission (`runtime-otel.ts`) | Attach turn/trace ID, snapshot status/version/digest; export failure neither deletes the local row nor changes turn outcome. |
| Trusted harvest, then replay seeding (future protected eval PR) | Read snapshot by team + turn/trace, validate identity/version/digest/completeness/outcome/expiry, freeze payload into Langfuse item input and pin dataset version. Seed initial world and ordered views in disposable DB; preserve candidate effects. Missing, pending, failed, expired, corrupt, unknown-version or unsupported reads => `incomplete: snapshot <reason>`, never a scored regression or live fallback. Restore `todos`/`open_thread` eligibility only with full closure parity. |
| Retention/deletion | Daily bounded cleanup deletes expired rows after 30 days; harvest checks expiry even if cleanup fails. Cap retained payload at 256 MiB/team, evict oldest sealed rows first; missing rows become unusable. Team/privacy deletion removes snapshots too. Curated Langfuse inputs are independent copies governed by dataset retention/deletion, not pointers to expiring rows. |

Bound each turn to 2 MiB UTF-8 redacted JSON, 10,000 total projected records and 128 call views, enforced during collection and serialization. Exceeding any bound stores only an unusable reason; never truncate into an eligible case. These limits and retention are Proposed local decisions, not upstream guarantees.

## Privacy and acceptance

**Proposed:** allowlist fields first; exclude credentials, encrypted envelopes, auth headers, environment values, machine addresses and filesystem paths. Apply the same shared `redactSecrets` used by `runtime-otel.ts` before persistence and again at export; store hit counts only. Redaction/key collision or removal of a required replay field makes the case unusable. Restrict local reads and harvest to authorized team/trusted operator paths; no public endpoint or public-repo fixture containing harvested owner text. Keep expected answers outside snapshots/candidate input.

**Red first:** before implementation, fail on current main for (1) timestamp-free schema + harvest after later mutation/deletion, (2) one real source/replay parity test per closure-table row, including list/detail pagination, restart and quoted split creation, (3) pre/post-create separation, concurrent writes and time-based ownership/quota, (4) duplicate/conflicting finish, crash/recovery, failed/stopped turns and both completion entry paths, (5) injected snapshot write failure with successful turn and unusable harvest, (6) bounds, expiry/cap cleanup and team deletion/isolation, (7) fake-token redaction, forbidden fields, corruption/unknown schema and uncaptured-read denial. Then prove red-to-green with targeted tests plus an isolated running server's real tools, persisted row and harvest; no live-instance writes. This PR provides design evidence only.
