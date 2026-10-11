# #1181 — verify-pacman drive-hotkeys / drive-newtask-key 迁退役搜索选择器

修复：`drive-hotkeys.mjs` 与 `drive-newtask-key.mjs` 不再等待已退役的
`.search-panel` / `.search-input-row` 选择器（随 #950 / #910 语义载体迁移
退役，`apps/web/src` 下零定义），按 #1166（PR #1179）在 `drive.mjs` search
probe 落地的同款形态迁到现行语义载体。

本票两条平行车道（PR #1202 与 PR #1205）各自跑通了全链迁移；合并取
PR #1205 的脚本版本，差异与取舍记录见下「双车道差异」一节。

## 迁移映射（5 处票面病灶 + 同文件内被同一根因挡住的陈旧断言）

| 旧选择器 | 新载体 |
|---|---|
| `.search-panel`（面板等待 ×3） | `getByRole('dialog', { name: '搜索' })` |
| `.search-input-row input`（输入框 ×2） | 面板 scope 内 `getByRole('textbox')` |
| `button[aria-label="总管"] .kbd-hint`（⌘J 提示，#1008 起退役） | 页面级 `[data-slot="tooltip-content"]` + 内层 `[data-slot="kbd"]` 文案 ⌘J（e2e hotkeys.spec 同律） |

`drive-hotkeys.mjs` 迁移中顺带修正的同文件陈旧断言（与退役选择器同根因，
改前同栈复现红，见 before/hotkeys/run.log）：

1. **⌘J 输入态负向语义**：#468 起 ⌘J 是 toggle——搜框内按 ⌘J 的守卫语义是
   「抽屉保持关闭」（面板开着时 ⌘J 只许关自己开的面），不是「零抽屉节点」
   （DOM 常驻 `display:none`）。断言从 `count() === 0` 改为「不可见」。
2. **schedules 页 C 开面判据**：旧断言 `page.url().includes('/app/schedules')`
   恒真（goto 后 URL 必然如此）——改为真判据「dialog 8 次重按后可见」，同时
   给冷栈首编译窗留足余量。
3. **抽屉收起方式**：ADR 0013 D3 裁定 Esc 永不关面板（`onOpenChange` 对
   `escape-key` 只收内层弹层）——收起走 ⌘J toggle，与 e2e hotkeys.spec 同律
   （本版与 #1202 版的差异点，见下节）。

`drive-949-overlays.mjs` / `drive-947-secondary.mjs` 里的同名类是退役审计
清单（断言规则不存在），未动。

## 双车道差异（#1202 已并入 / #1205 本版）

| 面 | #1202（已在 main） | #1205（本版，合并后生效） |
|---|---|---|
| 搜索 5 处 + kbd-hint 迁移 | 同形态 | 同形态 |
| 抽屉收起 | Esc + 8s 容忍等待（`.catch` 容关不掉——Esc 实际不收窗，靠超时吞掉） | ⌘J toggle 收起（对接 ADR 0013 D3 现行为） |
| schedules 判据 | dialog 8 次重按可见 | dialog 可见（pressUntil） |
| feature map / changelog | 未更新 | `features/hotkeys.md` + `changelog/2026-10-11-1181.md` 已更新 |

## 复跑配方

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"  # 本仓 node 走 fnm
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-hotkeys.mjs
node .claude/skills/verify-pacman/scripts/drive-newtask-key.mjs
```

栈：server `:8791` + vite `:5273`，PACMAN_HOME = `.claude/verify-run/home`
（launch 每次清空 = 全新库）。

## 证据（before 红 / after 绿成对）

两条车道各留一套成对证据，目录名区分车道：

| 腿 | 结果 | 证据 |
|---|---|---|
| before · drive-hotkeys（#1202 车道，迁移前跑） | `Meta+k never opened .search-panel` 崩于 pressUntil；kbd-hint 两 check 同栈红 | `before/hotkeys/run.log` |
| before · drive-newtask-key（#1202 车道，迁移前跑） | `waitForSelector('.search-panel')` 5s 超时崩 | `before/newtask-key/run.log` |
| after · drive-hotkeys（#1202 车道） | 15/15 PASS | `after/hotkeys/run.log` + `result.json` |
| after · drive-newtask-key（#1202 车道） | 18/18 PASS | `after/newtask-key/run.log` + `result.json` |
| before · drive-hotkeys（#1205 车道，迁移前跑） | 同形状红 | `before-red/hotkeys/console.log` |
| before · drive-newtask-key（#1205 车道，迁移前跑） | `waitForSelector('.search-panel')` 5s 超时崩 | `before-red/newtask-key/console.log` |
| after · drive-hotkeys（#1205 车道） | 16/16 PASS | `after-green/hotkeys/result.json`（ok=true）+ console.log |
| after · drive-newtask-key（#1205 车道） | 22/22 PASS | `after-green/newtask-key/result.json`（ok=true）+ console.log |

双脚本 grep 零退役 class 残留（`search-panel` / `search-input-row`，
审计清单除外）：

```sh
grep -n "search-panel\|search-input-row" \
  .claude/skills/verify-pacman/scripts/drive-hotkeys.mjs \
  .claude/skills/verify-pacman/scripts/drive-newtask-key.mjs
# (no matches)
```

## 判读 gotcha（两车道实测）

- **kbd-hint 退役是第二处同型欠账**：#1166 只迁了搜索载体，`drive-hotkeys`
  的 ⌘J 提示断言还钉在 #950 时代的 `.kbd-hint` 类上——#1008（#983 判决）把
  chip 换成了 registry Tooltip+Kbd，静息态 tooltip 不挂载（`count()===0`），
  悬浮态从 body 级 portal 浮出。票面病灶清单只列了搜索 5 处，这处与根因
  同型（退役选择器跑必红），随本票一并迁移，断言形态对齐 e2e
  hotkeys.spec「robot FAB surfaces the ⌘J hint」。
- **⌘J toggle 语义与旧断言的假红**：迁移后第一次 after 跑，editable-guard
  报 `drawer=1`——DOM 常驻的 `.chief-drawer`（`display:none`）在
  `count()` 断言下恒 1。守卫的真语义是「不可见」（#468 toggle 律），不是
  「零节点」。

## Carrier map (retired selector -> current semantic carrier)

| retired selector | current carrier | where |
|---|---|---|
| `.search-panel` (wait open) | `role=dialog` named 搜索 | drive-hotkeys.mjs, drive-newtask-key.mjs |
| `.search-input-row input` | textbox inside the dialog scope | drive-hotkeys.mjs |
| `.search-panel` (wait hidden) | dialog detached / absent | drive-newtask-key.mjs |
| board row target | `[data-row-kind="todo"]` | drive-newtask-key.mjs |

The drawio variant of this map was removed: drawio diagrams are retired
(2026-10-11); this table is the canonical carrier reference for #1181.
