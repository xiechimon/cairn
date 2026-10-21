# #1446 evidence: stop or close a queued task from its detail page

Base = this branch before the #1446 commit (web unchanged since `bbd1e858`). Branch = `claude/optimistic-albattani-r5pmfn`.

A queued task's 更多 menu shows 停止 (`apps/web/src/overlay/more-menu.tsx` `onStop`, wired in `routes/todo-detail-page.tsx` for a live queued task with a build). It opens `StopConfirmDialog` in its queued form: title 停止排队？, one line saying the task goes back to where it was before it was queued (待开始 on a first run, the run's starting phase on a rerun, per the server's `stopFallbackPhase`), no "discard this round" checkbox. Confirming calls the existing `POST /api/builds/:id/stop`. The dialog's form is fixed when it opens, so a machine claiming the step while it is open does not swap the title or reveal the discard checkbox under the cursor. 更多 > 关闭 is enabled for queued (`detail/use-detail-actions.ts` `canClose`); the server stops the pending step before closing (#1445). planning / building are unchanged.

## e2e: `apps/web/e2e/detail-queued-exit.spec.ts`

Stubbed live boot (no `?scenario=`): one queued task and one planning task, each with a build. The stop POST and the todo PATCH are recorded.

- `e2e-old-leg.txt`: before the change. 2 failed / 1 passed. The queued menu has no 停止 (`element(s) not found`), and its 关闭 is disabled (`Received: disabled`). The planning control passes.
- `e2e-sync-stop-old-leg.txt`: the code-review follow-up, before its fix. The 4th test fails: after a synchronous stop (`{delegated:false}`) of a waiting_quota step, the next step on the same build reads `正在停止…` instead of 处理中. A waiting_quota step never counts as running on the detail page, so nothing cleared the optimistic flag. The fix clears it when the server answers `delegated:false`.
- `e2e-new-leg.txt`: after. 4 passed. 停止 → dialog 停止排队？ with no checkbox → `POST /api/builds/build-todo-queued/stop`; a synchronous stop leaves 处理中, not 正在停止…; 关闭 → `PATCH /api/todos/todo-queued {phase:'closed'}`; planning shows no menu 停止 and keeps 关闭 disabled.

`e2e-affected-dry-run.txt`: `scripts/e2e-affected.mjs --dry-run` for an edit to `overlay/more-menu.tsx`, where the 停止 row lives. Before the family-table line it selected 14 specs without `detail-queued-exit`; after, 15 with it.

| shot | `old/` | `new/` |
|---|---|---|
| `queued-more-menu.png` | 完成 / 复制链接 / 关闭 (disabled) / 删除 | 完成 / 停止 / 复制链接 / 关闭 / 删除 |
| `queued-stop-dialog.png` | (no 停止 to open) | 停止排队？, 任务回到排队前的状态。, 取消 / 停止 |

## Rerun

```sh
cd apps/web
PACMAN_E2E_EVIDENCE=docs/verify/1446/new E2E_PORT=8398 pnpm exec playwright test detail-queued-exit.spec.ts
```
