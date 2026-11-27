# Pin a new task to a computer — one-page design, 2026-11-27

Newcomer first: someone who installs Cairn today and has one computer sees no change in the add-task row. When they connect a second computer, the row gains one small `自动` chip. They do not need to know what routing is; opening the chip shows computer names they already gave their machines. Choosing one means this task waits for that computer. No account, payment or key is added; the choice is stored on the task in the existing local task record. If the machine id is wrong or retired, creation fails with a plain error instead of silently ignoring the choice.

Owner decision (translated to English from owner feedback on 2026-11-27):

> "Why show a line saying waiting for the runner to come online? I do not want that — just give me a subtle hint."

> "I do not want a placeholder element affecting what is below... if that element appears, everything underneath shifts downward."

Approved direction: direction 1 from `.claude/prototypes/pin-computer.html`, the inline chip, with the offline hint inside the chip/menu/tooltip only. Choosing an offline computer is allowed; the task waits for it. Coordinator chat gets no composer chip; its `create_todo` tool gains an optional machine parameter used only when the owner names a computer.

Research: `docs/research/pin-task-computer-2026-11-27.md`.

## State and writers

The only persisted state is the existing `todo.routeOverride.machineId`; there is no new column or table.

Writers:

1. `POST /api/projects/:id/todos`: accepts optional `machineId`, validates that the machine exists in the project team, is registered, and `retiredAt` is null, then creates the todo with `routeOverride: { machineId }`.
2. Coordinator `create_todo`: accepts optional `machine` as a machine id, applies the same validation (plus rejecting a contradictory `platform` before insertion), and passes the same route override into request-todo creation.
3. Existing task route-override editing paths remain unchanged readers/writers.

Readers:

1. Scheduling already reads `todo.routeOverride.machineId` as `explicit-pin`.
2. The task add row reads only the already-loaded machine list used by the Machines panel; it does not fetch or persist machine state itself.

Failure behavior:

- Unknown, other-team or retired machine id: create is refused before insertion.
- Chosen machine offline: creation succeeds; scheduling waits for that machine under the existing explicit-pin behavior.
- Chosen machine later retired or unavailable: existing queue/failover behavior remains responsible for explaining and recovering; this feature does not change it.

## UI brief

Surface: Coordinator chat / Tasks panel.

Goal: when creating a task, let the user choose which of their computers runs it, while automatic stays the default.

Reference opened before coding: `docs/design/references/first-run/amp-run-location-chooser.jpg` — take the compact creation-time location chip and small menu, not Amp's machine-connection copy.

Draft: owner-picked direction 1, `.claude/prototypes/pin-computer.html`.

Stay unchanged: the add row remains one row high; below-list positions do not move when the chip opens, closes or changes value; the Coordinator chat composer gains no machine control; one-computer and zero-computer users see no picker; existing route override dialog behavior stays as it is.

Component x state list for `TasksAddInput` machine chip:

| Component | empty | loading | error | offline | slow network | rapid repeated input | long content | pending question | 390px | dark | transition |
|---|---|---|---|---|---|---|---|---|---|---|---|
| machine chip | hidden with 0/1 machine | machines already load with panel; no extra skeleton | create failure uses existing toast | chosen offline machine keeps an offline dot/menu label inside the chip | submit path already disables while pending; no extra machine fetch | repeated chip/menu presses keep the last selected value and do not move rows | long machine names truncate in chip and wrap in menu | unrelated to chip | measured in e2e/screenshot | measured in e2e/screenshot | select menu uses existing select motion; no layout-property animation |

Craft answers:

- Arrival: nothing appears for a new one-computer user. When a second machine exists, the chip is already present when the add row opens; selection changes text/dot in the same frame. No row below moves.
- States: no new loading skeleton because machine data is already part of the panel data. A create failure uses the existing toast and the entered text remains in place. Offline and long-name cells are fixture/e2e seeded.
- Finish: machine names use existing machine display/icon pieces; counts are not involved; dark mode uses token colors only; status dots sit inside the existing icon/text line.
- Measure: C34 e2e (`e2e/no-layout-shift.spec.ts` and `e2e/chief-home-add-task.spec.ts`) measures CLS = 0 and bounding boxes of the first task row before and after opening the chip and choosing an offline machine. Fixture screenshot review covers 1440/390 and light/dark; axe coverage comes from the touched journey.

## Tests

Red-first behavior tests:

1. Create through HTTP with a valid machine id writes `routeOverride.machineId`.
2. Create through HTTP with an unknown/other-team/unregistered/retired machine id is refused and creates nothing.
3. Coordinator `create_todo` with `machine` writes the same route override.
4. Coordinator `create_todo` rejects an unknown, other-team, unregistered or retired machine, as well as a contradictory `machine` + `platform` pair.
5. Tasks panel e2e: choosing a machine sends `machineId` in the create request.
6. Tasks panel e2e `C34:`: opening the picker and choosing an offline machine causes zero CLS and zero bounding-box movement in the task list below.
