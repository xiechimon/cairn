# 搜索(侧栏 ⌘K 面板)

用户从侧栏搜索行打开全局面板,输入即筛任务:结果行 = 任务标题 + 项目子行 + 时间标签;命中实时收敛,Esc/外点关闭。

## Sub-features

- `search-open` 侧栏 `.rail-row[aria-label="搜索"]`(折叠态也常驻)开 `.search-panel`;面板内 `.search-input-row input` 即焦点位。
- `search-match` 输入即过滤 live todos,命中行 `.search-row--todo`(标题 `.search-row-title` + 项目子行 `.search-row-sub`)。
- `search-nav` 结果行点击进任务详情(`/app/todo/:id`)。

## Drive (vp.mjs)

- `vp.mjs drive search search`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list search`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- ⌘K 快捷键(任意 shell 页;输入即焦点)。
- 展开态侧栏「搜索」行(`button.sidebar-row`,带 ⌘K 徽标);折叠态为 `.rail-row[aria-label="搜索"]`。

## Driving it with verify-pacman

Preconditions:

- `launch.mjs` 起栈 + `doctor.mjs` 全 PASS。
- 至少有一条任务可搜——probe 自己会经公开 REST 铺底(建项目「搜索验证」+ 一条带时间戳标题的任务),铺底不是被测路径。

- **搜索命中。** ⌘K → 输入目标标题。Run `node <skill>/scripts/drive.mjs search`。链路:⌘K 开面板(热键监听注册在被动 effect,丢键重按,照抄 e2e search-focus.spec.ts 配方)→ `.search-input-row input` 填入 → `.search-row--todo` 含目标 title 的行可见。证据 `02-search-results.png` + `result.json`(searchTarget 字段)。
- **侧栏行入口。** probe 后手动补:展开态点 `button.sidebar-row`(含「搜索」文案)/折叠态点 `.rail-row[aria-label="搜索"]`,面板同开。
- **进入详情。** probe 后手动补:点命中行,URL 变 `/app/todo/<id>`(详情页 live 面本身未入 map,只断路由跳转,不断详情内容)。

## Gotchas

- **侧栏行选择器分态**:展开态是 `button.sidebar-row`(无 aria-label),折叠态才是 `.rail-row[aria-label="搜索"]`;默认展开,拿 rail-row 当唯一入口必 30s 超时。⌘K 无此坑。
- ⌘K 首按可能早于 hydration(监听注册在被动 effect):丢键要重按,面板可见即停,别盲连按(双 toggle 会关回去)。
- 面板过滤是客户端对当前 todos 查询集的过滤——刚建的任务若 SSE/重取未收敛,等一拍再断言;铺底走 REST 后 probe 有 10s 等待。
- 断言行用 `.search-row--todo` + 标题文本,别数全部 `.search-row`(面板里还有非任务行形态)。
- 输入框在 `.search-input-row` 内;面板关闭后重开是 retained-mount(输入不清空),连续验证别被上次残值骗。
