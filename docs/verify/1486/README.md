# #1486 evidence: a started card goes back to todo only through reset

Base = `29e60bb7` (origin/main). Decision on the ticket: option 3.

`PATCH /api/todos/:id` with `phase: 'todo'` on a started card (`isStartedTodoRow`: in progress, or any of `latestBuildId` / `lastRunAt` / `hasPlan` / `hasChanges` set) answers 409 with `POST /api/todos/:id/reset` in the error (`apps/server/src/routes-todos.ts`). Two moves still work:
- closed → todo is a reopen and keeps its history, as in the detail menu and `reopen_todos`;
- a card that never started still moves.

The route's stop-on-exit branch now covers done only; nothing can reach its todo half any more.

| file | routes-todos.ts | result |
|---|---|---|
| `old-leg.txt` | origin/main | 11 failed, 45 passed. The 7 started cases answer 200; `manual-drop-matrix` done (with changes) / building → todo answer 200; the two #1447 / #1451 PATCH-to-todo tests move the card |
| `new-leg.txt` | this branch | 56 passed (`patch-todo-reset-gate`, `manual-drop-matrix`, `close-stops-active-steps`) |

Tests that changed meaning:
- `close-stops-active-steps.test.ts` "queued → todo" and "planning → todo" now pin the 409, with the step untouched and no stop sent.
- The #1453 late-report test reaches todo by closing and then reopening.
