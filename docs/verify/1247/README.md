# 1247 done column order and pending drop

Live stack: server `http://127.0.0.1:8791`, web `http://127.0.0.1:5273/app`, fresh `PACMAN_HOME` under `.claude/verify-run/home`. No daemon. Four todos seeded through `POST /api/projects/:id/todos`, then SQLite set `phase`, `phaseAt`, `orderIndex`, and `hasChanges`.

Before the fix, `GET` rows were:

- OLD done, `orderIndex` 0, `phaseAt` one day earlier
- NEW done, `orderIndex` 10, `phaseAt` later
- FAILED, phase `failed`, `hasChanges` 0
- CONFIRM, phase `confirm`, `hasChanges` 0

The done column painted OLD above NEW. Dragging FAILED onto done left `data-drop-valid` unset and opened no dialog. Dropping CONFIRM wrote phase `done` with dialog count 0.

After the fix, the same seed painted NEW above OLD. Dragging FAILED set `data-drop-valid=true` and opened `把任务标记为已完成？`. Cancel left the card in 待处理. Confirm wrote `phase=done` (`GET /api/todos/:id`) and the card rendered at the top of 已完成. CONFIRM with `hasChanges` 0 opened the same dialog, and cancel left it in 待处理.

Screenshots: `1247-before-done-order.png`, `1247-before-drag-failed-into-done.png`, `1247-before-confirm-drop.png`, `1247-after-done-order.png`, `1247-after-drag-failed-dialog.png`, `1247-after-failed-landed.png`, `1247-after-confirm-dialog.png`.

SSE on the same server: a failed card `PATCH /api/todos/:id` with `{ "phase": "done" }` returned `phase=done`, and `GET /api/teams/:id/stream` delivered one `todo` frame for that id with `phase=done`, `v=2`, `seq=2`. Log: `sse.txt`.

## Follow-up: do not cancel the build, and do not release a failed child's wave

Fresh stack on `8791` / `5273`.

In-flight build. A building card with a pending `build` step. `PATCH { "phase": "done" }` returned `phase=done` and the step stayed `pending`. The detail page showed chip 已完成 and `排队中：等机器上线`. `POST /api/builds/:id/stop` with `{ "discard": false }` then returned 200, set the step to `stopped`, and wrote the phase back to `todo` (chip 待处理). That stop path is the same `applyStoppedStep` `cancelBuild` uses for a pending step. Calling it from the done PATCH would take the card out of 已完成. The dialog now says the running build keeps going.

Failed child. Parent in building. Child A failed, child B todo and blocked by A, with a build assignment. Before the route change, `PATCH` A to done left A `done`, moved B to `queued` with a new pending build step, and left the parent `building`. After the change, the same PATCH leaves B `todo` with no build. The parent stays `building` while B is not done. A client that skips the dialog uses this same PATCH.

Shots: `1247-before-inflight-dialog.png`, `1247-before-inflight-still-running.png`, `1247-before-stop-yanks-done.png`, `1247-before-sibling-waiting.png`, `1247-before-sibling-wave-started.png`, `1247-after-inflight-dialog.png`, `1247-after-inflight-still-running.png`, `1247-after-sibling-stays-waiting.png`.
