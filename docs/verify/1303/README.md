# #1303 chief unread badge

The same probe `drive-1303-chief-unread.mjs`, an isolated verify stack (web 5273 / api 8791, fake machine wire, zero daemon zero LLM). `--expect=old` runs before the behavior change; `--expect=new` after a re-launch on this branch's source. Both sides are 13/13.

```sh
node .claude/skills/verify-pacman/scripts/cleanup.mjs
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1303-chief-unread.mjs --expect=old
# after changing the source the server has no watch — must cleanup + launch before rerunning:
node .claude/skills/verify-pacman/scripts/drive-1303-chief-unread.mjs --expect=new
```

## Reading

| check | before (`before/result.json`) | after (`after/result.json`) |
| --- | --- | --- |
| two assistant texts in one thread | unread set length 1, badge `1` | same |
| tooltip | only `⌘J` | `1 个总管会话有未读` |
| open the drawer then minimize | the badge still `1`, `readAt` still empty | same (this ticket does not change this path) |
| idle for 8 days, the tick proven to have run by a `[wake:wake]` step | `readAt` still empty | `readAt` is written to the tick moment and leaves the unread set |
| wake close-out | snippet = the wake text, `readAt` empty, the thread enters unread | same snippet text, `readAt` non-empty, does not enter unread |
| 100 unread chief threads | the badge text reads `100` | the badge text reads `99+`, the tooltip writes `100 个总管会话有未读` |

Screenshots: `before/03-board-badge-1.png`, `before/12-badge-cap.png`, `after/04-tooltip-count-1.png`, `after/12-badge-cap.png`, `after/15-tooltip-cap.png`.
