# Retire todo reset endpoint and dead task-detail branches (#5338)

## Decision

Retire `POST /api/todos/:id/reset` and the `resetTodo` service completely, plus the dead
`DocPane` changes/diff/version branches, dead `Transcript` plan/liveStep/agent/elapsed
branches, and the unused `aiReview`/`onReview` Composer contract.

## Server surface

- Remove `POST /api/todos/:id/reset` from `routes-todos.ts`, its `resetTodoBodySchema`,
  and the `resetTodo` service in `services/todos.ts`.
- The PATCH `phase: 'todo'` gate stays: a started card still cannot move back to
  `todo`. The 409 message no longer points at `/reset`; it states the rejection
  directly. A closed card can still return to `todo` (the existing reactivation
  path), which is how tests formerly using `/reset` migrate.
- Remove `/api/todos/{id}/reset` from `packages/shared/src/protocol/rest.ts`.

## Web surface

- `hooks.ts`: remove `useDocumentDiff` (sole caller of `GET /api/documents/:id/diff`;
  the endpoint stays for other clients) and the `resetTodo` mutation.
- `mappers.ts`: remove `mapPlanDiff` and the `kind: 'plan'` transcript production.
  `mapPlanVersions` dies with `chat.planVersions` (only fed the retired version menu).
- `fixtures/records.ts`: drop `plan`/`elapsed` TranscriptItem variants.
- `docpane.tsx`: keep the plan-doc body and `DiffFileBody` (used by `ChangesCard`);
  remove `mode`, `changes`, `planDiff`, `planVersions`, `now`, `versionMenu`,
  `onVersionMenu`, `onCompare`, `onBase`, `onToggleExpand`, `buildId`,
  `hideVersion`, `onDocView`, `VersionMenu`, `VersionControl` branches.
- `overlay/plan-dropdown.tsx`: delete (sole consumers were DocPane and design
  specimens).
- `board/reset-confirm-dialog.tsx`: delete (gallery-only).
- `transcript.tsx` / `transcript-column.tsx`: remove `plan`, `elapsed`, `liveStep`,
  `agent` props and branches, and the `onOpenPlan` threading.
- `composer.tsx` / `overlay/composer-wire.ts`: remove `aiReview`, `onReview`,
  `reviewAvailable`, and the `review` slash command.
- `side-chat.tsx`: drop the `filter(kind !== 'plan')`, `liveStep`/`agent` props,
  `aiReview={false}`, `onOpenPlan`, and `planVersions` plumbing.
- `use-thread-chat.ts`: drop `planVersions` from the chat model.
- Design specimens (`product-detail.tsx`, `product-overlays.tsx`): remove
  reset/plan-dropdown/review specimens; simplify the DocPane specimen to plan-only.

## Tests

- Delete `reset-todo.test.ts`; delete the `resetting a todo` case in
  `merge-gate-tables.test.ts`.
- Gate-message assertions in `patch-todo-reset-gate.test.ts`,
  `close-stops-active-steps.test.ts`, `manual-drop-matrix.test.ts` move to the new
  wording.
- `github-writeback.test.ts` reactivation flows migrate to PATCH `closed` →
  `todo` (the surviving path).
- `machine-attachment.test.ts` and `machine-wire.test.ts` cleanup assertions
  migrate to `DELETE /api/todos/:id` (the surviving cascade).
- `wire.test.ts` route registry drops the reset entry.

## Acceptance

Zero references to `/api/todos/:id/reset`, `resetTodo`, `useDocumentDiff`,
`mapPlanDiff`, `VersionMenu`, `VersionControl`, `aiReview`, `onReview`, or the
retired TranscriptItem kinds outside historical docs. `pnpm prepush` and
`pnpm test:changed` pass.
