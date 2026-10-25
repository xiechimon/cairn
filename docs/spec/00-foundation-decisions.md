# 00 · Foundation decisions (execution engine / craft tier / UI foundation / pin discipline)

> Wayfinder ticket: xiechimon/pacman #39 (`wayfinder:grilling`, decision 2026-09-19).
> Upstream evidence: `docs/research/r4-foundation.md` (product of #38's research, measured 2026-09-19; cited in this volume as `r4 §…`); pi details cite `docs/research/r9-pi-sdk.md` (cited as `r9 §…`).
> Positioning: this volume locks down, in one pass, the **foundation choices** the replication implementation depends on — which libraries to bring in, in what form, which replacement seams to leave, and the pin discipline. Implementers make no further foundation decisions beyond this volume. Item-by-item tech-stack locking (runtime/framework/storage/build…) is in `01-stack-v2.md` (ticket #43); this volume fixes only its foundation boundaries.
> Type notation: inherited (carries over conclusions of the old 01-stack) / locked (newly decided by this ticket) / handed off (this ticket fixes only the boundary; the detailed plan belongs to another ticket) / fallback (an escape path with trigger conditions).

## 0. Summary of conclusions

| # | Decision | One-liner |
|---|---|---|
| D1 | Execution engine | **Single pi-SDK engine**, with an `AgentBackend`-shaped pluggable seam at the host layer (no pre-commitment to a second engine) |
| D2 | craft tier | **Design reference only, zero vendoring**; vendoring demoted to a per-package escape hatch (with triggers) |
| D3 | pi route layer | **AgentSession stable surface as the primary**; harness on the watch list |
| D4 | MCP | **Self-built thin bridge** (`@modelcontextprotocol/sdk`), maintained by pacman itself |
| D5 | UI-layer foundation | **React from scratch** (headless primitives + self-built tokens); craft UI as interaction reference only |
| D6 | pin discipline | **Continues 01-stack §3**: exact patch-pin + explicit upgrade windows that read the Breaking section |
| D7 | Fully self-built role | **Fallback/comparison only**, with trigger clauses; if enabled, the form is per-component patches, not a wholesale rewrite |

---

## D1 · Execution engine: single pi engine + pluggable-engine seam

**Locked.** The replication's execution engine (agent loop, provider transport, session persistence, compaction, retries) takes the **single pi-SDK engine**; the Claude Agent SDK is not introduced as a parallel engine.

**Reasoning (constraint-driven).**
1. #34 Notes locks "keep OAuth connections to own ChatGPT / Codex / Copilot / XAI subscriptions". pi natively covers all four subscription suites in `ai/src/auth/oauth/` (r4 §S2.1: `anthropic.ts` / `openai-codex.ts` / `github-copilot.ts` / `xai.ts` + pkce / device-code). The Claude Agent SDK's **model surface is Claude-family only** (r4 §S3.1, §S3.3.1), which directly fails this locked item — it can only serve as a second-engine backup, never as the sole engine.
2. pi is the only foundation among the four routes that is "fully open-capability, exactly pinnable, auditable, vendorable", with zero hard gaps and no fork needed (r4 §S0.2).
3. The Claude Agent SDK locks the deepest: the body is a **closed-source signed binary** of 217–234 MB per platform, All rights reserved + Commercial ToS + session-data-collection clauses, versions chasing Claude Code daily, behavior not independently pinnable (r4 §S3.2). The native surfaces it offers for the todos.dev-same-type scenario (git worktree, per-agent memory, the `SessionStore` contract, r4 §S3.1) **do not constitute a reason to introduce it**:
   - Worktree parallelism and per-agent memory are **host/executor orchestration-layer responsibilities** in todos.dev (r4 §S5 "shared items across routes"); #37 measured the executor protocol surface (`tds/conv-*`, checkpoint, 7-day reclamation), and pacman implementing the same protocol on its own executor needs no third-party closed-source binary.
   - `SessionStore`-class pluggable persistence: on the pi side it is achieved through the harness's `SessionRepo` contract or host-built (r4 §S2.2, r9 §S3.1/S8 D1).

**Pluggable-engine seam (borrows craft's shape without its cost).** craft paid ≈ 22.8k lines of adapter layer — `claude-agent.ts + pi-agent.ts + base-agent.ts + backend/ + pi-agent-server` — for "dual SDKs mounted on the same product event surface" (r4 §S1.2). pacman **borrows only the `AgentBackend` abstract-interface shape** (provider-agnostic event surface + capabilities-driven UI), placing it between the host orchestration layer and the execution engine — a second engine in the future is a bolt-on, not a rewrite. This ticket **does not pre-commit the Claude SDK as the slot** (its closed-source + ToS was already rejected per §S3.2); the seam stays engine-agnostic. The concrete interface signatures of the seam belong to `01-stack-v2.md` (#43) / the architecture volume (#41).

> **[Inferred] annotation**: r4 §S1.5's ending "what is same-type is the product concept layer, not the process-topology layer" and §S3.2's ending "N parallel sessions = N ~220MB-binary Node child processes" are qualitative inferences without a porting PoC. D1's worktree-host-built conclusion does not depend on these quantifications, only on the #37 fact that "worktree is an orchestration-layer responsibility".

## D2 · craft-agents-oss tier: design reference only, zero vendoring

**Locked.** craft's role in this map = **first-hand evidence of a same-type architecture** (r4 §S1.5 high-same-type rows: Chief-DAG / board state flow / scheduled automations / projects / skills / MCP sources / credential keys / remote machines / multi-LLD model-service connections). **No craft package is vendored, and its private npm artifacts are not built.** Established fact: `@craft-agent/*` npm registry 404 (r4 §S1.3); "consume it as a library" does not hold for craft.

**Block-by-block adjudication.**
- **Task-DAG (`task.yaml` schema + generator prompt + `TaskRunner`/Conductor)**: most same-type with Chief (r4 §S1.5, §S1.6.3), but #34 already locks Chief behavior = **black-box approximation** (mark [inferred] where no source evidence exists). todos.dev's Chief split/confirm flow is written separately per #37/#41 observations; craft's DAG serves as **shape reference** only (`NODE_KINDS` 14 node kinds, `depends_on` parameter passing, acceptance_criteria scoring loop) — not vendored, schema not copied.
- **`pi-agent-server` (6.4k lines, craft's pi-out-of-process JSONL bridge)**: closely read per r9 §S7; pacman uses pi's stable surface directly (D3), not vendored.
- **`auth/chatgpt-oauth.ts` (261-line PKCE)**: covered by pi's native OAuth under the single engine (§S2.1); redundant, not taken.
- **UI components (`packages/ui` + Electron renderer)**: see D5, reference only.
- **`AgentBackend` abstraction (§S1.2)**: shape borrowed (D1), code not vendored.

**Vendor escape hatch (with triggers, see §Trigger clauses T1).** If a discrete craft piece (most likely: the task-DAG shape, `mcp-pool.ts`) is proven at #41/#43 landing time to cost "more to re-implement than Apache-2.0 vendoring + divergence debt", it may be re-adjudicated to vendor on a per-package basis within an upgrade window. Apache-2.0 permits it (obligations: keep LICENSE/NOTICE, mark modifications, and pass through the Claude Agent SDK ToS notice in its NOTICE, r4 §S1.3); the four hard trademark boundaries ("Craft"/"Craft Agents" wordmarks + logo/icon, requiring renaming, new logo, and new bundle ID, r4 §S1.4) do not conflict for pacman (product name and assets are redone per todos.dev anyway, belongs to #44). The default tier remains zero vendoring.

## D3 · pi route layer: AgentSession stable surface as primary

**Locked.** pacman consumes pi through the **AgentSession stable surface** (r4 §S2.1, §S2.4.1): the workarounds for its eight "has-a-seam" items have already been product-validated by craft, and the checklist is ready-made (r4 §S2.2 = craft's §S7 answers: sandbox fencing goes through the official `BashOperations`/`BashSpawnHook` seams; per-turn systemPrompt goes through the `before_agent_start` inline extension; tool_call orphans go through the public `transformContext`; compaction races are serialized by the host's `waitForCompaction`; etc.).

**harness on the watch list.** pi harness (just promoted at 0.85.0, consumed as experimental) provides durable same-shape artifacts (transactional operation state, `replay:"safe"`, suspend/interrupt materialization, the `SessionRepo` contract, r4 §S2.1/S2.2/S3.2 ending). But the **cross-session / background / durable orchestration todos.dev wants is not ready-made on either pi route** (r4 §S2.3: multi-session concurrent orchestration, cron, and memory all live at the author layer) ⇒ durable semantics are self-held by pacman's host orchestration layer, not outsourced to the harness. **Therefore the harness's single-session durability adds no score in this map**, while carrying experimental risk. Re-evaluate per §Trigger clause T2 once harness is promoted.

## D4 · MCP: self-built thin bridge, maintained by pacman

**Locked.** MCP integration goes through a **self-built thin bridge**: use the official `@modelcontextprotocol/sdk` on the pacman side for defineTool mapping, maintained by pacman itself, **not relying on the community `pi-mcp-adapter`**.

**Reasoning.** pi core has zero MCP (r4 §S2.3, §S5). todos.dev's MCP is a **two-way parity surface** — serving as a server for Claude Code/Codex to connect, and as a client consuming external MCPs (team server per-Agent authorization, `/api/mcp` remote, key-level tool allowlists reading 11 writing 13), measured by #37 (`docs/research/r3-protocol-executor.md`). This block cannot ride on a third-party adapter's update cadence; the bridge itself is thin (tool-contract mapping, semantic inventory fixed at r3 §S3), controllable and pinnable. Inherits 01-stack's "MCP external to pacman" positioning (r4 §S2.4.3): this ticket only fixes ownership = self-built; the bridge's interface details belong to the #41 architecture volume / #43 stack volume.

## D5 · UI-layer foundation: React from scratch, craft UI as interaction reference only

**Locked.** The frontend is **implemented from scratch**: React + headless primitives (Radix-class) + self-built design tokens, targeting the #36 screen-level checklist and the todos.dev design tokens captured by #35. **craft UI code is not vendored**; craft UI (Electron renderer + React/Radix/cmdk) is demoted to a **component-granularity / interaction-pattern reference**.

**Reasoning.** The acceptance criterion is "pixel-level 1:1 match against **todos.dev**" (#34 Notes); the target visual has nothing to do with Craft's own appearance (r4 §S1.6.2, §S5 rework surfaces). craft UI is deeply coupled with its Electron main-process IPC; vendoring buys divergence debt + form rework, and buys no pixel points. **Desktop-compatibility constraint honored**: building a web-native React frontend from scratch lets a macOS desktop shell (Electron/Tauri-class, the follow-up intention left by #34 Notes) wrap the same web frontend and share one codebase with the PWA, without overturning the web architecture — satisfying the desktop-shell premise #41 must guarantee. Item-by-item locking of component library / style system / state and data layers is in #43 (this ticket only fixes the foundation boundary "from scratch + craft reference only", to avoid turf contention with #43).

## D6 · pin and replacement-seam discipline: continues 01-stack §3

**Inherited.** All dependencies are **exactly patch-pinned**; upgrades go through **explicit windows** (each window reads the upstream Breaking section before deciding); interface replacement seams follow the 01-stack §3 methodology.

**Pin surface (narrowed after D1's single engine).** The execution-engine layer = `@earendil-works/pi-ai` / `@earendil-works/pi-coding-agent` / `@earendil-works/pi-agent-core`, initially pinned at **0.85.1** (r4 §S2 version check: npm registry latest measured 2026-09-19, consistent with r9's pin, r9's line-number conclusions valid; `legacy-node20=0.74.2` not used); **the first upgrade window #107 is already honored: 0.85.1 → 0.86.0** (all three 0.86.0 Breaking entries land outside the AgentBackend seam; the live pin value = the execution-engine row of 01 §4.3). pi's weekly minor releases carry Breaking sections of their own (harness promotion / legacy repo API removal / `ModelsStreamTransforms` rename); budget upgrade windows per r9 §S6. **No Claude-SDK version-chasing burden** (not introduced). The per-item pin table for the remaining dependencies (framework/storage/UI components) is in the #43 stack volume.

**Discipline live sample (cautionary).** craft pins the Claude SDK at `0.3.258`, surviving 19+ versions behind "lagging but alive" (r4 §S3.2 ending, §S5) — a ready-made contrast of the cost and payoff of patch-pinning for behavior control, recorded here to corroborate the discipline's direction, not to suggest pacman adopt the same.

## D7 · Fully self-built role: fallback/comparison, with triggers

**Demoted.** The fully self-built engine layer is demoted from #39's parallel option to **fallback/comparison**; it is not on the default route.

**Reasoning.** Choosing any library route still cannot avoid self-writing todos.dev's Chief/board/orchestration/executor/hosted-repo (r4 §S4.2 "decision invariants"); the **increment of going fully self-built is exactly rewriting from zero the free gains of r9's "use pi"** — the ~40-provider wire-quirk table + the OAuth six-piece suite + the session tree/compaction/retry vocabulary + the event surface (r4 §S4.2), with manpower anchors: nanobot 629 py files / 4,443 commits / 2–3 core developers / 7.5 months, craft src TS ≈ 338k lines / 8 months (r4 §S4.2, §S1.1) — a net cost under the single-person + AI-agents route (#34 Notes), with no external evidence that it buys back any todos.dev parity point.

**Trigger clauses (see §Trigger clauses T3).** Enabled only when a fallback trigger fires, and the enabled form is **per-component self-built patches / forking only the gap pieces**, not a wholesale rewrite.

---

## Trigger clause summary (escape hatches, with decidable conditions)

| ID | Trigger condition | Action | Owning window |
|---|---|---|---|
| **T1** | Re-implementing a discrete craft piece costs more than vendoring + divergence debt | That package's "reference only" → "vendor" re-adjudicated per package | At #41/#43 landing; goes through a D6 upgrade window |
| **T2** | pi harness is promoted **and** the AgentSession seam is time-box-verified to still not support host durable orchestration | Re-evaluate D3; consider switching/adding the harness route | At the durable-orchestration implementation stage; the time box is set by #45 ROADMAP |
| **T3** | pi hits a hard gap, no host-layer workaround within a pin window, blocking one of #34's locked items (subscription OAuth / pixel or feature parity items) | Enable D7: per-component patches / fork only the gap pieces, not a wholesale rewrite | Can fire at any time; record into the ticket |

Any trigger firing ⇒ write back to this volume + the corresponding ticket comment; the foundation is not changed unilaterally.

## Impact on downstream tickets

- **#41 architecture parity**: D1's "worktree/orchestration = host-layer responsibility" → executor worktree protocol, multi-session orchestration, cron, and memory are all designed in #41; pi does not do them (r4 §S2.3, §S5). D5 honors the premise "a desktop shell does not overturn the web architecture".
- **#43 tech-stack locking v2**: D1/D4/D5/D6 give the foundation boundaries; #43 locks runtime/framework/storage/build/lint item by item on top, producing `01-stack-v2.md`. D6's pin discipline is expanded by #43 into a per-item pin table. **#43's blocked-by #39 is lifted** (blocked-by #41 remains open).
- **#44 release and asset replacement**: D2's trademark boundary (craft TRADEMARK does not conflict for pacman) + assets are redone per todos.dev anyway; the DMCA/attribution line belongs to #44.
- **#45 ROADMAP**: T2's time box and the cadence of upgrade windows are assembled by #45.

## Explicitly undecided / handed off by this ticket

- Orchestration sequencing and state machines, executor protocol details, the BYOK key-security model → **#41**.
- Concrete framework / component-library / style-system / state-layer / storage / build selections item by item → **#43**.
- Domain terminology and concept boundaries (Goal/Todo/Stage/Chief/Agent…) → **#40**.
- Whether the four-language i18n is carried over verbatim (recorded as undecided fog in #34 Notes) → not ruled by this ticket (belongs to the stack/assets layer; awaits #43/#44).
