# 2513: statecharts from the merge-gate and step-claim TLA+ models

Spike for #2513: render the `verify-merge-gate` and `verify-step-claim` TLA+ models as statecharts, check the charts against the skills' prose, and decide whether the verify skills should emit them as PR evidence.

Verdict: **go, scoped.** Emit a chart when a PR changes a model (re-render and commit the `.mmd`) or when `run.sh` reports a result that differs from `expected.txt` (draw the new counterexample). Do not attach a whole-graph chart to every run. Reasons are in [Go or no-go](#go-or-no-go).

## How the charts were generated

Tool: poteto's pstack `statechart` skill, canonical copy `cursor/plugins` at `pstack/skills/statechart`, commit `519d36aa98955bf680db01bcde5fdfba686dc901` (2026-10-27). `backnotprop/pstack` is a mirror of it. It runs TLC with `-dump dot`, lifts the state graph into an IR, groups model states through a hand-written view module (`state(vars)`, `step(action)`, `group(vars)`), and prints Mermaid `stateDiagram-v2` plus a report with the shortest path to each broken rule.

Safety: the 31 non-test files were fetched into a fresh `/tmp` directory and read before running. The runtime uses only Node built-ins (no npm install). Its only network path is `mise install` for Java and TLC, which it skips when `TLA2TOOLS` and `JAVA` are set. The runs used cairn's own `~/.cache/cairn/tla2tools-1.7.4.jar`, which has the same SHA-256 pin that pstack uses.

Inputs:

- Models are read in place from `.claude/skills/verify-*/model/`. Nothing in the models was changed.
- Each config is a scratch copy with `CHECK_DEADLOCK FALSE` appended. Both `run.sh` scripts pass `-deadlock`. pstack checks deadlock by default, and every terminal state of these models (a landed merge, for example) would otherwise count as a broken rule.
- The views are in [`assets/2513/views/`](assets/2513/views/). Their labels are written for an engineer who knows the code, so step labels name the code function (`tryClaim`, `mergeThroughGithub`), as in each skill's action-to-code table.

Command, per chart:

```sh
TLA2TOOLS=~/.cache/cairn/tla2tools-1.7.4.jar JAVA=<java 11+> \
  <pstack>/scripts/statechart <Model>.tla --config <scratch cfg> \
  --view docs/research/assets/2513/views/<view>.mjs --out <new dir>
```

pstack's chart budget is 500 TLC states (`CHART_STATES` in `ir.ts`). Above that it draws only bug paths, and it writes no chart at all when every rule holds. MergeGate (64,329 states) and StepClaim (2,909,723 states) are far above it. For the whole-graph charts the budget was raised in a scratch copy (one constant changed). Those files are marked "lifted budget" below.

| File | Model, config | Tool | TLC states → chart | Time |
|---|---|---|---|---|
| [`merge-gate.mmd`](assets/2513/merge-gate.mmd) | MergeGate, `P1_MergeBoundToJudgedPatch` | lifted budget | 64,329 → 8 states, 26 arrows | about 110 s |
| [`merge-gate-p4-bug.mmd`](assets/2513/merge-gate-p4-bug.mmd) | MergeGate, `P4_MergeRechecksDigest` | stock | 64,450 → bug path, 7 states | about 11 s |
| [`local-landing.mmd`](assets/2513/local-landing.mmd) | LocalLanding, `P3_LocalLandingBindsJudgedPatch` | stock | 47 → 13 states, 16 arrows | seconds |
| [`local-landing-p3a-bug.mmd`](assets/2513/local-landing-p3a-bug.mmd) | LocalLanding, `P3A_NoLandingRecheck` | stock | 62 → 16 states, 23 arrows, break marked | seconds |
| [`step-claim-one-machine.mmd`](assets/2513/step-claim-one-machine.mmd) | StepClaim, P1 config with `Machines = {m1}`, `MaxRebinds = 0` | lifted budget | 158,853 → 17 states, 39 arrows | about 130 s |
| [`step-claim-p5-bug.mmd`](assets/2513/step-claim-p5-bug.mmd) | StepClaim, `P5_ArchivedNeverClaimed__ClaimIgnoresArchive` | stock | bug path, 4 states | not timed |
| [`step-claim-p6-bug.mmd`](assets/2513/step-claim-p6-bug.mmd) | StepClaim, `P6_ArchivedStopSettles__ApplyIgnoresArchive` | stock | bug path, 4 states | about 60 s |

All counts are measured on this machine. Times are wall-clock from timestamps around each run; the LocalLanding runs were not timed precisely.

Every bug-path chart reproduces the counterexample recorded in `expected.txt` action for action: P4 `RecordVerdict×3, Evaluate, BaseMoveInteracting, ExecuteMergeGithub`; P3A `JudgeLocalPatch, LocalPatchChange, CreateCommit, DecideLocalMerge, LandLocal`; P5 `ArchiveCard, EnqueueAfterArchive, TryClaim`; P6 `TryClaim, FinishSession, ArchiveCard, FinishStepOwnedCheck`.

Not charted:

- `RepeatedVerdict.tla`: its `Next` is one `CASE`, so TLC names every step `RepeatedVerdictNext` and the chart is a four-state line with no information.
- `ReviewHeadCausality.tla`: it shares `Spec` with MergeGate, so its chart is `merge-gate.mmd`.
- The two-machine StepClaim graph: 2.9M states. Inferred from the 158k-state run, it would take about 40 minutes and a multi-GB dot dump, so it was not attempted.

## Readability

- **LocalLanding: readable.** 13 states and 16 arrows, under pstack's 20-arrow guideline. Each state reads as "what has happened, and what moved since the judgement". The P3A chart marks the "Landed an unjudged patch" state, so the negative control can be read at a glance.
- **MergeGate: readable, but coarse.** 8 states and 26 arrows. The two states that matter are "Merged on a judged patch" and "Gate ready, but the patch digest moved since". One reachable merge arrow, out of "Gate ready on the current patch", is P1 in one picture. The cost: several actions share one arrow ("a verdict is recorded or evidence-only push"), and the chart does not draw 90,114 steps that stay in one chart state, including every benign base move.
- **StepClaim one-machine: legible, at the edge.** 17 states and 39 arrows, about twice the guideline. Status × card state (open, closed or archived) is the right abstraction: P3 (no closed card reaches `Claimed` again), P5 and P7 (no "Claimed (task archived)" state without an archive stop) can be checked by eye. The network, crash and presence actions are all self-loops at this granularity and do not appear, so the chart shows the step lifecycle, not the concurrency the model exists to check.
- **Bug-path charts: always readable.** 3 to 7 states, and the same content as the counterexample in `expected.txt`, with readable state names.

Rendering, checked on GitHub's file view on this branch: every `.mmd` renders, including the group classes that have no `classDef`. The bug-path charts read at page width. `merge-gate.mmd` and `step-claim-one-machine.mmd` render as a dense web at page width, and their labels are legible only with the viewer's zoom. So the whole-graph charts work as review material for a model change, not as an at-a-glance picture in a PR body.

Across all models, the chart is only as good as the view, and the view is hand-written judgement. A model change that adds a variable or an action needs the view checked as well. Otherwise the new behavior collapses into an existing label.

## Check against the skills' prose

Each arrow was compared against the action-to-code table in its SKILL.md.

`verify-merge-gate`, MergeGate. Every arrow in `merge-gate.mmd` matches the table:

- A recorded verdict or any push clears a stored evaluation. Every arrow out of "Gate ready" on `RecordVerdict`, `PushCode` or `PushEvidence` leads to a "No evaluation" state.
- An interacting base move keeps the stored evaluation ("Gate ready" → "Gate ready, but the patch digest moved since"), matching "a stored gate status is not rewritten by a base move".
- `mergeThroughGithub` leaves only "Gate ready on the current patch".

LocalLanding: arrows match the table; the guards on `DecideLocalMerge` and `LandLocal` show up as the missing arrows out of drifted states.

`verify-step-claim`, StepClaim, one-machine scope:

- Archive stops pending and quota-waiting steps at once (`Pending` → `Stopped (task archived)`, `Waiting for quota` → `Stopped (task archived)`).
- A claimed step gets an archive stop that `fetchStop` acknowledges. Every result path out of an archive-stopped state goes to `Stopped`.
- Close sets a stop pending, and the next tick stops leftover pending or quota-waiting steps.
- A success report lands as `Done` even with a stop pending, which matches the F3 note "completion first".

Findings (none is a code bug; the first two are model coverage notes for follow-up):

1. **MergeGate: the gate can never be ready again after the default branch moves (TLC check, not a guess).** `ReadyAt` requires `b = "b1"`. Both base moves set `base = "b2"`, and no action returns it. `PushCode` requires `head = "h1" /\ dgst = "d1"`, so no "update the PR branch onto the new base" step exists either. An invariant probe `~(lastEval.ready /\ lastEval.b = "b2")`, checked on the P1 config in a scratch module, holds in all 64,329 states. Consequence: "a verdict on the old digest qualifies the new digest after an interacting base move" is never explored by P1 or P2. Both digest-binding controls (P1N, P2N) reach their violation through `PushCode` only. The digest binding against a base move is exercised only through P4's stale-evaluation path. The Bounds section says `b = "b1"` stands for the `pr-behind-base` family, but it does not say that re-verification after a base move is out of scope. Follow-up: add an action that updates the branch onto the new base, or state the bound in SKILL.md.
2. **LocalLanding: every drift after a judgement is a dead end.** In the P3 config, three non-landed chart states have no step out: "Commit built, judged (base moved)", "Decided to land (base moved)" and "Commit built, judged (patch changed, base moved)". A patch change after the judgement never leads to a landing. The model has no re-judge or rebuild, so `decideLocalMerge`'s `recheck` outcome ends the behavior. P3 is therefore checked only for first-attempt landings, and "re-judged, then landed" orderings are outside the bounds. This is sound for safety, but SKILL.md does not list it as a bound.
3. **StepClaim: a quota report on a closed card lands as `Waiting for quota (card closed)` and is stopped on the next tick.** This is intended: SKILL.md's `SchedulerTick` entry says the sweep first stops the leftover pending or quota-waiting steps of closed cards. It is recorded here because the chart makes the window visible.

No arrow contradicts the prose, and no transition is missing that the prose promises.

## Go or no-go

**Go, scoped to two triggers.**

Why not "every PR that touches a covered file carries a chart":

- The chart is a function of the model and the view, not of the product code. A PR that changes `builds.ts` without changing `MergeGate.tla` produces a byte-identical chart, so attaching it is decoration, not evidence.
- The whole-graph charts need a raised budget and cost about 110 s (MergeGate, against its 15 s check) and about 130 s (StepClaim, one machine only). The real StepClaim graph cannot be charted.

Why go at all:

- Bug-path charts come free with stock pstack. They match `expected.txt` exactly and are easier to read than a TLC trace with every variable listed.
- The whole-graph charts surfaced findings 1 and 2, which the TLC verdicts alone did not show. That is the review value of a chart when a model changes.

How the two skills would emit it (follow-up; this spike does not change the skills):

1. Pin the tool like the jar. `scripts/statechart.sh` in each skill fetches `cursor/plugins` `pstack/skills/statechart/scripts` at commit `519d36aa` into `~/.cache/cairn/pstack-statechart-519d36aa/`, verifies the git tree SHA, and refuses to run on a mismatch. It runs with `TLA2TOOLS="$JAR" JAVA="$JAVA"`, so mise and the network are never used. pstack has no budget option: either upstream a `STATECHART_BUDGET` environment override, or keep the one-line patch, applied by the fetch step and covered by the SHA check.
2. Add `model/charts.txt`, one line per chart: config, view module, output name. For `verify-merge-gate`: `P1_MergeBoundToJudgedPatch merge-gate`, `P3_LocalLandingBindsJudgedPatch local-landing`. For `verify-step-claim`: `C_OneMachine step-claim`. `C_OneMachine.cfg` is a chart-only config, `Machines = {m1}` and `MaxRebinds = 0`, never listed in `expected.txt`. Views move into `model/views/*.mjs`, and the charts into `model/charts/*.mmd`.
3. `statechart.sh` copies each config into `$TMPDIR` with `CHECK_DEADLOCK FALSE` appended, matching `run.sh`'s `-deadlock`, then runs the chart. With `--check` it exits 1 when a committed `.mmd` differs from a fresh render. The step 6 "update verification" procedure in both SKILL.md files gains one line: when the model or a view changes, re-render and commit the charts, and put the `.mmd` diff in the PR's Proof.
4. `run.sh` keeps stdout byte-deterministic. When a config's result differs from `expected.txt` (exit 1), it runs `statechart.sh` on that config without a budget change and writes the bug-path chart to `$TMPDIR/verify-*/<config>-chart/chart.mmd`. It prints that path on stderr, so the person reading the failure can paste the chart into the PR or the finding.
5. PR evidence: a PR that changes a model links the committed `.mmd` files. Their GitHub file view renders the Mermaid. A PR whose run differs from `expected.txt` puts the bug-path chart next to the `run.sh` output. Every other PR attaches only the TLC result, as today.

Open items for the follow-up:

- Decide whether to upstream the budget override to pstack or carry the patch.
- Write the bound notes for findings 1 and 2 into the two SKILL.md files, or extend the models.
