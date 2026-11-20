# Eval gate for system-level changes

Status: design only; the owner reviews it before any implementation. Supersedes nothing: it extends the accepted [eval-on-langfuse design](eval-on-langfuse.md) from routing evaluation to the whole system-level surface, and names what changed since (the `integration/eval/` deletion and the offline Langfuse host). Source: [research](../research/2026-11-21-eval-gate.md). Evidence terms: **Observed** = read first-hand in this checkout or a live command; **Derived** = consequence of the observed; **Unverified** = needs a real call.

## 0. Who meets this

Someone who installed Cairn today and has never heard of its parts changes the Coordinator's system prompt, a tool definition or a model-routing rule, and pushes a candidate to `queue/main`. Without this gate nothing measures whether real conversations got better or worse; the change lands on unit tests alone. With it, CI replays a fixed suite of recorded Coordinator conversations on the old and the new code, judges each replay with code the candidate cannot edit, and blocks the candidate only when the new code is measurably worse. The contributor waits about 30 minutes on pushes that touch the gated paths, pays nothing — the token bill, about $10–25 per run on the recommended model class, is on the team's eval budget — and sees a commit comment naming the cases that regressed. The suite's cases are curated by the owner; its judges and expected answers live outside the repository, so no push — human or agent — can grade its own homework.

## 1. Decision and ownership

Build the gate on the accepted Langfuse plane: **Langfuse holds the task set, the expected outputs, the run records and the scores; the repo holds only a thin runner and the gate check; only the owner's Langfuse login can edit cases and judges.** The alternative — cases and judges in a private mirror plus in-repo scoring — rebuilds Langfuse's ACL, versioning and review UI for no benefit, and a repo-YAML suite (promptfoo-style) cannot hold private harvested turns in a public repository. The deleted `integration/eval/` is restored only as a thin runner under `scripts/eval/`; the 2026-11-16 deletion removed a directory, not the direction.

What changed since the accepted design and is absorbed here:

- **Observed:** `integration/eval/`, `eval-gate.yml` and the harness-regression merge gate were deleted (`f2a47295f`); `packages/shared/src/langfuse.ts` and the `coordinator_turn_snapshot` capture (#4010, expanded by #4134) remain. Whether the reviewed dataset items and routing evaluator were ever uploaded to Langfuse is Unverified — the host was offline when checked.
- **Observed:** the Langfuse host (omarchy) is offline (`tailscale status`: last seen 15h ago); the only always-on infrastructure this design may assume is GitHub itself plus whatever Langfuse home the owner keeps reachable.
- **Observed:** Langfuse API-key presets changed — no single preset grants "read datasets + write scores" without also granting `evaluator:CUD`/`datasets:CUD`; CI therefore carries two keys (VIEWER + INGEST) instead of one.
- **Observed:** Langfuse code evaluators gained an `external` dispatcher option (your own HTTP executor); SDK evaluator functions inside `experiment.run` run in our own process and need no dispatcher — this design scores with judge code in the trusted runner process and treats managed evaluators as a later upgrade.

## 2. What triggers the gate

The `changes` job in `ci.yml` already diffs the push against its merge-base; a new `eval-needed` output greps that list against the system-level surface below. Any match runs the suite; no match, no cost.

| Surface | Globs |
|---|---|
| Coordinator prompt and context assembly | `apps/server/src/services/chief*.ts`, `coordinator-{context,input-upgrade,inputs,request,route,runs,steps,tool-defs}.ts`, `project-instructions*.ts` |
| Coordinator runtime (turn loop, models, provider binding, compaction, memory flush, harness, volatile context) | `apps/server/src/coordinator/**` |
| Tool definitions and tool-call repair | `packages/shared/src/protocol/chief-tools.ts`, `apps/server/src/services/{schedules,schedule-run,thread-schedule-tools}.ts` |
| Model routing and dispatch policy | `apps/server/src/services/{routing-rules,routing-migration,routing-rule-issues,step-route,machine-routing,model-routing,dispatch-eligibility,dispatch-timeouts}.ts` |
| Memory and skill injection | `apps/server/src/services/{memory*,team-memory}.ts`, `packages/shared/src/skill-{facts,inject,injection-check,route}.ts` |
| Dispatch prompts and lane policy | `docs/agent-dispatch-prompts.md`, `docs/ops/lane-workers.md`, `scripts/{dispatch-agent,lane-model-policy}.mjs` |

Deliberately out of scope for v1: `apps/daemon/src/backend/**` and everything below the Coordinator turn — the suite replays turns, not builds, so triggering on executor internals would gate on evidence the suite cannot produce (Derived: honest boundary over a gate that pretends to see). Build-level replay is the shelved pacman-bench territory (spec 29 E2) and is where Harbor stays relevant if it is ever revived.

Judge-side files never trigger; they join the protected eval surface in `merge-gate-paths.json` at implementation time (itself a human-routed edit): `apps/server/src/services/coordinator-turn-*.ts`, `apps/server/src/runtime-otel.ts`, `packages/shared/src/{langfuse,genai-conventions,trajectory-pack}.ts`, `scripts/eval/**`, `.github/workflows/ci.yml`. A push touching both sides still runs the suite and still routes to a human.

## 3. The task set

One Langfuse dataset, `cairn-coordinator-suite`, items pinned by dataset version on every run.

| Kind | Content | Where it comes from | Count (v1 target) |
|---|---|---|---|
| `harvested` | Real past Coordinator turns: the frozen `input` world (claim + ordered tool-boundary views) plus the owner request; `expectedOutput` is the normalized decision record the owner confirmed | Sealed `coordinator_turn_snapshot` rows (schema ≥2, unexpired, `status='sealed'`), reviewed in a Langfuse annotation queue, uploaded by an owner-run CLI — no public-repo fixture ever holds owner text | ~30 |
| `deterministic` | Synthetic worlds + requests with code-checked expectations: route to the right project, split into the right parts, ask on ambiguity, answer without tools, refuse an unsafe direct action, emit only schema-valid tool args, bind the seeded model | Authored; no private content, but still stored in Langfuse so candidate code cannot read expectations (Harness² rubric lesson) | ~10 |
| `canary` | One item pinned to a trivially known outcome | Authored | 1–2 |

Eligibility (Observed from `coordinator-turn-snapshot.md` and `coordinator-turn-capture.ts`): a harvested turn is replayable only while every read the candidate may make is covered by a captured closure — phase-1 capture covers prompt/context, `projects` and `create_todo`; `todos`/`open_thread` arrive with phase 2. An uncaptured read during replay marks the item `incomplete: snapshot <reason>` — never a failure, never a live-state fallback. An empty eligible dataset is a readiness failure, not a pass.

## 4. Scoring

Each replayed turn returns one normalized record: `{ decision: route|ask|answer, parts: [{project, title}], blockedBy, askCandidates, toolCalls[], repairedArgCalls, boundProvider, boundModel, boundThinking, terminalStatus, errorClass, turnTraceId }`. Required checks, all pure code, per item:

- `turn.completed` — terminal status reached; infra errors classify as unscored, not failed.
- `turn.tool_contract` — every emitted tool call validates against `chief-tools.ts` schemas and needed zero argument repair (regresses tool-definition changes).
- `turn.model_binding` — the turn bound the seeded provider/model/thinking (regresses routing-rule changes).
- `route.decision_ok`, `route.projects_ok`, `route.split_ok`, `route.ask_ok`, and `route.blocked_by_ok` where the expected record carries edges — the accepted routing ruler, unchanged.

A repeat passes when every required check passes; a case's score is its passing-repeat count (0..k). Optional soft scores (answer quality by a cheap LLM judge, receipt latency) are reported under separate score names and never gate — the blocking ruler stays code.

## 5. Noise, repeats and the minimum detectable effect

The statistical contract is the accepted design's, restated for this suite:

- k = 3 repeats per case per arm, 2 arms (base = merge-base SHA, candidate = queue head), identical dataset version, judge SHA, model and thinking level; arm order randomized per case/repeat; state reset between turns; case selection frozen before execution.
- One primary endpoint, a one-sided exact paired sign test at α = 0.05 over independent case clusters: per case compare candidate successes vs base successes; W counts cases worse, B better, ties discarded; D = W + B; p = Σ binomial(D, i)/2^D for i = W..D; regression only when p ≤ 0.05.
- **MDE:** the gate can only see a regression that flips ≥ 5 independent cases, and then only if almost none flip the other way (D = 5 needs W = 5; D = 8 needs W ≥ 7; D = 10 needs W ≥ 9). With N ≈ 40 cases that means a per-case success-rate drop on the order of half or more on ≥ ~12% of the suite; smaller or diffuse regressions are below the noise floor and are reported, not blocked. Two weekly main runs give the variance measurement to re-tune N and k; raising either lowers the MDE linearly in cost.
- The suite score each arm reports is the mean case success rate with a Wilson 95% interval; it is the trend line and the keep-if-better number, never the gate verdict — the verdict is the paired test alone.
- Improvement is counted symmetrically (B) and reported for the owner's keep-if-better loop; it never auto-lands anything — a candidate that does not regress promotes through the normal queue anyway.
- A quota shortfall, evaluator outage or budget cap marks the run `incomplete` with no verdict and fails the check closed; expected turn count (items × k × arms) is asserted at the end.
- Judge-side version drift (both arms must be scored by the same judge SHA and evaluator versions) and a flipped canary each invalidate the comparison.

## 6. Baseline store

Langfuse is the store, matching the accepted design:

- Every run is an experiment run carrying a fingerprint in `runName` and metadata: base and candidate SHAs, `prompt_sha256`, model, thinking, dataset version, judge SHA, arm, repeat index. Re-runs never resume an old fingerprint.
- `dataset.metadata.baselineRun` names the accepted reference run; only the owner moves it. The weekly main run refreshes the trend line — the same "did the score go up" record the owner's loop reads — and feeds the noise-floor measurement used to re-tune the suite.
- Nothing score-bearing is committed to this public repository: the paired-arm verdict needs no stored baseline, the trend lives in Langfuse, and the run record is reachable from the commit comment the gate posts.

## 7. Where it runs, and what a run costs

A conditional `eval` job inside `ci.yml` on `ubuntu-24.04` (pinned: `ubuntu-latest` migrates to Ubuntu 26.04 this month), `needs: changes`, `if:` the eval globs matched, feeding the existing `check` aggregator so `promote.yml` binds the verdict with no ruleset change. Triggers: pushes to `queue/**` plus a `schedule:` cron and `workflow_dispatch` inside the same workflow (a cron on main runs the suite with no candidate arm — the weekly trend run). Pull requests and forks never start it — the job needs secrets and only queue/main carries trusted pushes. Never the owner's Mac; there is no `cairn-eval` self-hosted runner and none is needed.

Two checkouts per run: the **candidate** (queue head) supplies only the Coordinator under test; the **ruler** (default branch) supplies the runner, judges and gate. The eval stack gets a seeded provider credential only — no Langfuse keys, no expected outputs, no route to the Langfuse API from the stack process.

Budget: N ≈ 40 items × 3 repeats × 2 arms ≈ 240 turns; ~40–80k input / ~3k output tokens per turn (Derived from snapshot bounds; measured after the first real runs). Concurrency ~4–6, per-turn timeout 10 min, job cap 90 min and a `max_run_usd` cap — breach means `incomplete`, not a verdict.

| Eval model choice | Token math | Cost per run | Note |
|---|---|---|---|
| Cheap API model (haiku-class, ~$1/$5 per MTok at list) | 240 × (60k in, 3k out) | ≈ $10–25 | Fidelity trade: prompt tuned for the prod model may behave differently; deltas still track because both arms share the model |
| Prod-class API model (~$3/$15 per MTok) | same | ≈ $30–55 | Best fidelity |
| Codex/Claude subscription auth | same | quota, ~240 turns | $0 marginal but auth decays and refreshes inside CI secrets — fragile |
| Optional LLM-judge soft scores | +240 small calls on haiku-class | + ~$0.5 | Non-blocking |

## 8. When the score drops

The `eval` job exits non-zero → `check` is red → `promote` cannot land the candidate. The gate posts a commit comment with the run fingerprint, W/B/D, p, per-case repeat counts and a link to the Langfuse comparison (per-item outputs side by side). The owner then either investigates in Langfuse — judge failures are re-scored without re-running turns — or reverts. An `incomplete` run is also red but is labeled infrastructure, not regression, so nobody hunts a phantom drop; it unblocks when the dependency is back, which is the price of a gate that cannot be silently skipped.

## 9. How the judge stays isolated

| Threat | Control |
|---|---|
| A push edits cases or expected outputs | They live only in Langfuse; CI keys are VIEWER + INGEST with no `datasets:CUD`; item history keeps every edit; runs record the pinned dataset version |
| A push edits the judge | Judge code executes from the default-branch ruler checkout; `scripts/eval/**` and the workflow are protected paths; managed evaluators (if adopted later) are owner-edited only, with the gate asserting both arms scored on identical versions |
| Candidate code reads the answers | Keys and expected outputs stay in the runner process; the stack sees only its model credential; the runner denies the stack egress to Langfuse — the Harness² rubric-download control |
| Candidate swaps the eval model or provider | The seeded ProviderConfig is pinned by the ruler config; `turn.model_binding` scores it |
| Noise-gaming by rerunning until green | Fixed k, one verdict per run fingerprint, no adaptive repeats or peeking |
| Infra flake counted as regression | Unscored/incomplete is never fail-by-score; the canary catches suite-level breakage |
| The self-improvement loop edits its own ruler | The judge surface (exporter, outcome fields, pack schema — already protected — plus the new runner/judge/otel files) routes to a human through `merge-gate-paths.json`; an agent-authored change to any of them cannot auto-merge |
| Langfuse unavailable | The gate fails closed as `incomplete`; it never passes on absence |

## 10. Delivery and open decisions

Ordered work after this design is reviewed; each its own change, branched fresh:

1. **Ops** (owner + one PR): pick the Langfuse home, mint the VIEWER + INGEST CI keys and the `eval` GitHub environment secrets, create dataset `cairn-coordinator-suite` and the review queue.
2. **Harvest**: owner-run snapshot→dataset CLI (revive the `199b89fbe` path); curate ~30 eligible turns + author ~10 deterministic items.
3. **Runner + gate**: `scripts/eval/` resurrected selectively from `31092d98d`, judge checks, the `ci.yml` `eval-needed`/`eval` wiring, the protected-surface additions.
4. **Tune**: two weekly main runs → re-check N, k and MDE; add managed evaluators via the `external` dispatcher only if the in-runner judges prove hard to review.

Decisions for the owner, each with my recommendation:

1. **Where does Langfuse live?** Options: (a) Langfuse Cloud Hobby — free for our volume, reachable from GH today, but harvested owner conversations sit on Langfuse's cloud; (b) self-host on an always-on tailnet node + `tailscale/github-action` in CI — private, but needs a host that actually stays online (omarchy has been offline 15h, ops-box 6d); (c) ephemeral Langfuse per CI job — self-contained but heavyweight and moves the durable store elsewhere anyway. *Recommend (a) if cloud-stored conversation inputs are acceptable, else (b) once a host is named.* The gate design is identical either way — one base URL + keys.
2. **Which eval model?** *Recommend the cheapest tool-faithful API model pinned in the ruler config (~$10–25/run at haiku-class list prices) for v1, with one weekly prod-model arm added once the suite is stable — it roughly halves cost now and keeps the fidelity question measurable.*
3. **Runner back in the repo?** *Recommend yes, under `scripts/eval/` — the `**/scripts/**` glob already makes it a protected path; an external mirror buys isolation we already get from ruler-checkout execution.*
4. **Suite size and repeats?** *Recommend ~40 items × k=3 × 2 arms to start (MDE ≈ a flip of ≥5 independent cases); re-tune after the first two weekly runs measure real variance.*
5. **Extend the protected eval surface** to `coordinator-turn-*.ts`, `runtime-otel.ts`, `langfuse.ts`, `genai-conventions.ts` alongside the runner? *Recommend yes, in the runner PR — the judge surface should be complete the day the gate exists.*
6. **Soft LLM-judge scores in v1?** *Recommend no — they cost nothing but add a second model to reason about; add them when the code-ruler runs are trusted.*

Two-way door: the workflow, runner and checks revert without touching Langfuse history; nothing here writes to the live Cairn instance or deletes a dataset. This doc claims no runtime proof — harvesting counts, reachability and real costs are verified in the phases above, not asserted here.
