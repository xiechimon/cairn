# Eval gate for system-level changes

Status: v1 implemented. Supersedes the previous draft of this document and the replay-runner design in `eval-on-langfuse.md` for the gate mechanism; the trajectory-pack data loop in spec 29 is deleted with this change, not implemented. Evidence terms: **Observed** = read first-hand in this checkout or a live call; **Derived** = consequence of the observed; **Unverified** = needs a real run.

Owner decisions this document implements: use an existing framework (no self-built runner or scorer); delete the repo's own eval skeleton (trajectory exporter, outcome fields, pack schema); the agent under test is the owner's Devin SWE-2 subscription via `devin` CLI; v1 scoring is deterministic code checks only (no LLM judge); results go to Langfuse; runs happen on GitHub Actions.

## 0. Who meets this

Someone who installed Cairn today and has never heard of its parts changes the Coordinator's system prompt, a tool definition, a routing rule or a dispatch prompt, and pushes a candidate to `queue/main`. Without this gate nothing measures whether the product's behavior regressed; the change lands on unit tests alone. With it, CI replays a fixed suite of Coordinator turns against a scripted model and runs a small set of real tasks through the Devin CLI, on the merge-base code and on the candidate, scores both arms with protected check files, and fails `check` when a case that passed on the base fails on the candidate. The contributor waits ~20–40 minutes on pushes that touch the gated paths, pays nothing in API tokens (the Devin subscription is the owner's), and sees a commit comment naming the regressed cases with a Langfuse link.

## 1. Framework choice: Langfuse Experiments

The suite runs on the **Langfuse Experiments SDK** (`LangfuseClient.experiment.run`, JS v6 — `@langfuse/client@6.1.1` already in the repo): datasets hold items, `experiment.run` executes a `task(item)` function per item and attaches evaluator scores to each run; the official [`langfuse/experiment-action`](https://github.com/langfuse/experiment-action) and the documented [CI gate pattern](https://langfuse.com/docs/evaluation/experiments/experiments-ci-cd) gate on `RegressionError`. The framework owns the trial loop, the scorer API and the store; we author only the task function and the checks — the same two pieces every framework requires.

| Framework | External CLI agent as solver | Deterministic scorer API | GitHub Actions | Results → Langfuse | License / stars / last push |
|---|---|---|---|---|---|
| **Langfuse Experiments** | `task(item)` is arbitrary async code; can `exec` `devin -p` ([SDK doc](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)) | Evaluator functions return `Evaluation` records — arbitrary code ([doc](https://langfuse.com/docs/evaluation/experiments/experiments-ci-cd)) | Yes — official `langfuse/experiment-action` fails on `RegressionError` ([README](https://github.com/langfuse/experiment-action)) | **Native**: datasets, runs, item scores, run comparison UI | Core MIT + EE dirs (repo `license: NOASSERTION`); langfuse/langfuse 37.7k★, pushed 2026-11-20 (`gh api`) |
| **Harbor (Terminal-Bench)** | `devin` is a **pre-integrated agent** (`-a devin`) plus custom agents ([agents doc](https://docs.harborframework.com/agents)) | `tests/test.sh` writes `reward.txt`/`reward.json` — arbitrary code, separate verifier env ([verifier doc](https://docs.harborframework.com/tasks/verifier)) | Technically yes (Docker on runners) but fragile: `EnvironmentStartError` ([harbor#3593](https://github.com/harbor-framework/harbor/pull/3593)); TB itself develops on Modal | None — results land in `result.json` / Harbor Hub; would need a bridge script | Apache-2.0; harbor-framework/harbor 7.3k★, pushed 2026-11-20 |
| **promptfoo** | `exec:` provider runs any shell command per case ([custom-script doc](https://www.promptfoo.dev/docs/providers/custom-script/)) | ~40 deterministic assert types + custom JS/exec asserts ([asserts doc](https://www.promptfoo.dev/docs/configuration/expected-outputs/deterministic/)) | Yes — pure Node CLI, official action | Integration is **inbound only**: `langfuse://` prompts and `langfuse://traces` as inputs ([integration doc](https://www.promptfoo.dev/docs/integrations/langfuse/), [promptfoo#6712](https://github.com/promptfoo/promptfoo/pull/6712)); results→Langfuse needs a bridge | MIT; promptfoo/promptfoo 27.5k★, pushed 2026-11-20 |
| **Inspect AI** | A custom solver is arbitrary Python — can subprocess `devin` ([solvers doc](https://inspect.aisi.org.uk/solvers.html)) | Custom `@scorer` functions ([scorers doc](https://inspect.aisi.org.uk/scorers.html)) | Yes — `pip install` | None — writes `.eval` logs; only third-party bridges (e.g. inspect-mlflow) | MIT; UKGovernmentBEIS/inspect_ai 3.3k★, pushed 2026-11-20 |
| **Braintrust** | Task function can exec `devin` | Custom scorers | Official eval-action ([run-in-ci doc](https://docs.braintrust.dev/evaluate/run-in-ci)) | **No** — results live in the Braintrust data plane (SaaS/BYOC), a competing store ([plans](https://docs.braintrust.dev/plans-and-limits)) | Apache-2.0 SDKs (braintrustdata/braintrust-sdk-javascript, 31★); platform closed SaaS |

Why not the others, one line each: Harbor's container-per-task model fits "devin solves bench tasks", not "a seeded Cairn stack replays a Coordinator turn", and its GH-runner Docker path already cost the owner 14/20 tasks once (Observed, prior research); promptfoo and Inspect would each need both a custom harness *and* a results bridge to Langfuse; Braintrust cannot put results in Langfuse at all.

## 2. Task-count evidence and suite size

What real suites use, each cited:

| Suite | Tasks | Source |
|---|---|---|
| SWE-bench Verified | 500 | [OpenAI post](https://openai.com/index/introducing-swe-bench-verified/), [HF dataset](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified) |
| Terminal-Bench 2.0 / 2.1 | 89 | [VentureBeat](https://venturebeat.com/technology/terminal-bench-2-0-launches-alongside-harbor-a-new-framework-for-testing), [terminal-bench-2](https://github.com/harbor-framework/terminal-bench-2) |
| τ-bench | 50 airline + 114 retail | [τ³ fixes post](https://taubench.com/blog/tau3-task-fixes.html) |
| Aider polyglot | 225 | [aider.chat](https://aider.chat/2024/12/21/polyglot.html), [leaderboard](https://aider.chat/docs/leaderboards/) |

Reported run-to-run variance:

- SWE-bench Verified: ten independent runs of six agent configs (60,000 trajectories) moved single-run pass@1 by **2.2–6.0 percentage points**, σ>1.5pp even at temperature 0 ([arXiv:2602.07150](https://arxiv.org/abs/2602.07150)). Harness-only changes swing scores by **up to ~15pp** on Verified and 69.7%→77.0% on Terminal-Bench 2 ([arXiv:2605.23950](https://arxiv.org/html/2605.23950)) — the surface this gate watches moves scores more than run noise does.
- Terminal-Bench 2.1: leaderboard requires **≥5 attempts per task (445 trials)**; reported ± is one task-clustered SEM ≈ ±3 points — "differences of a point or two are noise" ([SUBMIT.md](https://github.com/harbor-framework/terminal-bench-2), [methodology](https://fast-agent.ai/benchmarks/methodology/terminal-bench-2-1/), [gbench docs](https://github.com/google-deepmind/gbench/blob/main/docs/evals/terminal_bench.md)).
- τ-bench: built `pass^k` because agents are inconsistent — gpt-4o pass^8 < 25% retail; leaderboard pass^1→pass^4 drops like 0.460→0.225 ([paper](https://arxiv.org/pdf/2406.12045), [repo](https://github.com/sierra-research/tau-bench)).

Agent projects running regression evals in CI: OpenHands runs a nightly eval plus label-triggered SWE-bench evals of size 1/50/200/500 ([#4489](https://github.com/All-Hands-AI/OpenHands/pull/4489), [run-eval.yml](https://github.com/OpenHands/software-agent-sdk/blob/main/.github/workflows/run-eval.yml)); Terminal-Bench validates every task PR with oracle + nop + cheat trials ([TASK_REVIEW_AUTOMATION.md](https://github.com/harbor-framework/terminal-bench/blob/main/docs/TASK_REVIEW_AUTOMATION.md)); DeepMind's gbench runs the full 445-trial TB 2.1 suite automated ([gbench](https://github.com/google-deepmind/gbench)).

**Size decision: 40 starter tasks** = 28 `runtime` + 10 `lane` + 2 `canary`. Justification: the gate verdict is per-case paired flips, not a suite mean — at the measured noise levels a mean difference under ~3pp is undetectable at any N, while a real system-level regression flips whole cases (the harness-variance data above). Runtime replays are deterministic and free (scripted model), so k=3/arm; lane tasks consume the Devin subscription quota, so k=1/arm (~20 Devin sessions per gated push). 500-task breadth would add cost without sharpening the verdict; below ~25 tasks a structural regression could hide in case coverage gaps.

## 3. What triggers the gate

The `changes` job in `ci.yml` gains an `eval-needed` output that greps the merge-base diff against the system-level surface. Any match runs the suite; no match, no cost. The job only runs on `queue/**` and `preflight/**` pushes and the weekly main run — pull requests and forks never see it (it needs secrets).

| Surface | Globs |
|---|---|
| Coordinator prompt and context assembly | `apps/server/src/services/chief*.ts`, `coordinator-{context,input-upgrade,inputs,request,route,runs,steps,tool-defs}.ts`, `project-instructions*.ts` |
| Coordinator runtime | `apps/server/src/coordinator/**` |
| Tool definitions and tool-call repair | `packages/shared/src/protocol/chief-tools.ts`, `apps/server/src/services/{schedules,schedule-run,thread-schedule-tools}.ts` |
| Model routing and dispatch policy | `apps/server/src/services/{routing-rules,routing-migration,routing-rule-issues,step-route,machine-routing,model-routing,dispatch-eligibility,dispatch-timeouts}.ts` |
| Memory and skill injection | `apps/server/src/services/{memory*,team-memory}.ts`, `packages/shared/src/skill-{facts,inject,injection-check,route}.ts` |
| Dispatch prompts and lane policy | `docs/agent-dispatch-prompts.md`, `docs/ops/lane-workers.md`, `scripts/{dispatch-agent,lane-model-policy}.js` |
| The exam itself | `eval/**`, `.github/workflows/ci.yml`, `.github/workflows/eval-weekly.yml` |

`apps/daemon/src/backend/**` stays out of scope for v1 — the suite replays Coordinator turns and dispatches the Devin CLI directly; executor internals gate on evidence the suite cannot produce (Derived, honest boundary).

## 4. The task set

Two storage planes, one suite:

- **Repo tasks** (`eval/tasks/`, protected): authored, public-safe items. `runtime/*.json` — a world seed (projects/todos/threads), a request, a scripted model response list, and expected outcomes. `lane/<id>/` — a fixture repo plus instruction and artifact checks. `canary/*.json` — trivially-known outcomes.
- **Langfuse dataset `cairn-eval-suite`** (private): harvested real Coordinator turns. `eval/harvest.ts` (owner-run) reads sealed `coordinator_turn_snapshot` rows (250 exist on the owner's machine today; Observed) plus `coordinator turn` traces, derives items `{request, world, script-from-recorded-tool-calls, expected outcome}`, and uploads them. Owner text never enters this public repository: the script refuses an output path inside the checkout, defaults to `tmpdir()`, and redacts secrets and project names. v1 does not run these items — `eval/run.ts` builds its item list from `eval/tasks` alone, so a harvested item is staged in the dataset for review and becomes a repo task only when someone distils it there.

Runtime task kinds cover: route-to-project, multi-project split with `blockedBy` edges, ask-on-ambiguity, plain answer without tools, refusal of unsafe direct action, quick-lane, event turns, tool-contract violations (malformed args), model binding, and prompt-assembly assertions — the captured `systemPrompt` sent to the model is asserted deterministically (the `seen` channel in the harness; this is how prompt-template changes are gated without a thinking model).

## 5. Scoring — deterministic only

Each task returns one normalized record; evaluators are code, no LLM judge in v1:

| Check | What it catches |
|---|---|
| `turn.completed` | step reached `done`; infra errors classify `incomplete`, never failed |
| `turn.tool_contract` | every emitted tool call validates against `chief-tools.ts` schemas; arg-repair count regresses |
| `turn.model_binding` | the turn bound the seeded provider/model/thinking — regresses routing-rule changes |
| `turn.prompt_contract` | captured systemPrompt contains required sections and seeded entities, no drift markers |
| `route.decision_ok` / `projects_ok` / `split_ok` / `ask_ok` / `blocked_by_ok` | the accepted routing ruler, unchanged semantics |
| `lane.completed` | the Devin session ran and produced a workspace result |
| `lane.files_ok` / `lane.tests_pass` / `lane.diff_ok` | fixture-repo artifacts: expected files exist, declared checks pass, diff stays in-bounds |

A task's score is its passing-repeat count (0..k). A task can mark checks `report-only`; v1 gates lane tasks on `lane.completed` alone until two weekly runs measure their variance.

## 6. Baseline vs candidate and the verdict

One `eval` job in `ci.yml` (`needs: changes`, `if:` eval globs matched, queue/preflight branches only): two checkouts — `base` (merge-base SHA from `changes`) and `candidate` (queue head). Each arm executes its own `eval/run.ts` + `eval/harness/` (working-directory = the arm's checkout), so the code under test — Coordinator runtime, tools, routing — always comes from that arm's tree. The exam (`eval/tasks`, `eval/scorers`, `eval/harness/types.ts`, `eval/suite.json`) is dynamically imported from the **base** checkout's `eval/` when it exists there, else the candidate's — a push cannot rewrite the exam it is being judged by; edits to `eval/**` are additionally human-queue paths (§8).

There is no baseline to compare against while the suite is not yet on `main`: the job's `Baseline arm requires the suite on the merge base` step fails with that sentence instead of a module-not-found, and it also fails closed when `base-sha` is empty or is not an ancestor of `origin/main` — an empty base would otherwise check out the queue branch itself and compare it with itself. That is the reason `EVAL_ENABLED` stays unset for the landing push (§10) and is turned on afterwards, when every merge base carries `eval/`.

Each arm runs `eval/run.ts` → `client.experiment.run({name: "eval-<sha8>-<arm>", data: items×repeats, task, evaluators})` against a stack booted from that arm's checkout; both runs land as dataset runs in Langfuse for the UI comparison. `eval/compare.ts` pairs item scores by case id across arms: a case that passed on base and fails on candidate (or its success count drops) is a regression → non-zero exit feeds `check` → `promote` cannot land; the job posts a commit comment with the run fingerprint, per-case pass counts, the diff table and Langfuse links. `incomplete` items (Devin auth/quota failure, Langfuse outage, harness crash, a flipped canary) are never score-failures; ≥1 incomplete on a gated case, or any infra failure, marks the run `incomplete` and fails the job closed labeled infrastructure.

## 7. Where it runs, what a run costs

`ubuntu-24.04` (pinned; `ubuntu-latest` migrates this month). The stack replays in-process via `tsx` on each checkout — no Docker. The Devin CLI installs via `eval/install-devin.mjs` — the same `static.devin.ai` manifest + sha256-verified tarball mechanism the product's `devin-managed` backend uses — before credentials are restored and before `LANGFUSE_*` is exposed (both scoped to the run steps), and authenticates from a restored `credentials.toml` secret; `devin -p` runs each lane task in its fixture dir. Budget: 28 runtime × 3 × 2 arms = 168 scripted turns (free) + 10 lane × 1 × 2 = 20 Devin sessions (subscription quota — `EVAL_MAX_DEVIN_RUNS` caps it; breach = `incomplete`) + ~40 min job cap.

Secrets (owner adds once, `eval` environment): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (Langfuse Cloud — the owner's traces already go there; the self-hosted omarchy host has been offline 17h+), `DEVIN_CREDENTIALS_TOML`. Missing secrets fail the job as `incomplete`, never silently pass.

A weekly `eval-weekly.yml` cron runs the suite on `main` with no candidate arm — the trend line and the variance measurement that re-tunes N, k and which lane checks gate.

## 8. How the exam stays isolated

The deleted rule ("no change may edit what judges it" bound to the trajectory files) is replaced by path protection on the new exam:

| Threat | Control |
|---|---|
| A push edits tasks, checks or budgets | `eval/**` is `protected` in `merge-gate-paths.json` (+ `humanQueue.evalConfig`); agent-authored edits cannot auto-merge; at run time tasks/scorers/suite.json are imported from the merge-base checkout |
| A push edits harvested expected outputs | They live only in the Langfuse dataset; CI keys lack `datasets:CUD`; v1 runs do not read them (§4), so an edit there cannot change a verdict |
| Candidate code reads the answers | The stack process sees only its seeded world; expectations stay in the runner process; lane fixtures never contain expected diffs |
| Candidate arm code reads runner secrets | Accepted residual in v1: each arm's `run.ts` executes that arm's code in-process beside `LANGFUSE_*` and the restored `credentials.toml`; the `devin` subprocess sees neither (lane env allowlist) and checkouts persist no git token. The live control is the GitHub `eval` environment's deployment protection plus `humanQueue.evalConfig`; moving Langfuse upload into a separate trusted step is the hardening path if hostile code ever reaches the runner |
| Candidate arm decides its own verdict | Accepted residual in v1, and the reason the exam is pinned: the arm's `world.ts`/`lane.ts`/`run.ts` must come from that arm, because they import that arm's app code by relative path — pinning them to the base tree would run the base product and judge nothing. What a push cannot move is the exam (tasks, scorers, `suite.json`, `types.ts`) and the verdict code: `compare.ts` runs from the base checkout and fails closed when `base-sha` is not an ancestor of `origin/main`. A candidate that rewrites its own harness can therefore fake its arm's records, and `eval/**` being `humanQueue.evalConfig` makes that edit visible rather than impossible. The hardening path is a harness that takes the app root as an argument and dynamic-imports the arm's modules, so both arms run the base runner |
| CI token scope | The `eval` job holds `contents: write` for its commit comment only; `persist-credentials: false` on both checkouts and `GH_TOKEN` passed to that one step. Splitting the comment into a small artifact-consuming job is the hardening path |
| A fixture contains a symlink | Fixtures are protected and reviewed; `cpSync` copies links as links, so a link could point outside the temp workspace. Not reachable from exam data today; `dereference: false` plus a link check is the fix if fixtures ever come from outside review |
| Noise-gaming by rerunning until green | Fixed k, one verdict per run fingerprint; no adaptive repeats |
| Infra flake counted as regression | `incomplete` is never fail-by-score; the canary catches suite-level breakage; expected item count asserted |
| Langfuse unavailable | Gate fails closed as `incomplete` |

## 9. Deletion: the old skeleton

Removed in the same change: `apps/server/src/trajectory-*.ts` (18 files: exporter, CLI, outcome, outcome-backfill, attribution, push, reflect, reflect-curate, curate, shadow, otlp, transcript and their CLIs), `packages/shared/src/trajectory-pack.ts` and its test, 9 `apps/server/test/trajectory-*.test.ts`, the scheduler's three trajectory sweeps and their config flags (`CAIRN_TRAJ_*`, `CAIRN_REFLECTOR_*`), the eight `traj:*` package scripts, the `traj:export`/`traj:push` ops doc lines, feature-map rows, the four trajectory globs in `merge-gate-paths.json`, and the "no change may edit what judges it" line in AGENTS.md/CLAUDE.md (replaced by the §8 rule). The `build_outcome_backfill` table stays — it holds user data; the code that wrote it is gone. `packages/shared/src/langfuse.ts` (`openExperimentClient`) stays: it is the Langfuse SDK bridge the new suite uses, not part of the pack skeleton.

## 10. Delivery

One change: deletions + `eval/` + the `ci.yml` wiring + `merge-gate-paths.json` + doc updates. Owner steps after it lands, in this order: add the four `eval`-environment secrets (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `DEVIN_CREDENTIALS_TOML`, plus the `LANGFUSE_BASE_URL` repository variable), run `eval/harvest.ts` once to populate `cairn-eval-suite`, then set the repository variable `EVAL_ENABLED=true` — the `eval` job and `eval-weekly.yml` are both off until it is set, and `check` excusing a skipped `eval` is deliberate while it is unset (an admin-only variable: unsetting it turns the gate off). Setting it earlier fails every gated push at the baseline step, because `main` may not carry `eval/` yet. Then watch the first gated push. Two-week tune-up: measure lane-task variance on the weekly runs, then promote `lane.*` checks from report-only to gating.

Observed 2026-11-21 (this checkout): `node --import tsx eval/run.ts --arm smoke --exam eval --out … --offline --only canary` boots the in-server Coordinator against a temp database, replays both canaries and writes `canary.completed = 1` for each — the harness, the world seed and the scorers run end to end without Langfuse or the Devin CLI. No gated run has executed yet: `EVAL_ENABLED` is unset, so there is no first baseline-vs-candidate score to report until the owner completes the steps above. The suite is linted and typechecked like the rest of the repository (`biome.json` includes `eval/**`, and `apps/server/tsconfig.json` compiles it), which is how the unused locals and the direct SDK imports were caught and removed in favour of `@cairn/shared/langfuse`.
