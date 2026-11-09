# Coordinator context: B1 current-source supplement

Baseline: `f004cd719`, 2026-11-08. Claim labels: **measured** means first-hand source/document reading, not live deployment verification; **inferred** means derived from those readings; **unverified** means not established. Design: [context backend](../design/coordinator-context-backend.md).

## Reuse and designated-source coverage

The SOURCES.md **Agent runtime: context, compaction, tool loops, sub-agents, steering** row designates Claude Code docs, Anthropic API docs, Codex CLI source, installed pi/pi-durable, and Amp manual. The complete comparison is reused from [coordinator-compaction-2026-11-07.md](coordinator-compaction-2026-11-07.md), including its explicit unread-page limitations; it is not represented as fresh web observation. [Personal-agent-memory](personal-agent-memory-2026-11-07.md) supplies the pre-compaction flush comparison. No source is silently replaced by a secondary article.

| Source | Reused evidence and trade-off | B1 consequence |
|---|---|---|
| Claude Code official docs | Threshold compaction, re-injected durable instructions; closed summary prompt, baseline §1 | **inferred**: retain durable facts outside summary |
| Anthropic API official docs | Threshold/background compaction and history suffix preservation, baseline §1 | **inferred**: checkpoint only the covered prefix |
| Codex CLI pinned `f5ac7a7` | Summary plus bounded retained user history, baseline §1 | **inferred**: bounded context must retain a history lookup path |
| Installed pi-coding-agent 1.4.0 / pi-durable 1.5.0 | Baseline §2; current Cairn adapter read this round | **measured**: current adapter supplies thresholds and summary hook; not proof of a production compaction |
| Amp manual / handoff article | Baseline §1 and memory note §6 explicitly leave manual sub-pages unread | **inferred**: manual thread replacement does not fit a never-ending Coordinator; manual sub-pages remain a research limitation |

## Changes since the prior note

**measured**: [compaction.ts](../../apps/server/src/coordinator/runtime/compaction.ts) now runs a memory flush before folding, memoizes flush and summary at compaction-task scope, reports flush and fold failures separately, and requests low reasoning. The prior note's recommendation to add a flush is already implemented (#3381/#3392/#3394).

**measured**: [seed-summary.ts](../../apps/server/src/coordinator/seed-summary.ts) reads the older gap on demand, bounded to 2,000 rows and eight batches; a nonempty successful fold writes summary and coverage fields together. Folding failure reports the error and returns the prior summary. #3362 already removed steady-state rolling summarization.

**measured**: [coordinator-context.ts](../../apps/server/src/services/coordinator-context.ts) reports last-turn context tokens and resolves a display window, defaulting to 128,000. This file is not a request-budget assembler.

**inferred**: the registry's description of fresh per-turn assembly should not be read as authorization to replace the durable resumed session. #2981's measured spike favors resume plus tuned compaction; B1 preserves that mechanism.

**inferred**: bounded recovery can skip an older prefix while moving its cursor through newer rows. A recovery-summary design must make omitted-history semantics explicit rather than claim that the cursor proves every older row was summarized. Canonical history remains the recovery source.

## Recommendation

One threshold-driven runtime compaction path and one on-demand recovery path. Preserve merged behavior, make budget accounting and coverage semantics testable, and name failure domains. No new scheduler, blind retries, optional mode or replacement model. Code areas and tests are in the linked backend design.

## Evidence limits

No live provider call, production database inspection or fresh installed-runtime behavior test was performed in this supplement. Prior source pins and documented limits remain visible above. No background-agent dispatch tool is available in this session, so the source review was performed serially. Runtime verification is a separate implementation acceptance step; this note does not alter the eval ruler.
