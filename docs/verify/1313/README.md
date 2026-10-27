# #1313 verification evidence (empty-commit review close-out)

- probe: `.claude/skills/verify-pacman/scripts/drive-1313-empty-review.mjs`
- stack: server `127.0.0.1:8791` / web `127.0.0.1:5273` / a PACMAN_HOME scratch
- the executing agent's tools are only `推送分支`, missing `合并分支`
- the empty card: `hasChanges: true`, `changesDiff: ''`
- the contrast card: the same `hasChanges`, the diff contains `README.md`

## before (the pre-fix stack)

`before-result.json` all ok. The dialog still shows `将改动合并到默认分支`, the done button is disabled. Unchecking keeps the done button disabled. The changes response is `{ "files": [] }` with no `reported`.

| file | content |
|---|---|
| `before-empty-dialog.png` | the empty card, the merge checkbox on, done disabled, missing the `合并分支` grant |
| `before-empty-unchecked.png` | the same dialog with the checkbox unchecked, done still disabled |
| `before-files-dialog.png` | the card with files, the merge row still present |
| `before-empty-changes.json` | `{ "files": [] }` |
| `before-result.json` | the probe's checks |

## after (the post-fix stack)

`after-result.json` all ok. The empty card does not show the merge row, the copy is `本轮没有文件改动，完成不会合并分支。`, and done is clickable. After clicking, the phase is `done` with zero merge steps, and the timeline reads `标记为已完成`. The card with files still shows the merge row with done disabled.

| file | content |
|---|---|
| `after-empty-dialog.png` | the empty card, no merge row, done clickable |
| `after-empty-done-column.png` | the empty card lands in the done column |
| `after-files-dialog.png` | the card with files still goes through the merge gate |
| `after-empty-changes.json` | `{ "files": [], "reported": true }` |
| `after-empty-steps.json` | only the build step |
| `after-empty-messages.json` | the audit row `标记为已完成` |
| `after-result.json` | the probe's checks |
