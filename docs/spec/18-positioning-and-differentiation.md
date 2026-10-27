# 18 · Positioning and Differentiation (2026-10-02 #520 ruling finalized)

> **Remaining-volumes reconciliation seal (2026-10-08, #1013 / #991 Q13)**: the #908 migration leftover "which remaining volumes to mark superseded" reconciliation closes here — this volume has **no surface voided by the UI shape chain (ADR 0009 motion-value surface → ADR 0010 site-wide overhaul → ADR 0012 official-form alignment)**: the positioning source of truth is independent of the shape chain (ADR 0012 D6 explicitly preserves ADR 0008's positioning two axes and the self-use-first criterion); §4's "todos.dev baseline re-photography and pixel parity" not-doing caliber is consistent with volume 06 D1's parity-obligation release. The original text remains wholly canon.

> Canonical status: this volume = the pacman positioning source of truth (thesis / criterion / two axes / what not to do / honesty list),
> revising volume 06 D1's positioning narrative (**revision does not replace** — D1's other components stay valid).
> Ruling chain: #515 criterion and two axes → #516 adversarial ruling (thesis final draft) → #520 carrier six items (user 2026-10-02 agree).
> Argument and trade-offs go to `docs/adr/0008`: **the ADR records why, this volume records what**, mutually referencing.

## 0. Overview

| # | Item | Ruling |
|---|---|---|
| P1 | Thesis | in an open-source self-hostable world, only pacman is doing todos's semantic core (the full sentence verbatim sees §1) |
| P2 | Criterion | self-use first |
| P3 | Semantic axis | aligned with todos's three core points: two hard gates / AI review with teeth / versioned plan documents |
| P4 | Runtime axis | aligned with the Multica runtime model: runtime = one computer × one CLI tool |
| P5 | Not aligned | Multica's three philosophical tenets: no hard gates / status-first / daemon not a sandbox boundary |
| P6 | Chief | the gates' established consumer (withdrawn from the differentiation pillar), survival ruled by real closed-loop measurement |
| P7 | Shape | one chief; the entry chosen by the user; output that is code passes the gates; whether to open a PR is only how the code lands (§3.5) |

## 1. Thesis (#516 ruling final draft, verbatim)

> **In an open-source self-hostable world, todos's semantic core (two hard gates + AI review with teeth + versioned plan documents) is being done only by pacman — Multica has the source but not this semantics, todos has this semantics but not the source.** The resident orchestrator (Chief) exists as the gates' established consumer, its survival ruled by real closed-loop measurement.

In-volume terms (do not enter `CONTEXT.md` — that only manages product-domain entities):

- **Hard gate**: a fixed human-must-be-present stopping point, two in total — Confirm (before any code is touched, review the plan) and Review (before release, review the diff). Gates are part of the phase machine (the server-side edge table enforces the transition), not status labels.
- **AI review with teeth**: the reviewer's blocking verdict directly drives the `review→planning` auto-reflow (#330 loop) — it can block a merge, not just leave a comment.
- **Versioned plan documents**: Plan / Changes class documents, comparable version by version, the object "looked at" on the gate.
- **Semantic axis / runtime axis**: the semantic axis = how a task flows (gates, review, documents, state machine); the runtime axis = where a task runs (runtime, daemon, self-hosted deployment).
- **Self-use first**: sees §2.

**Maintenance trigger**: this thesis's scarcity has a clock — the source-available camp (Multica etc.) adding gates, or todos going open-source/self-hosted, expires the thesis the same day. On trigger, rewrite this section and README's Why thesis sentence (README is the de-pointed short version, low maintenance cost on expiry), leaving no hung thesis.

## 2. Criterion: Self-Use First

Every trade-off first asks "do I really use it myself", then "is it differentiating" (#515, 2026-09-30 ruled). In a single-person self-use scenario market validation weighs little — 51k stars proves "no-gate has a market", not evidence that "gates have no value".

Supporting discipline (#515 hard constraint): **reference implementation first, do not fabricate out of nothing** — any new mechanism first researches down to a running real implementation (Multica's open-source repo, todos official docs, Craft Agents, pi SDK), and if none found, mark `[inferred]` and degrade. Landing on the two axes: the semantic axis's mechanisms do not take Multica as reference (it has none); the runtime axis's mechanisms are not self-invented (it has an open-source implementation to read).

## 3. Two Axes

### 3.1 Semantic axis: aligned with todos's three core points

| Core piece | pacman landing spot | Comparison |
|---|---|---|
| two hard gates | Confirm / Review two phases; transitions only through the server-side edge table (`apps/server/src/services/phase.ts:17` `PHASE_TRANSITIONS`, REST / MCP / chief tool write surfaces all through `assertPhaseTransition`), the agent has zero state-self-writing channel | Multica: issue status explicitly written by the agent through the CLI, `in_review` is a status not a gate; todos: the two gates are the phases themselves |
| AI review with teeth | blocking verdict → `review→planning` auto-reflow (#330); review material = plan + change diff + read-only checkout, the same computation path a human looks at (#511 fixed the material link break) | todos: built-in AI review but explicitly states the reviewer has no veto ("The review does not decide anything"); Multica: no built-in (the official tutorial self-builds @Reviewer, the conclusion is just a normal comment) |
| versioned plan documents | the plan cards into the confirm gate, "review the plan before passing" has something to look at and compare version by version | Multica: no counterpart (plan goes through issue description and comments) |

### 3.2 Runtime axis: aligned with the Multica runtime model

runtime = one computer × one CLI tool; board + agent as handler + daemon as runtime + self-hosted single data root. Multi-machine execution, runtime detection, liveness judgment, task-level identity read from Multica's open-source implementation (r10 full explanation, r11 gap inventory), not self-invented.

### 3.3 Not aligned with Multica's philosophy (three tenets)

no hard gates / status-first / daemon not a sandbox boundary ("Treat every run as unsandboxed"). Choosing them equals deleting one's own differentiation, becoming "a weaker Multica".

### 3.4 Chief: the gates' established consumer

Chief withdraws from the differentiation pillar (#516 ruling, 2026-10-01; the earlier #515 two-axes wording includes Chief, #521 still writes "differentiation four pieces", this item wins over both, corrected in the same batch). It exists as the two hard gates' **established consumer** — who watches the gates for you, dispatches work, collects results; **survival ruled by real closed-loop measurement**. In a single-person self-use scenario the user is the orchestrator themselves, Multica's "human assignment + squad leader routing" covers the same need; Chief cannot self-wake, the actual shape is a delegation panel + watchdog. The criterion is same-sourced with §5 honesty-list item 2: count the withPlan distribution and Chief's actual usage rate in the real closed-loop measurement.

### 3.5 Shape principle: one chief, code must pass the gates (2026-10-24 user ruling)

Origin: after comparing EverMind Raven (the chief draws a task-dependency graph in memory, self-checks and runs directly, upstream output handed directly to downstream, chat entry), the user asked "should local users who need no PR switch to the Raven shape — with a board use the board, without a board use Raven". Ruling: do not switch shape by "board or not", split the shape into three mutually unrelated choices:

| Choice | Decided by | Values |
|---|---|---|
| entry and viewing surface | user | board; IM / command line (future, see §4 C class). All share the same Chief and the same gates; the board is the task graph's display surface, not a shape switch |
| output type | Chief judges per task | `code`: passes the two hard gates, AI review, verification; `info` (research, report, eval output): does not touch the repo, results handed directly to the downstream card (#1626) |
| code landing mode | project shape | `githubRepo`: opens a PR, merges per ADR 0021; `localPath`: no PR, the same judgment merges locally (#1625) |

Constraints:

- Output that is code passes the gates, independent of entry and whether a PR is opened. "No board means no gate" equals removing §1's three core pieces for a subset of users, becoming a weaker Raven, not adopted.
- The gate is a phase-machine stopping point; the passer can be a human or a deterministic checker per project policy (ADR 0021's merge-readiness gate, #1623's decomposition checker); the default is always a human, same caliber as ADR 0021 D1.
- Same-kind comparison (2026-10-24): Vibe Kanban, Conductor's local worktree shapes all ultimately land through PRs, Raven's coding specialist has no repo-level merge gate. "Local repo, no PR, gate before merge" has no existing implementation.

Construction tickets: #1623 (decomposition checker passes → auto-run) → #1625 (local-shape auto-merge) → #1626 (info-class fast lane); #1624 (sub-card injection pre-delivery summary) parallel with #1623. The IM entry and external-agent onboarding wait on the #1607 research conclusion.

## 4. What Not to Do (#515 Out of scope fixed)

- The paid three-piece set (built-in models gateway / cloud sandbox / subscription billing) — volume 02 exclusions, inherited.
- The Squad object — Chief's subset, and explicitly "does not raise concurrency, does not merge agents"; only copy its wake-rule table, do not introduce the object.
- Chief autonomous dispatch — first want "shutdown without breaking the chain", not "still deciding on its own when shut down".
- Gantt view / multiple workspaces / third-party Git (Forgejo / Gitea / GitLab) — meaningless for self-use, killed outright.
- Directly chasing Multica's integration-surface breadth (IM five, desktop app, iOS) — recorded as "possible future C class".
- todos.dev baseline re-photography and pixel parity — volume 06 D1 released the parity obligation.

(Multica's three philosophical tenets see §3.3, not entering this section.)

## 5. Honesty List

#516 five items (the parts the thesis cannot falsify):

1. **"Better" depends on unattended being real** — the gates' value proposition (queue up and leave, come back to check only two points) and the runtime axis (an always-on machine running at night) are each other's premise; when the real closed-loop measurement fails and a human stays present watching the run, the gates are just verbosity.
2. **withPlan already measured — bypass dominates (2026-10-05 #892 measured)** — direct-execute skipping confirm is a built-in ability (`withPlan=false`), board drag can also bypass the funnel; measured (local 28 builds / 17 done cards): direct-execute 39% (chief dispatch 8/8 all direct), the confirm gate entered 13 times only 3 confirmed, the review main door passed only 1, 15/17 done cards landed through manual board phase changes (both gates skipped), versioned plan documents 0 rows. The "rubber stamp" did not appear (the only 4 human gate dwells were all substantive), but "bypass" holds — the degraded shape is really "two gates + a side door everyone walks", not "one gate + a ritual". Data and improvement-ticket suggestions: `docs/research/892-gate-usage-measurement.md`.
3. **The runtime surface is currently in debt** — #518 inventoried 25 gaps (no runtime object / no capability advertisement / no liveness judgment / no task-level identity), of which 6 block #519. The differentiation thesis currently holds only on the semantic surface.
4. **single-person repo vs a live project** — Multica v0.6.0 (2026-09-28) is live; the security-fix and protocol-follow long-run risk cannot be refuted, only absorbed through self-use first.
5. **Chief** — in a single-person self-use scenario the user is the orchestrator themselves; per the 2026-10-01 ruling it withdraws from the pillar, demoted to "the gates' established consumer", survival awaits real closed-loop measurement.

#519 real closed-loop measurement debt (measured 2026-10-02, all three cleared after the fix tickets merged 2026-10-03; update this section as each fix ticket clears):

- **AI review five consecutive failures** (B-C9 `streamBodyTimeout` 540s step-level hard cap / B-C13 review-verdict extraction broken by a trailing tool call) — during measurement the review gate was substituted by human PR-diff review. Cleared: B-C9 (#711 body-arm event reset + timeout copy naming the real culprit), B-C13 (#713 verdict extraction skips pure tool-call messages from tail to head).
- **In-product merge path locked** (B-C17 failed-phase deadlock, merge API 409) — during measurement the merge action was manually executed via the gh CLI. Cleared: B-C17 (#716 failed→review conditional edge + merge / re-run-review-only two exits sharing the recovery gate).
- **Confirm-gate plan document empty** (B-C10) — during measurement confirm was a real point but with nothing to look at on the gate. Cleared: B-C10 / B-C11 / B-C14 (#719 product gate: a plan step with no plan row does not enter confirm, a build step with zero change does not enter review).

## 6. Sources

- #515 (Map: pacman self-positioning) — criterion / two axes / Out of scope ruling.
- #516 (Decision: why pacman exists — adversarial argument) — thesis final draft + three evidence items + honesty list five items.
- #519 (Task: control-surface migration + real closed-loop measurement) — the breakpoint list and the delivery comment.
- the user knowledge-base page "todos.dev vs Multica comparison" (both sides' official docs 33 pages + 41 pages full close read, 2026-09-30; the r10 / r11 fact base).
- `docs/research/r10-multica-runtime.md`, `docs/research/r11-runtime-gap.md` (the runtime model full explanation + capability-gap inventory, PR #524 / #526).
- `docs/adr/0008` (the two-axes trade-off argument: the strongest rebuttal + reconnaissance facts + Premortem).