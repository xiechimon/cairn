# #2522 Coordinator context spike: resume plus compaction against a fresh assembled session

Raw numbers are in `raw/`: one JSONL row per pi run, plus `summary.json`. `results-table.md` is generated from them.

## Commands

```sh
cd integration
node --import tsx eval/coordinator-context/run.mts --arms a0,a1,b1,b2 --out ../docs/verify/2522/raw
node --import tsx eval/coordinator-context/report.mts --raw ../docs/verify/2522/raw
```

## Setup

- Fixture: `integration/eval/coordinator-context/fixture.mts` generates a deterministic 500-turn Coordinator conversation of status questions, dispatches, CI failures, decisions and machine checks, with tool calls and results. Turn 20 holds the rare fact: the Kestrel billing migration runs on host `build-07`, change ticket `KST-4471`. `build-07` also appears in many later turns as a distractor. `Kestrel` and `KST-` appear nowhere else.
- Turns 1-480 are seeded without model calls. Turns 481-499 are 19 live turns. Turn 500 asks the recall question twice from the same state, once with `search_history`/`read_history` available and once without.
- System prompt: the real `buildChiefSystemPrompt` output for a team with 8 projects and 5 agents. Tools: all 55 `CHIEF_REMOTE_TOOLS` definitions. Every tool except the two history tools is a stub that answers `{"ok":true,"replay":true}`. The history tools run the product `searchHistory`/`readHistory` (`apps/server/src/services/chief-history.ts`) against an in-memory server database holding the same transcript.
- Runtime: pi 1.4.0 CLI, which runs the same session and compaction code the daemon uses. Model `anthropic/claude-haiku-5-5`, thinking `low`, metered Anthropic key. Usage comes from the provider usage fields that pi reports per assistant message. TTFT is measured from the first JSON event of the run, which is the session open, to the first streamed text, thinking or tool-call delta. In the resume arms it therefore includes any compaction that runs before the first token.
- Per-turn rows are also written to the new `chief_turn_usage` table in the harness database, and `summary.json` aggregates from it.

## Arms

| Arm | Session | Context |
| --- | --- | --- |
| a0-resume-pi-default | resume one pi session | pi defaults: compaction at contextWindow - 16384 (about 984k tokens on this model), so it never fires |
| a1-resume-tuned-compaction | resume one pi session | `reserveTokens` = `--contextWindow` (1,000,000) - 64,000 (compaction above 64k tokens), `keepRecentTokens` 16384 |
| b1-fresh-retrieval | fresh pi session per turn | system, then an index of older user-message ids and labels, then recent turns verbatim under min(16384, 64000/4) tokens; the last 3 tool results whole, older ones cut to 240 chars |
| b2-fresh-retrieval-aligned8 | fresh pi session per turn | as b1, but the recent window starts only on an 8-turn boundary, so the assembled prefix stays byte-identical for up to 8 turns |

## Results

Model anthropic/claude-haiku-5-5; spend 1.008 USD (all arms, including summaries).

| Arm | Live turns | Prompt tokens per turn (mean) | Cache-read share, all requests | Cache-read share, first request of turn | TTFT p50 / p90 ms | Summaries (paid) | Summary over an unchanged range | Recall with search_history | Recall without | Cost USD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a0-resume-pi-default | 19 | 566697 | 99.9% | 99.9% | 1353 / 3087 | 0 | 0 | yes (no tools) | yes (no tools) | 0.736 |
| a1-resume-tuned-compaction | 19 | 114424 | 97.9% | 95.9% | 965 / 5290 | 1 | 0 | yes (no tools) | yes (no tools) | 0.128 |
| b1-fresh-retrieval | 19 | 116113 | 82.0% | 54.9% | 3392 / 4393 | 0 | 0 | yes (read_history) | no (no tools) | 0.086 |
| b2-fresh-retrieval-aligned8 | 19 | 103682 | 89.4% | 75.9% | 3484 / 4632 | 0 | 0 | yes (read_history) | no (no tools) | 0.057 |

Detail from the same rows. Prompt tokens are input + cacheRead + cacheWrite. A turn averages 2.2-2.6 requests because of tool calls.

| Arm | First request of a turn: prompt tokens (mean) | First request: cache-write tokens (mean) | TTFT p50 on turns without a summary | Summary turn |
| --- | --- | --- | --- | --- |
| a0 | 256,608 | 367 | 1,353 ms | none |
| a1 | 53,166 | 2,160 | 964 ms | turn 481: TTFT 23,891 ms, of which 21,631 ms summarizing 126,908 tokens for 0.092 USD |
| b1 | 44,867 | 20,254 | 3,392 ms | none |
| b2 | 43,638 | 10,518 | 3,484 ms | none |

Verdict: arm (a), resume with server-tuned compaction (a1), wins.

- Cache: a1 keeps 96-98% of input tokens cache-read and clears the 80% bar. The fresh arms re-send a changed prefix every turn: b1 reads only 55% from cache on a turn's first request. Aligning the recent window to 8-turn blocks (b2) raises that to 76%, still below 80%.
- Latency: steady-state TTFT is about 1 s for a1 against about 3.4 s for b1 and b2.
- Cost: without its one summary, a1 spent 0.036 USD on 21 runs, against 0.086 for b1 and 0.057 for b2.
- Where a1 loses: the summary runs synchronously inside the user's turn, and that turn's TTFT was 23.9 s. This is the case for issue item 7, idle-time summarization.
- Recall of the turn-20 fact at turn 500 succeeded in every arm when the history tools were available; the fresh arms used `read_history` on the index id `m-0020-user`. Without the tools, both fresh arms failed (they saw only the index label), while a0 (full transcript) and a1 (the fact survived its one summary) answered. No turn in any arm paid for a summary over an unchanged range.

## Limits

- The production Coordinator model, `relay-186/glm-5.3`, could not be measured. The local key for that relay returns 404 for glm-5.3, and the production `token_usage` rows for it report `cacheRead` = 0, so that relay exposes no cache usage. Haiku 5.5 on the Anthropic API stands in. Absolute TTFT and cost do not transfer to glm-5.3. The cache and recall behaviour depends on the context layout and should carry over to any provider with prefix caching.
- The seeded session carries estimated, not measured, usage on its assistant messages, so pi's first compaction decision in a1 is based on that estimate.
- With one rare fact, the recall result is n=1 per cell. a1 summarized once, and Rakazo's loss of rare facts showed up across repeated rolling summaries, so one surviving summary does not show that summaries are safe.
- The four arms ran at the same time against the same API, so their TTFT values come from the same contention. The harness TTFT starts at pi's session open, not at the daemon's prompt send that `ttftMs` in `chief_turn_usage` uses.
- The live turns are short. Real Coordinator turns carry larger tool results, so with a 64k threshold a1 would summarize more often than once in 19 turns.
- A pilot run (spend 1.099 USD) had two harness bugs, both found by the pre-push Codex review. Fresh arms dropped live tool calls from the history, and a failing arm left its history server open. The pilot data was discarded and every arm was rerun on the fixed harness.
