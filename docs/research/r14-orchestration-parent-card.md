# R14 · Keep or drop the parent card in orchestration splits: three-way evidence and recommendation (XMON-98 decision point 1)

> Ticket: XMON-98 "agent behavior after Save and start" (Multica ticket; platform decommissioned; the decision chain is carried by r12). This document closes only decision point 1 (keep or drop the parent card); decision points 2–7 stay with the rulings already made in r12 §5.1.
> **Prior ruling (user's verbatim words of 2026-10-02, relayed via the coordination thread)**: "On the execution-vs-planning question for starting tasks — different agents for each — stop giving me this button. And when starting a task, stop giving me a choice: default it, execute directly, plan directly. One chief agent can start planning right away, then dispatch to a frontend agent, a backend agent, a verification agent, or whatever agent fits the actual work." — the r12 question "direct execution vs orchestrate-first" is thus answered for good: **orchestration is the only default path**, and the start-task surface no longer offers the user a choice. This document's recommendations build on that premise (the parent is the object of this orchestration round); removing the entry-point buttons/switches belongs to an implementation ticket and is out of scope here.
> Nature: decision material, not implementation. Read-only research + minimal write experiments on the reference site (cleaned up afterwards), zero product-code changes.
> Code baseline: `origin/main` = `ee636a5` (2026-10-02; this branch is at that tip). All P-side line numbers verified line by line on this baseline.
> Preceding work: `r12-save-and-start-behavior.md` §5.2 gives both positions (user: "child cards only, no parent card" vs counter-proposal "parent record = conversation, not rendered on the board, child cards carry source fields"); per the user's request, this document makes the recommendation after three-way evidence — how todos.dev does it / how other similar products do it / how herdr currently does it — followed by the recommendation and a critique of counterexamples.
> Evidence collection: one independent research thread per route (L-A/L-B/L-C); verbatim evidence and screenshots archived at `docs/research/assets/r14/`.

## 0. Reading conventions

Four kinds of sources, marked per item:

- **P** (pacman code) = `path:line`, verified line by line on `ee636a5` on 2026-10-02.
- **L-A / L-B / L-C** (the three evidence routes) = research-thread artifacts, archived canonical copies:
  - L-A `docs/research/assets/r14/raw/xmon98-laneA-todos.md` (todos.dev: in-repo archive re-parsing + live API/browser evidence + a split experiment);
  - L-B `docs/research/assets/r14/raw/xmon98-laneB-others.md` (Multica official-docs snapshot first-hand + GitHub/Linear official docs live capture; archived in the same directory as `xmon98-gh-*.md` / `xmon98-linear*.md`);
  - L-C `docs/research/assets/r14/raw/xmon98-laneC-herdr.md` (herdr/herdr-projects local read-only evidence).
- **W** (wiki citation) = `~/.agents/wiki/wiki/todos.dev 与 Multica 对照.md` (a 2026-09-30 full close-reading of both official docs sets), cited here without re-pulling the originals.
- Unverified citations are marked `[cited]`; judgments are marked `[inference]`; L-series evidence keeps the `[measured]/[archive-cited]/[inference]` grading from each artifact itself.

Screenshot index (`docs/research/assets/r14/`): live captures on the reference site (2026-10-02) — `11-todo12-card-zoom.png` (board card `由总管创建` chip close-up), `15-board-after-split.png` (board after the split experiment), `14-chief-round1-receipt.png` (split receipt), `12-chief-chat-expanded.png` (chief conversation panel full view), `03-todo12-detail.png` (detail page full text — zero source presentation), `10-cdp-board.png`, `06-board-with-chief-created-chip.png`, `13-chief-gap-exp-round1.png`; user-supplied — `07-start-task-dialog-user-shot.png` (the current "start task" dialog, i.e. the surface whose choices the prior ruling removes: the two-branch buttons and the assignment picker, code side `overlays.tsx:322,329`, payload #318).

## 1. The question under ruling and standing constraints

**Premise (ruled by the user on 2026-10-02)**: orchestration is the only default path — every "start task" (including "Save and start") goes through a chief orchestration round: the chief plans directly and dispatches to dedicated frontend / backend / verification agents by the actual work, with no choice at the entry point. This simultaneously corrects the second half of r12 §5.1 decision point 4 ("add a user switch to the dialog" is void — no switch at the entry), and makes "every start produces an orchestration round" the norm. The question of this document is restated accordingly: **should the object of this orchestration round (the parent) appear on the board; and how do the task cards of the dispatched dedicated agents belong** — that is the real substance of the parent-card question.

Three candidate shapes: (a) the parent-card object exists and is rendered on the board; (b) a parent record exists but is not rendered; (c) no parent at all, only child cards. Corollaries: how the data plane expresses belonging, where the completion judgment hangs, and where the original-text anchor lives.

**Standing P-side facts** (constraint surface, all re-verified on `ee636a5` on 2026-10-02):

1. The `todo.sourceTodo` dormant column exists but is always written null (`apps/server/src/db/schema.ts:81`; `apps/server/src/services/todos.ts:224`). Activating it = elevating parent-child relationships into the domain model.
2. A source family already exists: the `sourceKind` enum currently has only `['github-issue','github-issue-self']` (`packages/shared/src/records/todo.ts:43`), and `sourceRef` looks like `github:owner/repo#123` (single-source format #446); the detail page has a source panel (`apps/web/src/detail/source-issue.tsx:26` — when `sourceKind === null` the whole block is not rendered); board cards currently show no source indicator.
3. `CONTEXT.md:31` current ruling: "no Goal concept — there is only one unit of work, the todo"; the `来源` (source) entry is defined as "the **external** origin of a todo".
4. Chief card-creation traceability is implemented and aligned with the reference site: `create_todo` writes `createdBy = ctx.chiefAgentId`, `sourceBuildId = ctx.chiefId` (`apps/server/src/services/chief-tools.ts:369-375`) — but `sourceBuildId` is the chief **instance** id (`chief-<userId>-<teamId>`, shared across all requests), so it **answers "who created it" but not "which request split it"**; the `create_todo` tool has no sourceKind parameter surface.
5. The chief conversation panel already exists (`apps/web/src/overlays/hotkeys.ts:89-94` ⌘J drawer; #619 just completed the chief-drawer closed loop) — there is a ready landing point for a "whole request" aggregation view.
6. The nine phase values have no "orchestrating" (`apps/web/src/phase.ts`); Build ≡ Conversation (execution and message stream are two faces of the same entity, CONTEXT.md boundary ruling); GitHub-backed projects fire-and-forget a mirror issue per todo (`apps/server/src/services/todos.ts:242`).

## 2. The three evidence routes

### 2.1 todos.dev (the reference site — the semantic-axis alignment target)

Sources: L-A (environment: team free tier, chief bound to Agent r3-builder, tds CLI 0.1.53; the live portion contains a single write operation = the split-gap experiment, marked r98, cleaned up afterwards — experiment cards deleted, daemon stopped, reference site restored to its pre-experiment state).

1. **The parent concept is absent on all four layers** [L-A measured]:
   - API: the todo doc field set of 20 keys (19+v) has no parent/parentId/goalId/epicId in any form — verified by replaying live `GET /api/teams/{id}/progress` + cross-checking 5 docs captured in the r5 era (the field set is identical across both generations).
   - Chief tool vocabulary: the 49-key live `toolDefHashes` has no create_parent/goal/epic/subtask-style tool.
   - docs/MCP capability surface: 13 write tools, six capability groups, no parent concept (`r3-protocol-executor.md:208,216`).
   - UI: the board's 6 phase columns tile cards flat (`r2-app-ui-inventory.md:147-165`); detail-page field lists and the new-task form have no parent reference; the marketing site's 21 feature cards contain no epic/goal/milestone wording (`r1-site-inventory.md:124-125`).
2. **The split experiment** [L-A measured]: a natural phrasing "one document + one code feature" (two independently deliverable cross-type artifacts) → the chief round split it into **2 todos** (#23/#24) in 46s, dispatched by responsibility text (code → r3-builder, document → r5-scribe), dispatch = `withPlan:false` direct execution + automatic watch. Board rendering = **2 flat sibling cards landing in phase columns, drifting column by column with their phases** (#23→review, #24→failed), no parent row/grouping/container card; the only shared visual is the same-project chip (`15-board-after-split.png`). The receipt lives in the conversation thread and lists entity chips of both cards (`14-chief-round1-receipt.png`).
   - Contrast with the r5-era "three small same-type items" → **1** todo (title joined with `+`, `r5-chief-behavior.md:60`) — **whether to split is the chief's own judgment by request structure**: same-type small items are merged; cross-type independently verifiable deliverables are split; there is no user confirmation gate.
3. **Three-layer traceability** [L-A measured]:
   - Machine fields: `createdBy` = the chief-bound Agent id (a manually created card carries the user id in this field, live sample contrast); `sourceBuildId` = **the chief record id, not the thread id** — cards #12 (thread A) and #23/#24 (thread r98) share the same value across three cards and two threads. The link "child card → which specific conversation" exists only in ① the `[#N](todo:<id>)` entity references inside conversation messages and ② the watch record's `threadId` (the watch auto-detaches after settle/failed — after detachment there is no persistent link).
   - spec structure: `> a normalized rewrite of the relevant fragment of this subtask` (not the verbatim full text — "the first item / the second item" is stripped and replaced by the request topic) + `要求：` bullets + **textual cross-references between sibling tasks** (no data fields). The verbatim original words are kept only in the chief conversation's user message. r5 §3.2 (#11 spec three-section shape) is isomorphic.
   - Visible presentation: a single `**由总管创建**` chip on the board card's bottom row (`11-todo12-card-zoom.png`; newly observed on 2026-10-02, absent in the r5 era — a UI-evolution addition); **zero source on the detail page** (full-text check of `03-todo12-detail.png`).
4. **The container = the chief conversation** [L-A measured]: two entry points (sidebar `工作台` + board header `展开总管聊天`, `12-chief-chat-expanded.png`); user messages store the original words verbatim (the only verbatim archive); all wake reports of gate/settle/failed flow back to that thread (r5 §3.5: within 1 second of a review stop the chief receives a wake step and reports inside the thread). There is no other "request-level" view: the board does not aggregate, the project page's tasks tab is a flat list, search has no request grouping.

### 2.2 Other similar products (Multica + GitHub sub-issues + Linear)

Sources: L-B (Multica = first-hand re-review of the wiki raw official-docs snapshot, `~/.agents/wiki/raw/sources/2026-09/2026-09-30-todos-vs-multica-docs/multica/`; GitHub four pages + Linear two pages = 2026-10-02 agent-reach Jina live captures, archived as `assets/r14/raw/xmon98-gh-*.md`, `xmon98-linear*.md`). Collection details (issues.txt/cli.txt line numbers, REST endpoints, Display Options quotes) are all in the L-B original text; this section keeps only the ruling-relevant conclusions.

1. **The shared shape across all three**: the parent = a real issue (rendered as a card/entry); children = full issues (their own number/assignee/status/execution history); **belonging is always stored in an explicit relationship field on the child** (Multica `--parent`/`--stage`, GitHub REST+gh CLI+Projects fields, Linear parent field + attribute inheritance). No one makes the parent a pure conversation or a pure record.
2. **The disagreement is on exactly two axes**: parent-child status coupling (Multica none / GitHub none / Linear team-level optional bidirectional) × board folding (no folding / no folding / sub-issues hideable).
3. **Multica's narrowing** (issues.txt:101 verbatim "Parent and child statuses do not affect each other"): the parent card's semantics are narrowed to three duties — the canonical copy of the overall goal ("the parent issue keeps the overall goal"), the leader's acceptance thread (the XMON-92 live sample: dispatch receipts and acceptance reports all land in the parent ticket's comment section, acceptance authority with the leader), and the stage-barrier wake anchor (when all children of the earliest unfinished stage close, parent subscribers are notified and the leader is woken). Flipping the parent to `in_review` belongs to the leader, `done` to a human or PR; notifications bubble status changes only, not comments.
4. **GitHub's narrowing**: a pure data relationship + read-only aggregation — the sub-issues area embedded at the bottom of the parent description, a `Sub-issues · 1/3 (33%)` progress line, a permanent backlink in the child header; in Projects, parent and child are **independent items each**, the hierarchy expressed via group by "Parent issue" / filters; no status coupling on record. Limit: 100 children / 8 nesting levels.
5. **Linear's narrowing**: child display is a view-layer switch (the list shows only parents and parentless tickets); rollup is a team-level opt-in (all children done → parent done / parent done → all children done, each direction separately switchable); splitting is a first-class action on the parent detail page (saving one auto-opens the next); **"parent converts to project"** = the official precedent of container upgrade (when a parent grows beyond what a card should be, switch the container type and dissolve the parent-child relationship).
6. **L-B's verdict on pacman**: the counter-proposal (source fields + conversation container) has no precedent in the issue-family — it amounts to splitting Multica parent's three duties (original-text anchor / acceptance thread / wake anchor) out into a separate container — "an untrodden shape; the three landing points must prove themselves at implementation time".

### 2.3 herdr / herdr-projects (the user's own coordination system)

Sources: L-C (read-only evidence: `--help` / list / show / overview / context + Read; herdr client 0.9.3 / server 0.9.1 / plugins 0.2.34; sampled project = pacman itself, and this research thread is its t-0033 thread — the sample is alive).

1. **Objects**: a project = a disk folder (PROJECT.md/TASKS.md/memory/threads/…) + a resident coordinator agent whose cwd is pinned to the folder; a thread = `threads/t-NNNN.toml` + `.task.md` (the task brief + all follow-up prompts) + a report `.md` triple hanging off one herdr pane.
2. **The parent/child vocabulary does not exist**: zero parent references among the thread record's 48 fields; the only link is the optional `· t-NNNN` suffix at the end of a task line in TASKS.md — a **delete-on-completion pointer**; history settles in thread records (27 resolved entries permanently listed in overview).
3. **A project is never rendered as a card/row**: all four surfaces (TUI sidebar group header, projects popup scope, tab bar counts, overview title row) are container forms; status (idle/working/blocked, percent) all lives on threads; the unit of work is always the thread.
4. **Completion judgment is outsourced**: task lines are deleted on the user's word / by the coordinator; PR merges are auto-resolved by the ticker — there is no automatic "all children green = parent solved" aggregation semantics.
5. **Structural difference** [L-C inference]: herdr's conversation container is a **per-project resident coordinator**, not per-request; per-request traceability relies on the per-thread `.task.md` brief + naming-embedded slugs (repeated in four places: record directory / worktree name / thread_dir name / sidebar token, zero reference fields) — equivalent to the sourceKind route but without the field.

## 3. Cross comparison

| Axis | todos.dev (reference site) | Multica | GitHub sub-issues | Linear | herdr |
|---|---|---|---|---|---|
| Parent object | **none** (zero concept on all four layers) | issue (first-class part) | issue | issue | **none** (project = folder + resident conversation) |
| Parent on the board | — (board has only todos) | rendered as an ordinary card in all five views | parent and child independent items each | view layer can hide children | project = group header / scope / counts |
| Where belonging is stored | child-card machine fields (chief **record-level**) + in-conversation entity references + watch threadId (transient) | child `--parent`/`--stage` | child parent relationship (REST/CLI/Projects) | child parent + attribute inheritance | disk layout + naming (4 places, zero fields) + task-line suffix (ephemeral) |
| Status coupling | — | zero coupling (leader protocol manages the parent) | zero coupling (read-only aggregation) | team-level optional bidirectional | — (human + ticker) |
| Request container | chief conversation (verbatim original words + receipts + all wakes flowing back) | parent ticket comment section | sub-issues area at the bottom of the parent description | below the parent description | resident coordinator conversation (per-project) |
| Completion judgment | — | leader's manual acceptance | count display (no coupling) | opt-in count auto-close | human + ticker (PR merged auto-resolve) |
| Visible traceability UI | board card `由总管创建` chip | children hang under the parent (relationship is the display) | permanent backlink in child header | child list + filter | sidebar grouping |

**The two poles**: the reference site and herdr (**container is not a card**: the conversation/folder is the parent, only children are the visible work objects) vs the three issue-family products (**parent = card + narrowed semantics**: no status coupling, display switchable, aggregation read-only). pacman's semantic axis is pinned to todos.dev (spec 18 positioning, two axes: the "semantic alignment with todos" core of three points), and its board model (phase columns = execution units) is not isomorphic to the issue family (free status + free view grouping) — this decides the orientation below.

## 4. Where the other approaches go wrong

Boundary first: all three are self-consistent in their own contexts (issues are human-written planning objects, the parent ticket exists before the work, grouping is free at the view layer). What follows lists what is wrong **for pacman's context** — pacman's entry point is "one sentence of request in a dialog", the split happens on the agent side, and the artifacts land on a phase-machine board.

**Multica (parent card = board entity, all three duties pressed onto the parent card)**:
1. **Dual state tracks**: the parent ticket has its own state and the platform does not couple it, so the leader protocol is forced to carry a responsibility of "flip to in_review only when the whole is done" — the parent state is a degraded copy of information derivable from the children, adding a class of drift failures (parent in_progress while all children are green), and correcting it relies on prompt discipline rather than mechanism.
2. **The original-text anchor is buried by mixed traffic**: the parent ticket thread is both the orchestration conversation carrier (dispatch receipts / acceptance reports / fallback wakes all land in the comment section) and the anchor — the original words share a line with the new event stream. In the XMON-92 live sample, the user's original words were pushed deep by dispatch receipts. An anchor needs a stable address, not a busy address.
3. **One more non-executable slot on the board**: none of pacman's nine phase values can describe a parent card — it has no plan/build/review of its own, so any column it lands in is a lie; and the review count per request grows by one (parent first, then children), precisely the noise the user's intuition wants deleted.

**GitHub sub-issues (pure data relationship + read-only aggregation)**:
1. **Double WIP counting**: parent and child are independent items in Projects — a 3-subtask request = 4 rows; the parent ticket carries a progress display but has no execution semantics, occupying space without doing work.
2. **Count aggregation gives a false sense of completeness**: `1/3 (33%)` only counts closed children — **the card that was never split out is not in the denominator at all**. r12 §5.4 death cause 4 (wrong/incomplete decomposition passing silently) is not hedged but amplified under count rollups.

**Linear (hideable + optional coupling)**:
1. Bidirectional auto-close formalizes the previous formula to the extreme: **all children done → parent auto-done** — reducing semantic acceptance to a counting gate, and "all green = solved" is exactly the false signal to guard against.
2. But it contributes two **positive** counterexamples: child display as a view-layer switch (a display problem does not have to be elevated into the object model); and "parent converts to project" officially admits a card is not a universal container — when the container grows beyond what a card should be, switch the container type rather than letting the parent card bloat.

**herdr (positive sample)**: container = conversation/folder, children = units of work, task lines = delete-on-completion pointers — "the parent is a container, only children are visible" runs well under daily use with 27 resolved threads. Completion judgment is outsourced to human + ticker, with no count aggregation.

**todos.dev (the recommended shape, with two debts pacman should close rather than copy)** [inference]:
1. **The per-request link is not persistent**: `sourceBuildId` only reaches chief-record granularity; "child card → which conversation" is carried by in-conversation entity references and the watch threadId, and the watch auto-detaches after settle/failed — the link is lost in re-split/aggregation scenarios. If pacman copies this, rejection-driven re-decomposition and "see the whole request" both degrade to text search.
2. **Zero source on the detail page**: beyond the card chip, the child card's detail page offers no way to find "where did this card come from" — the discovery path assumes the user knows to open the chief panel.

## 5. Recommendation

**In one sentence: no parent card is introduced, and the board renders no parent container; the "parent" = the orchestration conversation (chief conversation) + a persistent source field on child cards (the sourceKind family extended with `orchestration`, sourceRef = the orchestration conversation id); do not activate sourceTodo, do not add a phase, do not build count rollups.**

That is the counter-proposal route from r12 §5.2, confirmed after the three-way evidence in this document, and going one step further than the reference site (a per-request persistent field — closing its two debts).

**What the prior ruling adds to this conclusion**: since orchestration is now the norm on every start, the parent card stops being "an accessory of complex requests" and becomes a **+1 board object on every task** — even a single-task verdict (the chief judges no split, one card assigned to one dedicated agent) needs a parent card to be self-consistent, which amounts to adding a ceremonial object visible to everyone. Conversely, under this premise **the container-as-conversation has constantly zero render cost**: with no split it is just an ordinary card (no container semantics), and only when a split happens does the conversation panel gain a round of traces — orchestration visibility appears exactly when a split occurs, matching the measured shape "splitting is the chief's own judgment, most requests are not split" (§2.1.2: same-type merges into one, cross-type splits into two). The dedicated-agent dispatch mechanism is ready-made: responsibility-text-weighted dispatch (r5 §3.3 measured + the dispatch-policy section in pacman's chief system prompt).

### 5.1 Object plane: no parent card

- Aligns with the reference site's measured zero-concept-on-all-four-layers (§2.1.1) + the user's intuition (parent card = +1 review count + occupying noise); under the prior ruling (orchestration on every start), this intuition upgrades from "occasional noise" to "constant noise", making the no-parent conclusion harder.
- The CONTEXT.md "no Goal concept" ruling stays untouched — a conversation is not a todo, no new unit-of-work class is added; the board keeps "one card = one executable unit of work".
- No "orchestrating" phase: a parent card has no plan/build/review of its own, and none of the nine phases applies (Multica error #3 in §4); a single-task verdict with no split = 1 card that the chief assigns to a dedicated agent for direct execution (withPlan follows r12 decision point 5 = false), and the board experience is identical to an ordinary card, with no container semantics.

### 5.2 Container plane: the orchestration conversation

All three landing points have ready-made mechanisms (the head-on answer to L-B's verdict "the three landing points must prove themselves", all verified on the P side):

| The duty Multica presses onto the parent card | pacman's landing point | Basis |
|---|---|---|
| Canonical copy of the overall goal | the conversation's user message (verbatim, stable address) + the normalized fragment embedded in each child card's spec | isomorphic to the reference site (§2.1.3: verbatim original words live only in the conversation; child-card specs are normalized quotations); the spec three-section shape = the r5 §3.2 measured sample |
| Acceptance thread | the conversation itself: split receipts list entity chips, and all gate/settle/failed wakes flow back | r5 §3.5 measured (chief reports inside the thread within 1s of a review stop); pacman's chief conversation panel already exists (P fact 5) |
| Wake anchor | automatic watch on dispatch (carrying threadId) + set_wake scheduled fallback | r12 §1.3b (the 49-word table includes watch/wake; `run_builds` auto-watch on dispatch is ready); live isomorphic on the reference site (§2.1.2) |

Orchestration prompt discipline (decomposition guardrail, to go into the implementation ticket): **decomposition granularity = number of reviews** — decompose by independently verifiable outcomes (measured on the reference site: cross-type deliverables split into 2, same-type small items merge into 1); each child card's spec must embed the original-text fragment quotation + textual cross-references between sibling tasks (isomorphic to the reference site's spec structure, §2.1.3).

### 5.3 Data plane: one more entry in the source family (the step beyond the reference site)

- `TASK_SOURCE_KINDS` + `'orchestration'`; `sourceRef` = the orchestration conversation id (per-request granularity; the format follows #446's single-source discipline and is fixed in the implementation ticket, shaped like `chief:<conversationId>`).
- **Why one step beyond the reference site**: the reference-site measurement proves an instance-level field cannot answer "which request" (§2.1.3: three cards share the same value across two threads; the link disappears after the watch detaches). pacman's rejection-driven re-decomposition, per-request aggregation, and source panel all need persistent queryability — the cost is one enum value + one ref format, zero migration, zero new objects.
- `createdBy`/`sourceBuildId` keep their current semantics (who created it); `sourceKind='orchestration'` + `sourceRef` answer "which request split it" — three layers each answer one question, not mixed.
- `todo.sourceTodo` stays dormant: activating it = elevating parent-child into the domain model, head-on contradicting the "no Goal concept" ruling, and having to answer the unanswerable "what is the phase semantics of a parent todo". Kept on file as a recorded alternative; reopening triggers in §5.6.

### 5.4 UI plane: align with facts the reference site has already evolved

- **The board card `由总管创建` chip**: the reference site added this visible traceability in 2026-10 (§2.1.3, `11-todo12-card-zoom.png`) — pacman aligns directly, answering "how to tell agent-created cards from manually created ones".
- **The detail-page source panel gains an orchestration rendering**: linking to the orchestration conversation panel. This is one step more than the reference site (which has zero source on the detail page) — because pacman's sourceRef has conversation granularity and the source-panel family already exists (`source-issue.tsx` same family), the cost is one rendering cell.
- T0 feedback (after clicking `保存并开始`, "where did my thing go") follows the short-lived toast already fixed in r12 §5.3.

### 5.5 Completion judgment: in-conversation self-check, no counting gate

- When the last child card settles, the chief posts a coverage self-check summary in the conversation (checking decomposition completeness against the original words item by item) — **a message, not a gate**; gaps go through `notify_user` (not just silently in the conversation).
- Linear-style auto-close is not adopted (§4: counting gates give false completeness); acceptance authority stays with the human — aligning with the Multica leader acceptance semantics, without paying a parent card for it.

### 5.6 Explicit do-not list and reopening conditions

Do not: a parent todo object, an "orchestrating" phase, board parent-child grouping/folding, parent-child status coupling, count rollups, activating sourceTodo.

**Trigger conditions for reopening the parent-card route** (on file): a future need for **cross-request, timeline-dimension** views such as request-level Gantt/swimlane/portfolio (the Linear convert-to-project position — when the container grows beyond what a conversation should be, switch containers and revisit parent-child objects then). Request-level aggregation inside the board does not constitute a trigger — that is a question a filter can answer (see the guardrail in premortem 3).

### 5.7 Impact surface (implementation-ticket scope; zero code change in this PR)

- **Entry surface (the landing of the prior ruling, a separate implementation ticket)**: the card-level "start task" two-branch is withdrawn (the `先做规划/立即执行` two buttons + the assignment picker at `overlays.tsx:322,329`, payload #318) — a single button sends the chief orchestration round directly; the new-task dialog's `保存并开始` gets the same semantics (the first step enqueues an orchestration step, replacing today's hardcoded `withPlan:true` plan step, `use-new-task-surface.ts:165`). User reference screenshot: `assets/r14/07-start-task-dialog-user-shot.png`.
- `packages/shared`: `TASK_SOURCE_KINDS` +1 value (`records/todo.ts:43`) → the zod schema JSON projection changes → **snapshot.test will go red**; update locally with `vitest run test/snapshot.test.ts -u`, then verify the diff block by block before pushing (the standing discipline for touching the shared schema slot).
- `CONTEXT.md`: the `来源` entry goes from "external origin" to "origin (including orchestration origin)"; "no Goal concept" untouched.
- server: the orchestration-step wiring point (the `startBuilds` withPlan fork, r12 §5.3 system-view timeline) + `create_todo` writing `sourceKind`/`sourceRef` (either an optional tool-schema parameter or the orchestration-step card-creation path writing it server-side automatically — the implementation ticket decides); the decomposition-discipline sentence goes into the orchestration prompt.
- web: the card `由总管创建` chip + the detail source panel's orchestration rendering (linking to the conversation panel).
- Compatibility: a zod enum extension — an older daemon/CLI parsing the new value fails validation; the self-hosted single-user rolling-upgrade risk is low, and the implementation ticket re-checks the version-skew window.
- No DB migration: the `sourceKind`/`sourceRef` columns already exist; `sourceTodo` is untouched.
- GitHub mirror surface (open question): GitHub-backed projects fire-and-forget a mirror issue per todo (P fact 6); child mirrors are naturally independent issues with no parent issue to attach to. If GitHub-side aggregation is ever wanted, add the sub-issue relationship at the mirror layer (external expression, pacman's model untouched) — out of scope for this ruling.

### 5.8 Why not the other two roads (the strongest counterarguments and responses)

1. **"Parent card + narrowing is the mainstream; the counter-proposal has no precedent" (L-B verdict)** — response: pacman's semantic axis is pinned to todos.dev (spec 18), and the reference site is itself the container shape, running in daily production; "no precedent" holds only inside the issue family, and pacman is not in that family (phase-machine board vs free status + view grouping, §3). herdr, as the user's daily system, is a second live sample of the container shape. The parent-card route pays four costs (a new unit-of-work class / unanswerable phase semantics / +1 review / dual state tracks or counting gates) for an "in-board aggregation display", while aggregation is already served by the conversation panel. The prior ruling (orchestration as the norm) tips the scale once more: the four costs go from "paid only for complex requests" to "paid for every task".
2. **"Pure child cards, zero container" (the extreme version of the user's intuition)** — response: three things are lost (r12 §5.2: the original-text anchor / completion judgment / traceability distinction), and the reference site does not go this way either (it has the chief conversation container). This recommendation keeps the substance of the user's intuition (the board shows only child cards, zero extra reviews), with the container attached at a layer the user does not see.

### 5.9 Premortem (suppose it fails three months later — the most likely causes of death and guardrails)

1. **Incomplete decomposition passes silently** (all green ≠ solved) → guardrails: the coverage self-check in the conversation at the last settle + `notify_user` for gaps (§5.5).
2. **The user cannot find "where did my request go"** (the conversation panel entry is buried) → guardrails: the card chip + the detail source panel linking the conversation + the T0 toast (§5.4).
3. **Aggregation scannability is insufficient** (the cost of giving up board rollups becomes visible) → guardrail: conversation panel first; if not enough, add a board filter "by source conversation" — solved at the view layer, not elevated into the object model (the Linear lesson, §4).
4. **sourceRef format drift / written in two places** → guardrail: #446 single-source discipline; the format is fixed in the implementation ticket (§5.3).

## 6. Evidence verification details

- **P side**: all file:line references verified one by one on `ee636a5` on 2026-10-02 (sourceTodo dormancy / sourceKind family / CONTEXT.md ruling / create_todo traceability / ⌘J drawer / nine phases / mirror issues).
- **L-A**: todos.dev live (API replays + ego-browser/CDP screenshots + full split-experiment record); the experiment's write operations were cleaned up (experiment cards DELETE 204 ×2, progress re-read back to original, daemon stopped); black-screen duds were discarded, and the 8 archived valid screenshots were all captured via CDP. In-repo citations r1/r2/r3/r5/r5b/r8 + re-parsing of `assets/r5/raw/`.
- **L-B**: six-page Multica official snapshot re-verified first-hand (line numbers pinned); GitHub four pages + Linear two pages re-verified via agent-reach Jina live capture; the two originally `[cited]` spots (Linear display-options, GitHub Copilot page) were re-captured and upgraded to verified, archived in `assets/r14/raw/`.
- **L-C**: read-only throughout (`--help`/list/show/overview/context + Read), no state-changing command.
- **User ruling (prior)**: verbatim 2026-10-02 words relayed via the coordination thread (quoted at the head of this document), guiding the restatement of the question here; the supplied screenshot `07-start-task-dialog-user-shot.png` is archived under `assets/r14/` (the image channel was unavailable to this research; the dialog structure is referenced per the code side `overlays.tsx:322,329` and the description in r12 §1.3).
- **W**: wiki-page citations (a close-reading artifact of the official docs), originals not re-pulled.
- Unverified items are marked in place (`[inference]`); the full original artifacts of the three evidence threads are archived at `docs/research/assets/r14/raw/`, and this document keeps only the ruling-relevant conclusions.

## 7. Related documents

- `r12-save-and-start-behavior.md` — 本票前序（§5.1 已拍裁决 2–7、§5.2 双方立场）
- `r5-chief-behavior.md` — 参考站 Chief 行为一手观察（spec 三段式 / watch 回路 / 线程形状）
- `r2-app-ui-inventory.md` / `r1-site-inventory.md` — 参考站看板与站点清单
- wiki [[todos.dev 与 Multica 对照]] — 对象面宽窄对照底座（L-B 的 Multica 一手来源）
- `CONTEXT.md` — 「无 Goal 概念」「来源=外部出处」现裁决（§5.7 列出随实现票更新的词条）
- `docs/spec/18-positioning-and-differentiation.md` — the positioning canonical copy that pins the semantic axes to todos.dev (basis of §5.8 argument 1)
