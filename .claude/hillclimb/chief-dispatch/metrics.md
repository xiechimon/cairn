# chief-dispatch scoring rubric

Object under test: **one turn** of the Chief's decision-making for a single user request. The judge
reads the **final state of the environment** — the rows in the isolated database after the turn
ends — not the transcript (for agent-style applications, the transcript is narrative; the
environment is the answer).

## Metrics

| id | type | definition |
|---|---|---|
| `decision_ok` | binary (primary) | In scenarios that should dispatch, the right agent was dispatched; in scenarios that should not dispatch, no dispatch happened. See the per-class rules below. |
| `receipt_ok` | binary | `工作约定` rule 4, "name the dispatched agent's role semantics after dispatch" (`派工后点名承接 Agent 的职责语义`): the body mentions the dispatched agent's display name. For non-dispatch scenarios, only a non-empty body is required. |

### `decision_ok` rules by case class

**Dispatch class (`expect.kind = "dispatch"`)**: pass requires `run_builds` to have been called
**and** the `assignment.build.agentId` of the newly created todo row to match the expected agent.
Both conditions are required — calling the tool but dispatching to the wrong agent, or creating a
todo without dispatching, both score 0.

**Hold class (`expect.kind = "hold"`)**: pass requires `run_builds` **not** to have been called
**and** the turn to have a non-empty body **and** the step status to be `done`. The third condition
blocks the `无回答 ≠ 否定回答` ("no answer ≠ negative answer") loophole: a truncated or interrupted
empty turn must not pass merely because "it did not dispatch."

## Why the primary metric is "who it dispatches to" rather than "whether it dispatches"

`工作约定` makes `措辞→spec→按职责文本选 Agent` ("wording → spec → pick an agent by the role
text") the Chief's central responsibility. The "who" item is: programmatically decidable (read
`todo.assignment`, no judge needed), has natural positive and negative examples (should dispatch /
should not dispatch), and the change surface (the dispatch rules in the system prompt + the
`run_builds` description) is cheap and reversible — the metric and the change surface are directly
coupled, which lands squarely on the hillclimb's three applicability criteria.

## Scenario roster

The four agents use **aliases** (`阿岚` / `老周` / `小柯` / `铁手`); classification info exists
only in `description`. This is deliberate: if display names were written as something like
`文档专职` ("docs specialist"), the model could get everything right without reading the role
text, the eval would hit the ceiling, and subsequent iterations could only chase cost, never
quality.

Model assignment: `老周` → glm-5.3, `小柯` → kimi-k3, `阿岚` → qwen3.8-max, `铁手` → glm-5.3.
The four agents use three models; `modelId` does not map one-to-one to category, which blocks the
shortcut of guessing the category from the model name. (In the eval the four agents are **never
executed**; they are only labels. What actually gets invoked is the Chief.)

## baseline results (glm-5.3, 36 cases × 3 reps, 2026-09-29)

```
decision_ok  168/176 = 95.5%   95%CI [92.4%, 98.5%]
原有 36 条 100/105 = 95.2%   新增 28 条 68/71 = 95.8%
成本 $9.16   链路失败 16 条（8.3%，全 harness_error，已隔离不计分）
```

**This eval is saturated and can no longer measure improvement.** The 4.5-point headroom is
smaller than the ±7.5-point noise floor.

One round of hardening was attempted (36 → 64 cases: 8 decoy paths / 6 cross-category / 6
symptom-attribution / 8 hard negatives), with three corresponding discrimination rules added to
`工作约定` first to keep the cases decidable. **The hardening failed**: the 28 new cases scored
95.8%, 0.6 points *higher* than the original 95.2%.

The reason for the failure is worth recording: hard cases are hard usually because they sit on a
category boundary; and to make the boundary decidable with two experts agreeing, the
discrimination rules have to be written into the prompt — **once the rules are written in, the
model reads and applies them and the task is easy again**. The difficulty never moved to boundary
judgment; it just swapped in another batch of "read the rules and answer."

Conclusion: the dispatch decision itself is not hard for this model. With the rules spelled out
and a clean roster it is nearly always right. The right use of this eval is not as a ruler for
capability hill-climbing but as a **regression gate** (does routing stay correct after a change),
and as the verifier for the real defect below.

### Failure shapes

True failures: 6 rows / 5 cases, two classes:

1. **Name/id mismatch** (o01, o02, o06 — 4 rows total) — the most worth chasing of the four
   classes: the body was correct from start to finish
   (`派给运维职责的 [铁手](agent:X)` — "dispatched to the agent who holds the ops role"),
   but the X it referenced was the **frontend agent's id**. The name and id do not line up. Any
   transcript-reading judge would give these full marks; only reading the final environment state
   exposes them. The root cause is most likely that the four agents are flattened into a single
   line of JSON by `composeChiefSystemPrompt`, plus two agents sharing the same `modelId`, so the
   model mismatches id ↔ name.
2. **Should have dispatched but didn't / no body** (c03: 1/3, n12: 1/3): the former finished
   probing and created the task but never called `run_builds`; the latter made 5 read-side calls
   but produced no body at all — under `无回答 ≠ 否定回答` ("no answer ≠ negative answer"), an empty
   turn must not pass merely because "it did not dispatch."

## Fixed: name/id mismatch (2026-09-29)

Failure class 1 above was confirmed to be a product defect, fixed, and verified with this eval:

- **Cause**: `composeChiefSystemPrompt` flattened the agent list into a single line of JSON,
  turning dispatch into counting positions in a dense list to copy an id. The failures showed a
  systematic "one position too early" pattern — the last agent (`铁手`) should have been
  dispatched, but the one before it (`小柯`) was dispatched instead, while the receipt body still
  wrote the name correctly. An aggravator: helpers seed every test stack with an
  integration-test agent (`agent-it-1`) that is not part of the scenario roster but appears in the
  list, adding one more chance to slip a position.
- **Fix**: agents are now rendered one per line with name and id adjacent; the scenario side
  removed that legacy agent; and `run_builds` gained `requireTeamAgent` — a nonexistent agentId
  throws, and the error reaches the model through the relay (previously it was silently persisted,
  only blowing up when the build ran, by which time the user had long seen `已派工` ("dispatched")).

**Verification** (same 9 cases × 3 reps; the pre-fix numbers come from the same batch of rows as
this round's baseline):

| | pre-fix | post-fix |
|---|---|---|
| 9 cases total | 20/25 = 80% | 27/27 = 100% |
| of which the 7 ops-related cases | 15/19 | 21/21 |

If the mismatch rate were unchanged (21%), the probability of 21/21 correct by chance is about
0.7%.

**Note: the baseline numbers above predate this fix** (`harness_sha` is also stale; a rerun needs
`--approve-harness`). A baseline consistent with current code requires a full rerun.

### Scoring boundary: which turns do not count

Chain failures **always land in `errors.jsonl` and are never scored**. Both observed shapes must
be intercepted in the runner; otherwise failures concentrate on a few cases and look like "the
model systematically cannot do this thing":

1. **Zero tokens**: the turn never reached the model (latency pinned neatly at the ~30s timeout
   signature).
2. **`step != done`**: the model ran and produced output, but the step ended in failure. **Token
   counts alone cannot catch this shape** — there was a case whose 3/3 were all failed steps,
   misread as "it systematically does not dispatch"; it was actually a chain problem.

## How to run

Credentials: the relay key is read from `CAIRN_EVAL_RELAY_KEY`, falling back by default to
`env.ANTHROPIC_AUTH_TOKEN` in `~/.claude/settings.json`. The relay URL can be overridden with
`CAIRN_EVAL_RELAY_URL`. The key is held only in process memory — never written to disk, never
committed.

```sh
# 全量 baseline（36 用例 × 3 reps，约 $5 / 35 分钟）
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/chief-dispatch --variant baseline --model glm-5.3 --reps 3

# 出报告 → .claude/hillclimb/chief-dispatch/report.html
node integration/eval/chief-dispatch/build-report-lite.mts .claude/hillclimb/chief-dispatch/
```

After changing the harness (runner / judgeCase / cases.json / scenario seeds / `chief.ts`), the
next run refuses because `harness_sha` no longer matches — this is deliberate: review the diff
before rerunning, then allow it with `--approve-harness`. If a run dies, just rerun; completed
(case, rep) pairs are skipped.

## Diagnostics entry points

| script | purpose |
|---|---|
| `oracle-check.mts` | Scoring-chain self-check (oracle must pass / null must fail / misroute must fail); costs nothing |
| `verify-seed.mts` | Dumps the full file tree of a scenario's bare repo to verify the seeds actually landed; costs nothing |
| `debug-one.mts <flow> <caseId>` | Runs a single case and prints the roster→agentId mapping, actual `run_builds` args, the persisted todo, and body naming |

## Known gaps (recorded honestly, not hidden)

1. **Truncation can only be inferred from symptoms.** cairn currently does not report the model's
   `finish_reason`; the runner can only use "the turn ended normally but with neither tool calls
   nor body" as the truncation signature. This conflates truncation with "the model deliberately
   did nothing." The fix is for the daemon to carry `stop_reason` on step events / in the
   transcript (an additive change).
2. **The served-model assertion is weak.** The model id is taken from `token_usage.model`, which
   is cairn's own bookkeeping, not echoed back from the upstream response — it can catch "the
   daemon picked a different model" but not "the relay silently swapped models."
3. **The relay does not report cost.** `cost_usd` is computed on the spot from OpenRouter list
   prices, not measured from an actual bill.
4. **Chain failure rate ~5%.** Of 108 turns, 5 never reached the model (zero tokens) or hit
   `fetch failed`. They landed in errors.jsonl and are unscored, but repeated runs leave gaps in
   the grid.

## Relay availability (measured 2026-09-29; four request classes, one request of each per model)

| model | responses | tool calls | median latency | verdict |
|---|---|---|---|---|
| `kimi-k3` | 4/4 | 4/4 | 22.1s | usable |
| `glm-5.3` | 4/4 | 4/4 | 18.3s | usable, heaviest reasoning |
| `qwen3.8-max` | 4/4 | 4/4 | 11.6s | usable |
| `deepseek-v4-pro` | 2/4 | 1/4 | — | unstable (502s, upstream stream cut) |
| `gpt-5.6-luna` | 0/4 | 0/4 | — | unavailable (relay has no account configured) |

## Cost profile and deployed levers (2026-09-29)

Per-turn measurements: 10,957 input · 3,149 output · 87,891 cache-read · 10.7 tool calls.
Cost breakdown: **cache-read 43.9%**, input 29.5%, output 26.6%.

Cache-read is the largest item, and it grows linearly with the **number of round trips** (every
tool call resends the entire context). The measured cost–round-trip relationship spans 10×
($0.011 at 0 trips → $0.113 at 20).

Tool-call distribution (176 traces / 1,881 calls): `docs` alone accounts for **64%** (6.8 per
turn), yet it is a single-file read interface. The top 5 tools
(docs/bash/create_todo/watch_todos/run_builds) cover 90% of calls.

### Lever 1: batched `docs` reads (deployed)

`docs` changed its parameter from `path` to `paths: string[]`, so one call reads multiple files;
files are read one by one with errors recorded per file (a single failure does not roll back the
whole batch); the per-call cap is 24 files, with the overflow reported explicitly as `omitted` in
the response.

Full-set measurement (same 64 cases; 3 reps before / 1 rep after):

| | round trips | input tok | output tok | cache-read | cost/turn | decision_ok |
|---|---|---|---|---|---|---|
| before | 10.7 | 10,957 | 3,149 | 87,891 | $0.0520 | 95% (n=176) |
| after | 6.0 | 10,698 | 2,937 | 65,847 | **$0.0450** | 100% (n=61) |
| change | −44% | −2% | −7% | −25% | **−14%** | no regression |

**14% saved per turn.** Round trips fell 44% while input barely moved (fewer trips, longer
context per trip — the two partly cancel).

Incidentally: `harness_paths` had previously omitted the tool definitions
(`packages/shared/src/protocol/chief-tools.ts`) and the executor
(`apps/server/src/services/chief-tools.ts`) — the eval tests exactly "the Chief dispatches through
the tool surface," yet changing tool descriptions did not trigger re-approval. Fixed.

### Levers that cannot be executed safely

Cutting tools by "never called" (33 of 53 never appear, 62% of schema volume) **cannot be decided
from this eval**: all 176 traces come from eval cases, which cover only "one user request →
dispatch decision." Tools like `create_project`/`connect_repo`/`set_secret`/`merge_builds` are
absent because **the eval deliberately does not cover those scenarios** (wake turns and config
turns are out of scope), not because production does not need them. Cutting requires real traffic
first.

### Lever 2: lowering the thinking level — structurally impossible (2026-09-29)

The `CAIRN_EVAL_CHIEF_THINKING` knob was added (a parameter in the eval seed; touches no product
code). But A/B showed it is **ineffective for models on the relay**: the default level produced
4,452 tokens / $0.0636 output; the `low` level produced 5,513 / $0.0657 (in 3 of the 4 cases
output actually increased — pure run-to-run noise).

Mechanism confirmed (reading pi's `dist/core/model-config.d.ts`): for pi to send the level
downstream, the model entry needs a `thinkingFormat` (`zai`/`qwen`/`deepseek`/`openrouter`/…)
plus a `thinkingLevelMap` (level → that provider's request field). But the entries
`materializeProvider` writes for custom endpoints only have
`reasoning`/`input`/`cost`/`contextWindow`/`maxTokens` — **neither field is present**; pi has
nothing to translate into.

**Product implication**: cairn's custom-endpoint path has no reasoning-depth control at all. For
models on the relay, reasoning tokens are generated and billed as usual and the user has no
switch. Output is 26.6% of cost, and this block is currently unmanageable. Opening it requires
declaring `thinkingFormat`/`thinkingLevelMap` per model (per-provider wire knowledge, which
belongs to spec 11's territory).

`CAIRN_EVAL_CHIEF_THINKING` stays: it is effective for models that declare thinking capability,
and it is the knob an eval should have.

### Lever 2 addendum: custom endpoints accepting reasoning levels — implemented (opt-in), effect undetermined (2026-09-29/30)

The "structurally impossible" recorded in the previous section is resolved: in pi's
`dist/bundle/chunks/openai-completions-*.js`, as long as the model entry has `reasoning: true`
and compat probing detects `supportsReasoningEffort`, the generic branch sends
`reasoning_effort` (values mapped via `thinkingLevelMap`). None of the three models on our relay
match, so we land on `thinkingFormat: 'openai'` + `supportsReasoningEffort: true`.

Implementation: with `CAIRN_CUSTOM_MODEL_REASONING=1`, `materializeProvider` writes
`reasoning: true` + a seven-level map + `compat: {supportsDeveloperRole: false}` into the model
entry for custom endpoints. **Opt-in, not the default**: backends differ in their tolerance for
`reasoning_effort` — measured on this relay, only low/high/max are accepted, and passing `medium`
returns 400 outright, so enabling it by default would break some custom endpoints entirely. The
map only writes values this relay is confirmed to accept (none/low/high/max), folding the seven
levels monotonically onto four. `supportsDeveloperRole: false` is required: `reasoning: true`
switches the system-prompt role from system to developer (pi's instructionRole decision), and
pinning it keeps the prompt shape unchanged.

**Wire evidence** (`wire-tap.mts`, pointing the relay URL at a local recording proxy): the
request body does carry `{"reasoning_effort":"low"}`, `systemRole: "system"`, 52 tools, maxTokens
16384.

**Effect: undetermined.** Paired A/B on the same 20 cases (the switch is the only variable):

| metric | switch off | switch on + low | paired diff ±95%CI | significant |
|---|---|---|---|---|
| output tokens | 4,220 | 3,878 | −342 ± 999 | no |
| cache-read | 123,200 | 90,790 | −32,410 ± 72,189 | no |
| round trips | 9.35 | 7.70 | −1.65 ± 3.78 | no |
| cost | $0.0677 | $0.0577 | −$0.0100 ± $0.0210 | no |
| latency | 62.4s | 54.8s | −7.6 ± 11.3 | no |
| decision_ok | 18/20 | 19/20 | — | — |

The point estimates of all six metrics move in the **good** direction, but n=20 cannot resolve
them; a verdict on cost needs about 80 paired cases.

**One methodological lesson**: a single-call probe badly overestimates the effect — in a probe,
`reasoning_effort=low` cut output to 1/4, while the point estimate in the real agentic loop is
only −8%. A single shot has no tool round trips and no context accumulation; it does not represent
real load. Evaluating fields like this must go through the real loop.
