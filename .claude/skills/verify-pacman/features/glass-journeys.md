# Control Glass journeys

`node .cursor/skills/verify-pacman/scripts/glass.mjs` walks these journeys on a scratch stack (Hono `8791`, Vite `5273`, scratch `PACMAN_HOME`). This file is the map. The thin skill at `.cursor/skills/verify-pacman/SKILL.md` does not restate the clicks.

A review journey's seed is a precondition, not the user path: one plain project (no repo), one enrolled machine, one agent holding `合并分支` and `推送分支`, then a plan step and a build step whose `changesDiff` is a unified diff. Create task and dispatch are clicks on a board that may already contain that project. Dispatch also binds that agent onto the chief (`PATCH /api/teams/:id/chief` body `{agent:{agentId}}`) before the click. A fresh chief has `agentId` null; 保存并开始 then returns 409 「请先为总管选择一个 Agent」. That bind is seed, not the user path.

## Create task

Enter: the board. Sidebar row 新任务 (`.sidebar-new-task`), or the C key.

Key actions: fill the single body field `.new-task-spec`. Click 保存 (`.new-task-save`).

Expected outcome: the dialog closes. A card whose title is the first line of the body sits in `[data-column-list="todo"]`. `GET /api/todos` returns that title at phase `todo`, and the `todo` row is in SQLite. On an empty library, save also creates 默认项目. A run that already seeded a project proves the card, not that auto-create.

Detail: [board-new-task.md](./board-new-task.md). 保存并开始 is the dispatch journey.

## Dispatch to agent

Enter: the same 新建任务 dialog.

Key actions: fill the body. Click 保存并开始 (`.new-task-start`). Open the 总管 button (`.chief-fab`).

Expected outcome: a toast reads 已保存，交给总管编排. `GET /api/teams/:id/chief/threads` has a new thread. The card stays in 待开始 until a machine claims the chief step. This command does not start a daemon, so the card not moving is the stack boundary. If the toast never appears and `POST /api/todos/:id/orchestrate` is 409, the chief was not bound.

Detail: the user path is this button. The chief's withPlan judgment is a different surface: [chief-dispatch-judgment.md](./chief-dispatch-judgment.md).

## View diff

Enter: a review-phase task that has a reported diff. Open `/app/todo/:id`.

Key actions: read the 变更 pane. It is the phase default, and it opens expanded.

Expected outcome: the header contains `个文件改动` and the seeded path `src/hello.txt`, with the added and removed lines visible. `GET /api/builds/:id/changes` reports that file.

Detail: commit-history diffs are a different page, [project-commit-detail.md](./project-commit-detail.md).

## Request changes

Enter: a quiescent review-phase task (no claimed step). Header 更多.

Key actions: menu row 请求修改 (`.more-menu-item[data-action="reject"]`). Fill the dialog textbox. Click 请求修改.

Expected outcome: the chip flips to 规划中 without a reload. `GET /api/todos/:id` phase is `planning`. `latestBuildId` is unchanged.

Detail: [review-reject.md](./review-reject.md).

## Merge

Enter: a review-phase task whose reported diff names a file. Header 完成 (`.detail-head-action`).

Key actions: in the 完成任务 dialog, leave 将改动合并到默认分支 checked. Click 完成.

Expected outcome: a toast reads 已发起合并. Phase stays `review` until a machine finishes the merge step. This command does not start a daemon, so the phase not moving is the stack boundary.

The checkbox is absent when the reported diff is an empty commit (`substantiveChanges === false`). This journey uses a diff that names a file, so the checkbox is present. A new agent does not hold 合并分支. Without that tool, 完成 is disabled and the dialog names the missing tool. The seed grants 合并分支 and 推送分支 so the click can land.
