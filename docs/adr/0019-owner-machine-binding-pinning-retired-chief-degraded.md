# ADR 0019 · Owner-machine binding: pinning retired, chief demoted

> Status: **Decided** (2026-10-12, settled by #1259 + #1260). Supersedes ADR 0018 decision 4 (coordination model: agents not bound to machines + capability gate) and the chief special dispatch position in decision 0; the rest of 0018 (roster, within-ticket pipeline, ticket splitting, parallelism gates) stands. Construction tickets #1259 (worker binding + UI closure), #1260 (chief demotion).

## Problem Statement

ADR 0018 decision 4 was finalized the same day with "agents not bound to machines + capability declaration/capability gate", but the user overturned it at direction re-check: "I still want to align with multica — different machines, different orchestration", "stability is better", "learn it all the way". The grounds for the overturn are three structural problems of the pooled model:

1. **The model-mismatch hole**: the capability gate only verifies "which runtime a machine has installed", not "which model the machine's claude-code actually has configured" — an agent configured with model X has its step dispatched to a machine with claude-code installed but X not configured, and it only explodes at model resolution. Extending the gate to model granularity means recomputing "which machine can run this agent" over and over — better to just store it as a property.
2. **Pinning scattered across four sites**: the four pinning spots todo.machineId / build.pinnedMachineId / chiefThread.pinnedMachineId / schedule.machineId each act on their own; stacked with the capability gate, "which machine does this step actually go to" has no single-source answer, and pending/failure copy cannot name the reason.
3. **The chief is a special case**: chief floats outside the agent roster (affinity lock-holding, occupying no concurrency slot, no machine ownership); under a cross-machine topology "which machine does chief run on" has no answer; in Multica the leader is an ordinary agent bound to a runtime inside the squad roster (squad.leader_id → agent → agent_runtime).

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | Multica's binding model: agent.runtime_id → agent_runtime(daemon_id, provider); the leader briefing is injected at claim time | multica daemon.go:2708 |
| F2 | The four scattered pinning spots (todo/build/chiefThread/schedule) actually exist in the schema | apps/server/src/db/schema.ts |
| F3 | Machines self-report capabilities in a 30s heartbeat; claude-code includes the actually-configured model list (claudeCodeReport.models) — the input for binding verification is ready-made | routes-machine.ts heartbeat |
| F4 | dispatch-eligibility.ts is the single-source leaf shared by claim/sweep adjudication (sunk by #881) — the pinning point for owner-machine verification | apps/server/src/services/dispatch-eligibility.ts |
| F5 | The chief special-position mechanism surface: the chiefAffinityHeldByOther affinity lock, chief steps occupying no machine concurrency slot, the chiefThread.pinnedMachineId pinned machine slot | apps/server/src/services/machines.ts |
| F6 | No existing agent has a machine binding; real online data concentrates on the mea machine | user decision ("just move them all to mea first") |

## Decision

### 1 · Owner-machine single source

`agent.machineId` = the single answer to which machine the agent's steps go (vocabulary: owner machine). Creating an agent requires choosing an owner machine; worker steps are claimed only by the owner machine (the claim loop skips when `agentRow.machineId !== machineId`); chief steps go to the chief's owner machine. All four card-level pinning spots (todo.machineId / build.pinnedMachineId / chiefThread.pinnedMachineId / schedule.machineId) retire — "where I want it to run" converges from each card's own scattered spot into one property of the agent.

### 2 · Verification single source homeMachineRejectReason

One verification shared by the three entry points — creation / re-binding / whole-machine evacuation — lives in dispatch-eligibility.ts: the target machine has that runtime enabled + (claude-code family) the model is in the machine's self-reported model list; the pi tier is exempt from model checks (pi is server-side configuration, machine-independent). Verification failure = 400 on creation / 400 on re-binding / staying on the original machine on evacuation, with copy naming what is missing.

### 3 · Existing-data migration: backfill mea directly, no banner

Migration 0036 backfills all existing agents onto the mea machine (the machine in the same team whose name is LIKE 'mea%'), and 0037 deletes the four pinning columns. The user ruled: "no top banner needed, just move them all to mea first" — the migration-notice banner form is rejected.

### 4 · Machine lifecycle exits

- **Deletion protection**: DELETE on a machine with bound agents → 409 naming the occupying list.
- **Whole-machine evacuation** (vocabulary: whole-machine evacuation): POST /api/machines/:id/evacuate migrates the bound agents one by one through decision 2's verification onto the target machine; those that cannot pass stay on the original machine, with the response listing each reason — partial evacuation is a normal exit.
- **UI closure**: the /app/resources/machines/:id detail page (fact rows + a grid of agents owned by this machine + a creation slot with the machine preselected + evacuation/deletion exits); the grid reuses the card grid of /app/team (user ruling: "the content of this route can be reused exactly: /app/team"); machine names in the machines list rows link to the detail page; agent cards carry an owner-machine row.

### 5 · Chief demoted to an ordinary agent (#1260)

The chief is demoted from a special case of the dispatch layer to an ordinary agent bound to an owner machine in the roster: the affinity lock (chiefAffinityHeldByOther), the no-concurrency-slot exemption, and the thread pinning machine slot all retire; chief steps share the same gate and queue as ordinary steps on the same machine. The roster semantics of 0018 decision 0 (1 orchestrator + 6 personas) stand — what moves is the mechanism surface: the chief's machine ownership changes from "no answer" to "its owner machine (the primary machine)".

## Premortem (assuming this ruling is wrong: the three most likely failure modes)

1. **Owner machine offline = every agent of that machine stalls** — binding amplifies "machine down = partial loss" into "that machine's whole roster stops"; if the chief's owner machine dies, orchestration stops → guardrail (**the current rule after the 2026-10-13 merge of the #1257 suspension semantics**; see "Collision and closure with #1257" below): steps suspend instead of being pronounced dead, the board surface shows a waitingOn "waiting for machine" chip, and work auto-resumes when the machine returns; re-binding and whole-machine evacuation are first-class operations (decision 4), and the chief can be re-bound the same way.
2. **Model drift on the target machine after re-binding/evacuation** (uninstalling a model, changing configuration) → steps wedge at the owner machine unable to get the runtime, more visible than in the pooled era → guardrail (same current rule): the gate blocks in the form of a suspension + chip, the machine's model list self-reports through the 30s heartbeat (F3), verification reads the latest snapshot, and installing it unlocks automatically.
3. **Concurrency hotspots**: good machines get fully bound while others sit idle — binding gives up the pooled model's spillover elasticity → this is a deliberate trade-off ("stability is better"); guardrail: the machine-level maxConcurrent queues steps instead of mis-dispatching them, and step-queue's waitingFor surfaces "which machine it waits for" on the UI; a human sees the hotspot and disperses it with whole-machine evacuation.

## Relationship to ADR 0018

The pooled direction of 0018 decision 4 (steps go to "any capable machine") is voided; the capability dimension has landed via #1251 (`requiredCapabilities` × machine capability-list self-report + the machine-fit read surface + queue blocked causes) and is **orthogonally kept** under the binding model: the owner machine decides "which machine it must be", the capability gate decides "whether that machine can" — the two gates chain in series on the claim surface (owner machine first, capability second). The "model-list self-report" in capability reporting (F3) is simultaneously the input for owner-machine verification. Decision 0's roster, decision 1's within-ticket pipeline, decision 2's splitting, and decision 3's parallelism gates all stand. The orthogonality of 0018 to 0017 (source selection before dispatch) simplifies under the binding model: the machine is uniquely determined by the owner machine, and the source-selection check (githubRepo vs localPath, 0017) proceeds as usual within that machine.

## Construction-ticket split

| Ticket | Scope | Status |
|---|---|---|
| **#1259** server,shared,web | agent.machineId + backfilling existing agents to mea + dispatch only to the owner machine + pinning retirement + re-binding/deletion protection/whole-machine evacuation + creation three-level cascade + machine detail page | constructed in the same round as this ADR |
| **#1260** server,web | Chief demoted to an ordinary agent: affinity lock / no-slot exemption / thread pinning retire; chief steps go to the chief's owner machine | constructed in the same round as this ADR |

**Acceptance gate**: the two tickets' PRs do not merge to main; first verify with real tasks on a branch deployment (create an agent, dispatch a step, re-bind, whole-machine evacuate, deletion protection, each walked through once), evidence lands in docs/verify/<ticket>/, and merging is discussed only after the user nods — user ruling: "after the PR is done, do not merge to main first; verify with real tasks".

## Collision and closure with #1257 (user ruling 2026-10-13)

On the day this ADR was finalized (2026-10-12), #1257 ("an unclaimed step is an infra event: the step suspends waiting for the machine and auto-resumes on return; it does not enter failed" — the user's original words: "why would a timeout just discard it? that's not nice at all") merged to main; the same evening, #1259's "offline grace funnel kept (PIN_OFFLINE_GRACE_MS 10 minutes → board-visible failure)" directly conflicted with it. The user ruled: **the #1257 suspension semantics win** — a pending step never fails, visibility = the board waitingOn chip (todos.ts waitingOnOf switches from pinning to reading the agent's owner machine), and the exits are re-binding / whole-machine evacuation (no longer failure-copy naming). The grace-failure copy family (the PIN_OFFLINE_GRACE_MS / homeOfflineReason / homeRuntimeBlockedReason / homeWedgeReason / noHomeReason / CHIEF_UNBOUND_REASON family + the chief five-branch sweep failAbandonedChiefSteps) retires with it; the sweep only kills claimed steps "proven sick" (zero heartbeat progress → release and re-claim). Premortem failure modes 1 and 2's guardrail wording is to be read per the current rule in this section.
