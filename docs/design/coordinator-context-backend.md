# Coordinator context and compaction backend

Status: B1 design draft, documentation only. Baseline: `f004cd719`, 2026-11-08. Research: [current-source supplement](../research/coordinator-context-2026-11-08.md), [prior art](../research/coordinator-compaction-2026-11-07.md). This design retains the merged memory-rework behavior, not the older rolling-summary proposal.

## Contract and ownership

The Coordinator has one continuing conversation. `chief_message` is canonical history; compaction changes model context, never the user's transcript. History tools remain the way to recover omitted detail. No frontend compaction controls or new routes are introduced.

There is one runtime compaction path: pi-durable threshold compaction through `coordinatorCompactionExtension`. It runs in the background from the background start; it blocks a request only above the blocking threshold, where the request would not fit.

A send never waits on a summary (mon X, 2026-11-14). A model switch sends the whole conversation, the same view the next warm turn would send, so it needs no summary. Reconstructing the derived runtime store seeds the newest `SEED_MAX_ROWS` conversational rows from `chief_message`, without calling a model. The earlier `chief_summary` recovery cache and its `seedSummary` fold were retired by #5349: a seeded session no longer prepends a compacted block, so rows older than the window are recoverable only through the history tools.

## Budget

`coordinatorCompactionSettings` reserves 16,384 tokens and keeps 8,000 recent tokens. For model window W, blocking pressure is W minus 16,384 and background start is min(150,000, floor((W minus 16,384) / 2)). The pi setting named `backgroundTokens` is the distance below the blocking threshold, not the absolute start. Model overrides must preserve that distinction.

The resolved model catalog supplies W. Reject an unusable model window before starting a turn; do not use the context-meter default of 128,000 as permission to submit a larger request. The 3,000-token memory selection budget is inside the total request, not extra space outside W. Tool schemas, system instructions, recent messages and output reservation all consume the same window.

Summary input is divided by `COORDINATOR_SUMMARY_TRANSCRIPT_MAX_CHARS`; output is bounded by `COORDINATOR_SUMMARY_MAX_CHARS`. Character limits bound work but do not prove token fit. Acceptance must measure the actual submitted request with the selected model, including the previous summary and fixed prompt.

## Storage and sequencing

| Store | Identity and role | Write rule |
|---|---|---|
| `chief_message` | Canonical rows in a thread | Never removed by compaction |
| pi durable store | Runtime entries and compaction checkpoints | Derived; keep valid turn/tool boundaries |
| Turn usage | Actual request context usage | Diagnostic |

Rows older than the seed window are not carried into a reconstructed session; they stay reachable through the canonical history tools.

## Compaction flow

1. pi chooses the cut at valid conversation boundaries.
2. Read the compaction-task summary memo; reuse a completed value on task replay.
3. Split the previous summary from new messages. Shorten events using `shortEvent`; omit tool-result bodies. Keep tool names and bounded arguments, exact identifiers and lookup hints.
4. Run the bounded durable-fact flush through the memory service. A failed flush is reported as `memory-flush`; summary folding still runs. Its completion memo prevents duplicate writes during task replay.
5. Fold batches using the compaction-routed model with low reasoning. A non-stop completion is failure, not a partial summary.
6. Commit the successful summary through pi's compaction task; publish the failure through existing reporting if folding fails. No blind retry loop or model substitution is added.

Memory flush and summary are deliberately separate failure domains. A flush failure must be visible to operators even if compaction succeeds. No credentials, complete prompts or memory bodies belong in diagnostic events.

## Failure modes and tests to write first

| Failure | Required outcome | Test location |
|---|---|---|
| Small/unknown model window | Reject invalid budget before model request; no negative threshold | `apps/server/test/coordinator/compaction.test.ts` |
| Summary missing model, provider error or non-stop completion | Report and preserve canonical history and prior checkpoint | `apps/server/test/coordinator/compaction-failures.test.ts` |
| Equal timestamps at boundary | Exactly ordered inclusion; no duplicate/omitted boundary row | Seed tests under `apps/server/test/coordinator/` |
| Rows beyond the seed window | Recoverable through history tools, never a partial summary | Seed tests plus history integration |
| Restart after flush, before summary commit | Replay reuses task memo; no duplicate durable fact | Compaction and memory-flush tests |
| Failed flush | One observable failure, successful summary can continue, no false flush success claim | Compaction failure tests |
| Tool call/result spans cut | No orphaned tool result submitted | Runtime integration |
| Memory or summary instructions contain hostile quoted data | Treat content as data; service validation remains authoritative | Memory-flush tests |

Run existing compaction/history tests before adding behavior. A compiled runtime or request snapshot must demonstrate threshold translation, full request size, stable cache prefix before compaction, and searchable canonical history afterward. Real-model performance comparisons reuse #2981's harness; changing the protected eval ruler is outside B1.

## Code areas and replacement boundary

- `apps/server/src/coordinator/runtime/compaction.ts`: threshold settings, transcript shaping, fold and task memos.
- `apps/server/src/services/chief-history.ts`: canonical read/search, not lossy summary search.
- `apps/server/src/services/coordinator-context.ts`: measured usage and display window.
- `apps/server/src/coordinator/memory-flush.ts`: durable facts through validated memory service.

The old `planChiefSummaries` scheduler and steady-state rolling digest were already removed by #3362. Daily user reports and daily conversation digests are also retired. Context-pressure compaction and pre-compaction memory flush remain; neither schedules daily work. No daemon/provider access is moved outside its existing seam.
