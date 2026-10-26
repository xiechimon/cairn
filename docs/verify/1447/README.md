# #1447 evidence: a queued card sits in `执行中` with a waiting footer

Base = this branch before the #1447 commit (board code unchanged since `bbd1e858`). Branch = `claude/optimistic-albattani-r5pmfn`.

`packages/shared/src/phase.ts` `boardColumnFor('queued')` is `执行中` (in progress): a started task sits on the step its build will run, as the reference product's 2026-09-12 changelog says ("a queued todo sits on the step its build will run"). This replaces the old `queued → 待开始` fold, which `docs/spec/02-architecture-parity.md` §4.1 marked [inferred]. The web in-progress column accepts queued (`apps/web/src/board/columns.ts`); `IN_FLIGHT_PHASES` stays planning / building. A queued card takes the in-progress footer in a waiting form (`apps/web/src/board/todo-card.tsx`): a static hourglass, secondary ink, "agent · `排队中`", or `等机器` / `等额度` when held. The breathing robot stays for planning / building. A queued card dropped on `待开始` opens the #755 reset dialog.

## Unit

- `unit-old-leg.txt`: base.
  - web `columns.test.ts`: 3 failed. canDropOnColumn(queued, 'todo') is false, `cardFace(queued)` is `{ kind: 'queued', action: null }`, and the `执行中` column does not accept queued.
  - shared `vocabulary.test.ts`: 2 failed (`expected ‘待开始’ to be ‘执行中’`, `canBoardDrop('queued','todo')` false).
  - server `phase.test.ts`: 1 failed (same column mapping).
- After the change: web `columns.test.ts` + `dnd.test.ts` 46 passed, shared `vocabulary.test.ts` 38 passed, server `phase.test.ts` + `manual-drop-matrix.test.ts` 23 passed.

## e2e: `apps/web/e2e/board-queued-column.spec.ts`

Stubbed live board (no `?scenario=`): a healthy queued card, a held queued card (`waitingOn: machine`), a todo card and a building card.

- `e2e-old-leg.txt`: base. 2 failed. The queued card is not in `执行中` (`element(s) not found`); dragging it to `待开始` does not mark the column as a drop target (`Received: ""`).
- `e2e-new-leg.txt`: branch. 4 passed (2 behaviour tests, plus an axe-core WCAG 2.1 AA scan of the `执行中` column in light and dark: the fixture board has no queued card, so `a11y-axe.spec.ts` from #1442 never reaches the waiting footer). Columns hold `待开始` 1 / `执行中` 3; the footers read `r3-builder · 排队中`, `r3-builder · 等机器` (no breathing class) and `r3-builder · 执行中` (breathing); the drop on `待开始` opens `把任务重置回待开始？`.
- `queued-action.spec.ts` and `board-queued-drop.spec.ts` (the #1423 / #1434 pins) now look for the queued card in `执行中`, and pass with `board-dnd`, `board-dnd-live`, `quota-wait-board`, `paper-card` and `detail-queued-exit`: 50 passed.

- `e2e-after-main-merge.txt`: after merging origin/main (which brought the #1442 axe gate), `a11y-axe.spec.ts` plus the five queued specs: 55 passed.
- `e2e-full.txt`: `pnpm --filter @pacman/web e2e:affected` on the branch after the first code-review round (shared `phase.ts` and `i18n/` changed, so it ran the full suite): 1133 passed, 0 failed.

| shot | `old/` (base) | `new/` (branch) |
|---|---|---|
| `board-columns.png` | both queued cards in `待开始`; the healthy one shows nothing, the held one's `等机器` is clipped to `等` | both in `执行中` with an hourglass footer; the building card keeps the green robot |

## Rerun

```sh
cd apps/web
pnpm exec vitest run test/columns.test.ts test/dnd.test.ts
PACMAN_E2E_EVIDENCE=docs/verify/1447/new E2E_PORT=8398 pnpm exec playwright test board-queued-column.spec.ts
```
