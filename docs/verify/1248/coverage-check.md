# #1248 ADR 0018 structure self-check record (2026-10-12)

## Four-section completeness check

| section | present |
|---|---|
| Problem Statement | yes (three orthogonal sub-problems: intra-ticket / inter-ticket / cross-machine) |
| reconnaissance facts | yes (F1-F11, all with sources) |
| Decision | yes (decision 0 roster + layers 1/2/3 + the coordination model) |
| Premortem | yes (three death causes + guardrails) |
| final section: the relationship with ADR 0017 | yes (orthogonal, no conflict; the source-selection judgment precedes the capability gate) |
| final section: the construction-ticket split | yes (#1250/#1251 + the placement note F11) |

## Coverage reconciliation tables

### #1248's three ticket deliverable boxes

| ticket deliverable | ADR location |
|---|---|
| docs/adr/0018-*.md entered (three layers + the coordination model + the relationship with 0017) | the full text + the `与 ADR 0017 的关系` section |
| spec 02's agent/machine sections gain the capability-gate semantics | spec 02 §4.2 last item + §5.4 last item (pointer-style notes, not copying the body — the canon discipline) |
| the construction-ticket split suggestion written into the ADR's final section | the `施工票拆分` section (#1250/#1251 + the #1249 occupancy note) |

### #1248's three ruled layers

| ruling | ADR location |
|---|---|
| layer 1 intra-ticket pipeline (four roles / four step kinds / the assignment extension / confirm+merge keep-a-human) | Decision 1 |
| layer 2 split_todo ticket-splitting + dependency edges + all-children-done auto-close + a human confirm | Decision 2 |
| layer 3 role concurrency + the #1241 machine-recommended concurrency across machines in parallel | Decision 3 |
| the coordination model (capability inventory reporting / requiredCapabilities / the capability gate / visible reason / skills single source / MCP reconciliation) | Decision 4 |

### The seven design inputs (the #1248 comment)

| input | ADR location |
|---|---|
| ① Skill=how / Persona=who / Command=when three-layer separation + the persona contract | Decision 0 |
| ② personas do not invoke other personas, single-layer orchestration | Decision 0's hard-law entry |
| ③ the meta-orchestrator anti-pattern + the chief criteria for value return | Decision 0's Chief row |
| ④ the fan-out three perspectives + the small-merge go/no-go | Decision 1's review fan-out entry |
| ⑤ the decision-matrix split criteria | Decision 2 |
| ⑥ the /build auto precedent supporting confirm keep-a-human | Decision 1's confirm entry |
| ⑦ mcpServers frontmatter silently ignored → MCP coordination belongs to the machine/daemon layer | Decision 4 item 6 |

### The roster ruling (session correction 2026-10-12)

| roster item | ADR location |
|---|---|
| the seven members (Chief + Planner + Implementer + CodeReviewer/SecurityAuditor/TestEngineer + Verifier), per-item duties + artifact | Decision 0's table |
| no WebPerf agent; it is a Verifier conditional skill hop | Decision 0 |
| the merge action keeps a human, not in the roster | Decision 0 |
| the Composition block requirement | Decision 0's opening paragraph |
| model tiers annotated per role (concrete values left to the #1250 seeding) | Decision 0's last entry |
| the TestEngineer / Verifier division of labor (reading the diff to criticize vs running the real system for evidence) | Decision 0's table, the Verifier row |

## Edge-case reconciliation

- No contradiction with ADR 0017: 0017's localPath accelerator-slot semantics do not move, and the relationship section states "the source-selection judgment precedes the capability gate; the two judgments do not rewrite each other" — a cross-read passes.
- #1241 is referenced, not redefined (Decision 3 states "its plan handoff artifact is the canon").
- The dependency-edge two-readings coexistence is entered faithfully (F8 + Decision 2); the carrier is left to #1250.
- The review meta header semantics do not move (Decision 1's carrier pin: the slot governs the default, the meta header governs the actual).
- A pure-docs ticket: zero .ts changes; spec 02 gains only two pointer notes.

## Verification

- `pnpm spec:parse` PASS (output stored in this directory as spec-parse-gate.txt, exit=0).
- This file + spec-parse-gate.txt = the docs/verify/1248/ evidence package.
