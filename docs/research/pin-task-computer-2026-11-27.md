# Pin a task to a computer — prior art, 2026-11-27

Question: when a user creates a task, how should they choose which of their computers runs it, and what should happen when that computer is offline?

| Source | How it does it | Trade-offs | Evidence |
|---|---|---|---|
| GitHub Actions | A workflow job names runner constraints with `runs-on` labels. If no online idle self-hosted runner matches, the job stays queued until one comes online; if a runner does not accept an assigned job within 60 seconds it is requeued. | Strong, explicit constraint; queueing is normal. Labels are powerful but indirect for a consumer UI. | Observed: https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow and https://docs.github.com/en/actions/reference/runners/self-hosted-runners |
| Kubernetes | A pod can use `nodeSelector` or node affinity to constrain scheduling to matching nodes. A pod that cannot be placed remains pending instead of silently moving to a non-matching node. | The constraint is authoritative and visible in scheduling state; too low-level for Cairn's user-facing copy. | Observed: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/ |
| Buildkite | Pipeline steps target agents through queue and agent tags; agents pick only matching work. | Simple operational model, but tags and queues still expose infrastructure vocabulary. | Observed: https://buildkite.com/docs/pipelines/configure/step-types/agent-tags and https://buildkite.com/docs/agent/v3/queues |
| Amp | The composer has a small run-location chip. Its menu offers the cloud default and machine connection choices inline, without moving the composer layout. | Closest UI reference: the control is present where work is created, compact by default, and opens only on demand. It is a connection/location chooser more than a per-machine pin. | Observed reference shot in this repo: `docs/design/references/first-run/amp-run-location-chooser.jpg` |
| Cairn proposal | Default stays automatic. When at least two usable computers exist, the new-task row carries one inline chip. The chip stores one explicit machine choice or automatic; offline machines remain selectable, and the offline hint stays inside the chip/menu/tooltip. The task waits for the chosen machine. | Matches the established explicit-pin semantics already in Cairn scheduling, keeps quick-add one row high, and does not expose labels/tags. It adds one control only when the choice is real. | Inferred from the rows above plus Cairn's existing `routeOverride.machineId` scheduler path |

## Pattern that fits Cairn

Cairn already treats an explicit machine as a scheduling constraint through `todo.routeOverride.machineId`: the worker candidate resolver classifies it as `explicit-pin`; a pinned machine that is not currently claimable becomes the machine the task waits for, with alternates exposed for manual recovery. The feature should write that existing field at creation time instead of adding a parallel pinning mechanism.

The UI pattern that fits is Amp's compact creation-time control, narrowed to Cairn's need: one inline chip in the task add row. It appears only when there are at least two registered computers with ids, because with zero or one real choice the control would be inert.

## Recommendation

1. Extend the task-create request with optional `machineId`, validate it belongs to the team and is not retired, and write `routeOverride: { machineId }` during creation.
2. Add an optional `machine` parameter to the Coordinator `create_todo` tool, described as only for cases where the owner names a computer, and map it to the same field.
3. In the Tasks panel add row, reuse the existing select/machine icon/status dot pieces for a compact chip. The offline state is communicated inside the chip and menu; no new row enters the page flow.

Code areas: `packages/shared/src/records/todo.ts`, `packages/shared/src/protocol/chief-tools.ts`, `apps/server/src/routes-todos.ts`, `apps/server/src/services/todos.ts`, `apps/server/src/services/coordinator-request.ts`, `apps/server/src/services/chief-tools.ts`, `apps/web/src/board/tasks-add-input.tsx`, `apps/web/src/board/tasks-panel.tsx`, `apps/web/src/board/home-c.tsx`.
