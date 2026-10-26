# eval-methods — agent / LLM evaluation methodology and the state of the market

- Nature: methodology research, not a research-ticket artifact (in-repo `r<N>-*.md` files are numbered by research ticket; this one is not). No implementation plan.
- Subjects: ① evaluation methodology itself; ② pi (`@earendil-works/pi-*`, the agent runtime embedded in the pacman daemon) and how it approaches evaluation; ③ the state of the market (as of 2026-09).
- Capture date: 2026-09-30 (scores and version numbers are as captured on that day). Online channels: `agent-reach` (`web` = Jina Reader, `exa_search`, `github` = gh CLI).
- Marking convention: `measured` = read the code / captured the original text and verified it myself; `inferred` = derived from the original text or code; `guess` = no first-hand evidence. `[first-hand]` / `[secondhand]` mark the nature of the source.
- Citation convention: pi conclusions cite the locally installed packages (0.86.0); the path `node_modules/.pnpm/@earendil-works+<pkg>@<ver>_<peerhash>/node_modules/@earendil-works/<pkg>/` is abbreviated as `~pi-<pkg>/`.
- Check-in note (2026-10-03): the `apps/daemon/src/backend/pi.ts` line numbers cited in S7.9 / S8 are on the 2026-09-30 baseline; after #657 (relay protocol-400 self-adaptation) landed, everything shifted back (the `stopReason` declaration now at :313, the message_end branch now at :418-422, `toMessageRecord` now at :348-355). The described behaviors were re-verified item by item on 2026-10-03 and still hold; `integration/eval/chief-dispatch/run-eval.mts:121` has not drifted; the three pi packages remain pinned at 0.86.0.

---

## S0 Quick conclusions

1. Evaluation is not "a score" but a device: **ask the same question repeatedly and automatically judge right or wrong**, so that "did the change make things better or worse" becomes a visible number. The device has only three parts: **task / judge / repetition**. `measured`
2. The skeleton has converged worldwide into a **four-stage form**: dataset → executor (runs trials) → judge (code / model / human) → aggregation. Eight harnesses and three vendors' docs are highly isomorphic on this skeleton; the differences are all in **the judge's form** and **the rigor of the aggregation statistics**. `measured`
3. The single most load-bearing principle: **judge the environment's end state, not what it said** (outcome). The transcript is the narrative; the environment is the answer. `measured`
4. The two biggest points of disagreement: **aggregation statistics** (only Inspect AI makes confidence intervals a first-class API) and **where the judging criteria come from** (Anthropic: humans write tasks / Google: per-task generated adaptive rubrics / OpenAI: platform API-ized graders). `measured`
5. Mainstream agent benchmarks are in a **credibility crisis**: Berkeley RDI scored 8 leaderboards at 73%–100% exploitability; OpenAI publicly stopped reporting SWE-bench Verified (an audit of 138 tasks found 59.4% with substantive defects). The root cause sits entirely in the judging cell. `measured`
6. A grader must be designed against "**can it be gamed**" — the question is not "does it judge correctly" but "does passing it really require solving the problem". `measured` (principle) / `inferred` (corollary)
7. **pi has its own evaluation package `packages/evals`** (`@earendil-works/pi-evals`, `private: true`, never published to npm): host evals + documentation-lift evals (paired A/B reporting lift). **The three locally installed pi packages do not include it — searching only `node_modules/` leads to the wrong conclusion that "pi does no evaluation"** (this reconnaissance's first round fell exactly there). `measured`
8. pi **does have** `stopReason` (7 states + `rawStopReason` + `responseModel`); the "missing finish_reason" recorded in pacman's `metrics.md` is a **host-side projection drop**, not an upstream gap. `measured`

---

## S1 The skeleton: the four-stage form

```
dataset ──→ executor (runs trials) ──→ judge ──→ aggregation
              │                         │            │
         agent harness            code/model/human   metric + threshold + report
         + model
              │
       leaves a transcript (what it said) + the environment's end state (what the world became)
```

Glossary (per the Anthropic engineering long-form, see [[Demystifying Evals for AI Agents]]): a **task** (input + success criteria) → multiple attempts are **trials** → a **grader** scores some aspect (one task can carry multiple graders) → the **transcript / trace / trajectory** is the complete record of a trial → the **outcome** = the environment's end state → an **evaluation harness** runs end to end → an **evaluation suite** is a set of tasks sharing one larger goal.

Four main lines grow out of these four stages:

| Main line | Key points |
|---|---|
| How the ruler is set | Tasks mirror production; a stronger model must score higher; frontier keeps headroom but the gap must not come from ambiguous tasks; low variance between runs (environment residue hands the answer to the agent) |
| What to judge | outcome first; judging only the result cannot localize the failing step → open a separate process channel |
| Who judges | code → model → human, chosen by "cheapest that suffices"; the judge must not be the model under test |
| How many times, how to read | one run does not count; pass@k vs pass^k tell opposite stories at large k |

`measured` ([[Demystifying Evals for AI Agents]], ``[[Anthropic Eval and Hillclimb]]``, cross-checked against first-hand sources this time)

---

## S2 Market harnesses and platforms

### S2.1 Core abstractions of the eight (all first-hand docs)

| Project | Task unit | Judge form | Trajectory/process judging | Confidence-interval narrative |
|---|---|---|---|---|
| **Inspect AI** (UK AISI) | `Sample` (input/choices/target/sandbox); unit `Task(dataset, solver, scorer, metrics)` | Four scorer kinds: heuristic extraction / text similarity / model judgment / another rubric set; `multi_scorer()` composition; humans exist as Human Agent / Intervention | Built-in ReAct / Deep Agent / inspect_swe (runs Claude Code, Codex CLI) / Agent Bridge | **Yes, and the most complete**: `ci()`, `ci_wilson()`, `bootstrap_stderr()`, `stderr(cluster=)`, `krippendorff_alpha()` |
| **promptfoo** | YAML test case (`vars` + `assert` list), `assert-set` supports AND / threshold-then-OR | Deterministic metrics + model-assisted (`llm-rubric` / factuality / answer-relevance / select-best / classifiers) | Yes: deterministic `trajectory:tool-used` / `tool-args-match` / `tool-sequence`, model-judged `trajectory:goal-success` (the `not-` prefix judges "forbidden achievement", and judge transport/parse failures still count as failure, so a broken judge is not silently read as a pass) | Docs-negative |
| **DeepEval** | `Golden` of `LLMTestCase` / `EvaluationDataset`; four usage modes (end-to-end / trajectory-level / component-level / one-off) | 50+ metrics, mostly LLM-as-judge (G-Eval / DAG / QAG); `JevEval` uses a decision model to emit calibrated probabilities; `strict_mode` goes binary, `flaky=True` keeps noisy metrics out of pass/fail | Yes: TaskCompletion / StepEfficiency / PlanAdherence / PlanQuality / ToolCorrectness / ArgumentCorrectness | Docs-negative |
| **Braintrust** | Data (examples) / Task / Evaluators three-stage; playground → experiment (immutable snapshot) → CI | `autoevals` + LLM-as-judge + custom code; judge-selection discipline written out: "first check whether the extra reasoning genuinely raises agreement with humans enough to be worth the latency and cost" | Yes (remote evals / sandboxes; online scoring evaluates traces) | Docs-negative |
| **LangSmith** | Dataset examples (inputs + reference outputs) offline / production runs online, two tracks | Five kinds: human (annotation queue + assertions) / code / LLM-as-judge / **decision model** (SemIf or Jev, typed questions each becoming independent feedback) / pairwise; datasets support splits (incl. train/val/test splits) | Open-source package `agentevals`: `strict` / `unordered` / `subset` / `superset` four deterministic trajectory matches + LLM judges | Docs-negative (zero hits for a full-text `confidence interval` search) |
| **Langfuse** | Online traces / offline datasets, two tracks | LLM-as-judge, **Jev as a judge** (experimental), code evaluators, annotation queue, user feedback | — | Does judge-consistency analysis only (confusion matrix + Cohen's Kappa + F1 + Pearson + Kappa band explanations) |
| **Arize Phoenix / AX** | — | A unified **`Score` object** for the three judge kinds: required `name` / `kind` (llm/code/human) / `direction`; the specialty is structured output via tool calling — forcing the judge to call a tool instead of free text | Yes: Tool Selection / Tool Invocation / Tool Response Handling + `evaluate_path_length` (convergence evaluation, `avg(minimum steps / steps taken)`) | Docs-negative |
| **Harbor** | `Task` (instruction + sandbox + verifier) / `Dataset` = one benchmark / `Trial` / `Job` | The verifier is `tests/test.sh`, **must write `/logs/verifier/reward.txt` or `reward.json`**; officially states any verification method can be implemented there including LLM/agent judges; RewardKit provides programmatic + judge-based criteria kinds; a separate verifier environment improves the safety boundary between agent and verifier (and only an independent verifier can regrade an already-run trial) | Custom ATIF (Agent Trajectory Interchange Format), v1.8, aiming at one representation common across agents | Docs-negative (only aggregation logic: mean of rewards by default, missing rewards and missing dimensions both count as 0) |

`measured` (sources per cell in Appendix B)

**Measured evidence of ecosystem convergence**: Inspect's eval registry renders 162 records, of which 86 are tagged `inspect_harbor` and 76 `inspect_evals` — AISI's harness directly runs benchmarks from the Harbor registry as its own evals. `measured` `[first-hand] https://inspect.aisi.org.uk/evals/index.html`

### S2.2 The three vendors' orientation differences

| Dimension | Anthropic | OpenAI | Google |
|---|---|---|---|
| Where criteria come from | Humans write tasks, rubrics checkable item by item; a task's criterion = "two domain experts independently looking would give the same pass/fail" | Platform API-ized graders (JSON: string check / text similarity / score_model / python), returning 0-1 supporting partial credit; graders tuned with expert answers | Adaptive rubrics: **generate the pass/fail criteria on the spot for each prompt and then verify**; docs mark it recommended |
| Process/trajectory judging | Transcripts can be re-judged (code heuristics + model judges for tool calls and collaboration) | Trace grading was once a product capability | ADK's systematic criteria: `tool_trajectory_avg_score` / `rubric_based_tool_use_quality_v1` / `multi_turn_*`, etc. |
| Conversation and user simulation | The conversational-agent chapter gives the practice | No public first-hand details found | User simulation + environment simulation (intercept tool calls to inject mocks / 503 / latency spikes) is a product capability |
| Statistical caliber | pass@k vs pass^k selection made explicit; confidence intervals required in reports | Continuous 0-1 scores + pass_threshold | Aggregated pass rate + per-criterion details |
| Public assets | Engineering blog + methodology | Paper-grade benchmark repos (PaperBench / SWE-Lancer / EVMbench) | eval_hub (README one line) + a skill |

`measured` (each cell backed by a first-hand source in S2.1 / Appendix B; "not found" means search-negative)

**OpenAI is retreating, not advancing**: the Evals and Agent Builder products go **offline from 2026-11-30**, the graders API is deprecated in sync, and `simple-evals` has been frozen since 2025-07. `measured` `[first-hand] https://openai.com/index/introducing-agentkit/`

**What emerged new in 2026 and is consistent across platforms**: decision models as judges. TypeSafe's Jev (returns typed answers with probabilities, generates no text) appears simultaneously in the official docs of Langfuse, LangSmith, and DeepEval, with the same positioning — cheap, fast, deterministic, calibratable, replacing the "free-text scoring" segment. `measured`

---

## S3 Statistical calibers

### S3.1 pass@k vs pass^k

- **pass@k** origin: HumanEval, NeurIPS 2019. At least one success in k i.i.d. trials.
- **pass^k** origin: τ-bench, arXiv 2406.12045. All k trials succeed; unbiased estimator `pass^k = E_task[C(c,k)/C(n,k)]`.
- At k=1 the two coincide; at k=10 pass@k approaches 100% while pass^k approaches 0%. Selection: tools where one success is worth money use pass@k; user-facing agents that must be reliable every time use pass^k. `measured`

**Inconsistent calibers (citations must state the source)**: the Anthropic blog writes pass^k as `p^k` (independence assumption), while the τ-bench original uses the finite-sample unbiased estimator `C(c,k)/C(n,k)`; the two are **not equal** when each task has multiple trials and n≥k. `inferred` (both originals read)

### S3.2 Confidence-interval methodology: no consensus, tiered by N

| Position | Source | Claim |
|---|---|---|
| A (large N) | Evan Miller, arXiv 2411.00640 | Super-population framework; naive SE = `sqrt(Var(s)/n)`, degenerating to `sqrt(p(1-p)/n)` for binaries; when tasks share passages / the same task appears in multiple languages, **clustered SE is mandatory**; **bootstrap unnecessary**; resampling the same task K times lowers the variance ceiling by 2/3; paired analysis must also report the cross-model correlation to be recomputable |
| B (small N) | Bowyer et al., ICML 2025 Spotlight Position, arXiv 2503.01747 | With N in the teens-to-dozens, **CLT intervals are extremely badly calibrated**, even extending beyond [0,1] or collapsing to zero; only **Bayesian credible intervals and Wilson CI** have correct coverage; CLT and bootstrap coverage both fall far below nominal; clustering scenarios fail the same way |

**Do not take either side as universal**: they target different N. Bootstrap is judged "unnecessary" by one side and "among the worst" by the other. `measured`

**Not found**: no dedicated first-hand paper on confidence intervals for pass^k (both τ-bench and TRAIL give point estimates only); nor a first-hand significance test for "step efficiency". `measured` (search-negative)

---

## S4 Judge reliability (LLM-as-judge)

- **Baseline (MT-Bench, arXiv 2306.05685)**: GPT-4 judge agreement with human experts is 85% (setup S2, no ties), higher than human-human 81%. **Caliber warning**: the agreement definition is "the probability that two randomly picked people vote the same on a random question", so human-human agreement is an underestimate. **Citing 85% must carry the S2 setup and this definition, otherwise it is overestimated.** `measured`
- **Position bias**: GPT-4 zero-shot order-swap consistency 65.0% (30.0% bias to the first), Claude-v1 23.8% (75.0% bias to the former); few-shot pulls GPT-4 to 77.5%, but the original emphasizes "high consistency may not imply high accuracy". Systematic quantification in arXiv 2406.07791 (15 judges / 150k+ instances): position bias **is not random noise**; preference direction varies highly across tasks for the same judge. `measured`
- **Self-preference**: GPT-4 +10%, Claude-v1 +25% win rate; the hypothesized root cause is **perplexity** — higher scores go to low-perplexity outputs regardless of who generated them (arXiv 2410.21819). A more rigorous variant introduces gold judgments as a quality proxy (arXiv 2506.02592). `measured`
- **rubric vs Likert**: CheckEval (arXiv 2403.18771) attributes low agreement to "subjective evaluation criteria combined with Likert scale scoring"; switching to a **decomposed binary checklist** lifts the average agreement across 12 evaluator models by 0.45. `measured`
- **Counter-evidence (refuting "pairwise is more stable")**: arXiv 2504.14716 (COLM 2025) — pairwise preferences can be flipped by an embedded distractor feature in **~35%** of cases, while absolute scoring only ~9%. `measured`
- **Jury / panel**: PoLL (arXiv 2404.18796) uses a panel of 3 **different-model-family** small models, achieving better correlation with humans than a single large judge at over 7× lower cost. `measured`
- **The landing form is "calibration", not a "consensus algorithm"**: Langfuse provides Cohen's Kappa and other consistency metrics plus calibration workflows, Arize lists "align evaluators" as a separate step, Anthropic requires "read a batch of already-scored transcripts before trusting the evaluator". `measured`

---

## S5 Process / trajectory evaluation

### S5.1 Already commoditized (all five have official first-hand docs)

Criteria have converged into six operationalizable quantities: **tool selection/arguments, trajectory sequence matching, step efficiency, plan quality, goal progression, load-bearing-step localization**. `measured`

- `agentevals` (LangChain, MIT): `strict` / `unordered` / `subset` / `superset`. **The subset/superset pair is precisely the operationalizable criterion for "step efficiency" and "minimal sufficient steps".**
- promptfoo: deterministic `trajectory:tool-*` + model-judged `trajectory:goal-success`.
- DeepEval: `ToolCorrectnessMetric` (set comparison + "was it the optimal tool" taking the minimum), `StepEfficiency`, `PlanAdherence`, `PlanQuality`.
- Arize AX: cluster tool-calling spans by trace → take the ordered tool-call list → LLM judge scores correct/incorrect. The original rationale, worth remembering: "even when the final answer is right, a bad step sequence wastes time, money, or exposes the user to risk".
- Google ADK: `tool_trajectory_avg_score` (exact match, default threshold 1.0) / `rubric_based_tool_use_quality_v1` / `multi_turn_trajectory_quality_v1`, etc.

**Infrastructure has standardized onto OpenTelemetry**: the well-known values of `gen_ai.operation.name` include `create_agent` / `invoke_agent` / `execute_tool` / **`plan`** (the planning phase itself is modeled as an operation); but these agent/tool conventions are currently marked **Development (not Stable)**. `measured`

### S5.2 Load-bearing-step localization is still hard

- **TRAIL** (Patronus AI, arXiv 2505.08638, MIT): 148 human-labeled traces / 1987 OTel spans, 575 containing at least one error. **The best Gemini-2.5-pro reaches only 11%.** `measured`
- **AgentRx** (Microsoft, arXiv 2602.02475, EMNLP Findings 2026): a human benchmark of 170 failed trajectories, each labeled with one critical failure step. The method chain `Raw logs → Trajectory IR → Invariants → Checker → Judge → Reports` (synthesized constraints → step-by-step verification → auditable violation logs → LLM judge localization). Step localization improves over prior work by **75%** on average. Requires Azure/TRAPI credentials; not purely local. `measured`
- **AgentProcessBench** (arXiv 2603.14465): 1000 trajectories / 8509 human-labeled steps / IAA 89.1%; ternary labeling. One conclusion: weak policy models show inflated "correct-step ratios" due to **early termination**. The original motivation is worth recording: "tool-use failures frequently induce irreversible side effects" — a failed tool call often has irreversible side effects, so step-by-step verification matters more than backtracking in math reasoning. `measured`
- **Agent-as-a-Judge** (Meta/KAUST, arXiv 2410.10934): agentic systems evaluating agentic systems; 90% alignment with human consensus vs 70% for LLM-as-a-Judge; 97.7% time / 97.6% cost savings versus three human experts. **The component ablation is the most valuable part**: ask only 65.03% → +graph 75.95% → +read 82.24% → +locate 90.44%; adding search actually drops it to 86.06%. That is, **directly reading file contents + locating relevant files is the load-bearing capability**. `measured`

### S5.3 Reward-hacking detection (new in 2026)

- **Reward Hacking Benchmark** (arXiv 2605.02964, ICML 2026): multi-step tool tasks seeded with "naturalistic shortcuts" (skipping verification steps, back-deriving answers from neighboring metadata, tampering with evaluation-related functions). 13 frontier models show exploit rates from 0% (Claude Sonnet 4.5) to 13.9% (DeepSeek-R1-Zero). **72% of reward-hacking segments carry explicit CoT justifications** (the model often frames the exploit as legitimate problem solving). Simple environment hardening cuts the exploit rate by 5.7 percentage points (a relative 87.7% reduction) without hurting task success. `measured`
- **METR** names two detection methods: a "high-scoring heuristic" and an LLM "monitor"; per-task reward-hack counts: RE-Bench 30.4% / HCAST 0.7%. `measured`

---

## S6 The benchmark credibility crisis

### S6.1 Judging can be bypassed directly (Berkeley RDI, `[first-hand]` but self-tested, no independent replication seen)

Scored 8 leaderboards at **73%–100%** exploitability: `measured`

| Leaderboard | Attack | Root cause |
|---|---|---|
| SWE-bench Verified / Pro | 10 lines of `conftest.py` (a pytest hook rewriting every test outcome to passed) → Verified 500/500, Pro 731/731 full marks | The patch and the tests run in the same container |
| Terminal-Bench 2.0 | 82 of 89 tasks `curl`-install `uv` at verification; the agent phase replaces `/usr/bin/curl` with a wrapper, the verification phase trojans `uvx`, which prints a forged "3 passed" when it detects pytest | Harbor defaults `allow_internet=true` with no per-task override |
| WebArena | `goto file:///proc/self/cwd/config_files/{task_id}.json` reads the gold answer; ~100% full marks on 812 tasks without changing a line of code | Task configs with reference answers land in the local filesystem; Playwright never blocks `file://` |
| OSWorld | Gold reference files hosted at public HuggingFace URLs embedded in the task config; the VM has unrestricted internet, so the agent directly wgets them, forming a gold-vs-gold comparison | The judge calls `eval()` on strings coming from the VM |
| GAIA | `normalize_str` strips all whitespace and punctuation → `"D.R M.A.R.T.I.N L.U.T.H.E.R K.I.N.G J.R"` and `"Dr. Martin Luther King Jr."` normalize identically and score full marks; the 100% gate does intercept, but deliberately leaving one question unanswered per task bypasses at ~98% | Over-wide normalization + the intercept written as `if all scores == 1.0` |

### S6.2 OpenAI stops reporting SWE-bench Verified (the heaviest first-hand item)

Auditing the 138 tasks that "o3 still cannot solve stably after 64 runs" (each reviewed independently by at least 6 senior engineers), **59.4% have substantive defects**: 35.5% narrow tests (pinning implementation details, killing functionally correct solutions), 18.8% wide tests (checking functionality the prompt never stated), 5.1% other. An automated red team additionally proves GPT-5.2 / Claude Opus 4.5 / Gemini 3 Flash can all be induced to **reproduce the gold patch verbatim**. Conclusion: Verified progress increasingly reflects training-time exposure rather than engineering capability; the public recommendation is to report SWE-bench Pro instead. `measured` `[first-hand] https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/`

### S6.3 Contamination and saturation

- SWE-bench Illusion (arXiv 2506.12286): give only the issue description, no repository structure, and let the model guess the path of the problem file — SoTA peaks at 76% on Verified but only ≤53% on non-SWE-bench repositories. `measured`
- SWE-bench Pro (Scale AI) states its three-set design motivation explicitly: data contamination, insufficient task diversity, over-simplified problems, non-reproducible evaluation; head models score ~23% on the public set and 14.9–17.8% on the private set, while the same batch scores 70%+ on Verified. `measured`
- Leaderboards are generally saturated: Verified top 79.20%, Terminal-Bench 2.0 top 58.2% ± 2.8% (captured 2026-09-30). `measured`
- **Cross-harness score comparability is unresolved**: `SWE-bench/experiments` issue #462 points out that `metadata.yaml` records neither the harness version nor the image, while leaderboard entries span about two years; **comparability should not be assumed**. `measured`
- τ-bench judging variance (official repo issue #57, a third-party analysis, not Sierra's own caliber): 43%–64% of tasks flip outcomes between repeated trials of the same system; ICC(1) only 0.41–0.53; for the airline domain with n=50 and power .80 the **minimum detectable difference is 23.77pp**, while the published airline leaderboard spans only 23.5pp — **a single run can barely separate the top from the bottom**. `measured`

**The lesson is not "benchmarks are untrustworthy"; it is that graders must be designed against "can it be gamed".** When designing a judge, the question to ask is: **does passing it really require solving the problem.** `inferred`

---

## S7 How pi (pacman's agent runtime) does evaluation

First-hand sources in two layers: ① the locally installed pi 0.86.0 bundled types + in-package `docs/` / `examples/` / `README.md`; ② the upstream monorepo `earendil-works/pi`'s `packages/evals` (source read via `gh`, see Appendix B).

**A methodological lesson first**: `packages/evals` is `private: true` and **never published to npm**, so it is not in the local `node_modules/`. Checking only installed dependencies yields the wrong conclusion that "pi does no evaluation" — this reconnaissance's first round fell exactly there. To study a project's practice, the installed packages are not the whole of it.

1. **pi has a dedicated evaluation package `packages/evals`** (`@earendil-works/pi-evals`, README self-describes as "Behavioral evals for Pi's coding agent, built with `vitest-evals`"). It depends on `vitest-evals` 0.15.0 + `@vitest-evals/core` + Braintrust's `autoevals` 0.3.0. Two script routes: `eval:host` (vitest on the local machine) and `eval:docs` (paired comparison in Docker). `measured` (`packages/evals/package.json`, `README.md`)
2. **Two eval kinds**: `*.docs.eval.ts` are **documentation-lift evals** — each case runs once in an isolated `without_docs` container and once in a `with_docs` container, **reporting lift**; the remaining `*.eval.ts` are host evals, ordinary vitest-evals suites without paired comparison. `measured` (`README.md` "File conventions")
3. **The docs-lift runner's execution discipline** (listed item by item in the README; the most worth-copying part of this setup):
   1. Mount the repository once for the Docker build, package the workspace packages via the in-repo consumer-install mechanism, then build two images from the staged runtime
   2. **Discover the selected cases in each image independently and require the cohorts to be identical** (prevents one side running fewer cases and inflating the lift)
   3. **Plan out every `(case, variant, model, runNumber)` arm before executing**
   4. Each arm runs in a **brand-new container**; failed or missing arms are **recorded while the rest of the cohort continues**
   5. Read results from Vitest's native JSON, **pair exactly** (pair exact arms) before computing lift
   6. **Blocked pairs hold back the headline lift, and the process exits non-zero** — missing arms are not allowed to inflate the headline score
   7. **Repeat ordering alternates by run number to reduce order bias**
   `measured` (`README.md` "The runner")
4. **Criteria forms**: host evals use ordinary `expect` — exact output (`toBe("Paris")`), `errors` must be empty, `usage` must match `PI_PROVIDER`/`PI_MODEL`, `totalTokens > 0`; open-ended spots use `createJudge` (vitest-evals' LLM judge) and `autoevals`' `Levenshtein`. The harness is `createPiCodingAgentHarness({ noTools: "all" })`, i.e. **scripted control over the tool surface**. `measured` (`evals/smoke.eval.ts`, `evals/tui.docs.eval.ts`)
5. **There is also a test double `fauxProvider()`** (pi-ai layer, public export): a scripted in-memory provider, `setResponses([...])` answers in order, `state.callCount`, `tokensPerSecond`, multiple models for switch testing. Its purpose is "drive one turn without starting a real model", not an evaluation framework. `measured` (`~pi-ai/dist/providers/faux.d.ts:1-100`, `README.md:1252-1330`)
6. `pi-agent-core`'s `conformance/` and `benchmark/` directories belong to the **session-storage backend contract** domain (`createStorageConformance` / `STORAGE_BENCHMARK_DATASETS`), not agent behavior. `measured`
7. pi officially points the "evaluation research" outlet to the external repo `badlogic/pi-share-hf` (sending sessions to Hugging Face datasets). `measured` (`~pi-coding-agent/docs/usage.md:142`)
8. **`stopReason` exists, and is richer than `finish_reason`**:

```ts
// ~pi-ai/dist/types.d.ts:292
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
```

Hung off `AssistantMessage.stopReason` (:365), plus `rawStopReason` (the provider's original value, :368), `responseModel` (the model the upstream actually returned, :359), `endTurn` (:369). It persists into the session JSONL and is a first-class telemetry property `pi.ai.response.stop_reason`. `measured`

9. **The pacman side is a host projection drop** (not an upstream gap): `PiMessageLike` declares `stopReason?: string` (`apps/daemon/src/backend/pi.ts:216`), but the `message_end` branch only recognizes `'aborted'` and `'error'` (`pi.ts:321-329`), with `'length'` falling into the generic path; `toMessageRecord` further trims the payload to `{role, content}` (`pi.ts:251-258`). The harness therefore synthesizes `stop_reason` (`integration/eval/chief-dispatch/run-eval.mts:121`). `measured` (re-verified line by line this time)
10. **Two coexisting event paths**: pacman uses `AgentSession` (~15 event types + extension hooks); upstream additionally has the more complete `AgentHarness` (~30 event types + 12 strongly-typed hooks + an event bus + an OTel-style telemetry schema, 60+ attributes including `pi.ai.response.stop_reason`), but pi-coding-agent itself does not use it. `measured`
11. **`agent_end` ≠ turn end**: pi may still auto-retry / auto-compact / consume queued follow-ups afterwards; the correct signal is the extension `agent_settled` (original text: "Use `agent_settled` for status integrations that need to know Pi will not continue running automatically."). `measured`

---

## S8 Comparison with pacman chief-dispatch (methodology level)

The `integration/eval/chief-dispatch/` setup is a textbook **outcome channel**:

| Methodology requirement | pacman current state |
|---|---|
| Judge the environment's end state, not the narrative | Judges `todo.assignment.build.agentId`, reading drizzle rather than the transcript (`grade.mts:26,39-63`) |
| Verify the judge before spending money | `oracle-check.mts` feeds oracle (must pass) / null (must fail) / misroute (must fail) three constructed turns through the real grading function, at zero cost |
| Low variance = isolated environments | Each case gets a fresh stack + fresh home / skills root / machine registration (`stack.mts:142-231`) |
| Infrastructure noise must not masquerade as model fluctuation | `dead = zero tokens or step != done` → lands in `errors.jsonl`, not counted (`run-eval.mts:104-110`) |
| Harness changes need a human reading the diff | `harness_sha` gate; mismatch exits 2, `--approve-harness` overrides (`run-eval.mts:227-269`) |

The two missing cells on the methodology map:

1. **Only an outcome channel, no process channel**. Failures come in only two shapes (name/id mismatch, should-have-dispatched-but-didn't), because the outcome score compresses "sampling error / classification error / arithmetic error / a missing precondition in some step" into the same 0. The "saturated, cannot measure improvements" recorded in `metrics.md` and TRACES's "scalars compress five causes into one number" are the same disease.
2. **The capability track and the regression track are not separated**. `metrics.md` already recognizes the need to turn into a regression gate, but the suite has no independent capability track.

One **erroneous record** needs correction: gap ① in `metrics.md:138-142` says "pacman currently does not report the model's `finish_reason`; the runner can only use symptoms as truncation features". In fact the upstream has the richer fields (S7.8 in this document); it is a host-side projection drop (S7.9).

---

## Appendix A: Doubts and unverified items (re-verify before citing)

1. The **τ-bench subscores** `pass^1 ≈ 61% (retail) / ≈ 35% (airline)` appear only in search-result snippets; the original (v5 HTML and PDF) returned only ~1.8KB via Jina and failed to capture. The summary-level numbers (`<50%`, `pass^8 <25% in retail`) were verified directly. `inferred`
2. **pass^k caliber inconsistency**: Anthropic uses `p^k`, τ-bench uses `C(c,k)/C(n,k)`; they differ for finite n — citations must state the source. (Marked in S3.1 of this document.)
3. **CI methods**: Miller and Bowyer are two opposing camps targeting different N; do not take either as universal.
4. **Berkeley RDI's 73%–100% exploitability** is self-tested with a self-built scanning agent, with no independent replication seen; the OSWorld and GAIA numbers come from the same source, so cross-confirmation is weak.
5. **H2O.ai's "about 5% of GAIA ground truth is wrong"** is a single participating vendor's claim, not confirmed by the GAIA authors.
6. **Epoch AI's "about 10% of tasks have serious errors"** and the official issue #177's "32/369 ≈ 9% infeasible" are **not the same caliber**; do not mix them.
7. **Unverified, do not cite**: arXiv 2609.11028 (BenchShield), 2609.19101. SAJA (ACL 2026 Industry) returned only a proof template; only the title is usable.
8. **Whether Harbor has a confidence-interval feature is unconfirmed** (docs-negative); its metric caliber is taken from the in-repo `docs-mintlify` mdx source rather than the rendered pages.
9. **The framework list in Anthropic's `Demystifying evals` appendix** (Harbor / Braintrust / LangSmith / Langfuse / Arize) is a 2026-01-09 snapshot and **does not include** Inspect AI / promptfoo / DeepEval — the vendor view and the community view differ.

**Failed-capture list** (this time): huggingface.co is entirely blocked to anonymous Jina (403) → current GAIA leaderboard scores and the TB2.0 / CORE-Bench dataset cards not obtained; τ-bench full text; Harbor docs-site subpages (the repo mdx worked instead); `docs.smith.langchain.com` trajectory page redirect (worked around with the `langchain-ai/docs` repo mdx); Langfuse docs need a `.md` suffix; `tbench.ai/docs/*` subpages 404.

---

## Appendix B: Sources

**Methodology canonical copies**
- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (2026-01-09)
- https://claude.dev/blog/automating-eval-design-and-hillclimbing/ (2026-09-28)

**S2 harnesses / platforms (in section order)**
- Inspect: https://inspect.aisi.org.uk/ , `/datasets.html`, `/scorers.html`, `/metrics.html`, `/agents.html`, `/agent-bridge.html`, `/evals/index.html`
- promptfoo: https://www.promptfoo.dev/docs/configuration/expected-outputs/ , `/expected-outputs/model-graded/`
- DeepEval: https://docs.confident-ai.com/docs/metrics-introduction , `/metrics-tool-correctness`
- Braintrust: https://www.braintrust.dev/docs/guides/evals , `/evaluate/llm-as-a-judge`
- LangSmith: https://docs.smith.langchain.com/evaluation , `/langsmith/decision-model-evaluator` , https://github.com/langchain-ai/agentevals
- Langfuse: https://langfuse.com/docs/evaluation/overview.md , `/evaluation/evaluation-methods/jev-as-a-judge.md` , `/evaluation/scores/score-analytics.md`
- Arize: https://docs.arize.com/phoenix/evaluation/evals , https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations
- Harbor: https://github.com/harbor-framework/harbor (`docs-mintlify/core-concepts/*.mdx`, `rfcs/0001-trajectory-format.md`), https://www.tbench.ai/
- Vendors: https://openai.com/index/introducing-agentkit/ , https://platform.openai.com/docs/guides/graders , https://deploymentsafety.openai.com/gpt-6-astra/evaluating-auto-review , https://cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview , https://cloud.google.com/gemini-enterprise-agent-platform/optimize/evaluation/agent-evaluation , https://google.github.io/adk-docs/evaluate/

**S3 statistics**: https://arxiv.org/abs/2411.00640 , https://arxiv.org/abs/2503.01747 , https://arxiv.org/abs/2406.12045

**S4 judge reliability**: https://arxiv.org/abs/2306.05685 , https://arxiv.org/abs/2406.07791 , https://arxiv.org/abs/2410.21819 , https://arxiv.org/abs/2403.18771 , https://arxiv.org/abs/2504.14716 , https://arxiv.org/abs/2404.18796

**S5 process evaluation**: https://arxiv.org/abs/2505.08638 , https://arxiv.org/abs/2602.02475 , https://arxiv.org/abs/2603.14465 , https://arxiv.org/abs/2410.10934 , https://arxiv.org/abs/2605.02964 , https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/

**S6 benchmarks**: https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/ , https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ , https://arxiv.org/abs/2506.12286 , https://scale.com/research/swe_bench_pro , https://www.swebench.com/ , https://github.com/SWE-bench/experiments/issues/462 , https://github.com/sierra-research/tau-bench/issues/57 , https://github.com/xlang-ai/OSWorld/issues/177

**S7 pi**: ① local `node_modules/.pnpm/@earendil-works+pi-*@0.86.0/**` (bundled types + `docs/` + `README.md`); ② upstream monorepo `packages/evals` (via `gh api repos/earendil-works/pi/contents/...` reading `README.md` / `package.json` / `evals/smoke.eval.ts` / `evals/tui.docs.eval.ts`)

**S8 pacman**: `integration/eval/chief-dispatch/{stack,grade}.mts`, `run-eval.mts`, `.claude/hillclimb/chief-dispatch/{metrics.md,_state.json}`, `apps/daemon/src/backend/pi.ts`
