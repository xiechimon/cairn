# Coordinator context and compaction backend

Status: B1 design draft, documentation only. Baseline: `f004cd719`, 2026-11-08. Research: [current-source supplement](../research/coordinator-context-2026-11-08.md), [prior art](../research/coordinator-compaction-2026-11-07.md). This design retains the merged memory-rework behavior, not the older rolling-summary proposal.

## Contract and ownership

The Coordinator has one continuing conversation. `chief_message` is canonical history; compaction changes model context, never the user's transcript. History tools remain the way to recover omitted detail. No frontend compaction controls or new routes are introduced.

There is one runtime compaction path: pi-durable threshold compaction through `coordinatorCompactionExtension`. It runs in the background from the background start; it blocks a request only above the blocking threshold, where the request would not fit.

A send never waits on a summary (mon X, 2026-11-14). A model switch sends the whole conversation, the same view the next warm turn would send, so it needs no summary. Reconstructing the derived runtime store seeds from the stored `chief_summary` and every row it does not cover, up to `SEED_MAX_ROWS + SUMMARY_LAG_ROWS` rows, without calling a model. After each turn, when at least `SUMMARY_LAG_ROWS` rows lie between the summary cursor and the newest `SEED_MAX_ROWS` rows, `seedSummary` folds that gap in the background so the next reconstruction finds the summary ready.

## Budget

`coordinatorCompactionSettings` reserves 16,384 tokens and keeps 8,000 recent tokens. For model window W, blocking pressure is W minus 16,384 and background start is min(150,000, floor((W minus 16,384) / 2)). The pi setting named `backgroundTokens` is the distance below the blocking threshold, not the absolute start. Model overrides must preserve that distinction.

The resolved model catalog supplies W. Reject an unusable model window before starting a turn; do not use the context-meter default of 128,000 as permission to submit a larger request. The 3,000-token memory selection budget is inside the total request, not extra space outside W. Tool schemas, system instructions, recent messages and output reservation all consume the same window.

Summary input is divided by `COORDINATOR_SUMMARY_TRANSCRIPT_MAX_CHARS`; output is bounded by `COORDINATOR_SUMMARY_MAX_CHARS`. Character limits bound work but do not prove token fit. Acceptance must measure the actual submitted request with the selected model, including the previous summary and fixed prompt.

## Storage and sequencing

| Store | Identity and role | Write rule |
|---|---|---|
| `chief_message` | Canonical rows in a thread | Never removed by compaction |
| pi durable store | Runtime entries and compaction checkpoints | Derived; keep valid turn/tool boundaries |
| `chief_summary` | Recovery cache keyed by `threadId` | Write only after nonempty successful folding |
| Recovery coverage | `coveredThroughId`, `coveredAt`, `coveredRowid` | Commit atomically with summary and generation |
| Turn usage | Actual request context usage | Diagnostic; the background summary is triggered by row lag, not usage |

Recovery orders equal timestamps by SQLite rowid. Snapshot `windowStart` before reading the older gap, and include only rows strictly before it and strictly after the prior coverage cursor. Messages appended during folding are not covered by that checkpoint. A restart reads the last committed generation; partial model output is not a checkpoint.

The current recovery implementation reads up to 2,000 newest gap rows and folds at most eight newest batches. This is bounded recovery, not evidence of complete older-history coverage. The design requires explicit coverage semantics: retain a searchable-history pointer for any skipped prefix and do not describe the summary as a complete account. Tests must distinguish the retained summarized range from omitted older history. The after-turn fold keeps the gap short; it does not make the summary a complete account.

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
| Empty summary | Do not advance recovery cursor or replace a valid checkpoint | Seed-summary tests under `apps/server/test/coordinator/` |
| Equal timestamps at boundary | Exactly ordered inclusion; no duplicate/omitted boundary row | Seed-summary tests |
| Append during fold | New rows remain outside committed coverage | Seed-summary tests |
| More than 2,000 rows/eight batches | Explicit omitted-prefix semantics and recoverability through history tools | Seed-summary tests plus history integration |
| Restart after flush, before summary commit | Replay reuses task memo; no duplicate durable fact | Compaction and memory-flush tests |
| Failed flush | One observable failure, successful summary can continue, no false flush success claim | Compaction failure tests |
| Tool call/result spans cut | No orphaned tool result submitted | Runtime integration |
| Memory or summary instructions contain hostile quoted data | Treat content as data; service validation remains authoritative | Memory-flush tests |

Run existing compaction/history tests before adding behavior. A compiled runtime or request snapshot must demonstrate threshold translation, full request size, stable cache prefix before compaction, and searchable canonical history afterward. Real-model performance comparisons reuse #2981's harness; changing the protected eval ruler is outside B1.

## Code areas and replacement boundary

- `apps/server/src/coordinator/runtime/compaction.ts`: threshold settings, transcript shaping, fold and task memos.
- `apps/server/src/coordinator/seed-summary.ts`: ordered recovery cache and cursor semantics.
- `apps/server/src/services/chief-history.ts`: canonical read/search, not lossy summary search.
- `apps/server/src/services/coordinator-context.ts`: measured usage and display window.
- `apps/server/src/coordinator/memory-flush.ts`: durable facts through validated memory service.

The old `planChiefSummaries` scheduler and steady-state rolling digest were already removed by #3362. Do not restore them. Preserve the daily user report: it is not a context checkpoint. No daemon/provider access is moved outside its existing seam.
