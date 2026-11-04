# R12 · Agent behavior after "Save and start": direct execution vs orchestrate-first — comparison and recommendation

> Ticket: Multica XMON-98 (parent ticket XMON-92; hotkey-related ticket XMON-91 → implementation sub-ticket XMON-95).
> Nature: decision material, not implementation. Read-only research, no code changes, no PR.
> Code baseline: `origin/main` = `4647eaf` (pulled 2026-10-02). Local HEAD = `52ceac3`, one commit behind; `4647eaf` (XMON-117) only touches `agent-detail-page.tsx` / `profile-card.*` / `account-page.tsx` / e2e, none of the files in this document's chain, **so all P-side line numbers hold for both commits**.
> Decision baseline: XMON-98's comment section already contains the user's rulings of 2026-10-01 — decision points 2–6 are ruled (soft-gate direct dispatch / Chief as orchestrator / orchestration-step self-judged threshold + dialog switch / sub-tasks withPlan:false / fallback defaults), decision point 7 the user handles themselves; **decision point 1 (keep or drop the parent card) is not closed** — §5.2 of this document gives both positions plus new facts.
> Upstream research: `r10-multica-runtime.md` (Multica runtime layer), `r11-runtime-gap.md` (runtime gap, baseline `c95ee5f`), `r5-chief-behavior.md` (Chief behavior), `herdr-multica-parity.md` (orchestrator comparison, content secondhand).
> History: the first version of this document, produced 2026-10-01, was corrupted (output stream interrupted, body garbled); this version is a full rewrite, with all code references re-verified on `4647eaf` (details in §6).

## 0. Reading conventions

Three kinds of sources, marked per item:

- **P** (pacman code) = `path:line`, all verified line by line on `4647eaf` / `52ceac3` (2026-10-02).
- **M-first** (Multica first-hand) = the ticket body and comment text in this workspace, re-pulled via the multica read-only CLI on 2026-10-02.
- **M-cited** (Multica cited) = multica-platform skill docs (`references/squads.md` / `issues.md`), cited from XMON-98 comment 1 (captured 2026-10-01), not independently verified in this document.
- External-product items carry source links and verification status; unverified citations are marked `[cited]`, unsupported judgments `[inference]`.

Definitions of the two routes (verbatim from the ticket):

- **A direct execution**: after clicking "Save and start", the agent starts working directly on what the user described.
- **B orchestrate-first**: first run an orchestration round in the background — deciding which tasks to create and what each task is — and then execute (the Multica way: leader reads the issue → splits into child issues → dispatches → members execute → acceptance review).

## 1. Current chain (P side)

### 1.1 The button and the eight-hop chain

**Button**: `apps/web/src/overlay/new-task-dialog.tsx:381-392` — the label is at :391 (`t('保存并开始')`), the only disable gate is :385 (`spec.trim() === ''`, non-empty body), onClick :386-389 calls `onSaveAndStart(spec, selected?.id)`. Wired only on the live surface (`apps/web/src/overlay/use-new-task-surface.ts:300`); i18n `apps/web/src/i18n/en.ts:409` ('Save and start'); e2e anchor `apps/web/e2e/newtask-single-field.spec.ts:36`. It does not submit a form — it is two chained mutations.

**Hotkey status**: on `origin/main`, "Save and start" has **no** ⌘↵; the only related hotkey is `C` opening the new-task dialog (`apps/web/src/overlays/hotkeys.ts:82-87`). The ⌘↵ implementation lives in commit `eb88476` (`web(XMON-95): 保存并开始 支持 ⌘↵`) and exists **only on the unmerged branch `agent/pacman/994dc12e8830`**, not on origin/main. Ticket relations: XMON-91 = the user's original hotkey ticket (in_progress), XMON-95 = the implementation sub-ticket (done, code on a branch awaiting merge).

**The eight hops from click to agent start**:

1. **Frontend mutation ① create card**: `createAndStart` (`use-new-task-surface.ts:144-187`) → `POST /api/projects/:id/todos` (`apps/web/src/api/hooks.ts:574-584`), body `{title:'', spec}` — title is always the empty string; the server derives a placeholder title from the first line of spec (`apps/server/src/services/todos.ts:200-201`), and the agent backfills it later via `set_task_meta`. With no project, a default project is created first (`use-new-task-surface.ts:129-134, 171-175`).
2. **Frontend mutation ② start build**: onSuccess immediately `POST /api/projects/:id/builds` (`hooks.ts:624-637`), body = `{todoIds:[new card], assignment:{plan,build same value = firstAgentId}, withPlan:true}` — **withPlan is hardcoded true at this entry point** (`use-new-task-surface.ts:165`); firstAgentId = the team's first agent member (`use-new-task-surface.ts:101-104`).
3. **Server creates the card**: `routes.ts:1040-1053` → `todos.ts:145-244`: insert todo (phase `'todo'`), emit SSE; GitHub-backed projects additionally fire-and-forget a mirror issue (`todos.ts:242`) — an external mirror, not an extra card.
4. **Server starts the build**: `routes.ts:1055-1071` → `startBuilds` (`apps/server/src/services/builds.ts:340-392`): phase assertion → insert build row (buildId ≡ conversationId, UUIDv7, :361; withPlan persisted :368; `triggerSource:'user'` :347,:352) → **enqueue the first step `withPlan ? 'plan' : 'build'` (:381, the fork point of this route)** → `setTodoPhase('queued')` (:382-386) → publishBuild SSE (:389).
5. **Step queue + wake**: `enqueueStep` (`builds.ts:271-307`) inserts a pending step, `machineHub.wake(teamId)` (:295). Verbatim from the comment: "step queue held by the server, claimed by machines" (`builds.ts:4-6`).
6. **Daemon claim**: long-poll `POST /api/machine/tasks/claim` (`apps/daemon/src/machine-loop.ts:348-372` → `apps/server/src/routes-machine.ts:226-233` → `machines.ts tryClaim :784-935`): FIFO + pinnedMachineId; **chief steps and worker steps share one queue** (`machines.ts:623-631`); `agentForStep` (:633-656) takes the agent by assignment slot (plan step → plan slot, build/merge → build slot); claim payload = `todo{title,spec} + project{repo} + agent{model,...} + session{action}` (:884-932).
7. **Execution**: `apps/daemon/src/runner.ts:214-829` `runStep` — first-turn prompt = `title\n\nspec` (`buildTaskPrompt` :92-96, :236-242); workspace = a session-level git worktree (:298-323); engine = **an in-process pi session** (`apps/daemon/src/backend/pi.ts:530`), not a spawned `claude` CLI; the plan step uploads the workspace `plan.md` at wrap-up (:776-790; `PLAN_FILE_NAME` defined at `packages/shared/src/records/plan.ts:10`); done → `completeStep`.
8. **Phase funnel + visibility**: `completeStep` (`builds.ts:614-713`): plan complete → **`confirm` (a hard gate waiting for a human)** (:627-647); build complete → `review` (:649-653); blocking findings from review → auto re-planning (:655-708); merge → `done` (:710-713). User-visible surfaces: SSE team stream (`routes.ts:401-425`; frontend global `apps/web/src/api/provider.tsx:88`) + conversation stream (`routes.ts:639`; `todo-detail-page.tsx:297`) + REST steps/plans/changes/usage; UI = the board phase column + detail-page transcript/plan panels.

**New tasks/cards created between the click and the agent starting: zero.** Exactly 1 todo + 1 build + 1 step; Chief is not involved (`triggerSource:'user'`).

### 1.2 The answer on the current state: neither pure A nor pure B

**Current state = a third state: "single task plans first + hard confirm gate + execution afterwards".**

- Difference from A: it does not write code right after the click — `withPlan:true` is hardcoded, the first step is always a planning step whose artifact is plan.md (four sections: Context / Changes / Edge cases / Verification, versioned + diff view), and then the phase stops at `confirm` **waiting for a human**; only after approval is the execution step enqueued (`builds.ts:477-481`), and rejection means re-planning with feedback (:542-553).
- Difference from B: there is no task-decomposition layer, no child cards, no multi-agent dispatch. The product of "think first" is **one document**, not **a set of tasks**.
- In one sentence: **a weak subset of B — there is planning, but no orchestration.**

### 1.3 Three supplementary facts to consider in the design

1. **Two entry points of the same product disagree semantically**: the card-level "start task" dialog is two-branch — primary button `立即执行` (withPlan:false), secondary button `先做规划` (withPlan:true), and plan/execution can be assigned to different agents (`apps/web/src/detail/overlays.tsx:243-250, 322, 329`; consumers `board-page.tsx:377-392`, `todo-detail-page.tsx:446-455`); the new-task dialog's "Save and start" instead hardcodes true with no switch (`use-new-task-surface.ts:165`).
2. **The Chief channel = a ready-made B-style orchestrator, but "Save and start" bypasses it**: one Chief per user×team, a turn = a machine step (kind `'chief'`) + pi session (`apps/server/src/services/chief.ts:1-13`); the 49-word tool table includes `create_todo` (`chief-tools.ts:357-372`, with `createdBy`/`sourceBuildId` traceability), `run_builds` (:604-651, `triggerSource:'chief'`, **withPlan:false direct execution by default**, auto-watch on dispatch), confirm/cancel/merge_builds, ask_user/notify_user, set_wake/clear_wake; watch/wake react automatically to gate/settle/failed (`chief.ts:429-456` `triggerChiefWakes`, `wakeFacts` :461-476, scheduled `fireDueChiefWakes` :512+); the entry point = the ⌘J drawer (`hotkeys.ts:89-94`). Workers have no card-creation tool (`WORKER_REMOTE_TOOLS`, `chief-tools.ts:693-711`) — the create/dispatch vocabulary is chief-exclusive.
3. **The domain model reserved "half a seat" for B**: the `todo.sourceTodo` column exists (`apps/server/src/db/schema.ts:81`; `packages/shared/src/records/todo.ts:86`) but is **always written null** (`todos.ts:224`) — a dormant field, never set by any code; the todo source concept currently has only one kind, `github-issue` (`sourceKind`/`sourceRef`); the nine phase values have no "orchestrating" (`apps/web/src/phase.ts`); CONTEXT.md's current ruling says "no Goal/parent-child concept — there is only one unit of work, the todo".

## 2. How Multica does it (M side)

### 2.1 The orchestration layer: leader splits child tickets → dispatches → members execute → acceptance review

**First-hand evidence (M-first) — this very ticket is a live sample of the flow**; key points of the XMON-92 parent ticket's dispatch-receipt comment of 2026-10-01 09:36 (re-pulled and re-verified 2026-10-02):

- the research task was split into child issue XMON-98, dispatched by ownership to `Pacman 后端` (rationale: involves the server-side chain + needs to read the pacman repo);
- two **fallback wake-ups** were attached at the same time: run failure/cancel event wake + a 30-minute periodic check (guarding against silent hangs), both valid for 72h;
- "once the report comes back I will check it against the acceptance criteria item by item, flip it to in_review only when it passes, and report the conclusions back to this thread" — **acceptance authority sits with the leader; the human checkpoint moves downstream**.

**Cited evidence (M-cited, multica-platform skill `references/squads.md` / `issues.md`, via XMON-98 comment 1)**:

- assigning an issue to a squad wakes only the leader, not the members; the leader briefing includes the Squad Operating Protocol + a member roster (with skill lists for capability-based dispatch);
- child tickets with `--status todo` = start immediately, `backlog` = parking lot; serial chains are not all set to todo at once — later stages stay backlog until the previous stage closes, which wakes the leader to promote;
- parent-ticket state belongs to the leader (stays in_progress while members work; flipped to in_review only when the whole is confirmed done); the platform does not flip parent tickets automatically.

### 2.2 The runtime layer: orchestration is not in the runtime

r10 (the complete Multica runtime model) has **no squad/leader content anywhere** (grep zero hits) — the runtime layer only has: WS `/api/daemon/ws` + 30s poll fallback, heartbeat 15s, offline decision ≈180s, queue = server notifies daemon, concurrency daemon 20 / agent 6, dispatched >5min judged failed (r10 §5 operations surface). r11 §9 in turn points out that pacman's step queue / claim / session-level worktree / plan.md upload / nine-phase hard gates are things the Multica runtime **does not have**.

**Implication**: Multica's "orchestrate first" lives at the **platform layer** (the squad/leader protocol), not at the execution layer. For pacman to learn from B, the runtime does not need to move — the daemon/claim/step queue is reused as-is; orchestration is just one more kind of step in the queue.

### 2.3 Two points useful to pacman

1. **The orchestration artifact = board entities**: the decomposition output is the child issues themselves, not an attached document — the user sees the agent's decisions at zero cost, and can comment, reassign, or shut them down at any time.
2. **Dispatch does not wait for user confirmation**: the leader dispatches autonomously; "intervenable" comes from artifact visibility + commentability throughout, not from a pre-execution approval gate.

## 3. External product comparison (5 products; the ticket requires ≥2)

### 3.1 Comparison table

| Product | Direct execution or plan/orchestrate first | Visibility of the plan/orchestration artifact | Pre-execution user confirmation | Source and verification status |
|---|---|---|---|---|
| Devin (Cognition) | Plans first by default: Initial Assessment (relevant files/key findings/implementation questions) → Detailed Plan | The plan carries code references; clicking a citation deep-links into the Devin IDE for checking | **Soft gate**: by default waits 30 seconds for feedback then continues (adjustable in Settings > Customization); complex tasks can click "Wait for my approval" to become a hard wait | [docs.devin.ai/work-with-devin/interactive-planning](https://docs.devin.ai/work-with-devin/interactive-planning). Re-verified 2026-10-02: the original link has vanished from the official docs index; content verified verbatim via the Exa cache ("By default, Devin will wait thirty seconds…") |
| OpenAI Codex (CLI/IDE) | Planning is opt-in: Plan mode (/plan or Shift+Tab), PLANS.md template; official best practices "Plan first for difficult tasks" | The plan is visible and iterable in the session | Plan mode must be approved before any action (research surface read-only); the default mode just works | [developers.openai.com/codex/learn/best-practices](https://developers.openai.com/codex/learn/best-practices) `[cited]` |
| OpenAI Codex (cloud) | Direct execution: @codex mention → webhook → cloud environment clone → harness runs directly; "plan locally first, then delegate to the cloud" is the officially recommended combination | No intermediate plan gate; the artifact = diff/PR | None; the checkpoint is PR review | [developers.openai.com/codex/cloud](https://developers.openai.com/codex/cloud), [openai/codex#11442](https://github.com/openai/codex/issues/11442) `[cited]` |
| Claude Code | Direct execution by default (todo list visible); Plan mode = read-only research + plan (Shift+Tab); Task/subagents and agent teams are at the agent's own discretion, not approved by the user one by one | todo/plan visible; subagents return only summaries; the team lead's coordination is visible | Plan mode = **hard gate**; the default mode is per-action permission confirmation, not a plan gate | [permission-modes](https://code.claude.com/docs/en/permission-modes), [sub-agents](https://code.claude.com/docs/en/sub-agents), [agent-teams](https://code.claude.com/docs/en/agent-teams) `[cited]` |
| Cursor | Agent mode executes directly by default; Plan mode opt-in (Shift+Tab, auto-suggested for complex tasks); Cloud agents run on cloud VMs straight to a merge-ready PR | The plan can be reviewed/edited (chat or markdown) and saved to the workspace for sharing | In Plan mode, clicking build is what executes | [cursor.com/docs/agent/plan-mode](https://cursor.com/docs/agent/plan-mode). Live re-verified 2026-10-02 ("Plan Mode creates detailed implementation plans before writing any code… Click to build the plan when ready") |
| GitHub Copilot cloud agent | Session flow in three stages "research → plan → iterate"; issue/integration entries auto-run the whole course | The plan is visible and iterable in the session (conversation-driven, not an approval gate) | No hard gate; the session does not auto-create a PR; the checkpoint is diff/PR | [coding-agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent), [research-plan-iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate) `[cited]` |

`[cited]` = fetched 2026-10-01 via the agent-reach Exa channel (XMON-98 comment 1), not re-verified item by item in this document; the two key rows (Devin soft gate, Cursor Plan mode) were independently re-verified on 2026-10-02.

### 3.2 Three takeaways

1. **Gate placement follows "is a human present"**: synchronous, human-present products dare put the confirmation gate before execution (and mostly as opt-in or softened — Devin waits only 30 seconds); asynchronous/cloud/issue-driven products all execute directly, moving the checkpoint to the PR. **pacman's "Save and start" is an asynchronous entry point (the human clicks and leaves), yet it carries the hardest gate in the whole product (the confirm phase waits indefinitely) — exactly the opposite of the industry baseline**, and the most deserving point of re-design in the current state.
2. **No one makes "task decomposition" a hard pre-execution gate.** Decomposition visibility takes two forms: Multica = decomposed into board entities; Claude Code / Cursor = a plan document/list visible in the session. B's core value (laying the agent's decisions out where they can be intervened on) is satisfied by both forms; they differ in intervention granularity.
3. **Decomposition needs a threshold**: the Claude Code agent-teams doc self-warns "high coordination overhead, significantly more tokens; sequential tasks / same-file changes are better in a single session"; Codex/Cursor both say "plan only for difficult tasks". Always-on orchestration shreds simple tasks.

## 4. Two-route comparison table (the ticket's core deliverable)

| Axis | A direct execution | B orchestrate-first |
|---|---|---|
| pacman current state | The current state is a variant of A: single card straight through + plan hard gate (third state, §1.2) | The parts already exist (Chief lane, §1.3b), but there is no wiring to "Save and start" |
| Flow after the click | 1 todo + 1 build + 1 step; first step plan (hardcoded) → confirm waits for a human → build | 1 todo + 1 orchestration step (kind chief / new kind, **sharing the worker-step queue**, P:`machines.ts:623-631`) → verdict: run the single task directly, or split into N child cards and dispatch |
| Time to first result | Fast; saves one LLM round | Slow by one orchestration round (minutes) |
| User intervention points | plan confirm hard gate + steer + reject/stop | Soft gate: child cards land on the board, visible and intervenable throughout (drag/comment/stop/cancel_builds), checkpoint moved downstream to review/merge |
| Form of the orchestration artifact | plan.md four-section document (versioned + diff view) | Child cards = board entities (Multica form), or conversation + child cards (the §5.2 compromise form) |
| Cost | Lowest tokens; **but the confirm gate = human waiting cost on an asynchronous entry point** (§3.2 takeaway 1) | One extra orchestration round of tokens per task; runaway decomposition granularity → review-click burden ("decomposition granularity = number of reviews", §5.2) |
| Fit with existing mechanisms | Zero changes | High: step queue / claim / wake / watch / 49-word table all ready; what is new = the wiring from card creation to the orchestration step, phase semantics (reuse planning or add "orchestrating"), child-card traceability fields (sourceKind or activating sourceTodo, §5.2) |
| External baseline support | All asynchronous/cloud products are A (Codex cloud, Cursor cloud, Copilot) | No one does "B + hard gate"; Multica is the only live sample of "B + soft gate" |
| Typical failure mode | Plan runs empty — already covered by the bounded `PLAN_REWRITE_PROMPT` backstop (P:`builds.ts:599-601, 627-641`) | Orchestration step hangs silently (needs event + scheduled fallback — Multica's leader currently attaches these manually, M-first); **wrong/incomplete decomposition is silent** (needs the final acceptance check as a counterweight, §5.2) |

**Conclusion**: go with the soft-gate version of B. Three reasons: ① the user has already clearly leaned to B and decision points 2–6 were ruled along B (§5.1); ② pacman's B parts (Chief) are far more mature than the wiring to be added — the 49-word table, watch/wake, and run_builds auto-watch are all ready (§1.3b); ③ the main disease of the current A variant (an asynchronous entry point carrying the hardest gate) is exactly what B's soft-gate design removes (§3.2 takeaway 1 + §2.3 point 2).

## 5. Recommended plan

### 5.1 Ruled decisions (XMON-98 comments 2/3, 2026-10-01, M-first)

| # | Decision point | Ruling |
|---|---|---|
| 2 | Orchestration confirmation | **Soft gate, dispatch directly** — the decomposition result does not stop at confirm; the board/thread allows reject-and-reassign at any time |
| 3 | Orchestrator | **Chief as orchestrator** (reusing the 49-word table + dispatch policy + watch/wake) |
| 4 | Decomposition threshold | **The orchestration step self-judges** run-the-single-task vs split + a user switch is added to the new-task dialog |
| 5 | Sub-task withPlan | **false, direct execution**; review/unification happens at review/merge |
| 6 | Orchestration fallback | **Defaulted**: run failure event wake + periodic check, built into the platform, not attached manually by the orchestrator |
| 7 | Command+Enter / UI indication | **User handles it themselves** (XMON-91 → XMON-95, code on the unmerged branch `agent/pacman/994dc12e8830`); status copy follows the new behavior |

### 5.2 The only open point: keep or drop the parent card (decision point 1)

**User position** (gist of comment 2): child cards only, no parent card — the problem resolves itself into multiple child cards to be reviewed one by one, and a parent card is noise.

**Counter-proposal in comment 3** (agent side, not yet confirmed by the user): the board **does not render the parent card** (adopting the user's intuition), but the "parent record" cannot be zero, or three things are lost — the original-text anchor (re-decomposition/rejection needs to return to the user's exact words), the completion judgment ("all green = solved" depends on the decomposition being complete, and a missed split is silent), and traceability (agent-created cards and manually created cards are indistinguishable on the board). Landing form: **the container is not a card but a conversation** (the chief-thread form) — the original words = the first message of the conversation, and the decomposition reasoning/assignments/summaries all live in the conversation; child cards carry their source via the existing source-family fields (currently only `github-issue` exists) plus `sourceKind='orchestration'` + the conversation id, **without violating CONTEXT.md's "no Goal/parent-child concept" ruling** (a conversation is not a todo); a single-task verdict with no split = exactly 1 card, no container, experience identical to today; the final acceptance check is made optional (when the last child card closes, the orchestrator self-checks coverage against the original words and posts a summary in the conversation).

**New facts in this document** (verified after comment 3, P side): the `todo.sourceTodo` dormant column already exists (`schema.ts:81`, always null, `todos.ts:224`) — if a "parent record" is wanted, there is technically a third road: activate sourceTodo to point at the first card of the orchestration conversation or a parent todo. But activating it = formally elevating parent-child relationships into the domain model, which head-on contradicts CONTEXT.md's current ruling and maximizes the tension with the user's "no parent card" intuition. **So this document supports comment 3's sourceKind route**, with sourceTodo recorded on the file as a known dormant alternative. `[inference]`

**Practical guardrail** (verbatim from comment 3, to go into the orchestration prompt): **decomposition granularity = number of reviews** — decompose by independently verifiable outcomes, not by execution steps; otherwise one question becomes 8 cards, and the parent card's noise comes back in the form of click counts.

### 5.3 Behavior design (per the ruled decisions)

**User-view timeline**:

1. **T0 click `保存并开始`**: the dialog closes, the card appears on the board. Under the board route the card landing in a column is feedback enough; under non-board routes (the dialog can open from all routes) add a short-lived clickable toast `已保存并开始 → #N` jumping to the card — **the toast answers only "where did my thing go", not "how is it doing"** (subsequent status belongs to the board phase column + notification surface; failure-path feedback takes priority over success-path). ⌘↵ triggers the same chain (after the XMON-95 branch merges).
2. **T0–T1 orchestration round (background)**: the orchestration step runs; two outcomes — verdict no-split: the card goes straight into execution (withPlan per the dialog switch, defaulting per ruling 4); verdict split: N child cards with assignments land on the board, **without waiting for approval** (ruling 2), the parent card is not rendered on the board (§5.2 compromise), and the original words + decomposition reasoning are inspectable in the orchestration conversation. The user can intervene at any time: drag, comment, stop, reassign.
3. **T2 executing**: the board phase column = each child card's progress; the orchestration conversation aggregates sub-task events (watch/wake ready-made).
4. **T3 acceptance**: child cards stop one by one at awaiting-review, and the user reviews/merges them one by one (the review point of ruling 5); an optional final acceptance summary (§5.2).

**System-view timeline** (minimizing new surfaces, reusing all existing parts):

1. `POST /api/todos` unchanged.
2. Wire at the withPlan fork of `startBuilds` (`builds.ts:381`): when the switch = orchestrate, the first step enqueued is a **kind 'chief' (or new kind 'orchestrate') step** — reusing enqueueStep/claim/wake, since chief steps already share the queue (`machines.ts:623-631`); prompt = parent task title+spec + decomposition discipline (§5.2 guardrail).
3. The orchestration step's outputs = `create_todo` batch-creating child cards (with `sourceKind='orchestration'` + conversation id) + assignment (by agent responsibility text; the policy section is already in the chief system prompt, `chief.ts:586`) + `run_builds` (withPlan:false, ruling 5) + auto-watch (ready-made, `chief-tools.ts:604-651`).
4. The sub-task pipeline = the existing plan/build/review/merge reused entirely, zero changes.
5. Fallbacks defaulted (ruling 6): orchestration step failure → the parent record goes red + notification (reusing the failure-rerun surface); run failure/cancel event wakes + periodic checks become platform defaults, no longer attached manually by the orchestrator.

### 5.4 Risks and guardrails (premortem: suppose it has been live for three months and failed — the most likely causes of death)

1. **Always-on decomposition shreds simple tasks** (coordination overhead + token cost, the Claude Code doc's self-warning) → guardrails: ruling 4's orchestration-step self-judgment + the dialog switch + the "run the single task" exit.
2. **The orchestration step hangs silently while the user thinks it is running** (a real pain point on the Multica side, evidenced by the leader attaching fallbacks manually) → guardrails: ruling 6 defaulted fallbacks (event wakes + periodic checks) + a red failure phase on the card.
3. **Parent/child or traceability changes break the shared contract for the frontend and CLI** (`packages/shared` is the contract layer) → guardrail: the §5.2 sourceKind-family-fields route, starting with zero domain-model changes; the sourceTodo dormant column stays untouched.
4. **Wrong/incomplete decomposition passes silently** (all green ≠ the original problem solved) → guardrails: the original-text anchor kept in the orchestration conversation + the optional final acceptance summary (§5.2).

## 6. Evidence verification details

- **P side**: all file:line references were re-verified one by one on 2026-10-02 against `4647eaf` (origin/main) / `52ceac3` (HEAD); the only commit between the two baselines, `4647eaf` (XMON-117), touches no file in this document's chain. The previous report (XMON-98 comment 1) used line numbers from an earlier baseline (around `c95ee5f`); this document's line numbers are authoritative.
- **M-first**: the XMON-92 dispatch-receipt comment, XMON-98's three comments (research report / user ruling / agent wrap-up), and the XMON-91 and XMON-95 ticket bodies — full text re-pulled and checked via the multica read-only CLI on 2026-10-02.
- **M-cited**: the squad-mechanism details from the multica-platform skill `references/squads.md` / `issues.md`, cited from XMON-98 comment 1, not independently verified in this document.
- **External products**: Devin (verified verbatim via the Exa cache; the original link is gone from the official index) and Cursor (verified live via Jina Reader) were independently re-verified on 2026-10-02; the other four are `[cited]` from comment 1 (fetched 2026-10-01 via the agent-reach Exa channel), with links preserved as-is. All fetch channels belong to the agent-reach family.
- **Correction of an r10 / r11 premise**: the task brief's original wording "how Multica actually does it (this repo already has r10 and r11 research)" is imprecise — both are **runtime-layer** studies with zero squad/leader content (verified by grep). §2.2 of this document turns that into evidence: orchestration is not in the Multica runtime. The squad comparison content lives in `herdr-multica-parity.md` (untracked, originating from a wiki outside the repo, `[secondhand]`, used as leads only, not as evidence).
- **Correction of a hotkey fact**: ⌘↵ is not on origin/main — commit `eb88476` (XMON-95) exists only on the unmerged branch `agent/pacman/994dc12e8830` (verified non-ancestor via `git merge-base --is-ancestor`). When citing "Save and start + ⌘↵" behavior, go by that branch's state.
- All unchecked/unverifiable items are marked in place (`[cited]` / `[secondhand]` / `[inference]`).

## 7. Related documents

- `r5-chief-behavior.md` — Chief behavior research (the in-repo canonical study for the B-route orchestrator)
- `r10-multica-runtime.md` / `r11-runtime-gap.md` — runtime-layer comparison (basis of §2.2)
- `herdr-multica-parity.md` — orchestrator comparison (S3/S6/S8, secondhand leads)
- `CONTEXT.md` — the current "no Goal/parent-child concept" ruling (the constraint surface of §5.2)
- Multica XMON-92 / XMON-98 / XMON-91 / XMON-95 — ticket bodies and comment sections (decisions of record)
