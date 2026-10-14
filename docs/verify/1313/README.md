# #1313 验证证据（空提交 review 收口）

- 探针：`.claude/skills/verify-pacman/scripts/drive-1313-empty-review.mjs`
- 栈：server `127.0.0.1:8791` / web `127.0.0.1:5273` / PACMAN_HOME scratch
- 执行 Agent 工具只有「推送分支」，缺「合并分支」
- 空卡：`hasChanges: true`，`changesDiff: ''`
- 对照卡：同一 `hasChanges`，diff 含 `README.md`

## before（修复前栈）

`before-result.json` 全部 ok。弹层仍展示「将改动合并到默认分支」，完成钮禁用。取消勾选后完成钮仍禁用。changes 响应是 `{ "files": [] }`，没有 `reported`。

| 文件 | 内容 |
|---|---|
| `before-empty-dialog.png` | 空卡，合并勾选开着，完成禁用，缺「合并分支」授权 |
| `before-empty-unchecked.png` | 同一弹层取消勾选，完成仍禁用 |
| `before-files-dialog.png` | 有文件的卡，合并行仍在 |
| `before-empty-changes.json` | `{ "files": [] }` |
| `before-result.json` | 探针 checks |

## after（修复后栈）

`after-result.json` 全部 ok。空卡不展示合并行，文案是「本轮没有文件改动，完成不会合并分支。」，完成可点。点击后相位 `done`，零 merge 步，时间线「标记为已完成」。有文件的卡仍展示合并行且完成禁用。

| 文件 | 内容 |
|---|---|
| `after-empty-dialog.png` | 空卡，无合并行，完成可点 |
| `after-empty-done-column.png` | 空卡落到已完成列 |
| `after-files-dialog.png` | 有文件的卡仍走合并闸 |
| `after-empty-changes.json` | `{ "files": [], "reported": true }` |
| `after-empty-steps.json` | 只有 build 步 |
| `after-empty-messages.json` | 审计行「标记为已完成」 |
| `after-result.json` | 探针 checks |
