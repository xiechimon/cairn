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
