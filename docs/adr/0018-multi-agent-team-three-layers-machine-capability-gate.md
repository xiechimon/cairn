# ADR 0018 · Multi-agent team: three layers + machine capability gate coordination model

> Status: **Decided** (2026-10-12, settled by #1248). Discussion ticket #1248; preceding ADR 0017 (dual execution sources). Design input: addyosmani/agent-skills reference-repo reconnaissance (seven points in the #1248 comment, see decision 1). Construction tickets #1250 (layer-1 pipeline), #1251 (capability reporting + capability gate); both start after this ADR merges.
>
> Amendment: "merge action stays with humans" was amended by ADR 0021 (2026-10-20) to "merge action belongs per project policy, defaulting to humans" — when `mergePolicy = human`, this document and #1256 remain in effect as written. The body is unchanged.

## Problem Statement

pacman's status quo is one agent plus one runtime running a whole ticket: the `assignment` two-slot `{plan, build}` only distinguishes the planning and executing phases, and the two slots can point to the same agent — the user explicitly does not want this shape, and asks for a multi-agent combination that splits tasks "like a team in a company" (role names in English), while also asking about agent ownership and skill/MCP coordination between two machines (local vs mea): which machine does an agent belong to? How are each side's skills and MCPs reconciled?

The problem splits into three orthogonal sub-questions:

1. **Within a ticket**: who performs each stage — plan/build/review/verify — of one ticket? (single agent does everything → role pipeline)
2. **Across tickets**: how does a large ticket split into sub-cards advancing in parallel? (the status quo where chief dispatches single cards → ticket splitting + dependency edges)
3. **Across machines**: with agents not bound to machines, how do we ensure a dispatched step only lands on a machine that "has everything it needs installed"? (the gap where mcpServers is declared but nobody verifies)

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | `stepKindSchema` currently has five values: plan/build/merge/chief/review — the review step was established by M7 #312; agentId travels via the prompt meta header, not through an assignment slot; the verify step does not exist | `packages/shared/src/records/step.ts` |
| F2 | `assignment` is the two-slot `{plan, build}` (`assignmentSchema`); extending it to four step kinds is a pure increment | `packages/shared/src/records/todo.ts` |
| F3 | The agent-level concurrency gate #1138 exists (`agentRunningCount`); machine concurrency #1108 exists (maxConcurrent 1..16, hot-written via PATCH); the four-paragraph machine-recommended-concurrency plan of #1241 is fixed (write point computes the recommended value + `maxConcurrentOverridden`; the formula lands in dispatch-eligibility.ts) | dispatch-eligibility.ts / memory #1241 plan four paragraphs |
| F4 | `dispatch-eligibility.ts` is the single-source leaf shared by claim/sweep adjudication (sunk by #881) — the pinning point for the capability gate | `apps/server/src/services/dispatch-eligibility.ts` |
| F5 | skills are delivered per step from a single server skillsDir source (`/api/machine/skills/:stepId`) — machine-independence already holds | routes-machine.ts |
| F6 | `agent.mcpServers` is declared on the agent record, but whether the executing machine actually has it installed is **verified by no one** — the gap the coordination model must close | records/agent.ts |
| F7 | The presence heartbeat is in routes-machine.ts; the 02 §5.4 heartbeat red line: field-level parse failures must not block the heartbeat (the #1241 plan already cites this discipline) | routes-machine.ts / 02 §5.4 |
| F8 | Dependency edges: the #1248 ticket claims "the board already has a blocking-edge model", but no blockedBy/dependency column is seen in code (neither schema.ts nor todo.ts) — the two accounts coexist; whether the implementation carrier is the existing model or a new one is left for #1250 to verify during construction | ticket vs code grep |
| F9 | Multica precedent: agents bound to runtimes (machines) + capability gate at save time (requireWorktreeCapableDaemon, project_resource.go:151-204) + an offline/missing-capability reason-code family (dispatch/reason.go) | #1248 ticket reconnaissance |
| F10 | Reference repo addyosmani/agent-skills (105k stars, SDLC skill pack), seven design inputs (see decision 1) | #1248 comment |
| F11 | Construction-ticket placement: the ticket pre-wrote "#1249 layer 1, #1250 capability gate" — #1249 was already taken by an open PR (ci(1240) pr-tasks-gate), so the actual new tickets are #1250 (layer-1 pipeline) + #1251 (capability gate) | measured via gh issue view 2026-10-12 |

## Decision

### 0 · Roster finalized (1 orchestrator + 6 personas, 7 in total)

Role names all in English (user-specified). Each persona's description is written per the persona contract: role / scope / output format / rules + a **Composition block** (through which step-kind entry, forbidden from being invoked by other personas) — this is where design input ① lands: Skill=how (server single-source skills) / Persona=who (role agents) / Command=when (step kinds + chief dispatch), three layers separated.

| Role | Entry | Responsibility | Output artifact |
|---|---|---|---|
| **Chief** (orchestrator) | chief step | `split_todo` splitting / dispatch / gate notifications / small-merge of the three review reports into go/no-go / merge-verdict advice. **No construction, no relay hops** (meta-orchestrator anti-pattern — chief's added value = splitting + gates + merge verdict, not pure routing) | dispatch decisions, split plans, go/no-go |
| **Planner** | plan step | read the ticket + produce the four-section plan.md from the repo, no code touched | plan doc (plan.md) |
| **Implementer** | build step | thin vertical-slice TDD per plan, committing per item, opening a six-section-body PR | branch + PR |
| **CodeReviewer** | review step (one of the fan-out three perspectives, parallel, reports only, no code changes) | five-axis review + severity labels | review report |
| **SecurityAuditor** | review step (one of the fan-out three perspectives) | OWASP-style audit; joins when the diff touches server/auth/crypto | security audit report |
| **TestEngineer** | review step (one of the fan-out three perspectives) | coverage gaps + Prove-It | missing-test list |
| **Verifier** | verify step (new) | run docs/verify/<ticket>/ e2e + pr-evidence-gate + CI reconciliation, output evidence pack + pass/fail; the division of labor with TestEngineer = critiquing the diff vs taking evidence from the real system, different artifacts so separate roles | evidence pack + pass/fail |

- **No WebPerf agent** — it is a conditional skill hop of the Verifier (runs when the diff touches apps/web), not a persona.
- **The merge action stays with humans** (the coordinator), not in the roster.
- **Hard rule: personas do not invoke other personas** (design input ②) — chief is the only orchestrator; role agents structurally have no dispatch tools (no run_builds-class tool surface attached), single-layer orchestration.
- Model tiers are annotated per role (Chief/Planner high tier, Implementer upper-middle, the review family middle, Verifier middle — the concrete tier values are set by #1250's seeding against the model list at that time; this ADR only fixes the structure "annotated per role").

### 1 · Layer 1: within-ticket pipeline

Step kind → role binding: plan→Planner / build→Implementer / review→Reviewer family (fan-out three perspectives, see below) / **new verify→Verifier**. `assignment` extends from two slots to four step-kind slots.

- **confirm/merge gates stay with humans**: the `/build auto` precedent (design input ⑥ — plan approved once, per-task TDD, stop on failure) is the same shape as pacman's existing confirm gate; the only human step stays at confirm, and the rest of the pipeline is fully automatic.
- **review fan-out three perspectives** (design input ④): CodeReviewer/SecurityAuditor/TestEngineer run in parallel over the PR diff, reports only, no code changes; a **small-merge step** (chief holding the full context) produces go/no-go. Parallel independent perspectives on the same artifact + small merge is the only sanctioned fan-out form.
- **review slot carrying** (how the F1 design point pins): the review step's existing agentId-via-prompt-meta-header semantics (set by M7 #312, not going through the assignment slot) are **unchanged**; the review slot added by the assignment extension is the default binding position (used by the UI assignment surface), while the fan-out three perspectives are still derived via meta headers (one fan-out = three review steps, each carrying its perspective agentId in the meta header) — slots govern "who reviews by default", meta headers govern "who actually runs this step", the two layers are orthogonal. The verify step goes through the assignment slot (same shape as plan/build). The four-slot extension must not break meta-header semantics.

### 2 · Layer 2: across-ticket splitting

chief gains a `split_todo` tool: split a large ticket into N sub-cards + dependency edges (F8: the ticket claims the board already has a blocking-edge model while no corresponding column is seen in code — the implementation carrier is left for #1250 to verify during construction, booked per the board blocking-edge criterion); each sub-card binds role agents; **the parent auto-closes when all children are done**. The split plan enters the confirm gate for human review (the over-splitting defense is in Premortem 3).

**The splitting criterion = a decision matrix** (design input ⑤): single-perspective single-artifact = direct call; genuinely independent subtasks = parallel fan-out; ordered dependencies = sequential dependency edges.

### 3 · Layer 3: parallelism

Role agents each have `maxConcurrentTasks` (the #1138 agent-level gate) + #1241 machine-recommended concurrency (the machine-level gate); the two layers stack and cross-machine parallelism follows naturally: multiple sub-cards of the same persona distribute across machines, and each machine is additionally capped by maxConcurrent. The #1241 formula and write-point plan defer to its plan handoff document; this ADR only cites, not redefines.

### 4 · Coordination model (agents vs machines/skills/MCP, answering the user's questions)

**Agents are not bound to machines** (keeping cross-machine elasticity — this is a deliberate fork from Multica's "agent bound to runtime" precedent: pacman's agent is a team-level record, the execution slot is decided by the dispatch gate). The ruling = **capability declaration + dispatch gate**:

1. **The daemon reports its capability list at registration/heartbeat**: installed MCP server name set, skills versions, model binaries and tiers. Field-level parse failures must not block the heartbeat (the F7 red line extends to capability fields — capability reporting is an enhancement signal; one broken field must not kill the heartbeat channel).
2. **The agent record gains `requiredCapabilities`**: declaring what the agent's steps need (MCP server names, runtime/model tiers, etc.).
3. **dispatch-eligibility gains the capability gate** (the F4 single-source leaf, the pinning point specified by the ticket): machines whose capability list does not satisfy `requiredCapabilities` do not claim that agent's steps. The gate only reads the server-side received report snapshots (Premortem 2 guardrail).
4. **pending comes with a visible reason** (borrowing the semantics of the Multica dispatch/reason.go family): missing capability = a fix is given (the reason copy names what is missing; installing it unlocks); machine offline = wait (the reason distinguishes "waiting for a machine to come online" from "missing capability X, install it" — the two pending causes are no longer a silently indefinite pending).
5. **skills stay server single-source**, delivered per step (F5 already holds, untouched).
6. **MCP is reconciled via capability reporting**: the agent surface shows "which machines can run it" = requiredCapabilities × each machine's reported list intersection. Platform-fact corroboration (design input ⑦): plugin agents' mcpServers frontmatter is silently ignored — MCP coordination must happen at the machine/daemon layer and cannot be written into the agent definition surface.

## Premortem (assuming this ruling is wrong: the three most likely failure modes)

1. **Context loss when merging the three fan-out review reports** — the three reports each excerpt different faces of the diff, and a merger holding only summaries loses cross-perspective connections (e.g. a security finding actually stemming from a test gap) → guardrail: the small-merge step (chief) holds the full context (three reports + diff) and produces go/no-go; it is not a plain vote; chief's merge verdict is a named capability in the roster.
2. **Capability-list reporting drift** — a machine has something installed but unreported (old daemon version), or reports something uninstalled (the list lingers after uninstall), and the capability gate admits/kills per the wrong list → guardrail: heartbeat field-level fault tolerance (a broken field does not block the heartbeat) + the gate reads only server-side received snapshots (no path other than the machine's own report is trusted); when a real install goes unreported and causes a wrongful kill, the visible reason names "missing X", and the human fix closes the loop.
3. **Splitting granularity runs away** — chief splits tickets too fine (one file-level change per sub-card), the confirm human-review gate drowns in N sub-cards, and coordination overhead eats the parallelism gains → guardrail: the split plan enters the confirm human review (a human can reject the whole split tree) + the decision-matrix criterion (single-perspective single-artifact = direct call, no split); "parent auto-closes when all children are done" guarantees the close-out cannot be missed.

## Relationship to ADR 0017

0017 ruled dual execution sources: githubRepo is permanently the truth source, and localPath is a same-machine execution accelerator slot (the machine-side source selection uses a two-condition check). 0018 is orthogonal and non-conflicting: **0017 answers "where does the repo come from"; 0018 answers "who does the work, and on which machine"**. Source selection runs before the capability gate — the machine first decides between the local accelerator slot and a GitHub clone (0017's remote/HEAD reconciliation), then checks whether it can claim the step (0018's capability gate); if a localPath-matching machine lacks the capability, the step still pends for another capability-complete machine (taking the GitHub-clone source), and the two checks do not rewrite each other. 0017's disposability ownership (truth and disposability belong to githubRepo only) is unaffected by the capability gate.

## Construction-ticket split

| Ticket | Scope | Dependencies |
|---|---|---|
| **#1250** server,shared,web | Layer-1 pipeline: four step kinds (including the new verify step) + four-slot assignment + persona seeding (7 members' descriptions per the Composition contract) + chief split_todo (including the dependency-edge carrier verification, F8) | waits for this ADR to merge |
| **#1251** daemon,server | Capability reporting (daemon heartbeat extension) + requiredCapabilities + dispatch-eligibility capability gate + visible pending reason | waits for this ADR to merge; pins the same dispatch-eligibility.ts as #1241 recommended concurrency, construction order aligned |

**Placement note (F11)**: the construction numbers pre-written on the #1248 ticket were "#1249 layer 1, #1250 capability gate"; since #1249 was already taken by an open PR (ci(1240) pr-tasks-gate), the actual new numbers are **#1250 (layer 1) / #1251 (capability gate)**. Future readers who cannot find tickets under the old numbers on the ticket should defer to this table.
