# ADR 0008 · Positioning trade-off on two axes — semantics aligned with todos, runtime aligned with Multica, philosophy deliberately not

> Status: **Decided and in effect** (2026-10-02).
> Source: adversarial-argument verdict of #516 (strongest-rebuttal stress test) + the #520 carrier decision. This ADR records "why it was decided this way";
> the canonical record of "what was decided" (the claim sentence / criteria / non-goals / honesty list) is `docs/spec/18-positioning-and-differentiation.md`; the two cross-reference each other.

## Problem Statement

The strongest rebuttal (verbatim from #516):

> Multica is open source (Go, ★51,737), fully self-hostable, 5 IMs, 25 CLI runtimes, Squad / Autopilot / Gantt / custom statuses — **and it is alive and maintained**. pacman shares the same skeleton with it; why not just use it?

pacman and Multica share the same skeleton (board + agent as assignee + daemon as runtime + self-hosted single data root), and Multica is bigger, active, and open-source. If the differentiation argument cannot stand, the correct move is contributing to Multica instead of maintaining pacman. This ADR records: why the rebuttal was rejected, what the two-axis trade-off is, and how this decision might die.

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | Full close-reading comparison of both official docs (todos 33 pages + Multica 41 pages + 117 changelog entries, 2026-09-30): nine shared skeleton items, but todos' semantic core (two hard gates / built-in AI review / versioned plan docs) is entirely absent on the Multica side — no resident orchestrator, no hard gates (`in_review` is a status, not a gate; the real gate is the PR), no built-in AI review (the tutorial tells you to build your own @Reviewer) | user's knowledge-base page "todos.dev vs Multica comparison" |
| F2 | pacman's todo phase can only flow along the server-side edge table: `apps/server/src/services/phase.ts:17` `PHASE_TRANSITIONS`; every write surface of REST / MCP / chief tools goes through `assertPhaseTransition`; agents have zero channels to write state themselves. Multica states the opposite — issue status is written explicitly by the agent itself via the CLI, and "the server does **not** flip status at the start or end of a run" | in-repo source + Multica official docs |
| F3 | Three states of review veto power: todos has a built-in AI review but explicitly says it has no veto ("The review does not decide anything. Confirming the plan and completing the todo are still your clicks."); Multica has none built in (its verdict is just an ordinary comment); pacman's blocking verdict directly drives the `review→planning` automatic flow-back (#330), and the review material travels the same compute path a human sees (#511 fixed the broken link) | each party's official docs + in-repo #330 / #511 |
| F4 | #519 real-closed-loop measurement (2026-10-02): the closed loop itself works (#561 → PR #606 → squash merge → ticket auto-closes), but three debts — AI review lost five times in a row (B-C9 / B-C13), the in-product merge path locked (B-C17), the confirmation-gate plan doc empty (B-C10); the runtime surface additionally has 25 gaps mapped by #518 (no runtime object / no capability advertisement / no liveness judgment / no task-level identity). The differentiation claim currently holds only on the semantic surface | #519 delivery comment + r11 |
| F5 | Multica is a living open-source project (v0.6.0 @2026-09-28, ★51,737, custom license, complete Docker/Helm self-hosting paths); todos is a closed-source SaaS (the self-hosted server gets a single incidental mention in the public docs, with no deployment guide) | knowledge-base comparison page + `gh api repos/multica-ai/multica` (2026-09-30) |

## Decision

Why the rebuttal was rejected (the #516 verdict): the rebuttal's biggest **borrowed assumption** is "open source = the semantics you want can grow on top of it". The skeleton is only a shell; the two gates, the versioned docs, and the state-machine funnel are the spine — transplanting the spine into Multica means rewriting its state machine against its publicly declared philosophy (status-first / "Treat every run as unsandboxed"), which is also a rewrite, just placed in a repo you control the least and whose direction follows 51k stars and a custom license. The star count proves "no gates has a market"; it is not evidence that "gates have no value"; for a solo, self-use-first builder, market validation has low weight to begin with.

| ID | Decision |
|---|---|
| **D1** | **Semantics axis aligned with todos**: two hard gates + AI review with teeth + versioned plan docs = pacman's only differentiation. Mechanisms on the semantics axis do not take Multica as a reference (it has none) |
| **D2** | **Runtime axis aligned with Multica**: runtime = one computer × one CLI tool; board + agent as assignee + daemon as runtime + self-hosted single data root. Mechanisms on the runtime axis are not reinvented (there is an open-source implementation to read) |
| **D3** | **Three Multica philosophy items deliberately not aligned**: no hard gates, status-first, daemon not as sandbox boundary — choosing them equals deleting our own differentiation and becoming "a weaker Multica" |
| **D4** | **Chief demoted**: withdrawn from the differentiation pillars, demoted to "an established consumer of the gates"; its keep-or-kill is ruled by the real-closed-loop measurement (#516 verdict 2026-10-01; #515's two-axis formulation predating it includes Chief, and #521 writes "four differentiation items" — both are superseded by this entry, corrected in the same batch) |
| **D5** | The criterion denominator = **self-use first**: ask "do I myself really use this" before "is it differentiation"; the companion discipline = prefer reference implementations, invent nothing from thin air (if none is found, mark `[inferred]` and downgrade) |

The division of labor in one sentence: **this ADR records the why; [volume 18](../spec/18-positioning-and-differentiation.md) records the what** (claim sentence verbatim, criteria, non-goals, and the honesty list live in the volume).

## Premortem (assuming it failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Scarce-claim expiry goes unnoticed**: a competitor adds gates / todos moves toward open-source self-hosting, and the claim expires the same day with nobody updating it | volume 18's maintenance-trigger clause (a trigger means rewriting the claim sentence); the README Why uses short de-named sentences (low maintenance cost on expiry); the named-comparison version lives only in volume 18 and this ADR |
| **Semantic-surface fixes stop leading**: energy drifts to general polish and pacman slides into "a weaker Multica" | #521 re-prioritizes the backlog by the three differentiation items; volume 18's honesty list updates with each measurement, pinning the "debts" next to the claim |
| **Honesty list falls out of maintenance**: the claim becomes marketing copy, and the five-loss streak / 25 gaps get no follow-up | the list lives on the same page as the claim (volume 18 §5); wherever the claim is cited, the debts are attached; each #519 broken-point fix ticket updates the entry as it is closed |
