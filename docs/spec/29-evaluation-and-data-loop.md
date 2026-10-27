# 29 · Evaluation & Data Loop

> Status: **drafting landed** (2026-10-25, ticket #1510). Source: the 2026-10-22 plan (claude.ai artifact `4cjTdsVFN6ZP8TccM3ZWcE`), with the 2026-10-23 observability supplement (artifact `NrfYjm1yd3CJLKWR5DmKHA`) and the 2026-10-24 E1 criteria additions from RAVEN's research (#1605, #1606). Scope decision (2026-10-22): "training" means optimizing the harness only — prompts, skills, tool descriptions, context assembly, routing; never model weights.
>
> Related: ADR 0021 D4 (protected paths, amended for the eval surface by ADR 0025), ADR 0022 (evidence pruning — nothing here depends on merged evidence staying on main), `docs/research/eval-methods.md` (methodology survey). Tickets: §4 ledger.

## 0 · Goal and end state

Every claim "the harness got better" becomes a measured number: a change to prompts, skills, tool descriptions, context assembly, or routing must pass a code judge on paired trials before it is adopted, and the benches, judges, and trajectory exporters that produce those numbers cannot be edited by the agent being measured.

End state, machine-checkable:

1. A harness change is a PR like any other; whether it helps is decided by `integration/eval/adoption/judge.mts` on paired before/after trials, with infra failures dropped, inert changes rejected, and a paired-z significance gate (#1605).
2. Every merged build leaves a complete trajectory pack (schema in `packages/shared/src/trajectory-pack.ts`); outcome fields (`merged`, `revertedWithin7d`, `fixedByLaterPr`) are backfilled from real repository history (#1515).
3. Rejections and rollbacks automatically become candidate bench questions; a human confirms before anything enters `integration/eval/` (#1516).
4. pacman-bench (#1517–#1519) scores the harness on real merged-PR tasks; CI runs its holdout slice on every harness-touching PR and blocks regressions beyond the confidence interval.
5. The eval ruler (`integration/eval/**`, `.claude/hillclimb/**`, the trajectory exporter source) is in D4 category ⑥ (ADR 0025): no auto-merge can edit its own ruler.

## 1 · Phases

### E0 · Ground truth — what actually happened (tickets #1511–#1514, merged)

Capture per-build trajectories with enough fidelity to replay and judge later: pack schema (`trajectoryPackSchema`: input, process, judgments, outcome), preserved `stopReason`/`rawStopReason`/`responseModel` plus raw session JSONL as step attachments, `baseSha`/`harnessHash` on every build, structured human-feedback records on plan/diff rejections, and a read-only, redacted `pnpm traj:export`.

Completion criteria:

- Pack schema unit tests cover required and nullable fields (#1511, PR #1559).
- A truncated (`length`) turn shows `stopReason: "length"` in the message row; session JSONL uploads and is retrievable by stepId under the existing attachment caps (#1512, PR #1590).
- Drizzle migration adds `baseSha`/`harnessHash`; all three rejection paths write a structured feedback record (#1513, PR #1560).
- Export of a merged build validates against the schema; an injected fake token is redacted and counted (#1514, PR #1641).

### E1 · The judging loop closes on real merges (tickets #1605, #1606, #1515, #1516)

Turn merged work into judged work: an adoption judge for harness changes, failure attribution inside packs, 7-day outcome backfill, and candidate bench questions generated from rejections and rollbacks.

Completion criteria:

- Adoption judge (`integration/eval/adoption/`): infra failures are re-run (max twice) then dropped from pairing and counted, never scored; a change never triggered at runtime is rejected as inert; paired per-question score deltas need z ≥ 1.96 to accept; a significantly worse delta rejects; the sealed set is read once per optimization run, enforced on disk (#1605, PR #1636; unit tests for each gate).
- Packs carry a failure-attribution field (which layer × why), writable via `traj:label`/`traj:attribution` (#1606, PR #1660).
- Backfill: builds merged 7+ days get `revertedWithin7d` / `fixedByLaterPr` from revert commits and later PRs touching the same lines; a constructed revert scenario passes unit tests (#1515).
- Each of the three events (plan rejection, review blocking, post-merge revert) produces one candidate bench question into the human confirmation queue; unconfirmed candidates never enter `integration/eval/` (#1516).

### E2 · pacman-bench: the harness measured on real work (#1517, #1518, #1519, #1532)

A bench of ~30 tasks distilled from merged PRs (issue text + base SHA as the prompt, the PR's own tests hidden in the grading container), run under Harbor for isolation, wired into CI as a regression gate, plus a same-model cross-harness page-generation comparison.

Completion criteria:

- 30-task list with per-task oracle checks (original patch passes, empty patch fails) and ian spot-checking ~10 tasks for inter-rater agreement (#1517; tasks ship as Harbor task directories with a pinned Harbor version).
- Isolated runner reports pass@1, pass^3, Wilson intervals, and cost; the score is not at ceiling (< 70%); a tampered-test-result negative control is caught by the grading container (#1518; Harbor owns container/network isolation, Cairn ships only the agent adapter and result conversion). Task images install uv, Python and the test runner before scoring, and the scoring container uses compose `network_mode: none` so scoring does not download and cannot reach the network (#1681).
- Every harness-touching PR runs the bench holdout slice plus the chief-dispatch suite in CI; the gate blocks only on differences exceeding the confidence interval; a deliberately-broken-dispatch negative control is blocked, and non-harness PRs do not trigger it (#1519).
- The page-generation comparison suite has its question bank and grading rubric in `integration/eval/`, a bare-pi-loop baseline round on the weak model tier, and per-batch human calibration (#1532).

### E3 · The harness optimizes itself (no tickets yet; candidates #1579, #1614, #1576)

Close the outer loop: candidate generation reads failed trajectories, evaluation dispatches itself, and adoption runs per change. GEPA drives prompt mutation with variants and scores (including failures) archived under `.claude/hillclimb/` (#1579); the merge gate dispatches a regression-eval agent when a result file is missing instead of waiting for a human (#1614); memory gets the same regression-eval treatment (#1576). Ticket split is pending; the phase is sequenced after E2 because the optimizer is only as good as the bench it optimizes against.

Completion criteria (draft, to be confirmed when ticketed):

- One full unattended round produces a candidate prompt change, its paired-trial result, and either an accepted PR or an archived rejection with reasons.
- Every variant, including failed ones, is archived with score and cost.
- No candidate is adopted without passing the E1 adoption judge on the holdout slice.

### E4 · The loop runs as a standing process (no tickets yet)

E3 on a schedule with human sampling: the system proposes harness changes continuously, humans review what landed and what was rejected, and corrections escalate into gates. Graduation: the E3 loop runs for a fixed observation window (suggested: 4 weeks) with no ruler tampering incident and no adopted change reverted within 7 days beyond an agreed rate. Definition pending ian's decision when E3 lands.

## 2 · Risks and guardrails

| Failure mode | Guardrail |
|---|---|
| An agent edits the judge, the bench, or the exporter to pass | D4 category ⑥ (ADR 0025): `integration/eval/**`, `.claude/hillclimb/**`, and the trajectory exporter source always route to a human; the harness-regression gate (#1578) binds results to the exact patch |
| Overfitting to the training split | optimize/holdout split fixed by issue number (#1517); sealed set readable once per run, enforced on disk (#1605); only holdout gains count (#1579) |
| Infra flake counted as score | validity gate re-runs and drops infra failures (#1605); zero-token and `step != done` interception (chief-dispatch) |
| The judge gets exploited | code judges over model judges; the grader is designed around "can it be bypassed", not "does it judge correctly" (eval-methods S0.6); judge source is protected (ADR 0025) |
| Optimization bloats prompts and cost | cost is a second Pareto objective (#1579); unit-cost-quality reported on every bench run |
| Private data leaks through traces | export-time redaction with hit counting (#1514); Langfuse is developer-side optional, packs stay local (§3) |
| The observability platform becomes the source of truth | local sqlite + trajectory packs remain canonical; OTel is an export format; replay, judging statistics, CI gates, and the self-optimization loop stay in-repo |

## 3 · Observability platform (2026-10-23 supplement; tickets #1569–#1573)

Decision: **OTel is the external data format; self-hosted Langfuse only views and labels** (traces, scores, annotation queues, experiment comparison). It is a developer-side optional component. Local sqlite + trajectory packs remain the single source of truth; replay, judging statistics, CI gates, and the harness self-optimization loop stay in the repository and are never delegated to the platform.

- #1569 self-hosted Langfuse: compose stack and operating notes (closed).
- #1570 `pnpm traj:push`: convert packs to OTLP and push to Langfuse.
- #1571 human review verdicts and outcome labels sync to Langfuse as scores.
- #1572 runtime OTel spans (default off): server, Claude Code subprocess, pi.
- #1573 mirror pacman-bench as a Langfuse dataset and experiments.

Consequences already absorbed by other tickets: #1515's weekly summary is replaced by Langfuse score dashboards; #1516's human confirmation queue is the Langfuse annotation queue, and a script opens the intake PR after confirmation — `integration/eval/` stays the canonical question bank and a protected path; #1532's blind-review calibration uses Langfuse's rater-agreement analysis. This supplement changes no ADR.

## 4 · Ticket ledger

| Phase | Ticket | What | State |
|---|---|---|---|
| Charter | #1510 | This spec + ADR 0025 (eval surface into D4 protected categories) | this PR |
| E0-1 | #1511 | `trajectoryPackSchema` | merged (PR #1559) |
| E0-2 | #1512 | `stopReason` / raw session JSONL retention | merged (PR #1590) |
| E0-3 | #1513 | `baseSha` / `harnessHash`, structured feedback records | merged (PR #1560) |
| E0-4 | #1514 | `pnpm traj:export` read-only + redaction | merged (PR #1641) |
| E1 | #1605 | Adoption judge: validity / trigger / paired-z gates + read-once sealed set | merged (PR #1636) |
| E1 | #1606 | Pack failure-attribution fields | merged (PR #1660) |
| E1-1 | #1515 | 7-day outcome backfill | open, waits for E0 (merged) — see issue for the 2026-10-23 adjustment |
| E1-2 | #1516 | Failure-replay candidate generation from rejections/rollbacks | open, waits for E0 (merged) — 2026-10-23 adjustment: confirmation via Langfuse annotation queue |
| E2-1 | #1517 | pacman-bench v0: 30 tasks from merged PRs (Harbor format since 2026-10-25) | open |
| E2-2 | #1518 | Isolated runner (Harbor since 2026-10-25) | open |
| E2-3 | #1519 | Bench holdout slice as a CI regression gate | open |
| E2-attached | #1532 | Same-model cross-harness page-generation comparison | open |
| Observability | #1569–#1573 | Langfuse self-host, `traj:push`, score sync, OTel spans, bench-as-dataset | #1569 closed; #1570–#1573 open |
| E3 | — | Self-optimization loop (#1579, #1614, #1576 as candidates) | not ticketed |
| E4 | — | Standing loop with human sampling | not ticketed |
