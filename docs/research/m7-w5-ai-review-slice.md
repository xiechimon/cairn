# M7-W5.1 (#312) slice ruling + Grill + Premortem

> ticket: #312  →  slice 1 of 2  →  ticket: #326 (M7-W5.2)
> date: 2026-09-27  author: agent
> Principles hit: adversarial review + first principles + No Negative Echo

## 0. Slice ruling

The full AC (r8 §3.1) = modal → pick Agent → review step → findings → blocking auto-revision loop.
Volume 08 §7 slice guardrail verdict: one ticket cannot hold it (spanning web+server+daemon five
layers + two new wire words + auto-revision feedback loop).
Split into two tickets:

| Ticket | Scope | Issue | PR |
|---|---|---|---|
| Ticket A (M7-W5.1) | modal (560-wide DialogShell) + pick Agent + optional focus + start review → server enqueues review step + timeline `发起了 AI 审核` + `审核中` chip + composer placeholder + stop button reusing steer | #312 | this PR |
| Ticket B (M7-W5.2) | findings on the real wire (verdict+number+(blocking)) + daemon stub-llm real emit + blocking→edit_plan auto-revision loop + new plan→confirm | #326 | #326's PR (blocked by #312) |

Ruling rationale:
1. The feedback loop spans three components: daemon emits findings → server receives + decides blocking → server enqueues revision step → daemon revises plan → server lands plan v2 → web switches to confirm. A stall at any layer breaks the whole loop.
2. The findings message wire is a new protocol surface (a new role / new content shape / new row kind) and must be reviewed independently.
3. Ticket AC2 "full chain genuinely usable" is delivered in two segments: ticket A segment = modal→review step; ticket B segment = findings→blocking→revision. #312's AC closes by merging both segments.

## 1. Grill counter-recommendations (pinning down requirements)

### Decision D1 · step kind word: add `review` vs reuse `build`

Counter-recommendation: **reuse build**, zero new vocabulary, daemon runner.ts CONTINUE_PROMPTS untouched.

Ruling: **add `review`**, because:
- runner.ts's `CONTINUE_PROMPTS[kind]` determines the first-turn prompt template; review ≠ build (review does not need the full todo.spec, but needs the plan.md context + focus textarea injection + tool allowlist of edit_plan only + refusal to modify the worktree).
- Volume 08 archive 2 backend inventory already lists the four items as independent: "review action + review step kind + findings message wire + blocking auto-revision loop" ([confirmed freeze point]).
- A tightened vocabulary means a later review v2 (different Agent / multiple review rounds) can evolve independently.

### Decision D2 · modal width: standalone 560 spec vs stretched DialogShell

Counter-recommendation: add a `width` parameter to DialogShell, default 448, pass 560 for review.

Ruling: **add `width?: number` to DialogShell**, because:
- r8 §2.5's "560 wide (a new tier outside the 448-overlay rule)" only describes the measured value; it does not say a standalone component is required.
- Reusing DialogShell (Esc/backdrop/close/focus management under the same rule) = one change in one place; a new DialogShell560 = two rules running in parallel.
- The only extension needed: dialog.css `.dlg` width from 448 to `var(--dlg-width, 448px)`, with dialog-shell.tsx passing it through.

### Decision D3 · `开始审核` button position: 32×32 circle vs reusing RerunDialog's existing footer rule

Counter-recommendation: reuse RerunDialog's `.overlay-actions` three-button row, centered at the modal bottom.

Ruling: **new primary row** (matching the measured coordinates of r8 §2.5 `开始审核 32×32 @ (943,476.5)`), because:
- The r8 screenshot capture shows `开始审核` in a standalone slot to the right of the textarea toolbar (@x943), not in the bottom actions.
- Different from chief-agent-dialog's footer three-button row = a new design rule.
- Implementation: a 32×32 primary button at the end of the textarea row inside dialog-body (`btn primary 32-square`); click = POST review.

### Decision D4 · timeline "initiated" message: role=user plain text vs system notice row

Counter-recommendation: role=user + actor assembly (same rule as the `发起了合并` row), reusing the existing MERGE_ANNOUNCEMENT pattern.

Ruling: **role=system plain text + new constant REVIEW_ANNOUNCEMENT**, because:
- MERGE_ANNOUNCEMENT is role=user (the user clicks merge in the UI) — review is "agent-process behavior" and semantically more like system.
- But review is initiated by the user clicking (the button is on the composer) — a user action.
- Compromise: role=user + reusing the MERGE_ANN... rule. Add `REVIEW_ANNOUNCEMENT = '发起了 AI 审核'`, same shape as MERGE.

### Decision D5 · in-review phase: reuse review vs add reviewing

Counter-recommendation: keep phase=review (the chip is already `审核`), reusing the existing phase UI row.

Ruling: **keep phase=review, but change the composer placeholder to `AI 审核进行中…` and use the `审核中` chip**, because:
- No new phase (volume 09 §1 nine-value freeze); the visual difference is carried by the phase UI row + composer placeholder.
- The `审核中` chip vs the phase=review chip `审核` = two step variants under the same phase; analogy: planning/building are the same chip with `规划中`/`执行中` as measured.
- Implementation: phase UI unchanged (review → chip `审核`, tone=confirm); add a reviewHasActiveStep flag (when the review step is claimed/pending → chip becomes `审核中`, placeholder becomes `AI 审核进行中…`).

### Decision D6 · daemon-side review step implementation: real findings emit this ticket or placeholder ack

Counter-recommendation: **placeholder ack** (after the review step completes, emit only a single line `AI 审核已完成`); the real findings emit belongs to #326.

Ruling: **placeholder ack + stub-llm path**, because:
- #326's blocking auto-revision loop needs the real findings shape (including the blocking marker); that layer of wire design is #326's independent review point.
- This ticket's goal = the user can see the complete three-phase transition `审核发起 → 审核中 → 审核完成`; missing any one phase makes it unverifiable.
- The placeholder ack reuses the `completeStep(deps, stepId, { hasChanges: false })` path (the review step does not touch the worktree and produces no changes); `insertMessageRow` with system role = `AI 审核已完成`.
- At #326, replace the placeholder ack with the real findings emit + blocking decision; the step kind/action vocabulary stays unchanged.

## 2. Premortem (3 death causes + guardrails)

### Cause P1 · the `AI 审核进行中…` composer placeholder conflicts with the steer/in-progress state

**Scenario**: when the review step is claimed/pending the chip should be `审核中` + composer placeholder `AI 审核进行中…`; at the same time the user may be sending a steer (building/review share the phase), and the placeholder then has to be the steer copy.
**Guardrail**: the chip copy is decided by the "active step kind", not by phase alone; add a reviewActive flag = `steps.some(s => s.kind === 'review' && (s.status === 'claimed' || s.status === 'pending'))`. The phase UI row does not read active steps and stays static. The composer placeholder reads reviewActive with priority over the phase UI placeholder.

### Cause P2 · build state changes while the modal is open (confirm/reject/rerun/reopen) make `开始审核` hit a dead endpoint

**Scenario**: the user opens the modal to pick an Agent at the confirm gate, clicks `重跑`/`重开` once while the modal is still open, and the buildId goes stale. Clicking `开始审核` → POST /api/builds/{oldId}/steps → 404.
**Guardrail**: at the moment `开始审核` is clicked, verify `buildId === latestBuildId`; if not equal, abort and re-fetch (any in-flight mutation). The server must also return 409 to distinguish "buildId does not exist" from "phase does not allow" (cf. the steer 409 rejection rule).

### Cause P3 · the placeholder ack makes "#312 AC2 full chain genuinely usable" a misnomer

**Scenario**: the reviewer sees verify evidence = modal→start review→in review→placeholder ack `AI 审核已完成`, and concludes AC2 without findings + blocking does not count as "full chain".
**Guardrail**: this ticket's PR description states explicitly "slice of #312: M7-W5.1 completed segment; AC2 sub-segment modal→review step genuinely usable; findings + blocking loop belongs to #326; #312's AC closes when #326 merges". Verify screenshots label the phase name (w5.1).

## 3. Implementation cut points

### shared (packages/shared/src/records/step.ts)
- `stepKindSchema` gains `'review'`
- `buildStepActionBodySchema` gains a `{action: 'review', agentId, focus?}` branch
- new constant `REVIEW_ANNOUNCEMENT = '发起了 AI 审核'`
- `phase.ts` doc gains a comment on the review-step active-period chip copy

### server
- `applyBuildStepAction` gains a `body.action === 'review'` branch:
  - validate phase ∈ {confirm, review}
  - insertMessageRow role=user content=REVIEW_ANNOUNCEMENT
  - enqueueStep(deps, buildId, 'review', teamId, reviewPrompt) where reviewPrompt includes the todo's full plan.md + user focus
- `completeStep` gains a `step.kind === 'review'` branch: phase unchanged (review stays review) + emit the placeholder ack message
- Errors: build not found → NotFoundError; illegal phase → 409

### daemon
- `CONTINUE_PROMPTS.review`: leave an empty-string placeholder (the review step = first turn; the prompt is injected by the server instruction)
- runner.ts: `claimed.step.kind === 'review'` needs no worktree (review does not modify the worktree); reuse the isChief path decision logic (use an `isReview` flag; prepare the worktree only when `!isChief && !isReview`)
- placeholder ack: handled on the completeStep server side; the daemon does not emit it directly (all accounting goes through the server)

### web (apps/web)
- new file `apps/web/src/detail/review-dialog.tsx`:
  - DialogShell 560-wide variant (width=560 parameter)
  - title `AI 审核` (derived from the #312 spec, promoting an i18n key)
  - search row (reusing chief-pick-search)
  - Agent rows 560×65 (reusing chief-pick-row geometry)
  - optional focus textarea (with placeholder `希望 Agent 审核时重点关注什么？（可选）`)
  - 32×32 primary row right-anchored `开始审核` button (@x943 geometry)
- `overlays.tsx` reuse: export `ReviewDialog` or a standalone file (same family shape)
- `OverlayState.kind` gains `'review'`
- composer.tsx aiReview visibility rule already implemented (r7 §4.1); add `onReview?: () => void` parameter
- todo-detail-page.tsx:
  - wire `aiReview && onReview={() => setOverlay({ kind: 'review' })}`
  - render ReviewDialog (live: mutate stepAction {action: 'review', agentId, focus?}; fixture: display only, no trigger)
  - chip copy switches to reading: `reviewActive ? '审核中' : ui.chip`
  - composer placeholder: `reviewActive ? 'AI 审核进行中…' : ui.placeholder`

### shared wire compatibility
- stepJournalRowSchema unchanged (the status field already covers claimed/pending/done)
- new review-step message content shape: role=user, content=REVIEW_ANNOUNCEMENT (plain text, same shape as MERGE)

### i18n
- zh additions: `AI 审核` (already present, used by aria-label), `发起了 AI 审核` (not in i18n, carried by the shared constant), `希望 Agent 审核时重点关注什么？（可选）`, `开始审核`, `审核中`
- en gets the same additions (i18n-coverage CI gate; precedent `本地闸 vs CI 闸`)

### verify
- verify-pacman stack: mock a build into the confirm gate → open modal → pick Agent → start review → timeline shows `发起了 AI 审核` + chip `审核中` + composer placeholder `AI 审核进行中…` + stop button usable → wait for the review step to finish → chip back to `审核` + placeholder back to `请求修改…`
- e2e: apps/web/e2e/review-modal.spec.ts (open modal/pick Agent/start → state change/timeline row/stop button usable)

## 4. Do-not-touch list (No Negative Echo + prior user agreements)

- steer implementation (#308 / PR #325): untouched; holes found are noted as PR comments
- DialogShell's existing 448-width rule: the family rule is not changed (only the width parameter is added)
- phase nine values: no reviewing added (chip copy relies on the reviewActive flag)
- chief-agent-dialog: not reused (the AI review modal is 560 wide + contains a textarea, a different shape from the 448-wide picker)
- runner.ts CONTINUE_PROMPTS vocabulary key count: review is added but the chief placeholder is kept

## 5. Wrap-up

- three gates green (pnpm lint / format / typecheck)
- verify-pacman evidence + e2e pinned surfaces
- commits `web(312)` `server(312)` `daemon(312)` by change surface
- PR body references Parent #302, with closes #312 (footnote: merges and closes after #326 wraps up); in effect this ticket only closes the "W5.1 segment"
