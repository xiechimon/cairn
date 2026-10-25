# Human bounce-back at the review gate (detail page, #701 B-C12)

In the review rest state (the step has closed, no active session), a human says "no": the task returns to planning for re-planning. Previously the person at the review gate could only nod — the composer's `请求修改…` was fillable and clickable, but sending hit the steer surface's 409 (no claimed step), the page showed only one small line; the more-menu had no bounce-back entry at all. The bounce-back goes through the server action surface `POST /api/builds/{id}/steps {action:"revision", side:"plan", feedback, clientMessageId}` (the same shape reused by the confirm-gate rejection), and the flow walks the review -> planning edge of `assertPhaseTransition` (shared with the #330 blocking auto-reflow).

## Sub-features

- `reject-menu-entry` the more-menu's `请求修改` row (`data-action="reject"`, MessageSquare icon) — rendered only in the live review rest state; absent on the fixture surface / other phases / while a row is running (the four-row capture geometry is byte-unchanged, the five-row surface's row-band re-pinned by `:has()`).
- `reject-dialog` the popup (role=dialog, accessible name `请求修改`): the textbox is required (the confirm button `请求修改` is disabled on an empty draft; since #951 the `.dlg-reject`/`.reject-feedback-input`/`.reject-confirm` class hooks retired); submitting = the revision action surface; on refusal (a 409 race), the popup does not close and the reason shows below the input row (the same rule as XMON-89).
- `reject-composer-direct` sending from the composer in the review rest state = the same revision action (the `请求修改…` placeholder is fillable, therefore sendable); on success the draft clears, on refusal the draft is kept + a `.composer-reject` hint row.
- `reject-steer-boundary` while running (a claimed/pending step in place), review keeps the steer follow-up surface — the bounce-back only acts at the rest gate, the two do not contend.
- `reject-landing` the bounce-back lands: the phase -> planning (the chip flips instantly via the SSE invalidation key, no reload) + a re-planning step is enqueued (a pending plan step, the prompt single-sourced from the shared `buildReviewRejectPrompt`, stating "the changes are still on the session branch, existing artifacts are not discarded") + the feedback row lands in the transcript (role user) + plan / branches / latestBuildId are all preserved (nothing deleted, nothing orphaned).

## How to get to it (user POV)

- After a task reaches review (the executing step closes): the detail page's header `更多` -> `请求修改` -> fill the feedback in the popup -> confirm.
- Or type the change request directly in the composer -> Enter / the send button.
- Driving: this feature has no current case; all registered ones are judged stale and refuse to run without `--force` (the refusal prints the reason), `vp.mjs list review-reject` lists the usage:
  - `vp.mjs drive review-reject blocking-revision`: its dependency setup-review-seed.mjs creates the agent without machineId, 400 since ADR 0019.
  - `vp.mjs drive review-reject human-reject`: its dependency setup-review-seed.mjs creates the agent without machineId, 400 since ADR 0019.

## Driving it with verify-cairn

Preconditions: `launch.mjs` stack up (a pure live stack — no daemon / no LLM dependency, the machine wire is driven equivalently over HTTP by the seed and the probe); `setup-review-seed.mjs` pushes to confirm (outputs todoId/machineToken).

- After the seed, the probe drives the confirm -> building -> review steps itself (claim + done success):
  `REVIEW_MACHINE_TOKEN=<token> node scripts/drive-review-reject.mjs <todoId>`
- Path A: click `.detail-head-icon--more` -> `.more-menu-item[data-action="reject"]` -> the dialog (role=dialog `请求修改`), fill the textbox -> role=button `请求修改`; observe the chip `.detail-chip` flipping to `规划中` without a reload (#951 carrier migration; the .detail-chip class hook survived until the #953 final account).
- Path B (the probe first drives the task back to review over the machine wire): fill `.composer-input` with text -> Enter; observe the chip flipping to `规划中`, the draft cleared, and no `.composer-reject` row.
- The three-surface truth: `GET /api/todos/{id}` phase=planning with latestBuildId unchanged; `GET /api/builds/{id}/steps` has the new pending plan step; `GET /api/conversations/{id}/messages` has the feedback row; `GET /api/builds/{id}/plans` v1 preserved; SQLite's `step.prompt` template head = `用户在审核关口请求修改。修改反馈：「` and contains `会话分支/不要丢弃既有产物`.
- 2026-10-03 live run 22/22 PASS, evidence `docs/verify/701/` (7 screenshots + result.json). The fixture/stub-surface regression = the e2e `review-reject.spec.ts` (5 cases: action-surface routing / menu popup / phase boundary / steer boundary / 409 draft-keep).

## Gotchas

- **The bounce-back cannot ride the message surface**: the rest review has no claimed step, `POST /api/conversations/{id}/messages` is permanently 409 — when regressing, pin the probe's `ui-no-reject-hint-line` and `A-api-replan-step-pending` first.
- **The chip flipping without a reload** = the real SSE-invalidation-key path; a `waitChip` timeout means the publish chain is broken (the setTodoPhase funnel's publishTodoDoc), not a rendering problem.
- **Changing the more-menu row order must change the overlay.css `:has([data-action="reject"])` row-band rule together**, otherwise on the five-row surface the `关闭` row eats the delete red band and the delete row loses its band.
- The popup's feedback-required gate is intentional (the re-planning round takes it as the work instruction); do not "quick bounce-back" with an empty draft.

## Cross-reference

- Same family: #700 (the daemon verdict-extraction surface, B-C13), #702 (the failed-review merge-path deadlock, B-C17) — the three halves together make "the review gate can close the loop".
- Same-edge precedent: the #330 blocking auto-revision loop (`drive-review-blocking.mjs`, review-modal.md).
- Same-shape precedent: the confirm-gate rejection (r5 §4, `buildReplanPrompt`), the failed-surface restart (failed-send.md).
