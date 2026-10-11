# verify 1181 — drive-hotkeys / drive-newtask-key 迁退役搜索选择器

栈:live 8791/5273(`launch.mjs` fresh,全新库)。worktree @ 290f6500。

## before-red(改前,同栈同码)

| 脚本 | 失败形状 | 证据 |
|---|---|---|
| drive-hotkeys.mjs | `Meta+k never opened .search-panel`(pressUntil 8 次重按后);另有 kbd-hint 两红(`.kbd-hint` 已随 #983/#1008 退役) | `before-red/hotkeys/console.log` |
| drive-newtask-key.mjs | `page.waitForSelector: Timeout 5000ms — waiting for locator('.search-panel') to be visible`(场景 2 输入态守卫) | `before-red/newtask-key/console.log` |

脚本中途抛出,未写 result.json;console.log 是完整判读面。

## after-green(改后,fresh relaunch)

| 脚本 | 结果 | 证据 |
|---|---|---|
| drive-hotkeys.mjs | 16/16 PASS | `after-green/hotkeys/result.json`(ok=true)+ console.log |
| drive-newtask-key.mjs | 22/22 PASS | `after-green/newtask-key/result.json`(ok=true)+ console.log |

复跑配方:`node .claude/skills/verify-pacman/scripts/launch.mjs` 起栈后各跑
`node .claude/skills/verify-pacman/scripts/{drive-hotkeys,drive-newtask-key}.mjs`。

## 迁移面

- 票面 5 处搜索选择器 → #1166 形态(role=dialog「搜索」/ 面板 scope textbox)。
- 同源 stale 顺带迁:`.kbd-hint`(→ registry Tooltip+Kbd,drive-1008 E1 同律)、
  drawer 计数/Esc 收窗(ADR 0013 D3/D6 → isVisible + ⌘J toggle)。
- 退役审计清单(drive-949/drive-947 的 styleSheets 断言)未动。
