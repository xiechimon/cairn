# Machine concurrency cap + queue visibility (machines page + chief drawer + task detail, #1108)

One machine runs N rounds at once (N = `machine.maxConcurrent`, DB NOT NULL default 3 - the 0000 migration historical value; #503 once dropped the column, and the drop premise "daemon serial never hits the cap" expired with this ticket's daemon parallel loop). **Only over N queues**: the server claim gate (`tryClaim` counts this machine's claimed >= cap then sends no step) + the daemon local gate (GET me reads the cap, version mixing protects a new daemon against an old server at 1 serial), both sides same value. Queuing has a real presentation: the pending step's position + the waiting object (the server queue projection `stepQueueProjector` - the steps query carries `queue`, the chief threads carry `turnQueue`), the chief drawer's in-flight existence row and the task detail's streaming row switch from `处理中...` to `排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）`; the machines-page in-row `执行中 n/N` read annotation + the `并发` selector (the row's second live control, the Popover listbox canonical shape). Slot handoff: the step terminal `finishStep` sends a team wake, a full machine's hanging claim long-poll is woken instantly (not waiting for the 75s hold expiry).

## Sub-features

- `mconc-cap-gate` claim capacity gate: this machine's claimed step count >= `maxConcurrent` -> claim empty-handed, the step stays pending (a legal queued state, does not enter the failure funnel - the pinned-machine-offline / runtime-gate-blocked / zero-online three-family sweep semantics unchanged). SQLite `machine.maxConcurrent` (integer default 3) is the truth column.
- `mconc-daemon-parallel` daemon parallel loop: claim-then-fire without await (`sessionHandles`/`stopRequests` already indexed per stepId), the canon line `step <id> for conv <conv> (n running)`'s n = the in-flight count; graceful stop = the loop exits then allSettled the in-flight set then resolve.
- `mconc-local-cap` daemon local gate: the GET me `maxConcurrent` cache + refresh on the presence beat (30s); absent (old server) = 1 serial. Lowering does not preempt in-flight steps (both gates only block new claims).
- `mconc-queue-projection` queue projection: `steps query` pending rows carry `queue{position, waitingFor}`; `GET chief/threads` active threads carry `turnQueue` (same shape). A pinned step's position only counts that machine's visible set (pinned same-machine or unpinned - claimCandidates same filter same order); unpinned steps count the whole team's FIFO (an honest approximation, over-report not under-report); waitingFor = the pinned machine + the running/capacity snapshot, unpinned null.
- `mconc-queue-row-queued` queue row label: pending + projection in place -> the live existence row `排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）` (the unpinned shape `排队中：等空闲机器（前面 {ahead} 个）`); claimed (the projection exits) -> falls back to the existing `处理中...` convergence. The queue row carries no phase face (signalAt/skills - the step is not running).
- `mconc-machine-readout` machines-page read annotation: `[data-machine-running]` text `执行中 {n}/{cap}` (n = the claimed count, GET machines records `runningSteps` derived per row).
- `mconc-machine-control` machines-page concurrency selector: `button[aria-label="并发上限"]` (with `data-machine-id`, the Popover listbox 1..8 tiers + the API-set 9..16 merged), selection = `PATCH /api/machines/{id}` single field `{maxConcurrent}` (range 1..16, out of range 400); the field absent (old server) -> the control and the read annotation both exit as a group.
- `mconc-finish-wake` slot handoff: `finishStep` terminal sends a team wake - a full machine's hanging claim immediately retries the claim (the enqueue wake only covers the new-step path).

## How to get to it (user POV)

- Machines page (`/app/resources/machines`): each row's right segment `执行中 n/N` + `并发 N` selector; changing N changes this machine's parallel quota (only narrows after the current batch finishes).
- Chief drawer: a full machine's dispatched rounds show `排队中：等 <机器>（n/N 在跑，前面 M 个）`; claimed returns to `处理中...`.
- Task detail conversation area: pending steps same-shaped queue row.
- Driving (`vp.mjs list machine-concurrency` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive machine-concurrency recommended-concurrency`: the machines-page recommended concurrency; also needs a real daemon (prerequisites below).
  - The stale-judged cases that refuse without `--force` (prints why on refusal): `vp.mjs drive machine-concurrency agent-concurrency-cap` (creating an agent without machineId 400s since ADR 0019); `vp.mjs drive machine-concurrency cap-and-queue` (creating an agent without machineId 400s since ADR 0019); `vp.mjs drive machine-concurrency zombie-claim` (creating an agent without machineId 400s since ADR 0019).

## Driving conventions

- The driving entry = `scripts/drive-1108-concurrency.mjs` (gated stub LLM + real daemon; four families 15 checks: the parallel canon line / stub request-interval overlap, the gate-block-queue-keep, turnQueue / queue-row / read annotation, slot handoff, PATCH range). Evidence `docs/verify/1108/` (with the rerun-recipe README).
- Unit face: server `test/machine-concurrency.test.ts` (gate/projection/write face 9) + `test/machine-pin.test.ts` (#1259 home-machine version: steps only dispatch to the agent's home machine, pin filtering retired - the session-affinity family retired and deleted with #1259); daemon `test/machine-loop.test.ts` parallel loop P1-P5; web `test/activity-live-row.test.ts` queue label Q1-Q6.
- e2e face: `machines-local.spec.ts` (the in-row live controls = two) + `machines-shell-switch.spec.ts` C1-C4 (PATCH single field / read annotation / old-shape exit) + `dead-buttons.spec.ts` (zero dead buttons narrowing the pin).

## Gotchas

- The machines-page row order = the local seed row first - probe/e2e assertions on the concurrency control pin by `data-machine-id`, `.first()` grabs the wrong row and gives a false red (the local row also carries the control, default 3).
- The chief-bound Agent's PATCH agent slot requires the `thinkingLevel` key (nullable but required key), missing the key 400s and the error does not name it.
- A new thread's default pin chain = `body.pinnedMachineId ?? chiefRow.machineId ?? null` - PATCHing the chief's primary machine makes all new threads pin this machine (the probe uses it to build the full-capacity scenario).
- The daemon local gate only refreshes a cap change after at most 30s (the presence beat) - the server gate is the authority side, full capacity blocks regardless; the probe times PATCH earlier than issuing the thread so it is imperceptible.
- #503's "in-row zero button / the concurrency cap must not return" negative pin narrows to "zero dead buttons" with this ticket: #503 dropped a read-only dead field, now it is a live control with a real write path and consumption chain (the user's 2026-10-10 exact words "give a number in the concurrency limit" is the reversal basis).