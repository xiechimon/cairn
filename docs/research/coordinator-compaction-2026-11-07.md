# Coordinator context compaction: how others do it, and what cairn should do (2026-11-07)

Labels: **measured** = source code or official documentation text read this round; **inferred** = follows from measured facts and can be re-checked; **guessed** = everything else. Baseline: `origin/main` @ `aa9eb3f40` (includes #3340); pi-durable 1.5.0 and pi-coding-agent 1.4.0 are the versions actually installed under `node_modules/.pnpm`.

## 0. Conclusions first

1. The existing background rolling summary (`chief_summary` + `planChiefSummaries`) matches no one else's practice. Nobody uses "a rolling summary in the background that nobody reads, every 2.5 minutes". (Inferred: every product I checked compacts when context nears the limit, or on demand / manually.)
2. It is also redundant. The Coordinator runtime (pi-durable) already has built-in threshold compaction (background start after 70k tokens, blocking at window minus 16k), and cairn already plugs in its own summary hook. `chief_summary` is only read when the store is lost and has to be re-seeded. (Measured, see section 2.3.)
3. Recommendation: remove the steady-state background summary planning (take `planChiefSummaries` out of the scheduler tick), keep only Pi's threshold compaction, and demote `chief_summary` to a one-off, on-demand summary used for re-seeding.
4. System rows (thread reports, `[wake:]`, tool calls) must not drive any summary by row count. They should be shortened and read back on demand, not summarized one by one; the root problem to treat first is that most of the 5250 rows are system rows.
5. What this document did not do: it did not count row types in the production database, and did not verify that Pi's threshold compaction has ever fired in production (see "verify first" in section 6).

## 1. Comparison table

| Product | When it compacts | What it keeps | Cost | Source | Label |
|---|---|---|---|---|---|
| Claude Code | Auto-compacts near the limit; `/compact [focus]` manually; `/autocompact N` sets the window (100K-1M). Default: models with a native 1M window compact at about 967K, 200K windows at the boundary. If the context fills again right after consecutive compactions it stops and reports an error instead of looping | The summary keeps user requests and key code; CLAUDE.md, auto memory and the plan are re-injected from disk; at most 5 recently read or edited files are re-read (files over 5k tokens keep only the path); the bodies of invoked skills are re-injected (each at most 5k, 25k in total) | One summary call (input is the whole history). The summary call inherits the session's thinking setting. The exact prompt is not documented (closed source) | [context-window](https://code.claude.com/docs/en/context-window), [model-config](https://code.claude.com/docs/en/model-config), [how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works) | Measured (docs); prompt content: not measured |
| Anthropic API: threshold compaction | Triggered inside a request, default `input_tokens` 150,000, minimum 50,000; completed synchronously within the request that triggered it, not in the background | The summary block replaces the history before it; you can `pause_after_compaction` and re-insert the last few turns yourself | `usage.iterations` lists compaction as its own item and you must sum it yourself; the summary block can carry cache_control, and the system prompt cache stays valid | [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction), [compaction-threshold](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold) | Measured (docs) |
| Anthropic API: on-demand / background compaction | The application picks the timing; the "background" version sends a summary request over a copy of the history while the conversation continues, and on return replaces only the segment the request contained, keeping turns appended later. The docs require starting while the window still has headroom and allow only one in flight at a time | Can keep the last N turns verbatim | One summary request, counted against rate limits | [compaction-background](https://platform.claude.com/docs/en/build-with-claude/compaction-background) | Measured (docs) |
| Anthropic API: context editing | `clear_tool_uses_20250919` starts clearing by default when `input_tokens` exceeds 100,000; the oldest tool results go first, replaced by placeholder text | Keeps the latest 3 tool use/result groups by default; `exclude_tools` can exempt tools; `clear_at_least` avoids breaking the cache to save very little | No summary call, zero model cost; invalidates the prefix cache | [context-editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) | Measured (docs) |
| Anthropic engineering blog | Calls "clearing tool results" the lightest form of compaction; the summary keeps architecture decisions, unresolved bugs and implementation details and drops redundant tool output | Also pairs it with structured notes (NOTES.md, todo) and sub-agents (returning 1-2k token summaries) | No numbers given | [effective-context-engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Measured (docs) |
| OpenAI Codex CLI (open source) | Checks before each turn (PreTurn) and inside a turn (MidTurn); default threshold = context window x 90%, the smaller of that and the configured value wins (`auto_compact_token_limit`) | History after compaction = initial context + user messages (newest first, at most 20,000 tokens in total) + the summary; assistant messages and tool output are not kept; an old summary message is not carried over as a user message | One summary call, whose prompt is "CONTEXT CHECKPOINT COMPACTION... handoff summary"; there is also a server-side remote compaction path | Source `codex-rs/protocol/src/openai_models.rs` (`auto_compact_token_limit`), `core/src/compact.rs` (`COMPACT_USER_MESSAGE_MAX_TOKENS`, `build_compacted_history`), `prompts/templates/compact/prompt.md`, repository [openai/codex](https://github.com/openai/codex) @ `f5ac7a7` | Measured (source) |
| OpenAI API | `context_management: [{type:"compaction", compact_threshold}]` compacts as soon as the stream crosses the threshold and emits a compaction item in the same stream; there is also a stateless `/responses/compact` | The compaction item is encrypted and opaque; earlier items can be dropped | The docs give no price | [compaction guide](https://developers.openai.com/api/docs/guides/compaction) | Measured (docs) |
| pi-coding-agent 1.4.0 (installed in this repo) | `shouldCompact`: context tokens > window minus `reserveTokens` (default 16384) | `keepRecentTokens` defaults to 20000 kept verbatim, summary before that; structured summary (Goal/Progress/Decisions/Next Steps) | One summary call | `node_modules/.pnpm/@earendil-works+pi-coding-agent@1.4.0*/.../dist/core/compaction/compaction.js` (`DEFAULT_COMPACTION_SETTINGS`, `shouldCompact`) | Measured (source) |
| pi-durable 1.5.0 (Coordinator runtime) | See section 2.1: blocking threshold = window minus reserve; further below it, `backgroundTokens` starts a run in the background; on context overflow it compacts and retries once; manual `compact()` | Cuts at turn boundaries; `keepRecentTokens` kept verbatim; the summary is stored as a `pi.compaction` entry and old entries remain in storage; the `beforeCompact` hook can reject or supply its own summary | The summary call's usage counts toward `pi.usage`; tool results in the summary input are cut to 2000 characters and thinking is excluded | `.../pi-durable/README.md` "Compaction" section, `dist/harness/compaction.js`, `dist/harness/generation.js` (`thresholdCompaction`) | Measured (source) |
| Cursor | Summarizes when the context is full and moves to a fresh window. Long tool output is written to files instead of truncated; the blog says this reduced the number of summaries | The summary is lossy, so chat history is stored as files and the agent gets a reference it can search later | Not published | [dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery); the [docs page](https://docs.cursor.com/agent/chat/summarization) redirects to cursor.com/docs and the body was not read this round, the search snippet is what is cited here | Blog: measured; docs page: not read |
| Amp | No automatic compaction; manual handoff instead: the user gives the goal of the next thread, Amp generates a start prompt and a list of relevant files | The new thread starts clean, with an editable start prompt | One generation call, triggered by the user | [Amp handoff](https://ampcode.com/news/handoff) (Amp calls compaction lossy and says it "encourages long threads", stacking summaries) | Measured (article) |
| claude.ai | On paid plans with code execution enabled, summarizes earlier messages automatically when a conversation nears its limit; the full chat history remains and can be referenced later | Details not published; the official note says longer conversations use more of the quota | Counted against the usage quota | [help center](https://support.claude.com/en/articles/8606394-how-large-is-the-context-window-on-paid-claude-plans) | Measured (docs); trigger point: not published |
| ChatGPT product | No documentation of long-conversation handling found in public material | - | - | - | Not measured (no first-party source) |

## 2. cairn today

### 2.1 pi-durable already has threshold compaction (measured)

- `thresholdCompaction()`: when the estimated tokens exceed `contextWindow - reserveTokens` it is blocking; and within `backgroundTokens` below that, with no compaction in progress, it starts a background compaction. If there is no cut position it does nothing.
- For a background compaction, "the summary is placed immediately when the session is idle, otherwise at the next turn boundary", and the conversation continues meanwhile. This is isomorphic to Anthropic's background compaction docs.
- cairn already configures this (`apps/server/src/coordinator/runtime/compaction.ts`): `reserveTokens` 16,384, `keepRecentTokens` 8,000, background start `min(70_000, blockingAt/2)`; `coordinatorCompactionExtension` supplies its own summary through the `beforeCompact` hook: it folds batch by batch with `COORDINATOR_SUMMARY_PROMPT_HEAD`, the input takes only user/assistant text and tool calls (`transcriptLines` drops toolResult), routed through `use='compaction'` (`credentials.ts`).
- So the Coordinator's in-session context was already "threshold-triggered, started in the background, recent text kept verbatim", the standard practice.

### 2.2 The rolling summary in chief_summary (measured)

- `planChiefSummaries` hangs off the scheduler tick (`scheduler.ts:510`). Each thread with at least 100 unsummarized rows (`SUMMARY_WINDOW_MESSAGES + SUMMARY_BATCH_MESSAGES`) gets a digest step queued, at most 400 rows per step (50 before #3340).
- It does not look at context usage, only at row count. It runs even with no context pressure.
- Each digest step is a full model call whose prompt carries the previous summary (at most 20,000 characters) plus new messages (at most 40,000 characters).

### 2.3 Who reads chief_summary (measured)

In all of `apps/server/src`, the only non-test read is `seed()` in `coordinator/index.ts`: when the store is missing or restored, it re-seeds a pi session from `chief_summary` plus the latest 100 rows (each at most 8,000 characters). A running session never reads it.

So in steady state the background summary's output has no consumer. (Inferred: it only matters in the rare event of losing the store, and then the old summary lags behind the newest rows anyway and a segment has to be filled in.)

### 2.4 Why "system rows" get counted (measured + inferred)

`conversational()` filters out `role='system'` and the `chief-digest-` and `chief-report-` prefixes, but thread reports and events are stored as `[wake:...]` text with `role='user'`, and tool calls are `kind:'toolcall'` rows with `role='assistant'`. All of these count toward the "unsummarized row count" (measured: the original text of the filter). "Most of the 5250 rows are system rows" is consistent with this (inferred; I did not check the production row-type distribution, see section 6).

`seed.ts` likewise carries them into seeding (events are rewritten as `[event] ...`, tool calls become `[called ...]`): of the latest 100 rows, most are probably events and tool calls, and the 8,000-character per-row cap is large for a thread report. (Inferred.)

## 3. General patterns

### 3.1 Threshold-triggered vs background rolling

- All coding agents (Claude Code, Codex, pi) are **threshold-triggered**: compaction happens when pressure arrives. The Anthropic and OpenAI APIs are also mainly token-threshold based (measured).
- "Background" appears as: leave headroom and start early before the threshold (Anthropic background compaction docs, pi `backgroundTokens`); the summary is the async version of the same compaction, not a resident rolling job.
- I found no product that does "every N messages, with output nobody reads". (Inferred, from the range in the table above.)
- Amp goes the other way: no compaction, change threads. That does not fit cairn's "one long thread per team", because this thread is designed never to be replaced. (Inferred.)

### 3.2 What to drop first

- Tool output first: Anthropic's context editing clears the oldest tool results first and the blog calls it the lightest compaction. Codex keeps no assistant or tool output after compaction, only user messages (at most 20k tokens) plus the summary. pi cuts tool results to 2000 characters in the summary input. Cursor writes long output to files. (Measured.)
- A lossy summary is the consensus: Cursor stores history as files for search, Claude.ai says the full history can still be referenced, Amp gave up on compaction. For cairn: `chief_message` is already the complete truth, and the `read_history` tool already exists (the truncation hint in seed refers to it). (Measured.)

### 3.3 Should system/event rows enter the model context

- This round found no product that treats event notifications as content that must be kept one by one. Claude Code's approach is that hook-injected content is summarized away with the rest of the conversation (measured, context-window docs).
- Only the event that triggers the current turn must be in context, because the model has to respond to it. Once the turn is over, its conclusion is already reflected in the Coordinator's reply and the todo state. (Inferred.)

### 3.4 Cost of each compaction

- One compaction is roughly one call with "input = the prefix to summarize (including the previous summary), output at most the summary cap" (measured: everyone does this).
- Total cost is set by the **number of compactions** and **how much each reads**. With threshold triggering, each message is read into a summary about once and afterwards appears only as summary. The problem with cairn's rolling summary: the trigger is decoupled from context pressure, with a backlog it runs every 2.5 minutes, and its output is read by almost nobody. (Inferred.)
- Cache: the Anthropic docs warn that compaction or clearing invalidates the prefix cache, hence `clear_at_least`; Codex rewrites history in the window. cairn's pi compaction places the summary at a turn boundary, which is consistent. (Measured docs; effect on cairn's cache: guessed.)

## 4. Which pattern fits the cairn Coordinator

**Threshold trigger with background start (what pi-durable does now), and do not stack a rolling summary on top.**

Reasons:

1. It is the industry mainstream and already wired in (section 2.1, measured).
2. The Coordinator is a single long thread, so compacting by token pressure is exactly right; compacting by row count cannot tell apart a thread with many short or long events. (Inferred.)
3. Durable truth is in `chief_message`, and the pi store is a derived product that can be re-seeded (`coordinator-in-server.md` section 3 already decided this), so no always-fresh summary is needed as insurance. (Measured: the original text of that document.)

## 5. Should the background digest still exist

**Not in steady state.** Three separate things:

- `planChiefSummaries` and its `queueSummary`, `finishChiefSummary`, `digestSlotBusy` and the `SUMMARY_*` constants: take them off the tick, delete them last.
- Keep the `chief_summary` table, and give it one of these two write sources:
  - A (simplest): when `seed()` finds the store missing, make one on-demand summary call over "the rows before the latest 100" (`foldSummary` in `compaction.ts` is the existing fold function), write it to `chief_summary` and use it for seeding. Cost: one slower startup when the store is lost; very rare.
  - B (faster startup): after pi's `beforeCompact` hook produces a summary, write it back to `chief_summary` together with "which `chief_message` it covers through" (needs the `coordinator_entry` table to map an entry back to a message). Then seeding always has a near-current summary. Cost: one more coupling, and the summary write must be in a transaction.
  - Recommend A; do B only if "slow startup after the store is lost" becomes a real problem. (Inferred.)
- The daily review digest in `chief-digest.ts` (`CHIEF_DIGEST_*`, daily/threshold) is a different feature (a "decisions / done / todo / remembered" list for the user), outside the scope of this document; do not delete it along the way. (Measured: that file's prompt and `foldCandidate`; whether the product still uses it: guessed.)

## 6. Handling non-conversation rows

From lowest to highest cost:

1. **Doable right away, depends on nothing else**: change the counting and the summary-input filter to "count only real conversation rows", i.e. exclude `[wake:...]` event rows and `kind:'toolcall'` rows. Before the deletion in section 5 lands, this alone brings "every 2.5 minutes" down to a rate that follows real conversation volume. (Inferred: based on the filter in section 2.4.)
2. **Give event rows their own short cap** in seeding and summary input (a few hundred characters, say, with a `read_history ids [...]` read-back hint, a format that already has precedent), instead of reusing the conversation-row cap of 8,000. (Inferred.)
3. **Make events short when they enter context**: the full thread report stays in `chief_message` for the UI, and the model gets a short form plus a read-back pointer. This corresponds to Cursor writing long output to files and Anthropic clearing tool results. It needs a look at the injection points in `volatile.ts` / `beforeRequest`; I did not read a hook I can confirm is feasible, so this is only a direction. (Guessed.)
4. **Clear old tool results**: Anthropic's `clear_tool_uses` idea, giving the Coordinator's tool results a "keep the latest N groups" setting. Whether pi-durable has an equivalent switch was not found this round, no conclusion. (Guessed.)

## 7. Concrete changes and code locations

| # | Change | Location | Note |
|---|---|---|---|
| 1 | Take `planChiefSummaries` off the scheduler tick | `apps/server/src/services/scheduler.ts:510` | Stops the background summary immediately; `chief_summary` data is untouched |
| 2 | Make `conversational()` and the seed row filter exclude wake events and toolcall rows | `apps/server/src/services/chief-summary.ts`, `apps/server/src/coordinator/runtime/seed.ts` (`readThreadRows`, `seedMessageText`), `seed()` in `apps/server/src/coordinator/index.ts` | Only if a transition period is wanted; either this or 1, or do it first |
| 3 | Build the seeding summary on demand (option A) | `seed()` in `coordinator/index.ts`, reusing `foldSummary` and `summaryBatches` from `coordinator/runtime/compaction.ts` | Afterwards delete the planning and finishing logic in `chief-summary.ts` and the call sites of `isChiefSummaryStep` (grep its consumers first, for example `machine-finish-step.ts`) |
| 4 | A separate short cap for event rows | the `SEED_ROW_MAX_CHARS` branch in `seed.ts` | Keep the `read_history` hint |
| 5 | Observability: record compaction events | pi's `pi.live.compactions`, `onReport`; cairn's existing `chief_turn_usage.contextTokens` | See below |

**Three things to verify before changing anything** (I did not do these; all are read-only):

- Count the production `chief_message` distribution by `role`, `kind` and `[wake:` prefix, to confirm the inference in section 2.4.
- Look at the recent trend of `chief_turn_usage.contextTokens` for the Coordinator thread and the `contextWindow` of the model in use: confirm that pi's background compaction threshold (`min(70k, blockingAt/2)`) has really fired in production and has not been failing for a long time (`pi.live.compactionFailure`).
- Confirm the call sites of `isChiefSummaryStep` and `finishChiefSummary` in the machine completion path, so no orphans are left after deletion.

## 8. Not found or not read

- The full text of Claude Code's summary prompt: closed source, not documented.
- Cursor's official docs page: the body was not fetched after the redirect from `docs.cursor.com`; only its blog and search snippets were used.
- ChatGPT product long-conversation handling: no first-party source.
- claude.ai's exact trigger point: the official article does not say.
- Anthropic's sub-pages such as `compaction-on-demand` and `preserved-thinking`: only the overview, background and threshold pages were read.
