# Idle and pre-expiry compaction — plan, 2026-11-28

## User scenario

A person chats with the Coordinator on a long project, leaves the app open, and comes back
forty minutes later. Today nothing happens while they are away: the conversation keeps every
token it had when they left, so their next message either carries the whole history to the model
or waits, right after its answer, for the threshold compaction in `compaction.ts` to summarize it.
After this change the conversation is compacted during that quiet window, so the next message
starts from the short summary, and the compaction is paid while the provider's prompt cache for
the conversation is still warm instead of after it expired. A first-time user needs nothing new:
no setting, account, key or table, and the transcript keeps every message it had, so the only
change they can notice is the context meter's count dropping on their next turn. If the summary
model is unreachable or the thread is on a backend runtime (Claude Code,
Gemini, Devin, Antigravity, Doubao) nothing is compacted in the background and the conversation
behaves exactly as it does today.

### Why, and the data behind it

The Coordinator's own `chief_turn_usage` on the Mac mini (read 2026-11-29) shows that cached
prompt tokens, not fresh input, are what a long conversation mostly pays for:
`workbuddy/deepseek-v4.1-flash` read 22.0M cache tokens against 3.4M input tokens over 140 turns
(86% of its prompt tokens came from cache), `gemini-4-hydrogen` 18.8M against 6.9M over 226 turns,
and `claude-code/claude-opus-5-5` 268M against 24k over 96 turns. A summary request that replays
the conversation's own prefix is therefore paid mostly at the cache-read rate, while a request
that serializes the same messages into a fresh transcript pays full input for all of them. That
is the cost this change removes, and it is why the pre-expiry rule matters: after the TTL the same
prefix costs full price, so the compaction is worth running before it lapses.

### What a user meets, situation by situation

| Situation | What they see | What the system does | Wait and cost |
|---|---|---|---|
| Long conversation, nobody has typed for ten minutes | Nothing changes in the transcript; the context meter drops on the next turn | Compacts in the background once the last turn measured at least `idleCompactAt` | No user wait; the summary request is a normal model call, read from the warm prefix when the provider reports one |
| Long conversation, warm cache about to lapse (≤90 s) | Nothing | Compacts before the TTL, so the summary reads the cached prefix | No user wait; cache-read price instead of full input |
| Short conversation (below `idleCompactAt`) | Nothing | Sends no request at all | No cost |
| Provider with no known cache TTL | Nothing beyond the idle summary, read from a fresh transcript | Idle rule only; the pre-expiry rule never fires | One summary call at the model's normal input price |
| User types while the summary is being written | Their message appears at once and the answer starts generating | Admits the message, abandons the now-stale precomputed summary and folds the current history | No added wait for the answer; the summary lands at the next boundary |
| Summary model missing, unreachable or too small | Nothing; the conversation behaves as today | Skips, or falls back to the transcript fold; retries after a backoff | No cost the user pays for a failed summary |
| Server stops mid-summary | Nothing | Aborts the summary and places nothing partial; compacts once after the restart | No user wait beyond the normal restart |

## Scope

1. **Idle trigger.** The Coordinator tick compacts a conversation that has had no user or assistant
   message for the idle window already used by the memory flush (ten minutes,
   `IDLE_MEMORY_FLUSH_MS`) when its last turn measured at least
   `idleCompactAt(window) = max(32_768, floor(backgroundAt / 2))` prompt tokens.
   That is half the point the turn path would compact anyway
   (`compactionWindow(window).backgroundAt`), lowered to a half so an idle conversation is already
   short when the user returns, and never below 32,768 so a small conversation is not summarized for
   nothing (a window whose `backgroundAt` is under that reserve never idle-compacts; the turn path
   clears it first). Oldest idle thread first, one compaction at a time.
2. **Pre-expiry trigger.** The same size gate fires when the conversation's warm prompt cache will
   expire within `CACHE_EXPIRY_LEAD_MS` (90 s), using the TTL `cacheTtlMsFor` already resolves from
   the provider, model and cache-write breakdown (5 min or 1 h for Anthropic, 30 min for caching
   OpenAI models, none for Claude Code until it reports a 1 h write), *and* the team's summary model
   is the model that owns that cache. A cold or unknown cache, or a summary model the team routes
   elsewhere, never fires the rule, so those teams get the idle rule only. After expiry the rule
   stays quiet: compacting then would pay full input price, which the threshold path already does
   after the answer.
3. **A summary that reads the warm cache.** `HookApi` hands the before-compact hook only the
   summarizable entries, never the live context, so the runtime builds the summary itself before it
   asks for a compaction: it reads `Conversation.context().messages` (the bytes the last turn sent,
   system sections and tool declarations included), appends one instruction asking for the rolling
   summary, and calls the summary model on that exact prefix. The provider therefore reads the
   cached prefix at the cache-read rate (0.1× input on Anthropic, implicit for providers that cache
   on their own) instead of re-reading a serialized transcript, which is what pi-durable's own
   summarize phase and `foldSummary` do. `cacheRetention` is passed only when the provider has an
   explicit cache mode whose TTL `cacheTtlMsFor` knows; providers that cache implicitly send none
   and pay no cache write for the summary. The answer is kept per conversation with the newest
   entry it read, and the extension places it instead of `foldSummary` only when the newest entry is
   still that one (a turn admitted mid-summary makes it stale and the fold path runs), when it is
   non-empty, and after cutting it to `COORDINATOR_SUMMARY_MAX_CHARS`. The precomputed summary is
   made only when the summary model is the last turn's model and the cache is plausibly warm: a
   known TTL has not lapsed, or an unknown TTL last turn read cache tokens. Otherwise, and when the
   measured context does not fit the summary model's window, none is made and the existing fold
   path runs unchanged.
4. **Invisible, and never in the user's way.** The compaction is admitted through
   `Conversation.compact()` (conversation-owned, not a run), so a user message that arrives mid
   summary is admitted at once and its turn starts generating without waiting for the summary; the
   summary is placed at the next boundary, before the turn's own entry is committed. Nothing is
   written to the transcript and no message, setting or notification is added: the rows the app
   draws stay as they are, and only the model's context is replaced by the compaction entry.
   `chief_thread`, `coordinatorConversation` and message rows are untouched apart from what the
   compaction itself already writes.
5. **Durable state and retries.** No new table, column, setting or env var. The sweep keeps its
   decisions in process: a per-thread backoff of `IDLE_MEMORY_FLUSH_RETRY_MS` after a failure, a
   marker of the usage row it compacted so one turn size is compacted once, and one in-flight
   compaction, bounded as a whole by `IDLE_COMPACT_TIMEOUT_MS` plus a minute and aborted when it
   passes that deadline or when the server shuts down, so a hung summary can neither stall every
   thread nor delay a restart. An idle compaction does not run the memory flush a second time: the
   idle memory sweep on the same tick already owns it. A restart re-evaluates from
   `chief_turn_usage` and skips a conversation whose head marker (the compaction entry's message
   timestamp) is newer than that turn's usage row, so a restart does not summarize the same cleared
   history again.
6. **Who is eligible.** Only threads whose last turn actually ran on the in-server runtime
   (`stepRuntimeFor(parseModelKey(usage.model).provider) === 'pi'`, the runtime pi-durable serves),
   and only threads the existing idle guards already call ready: not archived, no active or pending
   chief step, no pending Coordinator input, not a digest or memory thread. Backend-runtime threads
   are left exactly as they are today.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Idle short chat: idle for the window but below `idleCompactAt` | No request, no marker; the conversation is unchanged | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Idle long chat past the gate | Nothing new in the transcript; the next turn sends the summary instead of the history and the context meter drops | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| User types during the compaction | The message is admitted at once and its turn starts generating without waiting for the summary; the precomputed summary is dropped as stale, and the user's exchange survives in the model's next context | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Summary model routed to another model than the chat turn | Idle rule only, no cache-expiry rule and no context-prefix summary; the summary comes from the fold path | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Provider without a known cache TTL | Idle rule only; the cache-expiry rule never fires, and the prefix is reused only when the last turn actually read cache tokens | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Cache TTL 5 min vs 1 h | 5 min fires the pre-expiry rule inside the 90 s lead; after a lapsed TTL the idle rule compacts through the transcript instead; 1 h lets the ten-minute idle rule fire first, with the same size gate | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Summary route missing, or its credentials cannot be opened | No compaction request at all; the thread is retried on a later tick | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Server restart mid-compaction | Shutdown aborts the summary and places nothing partial; after restart the conversation compacts once, and a later restart with a head marker newer than the usage row skips | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Same usage row seen by a second tick | One compaction per turn size, retry only after a failure backoff | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Summary model does not fit the live context, or the summary is empty or over `COORDINATOR_SUMMARY_MAX_CHARS` | No context-prefix summary (empty) or a summary cut to the cap; the existing fold path compacts when it does not fit | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Summary request fails, is aborted by shutdown, or the fold path hangs | Compaction reported as a failure, no marker, retry after the backoff; a hung compaction is aborted at its deadline and stops blocking the sweep and `idle()` | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| The thread is archived during the compaction, or its active model changes between the decision and the run | Nothing partial is placed and the next tick re-decides from the current row; a turn that starts mid-compaction rebinds its own provider and summary model | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Idle compaction and the idle memory flush on the same tick | The memory is flushed once, by the idle memory sweep; the compaction does not flush again | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| Last turn ran on a backend runtime, or the thread has an active step or pending input | No background compaction at all | `apps/server/test/coordinator/idle-compact.test.ts` | this change |
| A turn size with nothing summarizable (`empty` outcome) | No head marker and no visible change; that usage row is not retried, and a new turn records a new row | `apps/server/test/coordinator/idle-compact.test.ts` | this change |

## Out of scope

- Daemon task sessions (`claude-code`, `gemini`, `devin`, `antigravity`, `doubao`, and the daemon's
  own `pi` step sessions): their process is gone while a task idles, and their backend compacts
  inside its own run.
- Changing the threshold compaction's summary (it keeps `foldSummary`), the memory flush, the
  context meter's numbers, and any new setting, env var or product surface.
- Deleting the fold path or pi-durable's own summarize phase; the fold path remains the fallback
  when the live context does not fit the summary model.
- Reordering the sweep's scan in SQL (a note from review): the per-thread usage and credential
  lookups stay in the loop until thread counts make the scan visible in profiles.

## Review

- Verdict: CONCERNS
- Plan-SHA256: 5c6538029d16a94b61d45f17edd392e9bae999661b0c8bf13bf9fbdf78160928
- Author-Model: doubao/main-agent
- Reviewer: fresh-context review session, 2026-11-28 (pi-review.sh plan)
- Reviewer-Model: anthropic/claude-opus-5-5
- Findings: 9 should-fix, 4 notes, 0 blocking. A user turn committing mid-summary would have placed a summary that never saw it; the idle rule treated a lapsed cache as warm and paid full input; the Proving tests were red on the parent only by a missing import; the memory flush ran twice on one tick; only the prefix request was bounded while the fold path could stall the sweep and `idle()`; the compaction mutated shared thread state; the pre-expiry rule lacked data; the newcomer scenario table and the missing edge rows. Fixed in one commit: stale-summary guard by newest entry, warm only while a known TTL lasts or a proven cache read, dynamic test imports so the integration rows run on the parent, no second flush during an idle compaction, a whole-compaction deadline with abort, ref/provider restore, the data and scenario table above, and the added edge rows.
- Fix-check: PASS
- Fix-check-Plan-SHA256: 522958847f5207bc0cb1581254d21cdf791b469ddca1487e532298cbd9faf7fa
