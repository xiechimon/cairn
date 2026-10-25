# ADR 0024 · Splits that pass the checker start without the confirm gate: project-level splitPolicy

> Status: **Decided** (2026-10-24, ian set the principle "one chief, all code goes through gates"). Ticket #1623. Amends ADR 0018 layer 2.
>
> ADR 0018 body unchanged: with `splitPolicy = human` (the default), ADR 0018 layer 2 "split plans stop at the parent card's confirm gate for human review" remains in effect. This ADR only changes behavior under the `shadow` and `auto` tiers.

## Problem Statement

ADR 0018 layer 2 requires that after chief's `split_todo` splits a large ticket, every split plan stops at the parent card's confirm gate waiting for human confirmation. The guard against over-splitting also sits on this gate (ADR 0018 Premortem 3: a human can reject the whole split tree).

The result is that even small, clear splits need a human click. That runs against spec 28's direction ("humans move from step-by-step approval to after-the-fact sampling"), and against the principle ian set on 2026-10-24: one chief does the orchestration; anything code can decide goes to a code gate, not to humans confirming card by card.

The problem splits into three sub-questions:

1. Which splits can start without a human, and who provides the criteria?
2. What takes over the "split too fine" guard that used to sit on human review?
3. How to ship without changing the current default, leaving an observation period?

## Decision

### 1 · Layer 2 becomes "only splits the checker flags go to human confirm review"

After `split_todo` persists the child cards, a pure-code split checker judges the split plan. The checker calls no model; its input is the `split_todo` child-card array plus a snapshot of the team's agents and the machines they belong to. Any failed check falls back to human review, with the reason recorded:

- Dependency edges: `blockedBy` indices are all within 1..N, none self-references, and the whole graph is acyclic;
- Agents: each child card's `agentId` exists and is in an available state, and its home machine is online; the home machine has the runtime that agent needs enabled and satisfies `requiredCapabilities` (reuses ADR 0018 decision 4 and ADR 0020's machine-capability gate; the criteria have a single source in `dispatch-eligibility`);
- Child-card count does not exceed the project cap (default 6);
- Child-card specs do not name an ADR 0021 D4 protected-category path. The check reuses D4's protected-category matching, with a conservative direction: a hit or an unclear verdict (the path contains characters outside the safe set) both fall back to human review.

When the checker passes fully, whether to start depends on the project's `splitPolicy` (see decision 3).

### 2 · The over-splitting guard moves to the child-card count cap

The death cause in ADR 0018 Premortem 3 (chief splits too fine and coordination overhead eats the parallelism gain) was previously covered by the human review gate. Under `auto` that gate is no longer mandatory, so the guard moves to the checker's child-card cap: plans over the cap fall back to human review, where a human decides whether to reject or allow. ADR 0018's split criteria (decision matrix: single-view single-artifact direct call, don't split) and "the parent auto-completes when all children are done" are unchanged.

### 3 · Project-level `splitPolicy = human | shadow | auto`, default `human`

- `human` (default): the auto-start branch does not run; splits still stop at the parent card's confirm gate, behavior identical to ADR 0018 layer 2;
- `shadow`: the checker still evaluates and only records "would this start if auto"; the split still stops at the confirm gate. Used to observe whether the checker's verdicts are trustworthy before shipping;
- `auto`: when the checker passes fully it counts as confirmation: the parent card enters building, and unblocked child cards dispatch; blocked child cards follow the existing wave progression and start automatically once their predecessors are done. A failed checker falls back to human review, stopping at the confirm gate.

The default stays `human`; existing and new projects behave unchanged until explicitly switched.

### 4 · Team-level `autonomyPaused` overrides

When the team-level kill switch `team.autonomyPaused` is true, the `auto` tier also falls back to human review, with the reason "team autonomy paused". The kill switch overrides project policy, same direction as ADR 0021's autonomy-merge kill switch: a human can pull the whole team back to human review at any time.

### 5 · Parent-card transcript records the result

Every split writes one checker-result line to the parent card's session for after-the-fact sampling:

- `checker result: auto-started` (`auto` and fully passed);
- `checker result: would auto-start (shadow)` (`shadow` and fully passed);
- `checker result: fell back to human review + <reason>` (checker failed, team kill switch, or policy is `human`).

## Premortem (assume this decision is wrong; the most likely death causes)

1. **The checker lets through a split it shouldn't**: a child-card spec uses natural language to describe a CI or migration change without naming the path, so the D4 check cannot match it. Guard: observe in the `shadow` tier first; the D4 autonomy-merge gate re-judges against the real diff at merge time — a split being cleared does not mean the merge is cleared.
2. **Stale machine snapshot**: the machine was online at check time but drops offline after dispatch. Guard: child-card steps still go through the claim gate; on disconnect the step stays pending with a visible reason (ADR 0018 decision 4.4); the checker's clearance never skips the dispatch gate.
3. **The cap is wrong**: the default 6 is too tight or too loose for some projects. Guard: exceeding the cap only falls back to human review, never rejects the split; the cap is per-project, and the first implementation uses the default 6 for all projects, with a per-project setting added when adjustment is needed.

## Relation to other ADRs

- **ADR 0018**: this ADR amends its layer 2 and the ownership of Premortem 3's guard; the roster, layer 1, layer 3, and the coordination model are unchanged.
- **ADR 0020**: the checker's capability judgment reuses its machine-capability gate; no new criteria are created.
- **ADR 0021**: the checker reuses D4's protected-category check; changing an ADR is a D4 protected category, so this ADR's PR is left for a human to merge.
