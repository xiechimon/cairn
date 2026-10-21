# #1423 evidence: a queued task has no primary action

Base = `e658294` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

`PHASE_UI.queued.action` is `null`. The detail header and the fresh block show no primary button for a queued task, and the queued board card shows no hover ▶ 开始. A `todo` task keeps its 开始 in both places.

## e2e: `apps/web/e2e/queued-action.spec.ts`

Stubbed live boot (no `?scenario=`, `page.route` answers `/api/*`). Two tasks: `queued` with a build, a pending plan step carrying the #1108 queue projection (`blocked: machine-offline`) and `waitingOn: machine`; `todo` with no build.

- `e2e-old-leg.txt`: the spec on base `e658294`. 2 failed, 1 passed. The queued detail header and the queued card each resolve one 开始 button (`Expected: 0, Received: 1`). The chip (排队中) and wait-row (排队中：等机器上线) assertions before them pass, so the failures are not vacuous. The todo header test passes.
- `e2e-new-leg.txt`: on branch `fa42cb2`, `queued-action` + `phase-chip-words` + `agent-detail` (the two specs that pin the queued chip and the agent detail waiting row). 52 passed.
- `e2e-affected.txt`: `pnpm --filter @pacman/web e2e:affected` on the branch. `phase.ts` is a shared path, so it ran the full suite: 1092 passed, 3 failed.
- `e2e-preexisting-on-base.txt`: those 3 tests on base `e658294` with `--repeat-each=3`: 9/9 failed. `accent-typo` sidebar mark (light, dark) wants `mask-size: 100% auto` and gets `100%`; `segmented-controls` sched freq reads the same ink on the idle and chosen radio. They fail without this change too, as already recorded in `docs/verify/1400/e2e-preexisting-on-base.txt`.

Screenshots (written by the spec with `PACMAN_E2E_EVIDENCE`):

| shot | `old/` (base) | `new/` (branch) |
|---|---|---|
| `detail-queued.png` | header 开始 beside the 排队中 chip | no header button; chip and wait row unchanged |
| `detail-queued-head.png` | header crop | header crop |
| `board-queued-hover.png` | hovered queued card floats ▶ 开始 | hovered queued card shows no 开始; the todo card is unchanged |

## Click trace on the base build: `old/click-trace.json`

A one-off probe (not committed) on base `e658294`, same stub: open the queued task, click the enabled header 开始, wait 1.5 s. URL, header text and dialog count are the same before and after, and the click sends no non-GET request. This is the no-op the ticket describes: `handlePrimaryAction` has no `queued` branch on the live path.

## Build artifact: `dist-phase-ui-new.txt`

The compiled `PHASE_UI` rows from the fixture build that the new-leg run produced: `queued` carries `action:null`, `todo` keeps `` action:`开始` ``.

## Rerun

```sh
cd apps/web
PACMAN_E2E_EVIDENCE=docs/verify/1423/new E2E_PORT=8398 pnpm exec playwright test queued-action.spec.ts
```
