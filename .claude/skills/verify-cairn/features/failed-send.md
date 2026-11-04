# Failure-surface send (detail-page composer failed phase, #320/#322)

Users type feedback into the failed task's detail-page composer and send it -> triggers a feedback-carrying restart of a new round (not the steer 409 semantics): `POST /api/builds/{id}/steps {action:"restart", feedback, clientMessageId}` -> the server starts a new build (withPlan carries the failed round) + the feedback row lands in the new conversation + the first step enqueued (the instruction carries the feedback) + the failed -> queued funnel. Original-site measurement: sending a message in the failed state = triggering a new round, the message enters the conversation with the new round (r9 §3.3).

## Sub-features

- `failed-composer-send` the failed-phase detail-page composer is editable + sendable (not read-only); the send button goes through the restart semantics.
- `restart-action-wire` send -> `POST /api/builds/{id}/steps {action:"restart", feedback, clientMessageId}` (the restart variant of shared buildStepActionBodySchema).
- `restart-new-build` the server starts a new build (withPlan carries the failed round) + the failed -> queued funnel; the feedback row lands in the new conversation.
- `restart-first-step` the first step enqueued, its instruction carries the user feedback (same seam as revision).
- `restart-phase-gate` the restart gate accepts only the failed phase (confirm goes through revision, building/review go through steer — the two write surfaces are phase-isolated, they do not share an entry).
- `restart-empty-rejected` an empty message cannot be sent (`feedback: z.string().min(1)`); when the async onSend fails (409), the draft is kept (no lost text).

## How to get to it (user POV)

- The failed task's detail page (`/app/todo/:id`, phase=failed) -> composer input with feedback -> the send button.
- Driving (`vp.mjs list failed-send` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive failed-send restart-combo`: after a failed-task restart, the drifted restart combo does not display as a user bubble.
  - Cases judged stale and refusing to run without `--force` (the refusal prints the reason): `vp.mjs drive failed-send restart-with-feedback` (its dependency setup-branch-sync-seed.mjs creates the agent without machineId, 400 since ADR 0019).

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS.
2. Seed a failed-phase todo (start a build -> fail the plan/build step, or construct the failed state directly); live surface.
3. After the restart starts the new build, the new round's execution needs a daemon (optional — verifying the restart enqueue needs only the server surface).

- **How to run.** To build the failed phase: launch -> `setup-branch-sync-seed.mjs` produces a pending build (it leaves the plan step pending; the git scene is harmless to this feature) -> start a real daemon (`pnpm exec tsx src/cli.ts start --foreground --api-key <k> --team <teamId> --server http://127.0.0.1:<port>`) and let it claim and fail that step (the stub provider is unreachable -> the step fails -> the todo lands failed) -> **stop the daemon cleanly** (see the pitfalls below) -> `node <skill>/scripts/drive-failed-send.mjs <todoId> <buildId>`.
- **Failure-surface send path.** The failed todo's detail page -> composer filled with feedback -> click send -> a new build starts (leaves failed) + the feedback row enters the conversation.
- **Truth.** `POST /api/builds/{id}/steps {action:"restart",...}` 200; `GET /api/todos/{id}` phase leaves failed — **the concrete value depends on whether a machine claims it**: `queued` (no claim yet) / `planning` (the plan step already claimed; `machines.ts` pushes the phase at claim time, `phase.ts` notes "machine claim: plan step -> planning"); the new build row (prevPhase=failed + withPlan carries it) + the new conversation contains the feedback message (`message.content` is a **JSON column**, the user row = a JSON string literal, decode before asserting) + the first step's enqueued prompt carries the feedback; negative: sending restart again in a non-failed phase -> 409.
- **Phase-gate negative.** Calling restart in a non-failed phase -> 409 (`restart 仅适用于 failed 相位`).

## Gotchas

- restart != steer: steer interrupts a running round (building/review phases, the stop button), restart is a feedback-carrying restart after failure (failed phase, composer send) — the two write surfaces are phase-isolated, the server funnel edges differ.
- Empty feedback is rejected by the schema (`z.string().min(1)`); when the async onSend fails, the draft is kept (the user's input is not lost).
- The restart starts a **new build** (withPlan carries the failed round's plan), not a continuation of the old build; todo.latestBuildId points at the new build.
- The failure-surface composer is a read-only placeholder on the fixture static surface; only the live surface wires the restart.
- **A daemon that is not stopped cleanly will "claim once more before dying" (measured)**: `TaskStop`/killing the outer shell only SIGTERMs the process group, and the daemon (tsx) does a **graceful shutdown** — during the shutdown window it still serves already-dispatched long-poll claims. Measured timeline: stop -> the click-check passes -> ~ 1.2s after the probe starts, the step is claimed (phase failed -> planning), and a later scan finds no process. So both `machine.online=0` and "no ESTABLISHED on the service port" are **point-in-time snapshots** and cannot catch this window (claims go through the long poll, not the machine stream, the online bit does not reflect it). Two countermeasures: (1) **do not count on a clean stop** — the probe has relaxed its phase assertion to "leaves failed" (queued/planning/building all count as pass), this race is naturally non-fatal; (2) to really confirm it has exited, judge process liveness by PID, do not use `pgrep -fl "tsx src/cli.ts start"` — the real command line is `.../tsx/dist/cli.mjs src/cli.ts start -f`, that pattern does not match and gives a false negative for "stopped".
- **The composer send button is mouse-unreachable (measured, not this feature's defect)**: `.composer-send` (32x32) is **completely covered** by `.detail-fab` (48x48, the chief floating button, anchored 16px from the bottom-right), `document.elementFromPoint` at the button center hits the fab -> a real `click()` times out (true on both the fixture and live surfaces). Both the in-repo `reject-chain.spec.ts` and `integration/test/m5-web-e2e.test.ts` therefore use `dispatchEvent('click')`. Keyboard Enter send is unaffected. This probe likewise drives the wire via dispatchEvent, and measures the occlusion fact into `result.json`'s `sendReachableByMouse`/`sendCenterHit`.
- **Verification state (2026-09-28)**: the main-repo live re-probe is in — `drive-failed-send.mjs` 11 checks all green, evidence archived at `docs/verify/320/`.
