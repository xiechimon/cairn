**Spike result (PR2): resume the runtime session with server-tuned compaction. Do not rebuild a fresh session per turn.**

PR: https://github.com/xiechimon/cairn/pull/2559. Raw rows, commands and limits: `docs/verify/2522/` on that branch.

Setup:

- Fixture: a deterministic 500-turn Coordinator transcript. Turns 1-480 are seeded, 19 turns run live, and the turn-500 recall question is asked twice from the same state.
- Context: the real `buildChiefSystemPrompt` and all 55 chief tool definitions. `search_history`/`read_history` run the product code over the same transcript.
- Runtime: pi 1.4.0 with `anthropic/claude-haiku-5-5`, thinking low.
- Metrics come from the provider usage fields. A per-turn row is written to the new `chief_turn_usage` table: migration 0086, with `ttftMs` measured by the pi backend.

| Arm | Prompt tokens / turn | Cache-read share (all / first request) | TTFT p50 | Paid summaries (over an unchanged range) | Turn-20 fact at turn 500, with / without history tools | Cost USD |
| --- | --- | --- | --- | --- | --- | --- |
| a0 resume, pi default compaction (never fires) | 566,697 | 99.9% / 99.9% | 1,353 ms | 0 (0) | yes / yes | 0.736 |
| a1 resume, compaction above 64k, keepRecent 16k | 114,424 | 97.9% / 95.9% | 965 ms; 23.9 s on the summary turn | 1 (0) | yes / yes | 0.128 (0.092 of it the summary) |
| b1 fresh session, retrieval assembly (index, recent ≤ min(16384, budget/4), last 3 tool results whole) | 116,113 | 82.0% / 54.9% | 3,392 ms | 0 (0) | yes via `read_history` / no | 0.086 |
| b2 as b1, recent window aligned to 8-turn blocks | 103,682 | 89.4% / 75.9% | 3,484 ms | 0 (0) | yes via `read_history` / no | 0.057 |

Verdict: **arm (a) wins.**

- a1 is the only arm that meets the ≥80% cache-read done-when on the first request of a turn (95.9%). The fresh arms rewrite part of their prefix every turn (cache writes of 10-20k tokens on each first request), so they reach only 55% and 76%.
- Steady-state TTFT is about 1 s for a1 against about 3.4 s for b1 and b2.
- Without its one summary, a1 is also the cheapest arm.
- The cost of a1 is the synchronous summary: 21.6 s and 0.092 USD for 127k tokens, inside the user's turn. That makes item 7 (idle-time summarization inside the cache window) the next piece of work.

Prewarm baseline (item 8): a1 steady-state TTFT p50 965 ms, p90 5,290 ms. The p90 is the summary turn.

Recall, next to Rakazo:

- Rakazo's rolling-summary strategy omitted rare distant facts (`docs/evals/history-findings.md:80` in elie222/rakazo @ 5e915c3, `history-current-baseline.json`, 4/6). Its retrieval strategy later qualified 54/54.
- Here the turn-20 fact (host `build-07`, ticket `KST-4471`; `build-07` also appears as a distractor in later turns) was answered at turn 500 in all four arms when the history tools were available. The fresh arms found it with `read_history` on the index id `m-0020-user`.
- Without the tools, both fresh arms failed, because they saw only the index label. a1 answered from its summary, but that was one summary and one fact (n=1). It does not contradict Rakazo's finding, which came from repeated rolling summaries.
- So keep `search_history`/`read_history` on in both arms, and treat a summary as a latency and cost tool, not as the recall path.

Limits:

- The production model `relay-186/glm-5.3` was not measurable: the local relay key returns 404 for it, and production `token_usage` rows for it show `cacheRead` = 0.
- All four arms ran at the same time.
- The live turns are short, so real threads with a 64k threshold will summarize more often.

Spend: 2.14 USD on a metered Anthropic key, including a 1.10 USD pilot that was discarded after the review found two harness bugs.
