# herdr 如何达到 Multica 的效果

- 性质：方法论 / 工具调研，不是研究票产物（仓内 `r<N>-*.md` 是按研究票编号的，这份不是）。无实施计划。
- 对象：① herdr 本体的能力面（能不能自己长出 Multica 的效果）；② herdr 的扩展面（插件 / socket API / 多机）；③ 生态里已经做出来的成品（逐个核实）。
- Captured 2026-10-01. Local herdr versions measured: client 0.9.3, server 0.9.1, socket protocol 22, socket `~/.config/herdr/herdr.sock`.
- 联网通道：`agent-reach` 的 github 后端（= `gh` CLI）。插件 README 为项目自述原文（一手），star 数为 `gh search repos --topic herdr-plugin` 实测快照。
- 标记约定：`measured` = 亲手跑到命令输出 / 抓到原文；`inferred` = 由原文或代码推导；`guess` = 无一手证据。来源性质用 `[一手]` / `[项目自述]` / `[二手]` 标注。
- 引用约定：herdr 结论来自本机 CLI 实测（`herdr --help`、`herdr api schema --json`、`herdr --skill`、`herdr status`）；Multica 结论转引 wiki [[todos.dev 与 Multica 对照]]（该页为 2026-09-30 全量精读 multica.ai 41 页官方文档的产物），本页**未重新抓 Multica 文档复核**。
- 入库标注（2026-10-03）：① Multica 的部署已于 2026-10-02 在本机与 mea 停用（用户追认），本页保留作方法论与历史对照；Multica 侧内容在写作时即为二手转引（见上条），该时效说明继续有效。② S7 的「插件零安装」是 2026-10-01 快照——截至 2026-10-03 本机已安装并启用 herdr-projects（即 S5 盘点到的 coordinator 插件），本仓多线程编排正在用它。

---

## S0 结论速览

1. **herdr 本体到不了 Multica——不是缺功能，是不同物种。** herdr 的 socket API 一共 **102 个方法**，逐个看全是「拓扑 + agent 生命周期」：`workspace.* / tab.* / pane.* / worktree.* / layout.* / agent.* / events.* / plugin.* / notification.show / integration.*`。里面**没有任何一个任务对象**——没有 issue、没有 task、没有队列、没有 run、没有派工、没有工作历史的持久化。`measured`
2. **herdr 知道的是「哪个 pane 里的 agent 现在是 idle / working / blocked / done」，不知道「谁在干什么活」。** 状态是 pane 级的瞬态，随 pane 存亡；herdr 自己的状态里没有「这件事做过没有」。`measured`
3. **Multica 的效果 = 在终端多路复用器之上多了一层「工作对象层」。** 看板（issue）、经办人、run 队列、心跳与离线排队、服务端元数据、跨机 runtime、IM 五通道、Squad、Autopilot、权限 Access——这些没有一条住在 herdr 本体的能力面里。`measured`（herdr 侧）/ `[二手]`（Multica 侧）
4. **但 herdr 的插件层能到，而且已经有人做到了。** 生态里 `nelsonPires5/herdr-board`（166★）就是 Multica 效果的终端版：**卡 = prompt，列 = 流水线阶段，把卡拖进自动列 → daemon 排队 → 在可见 herdr pane 里起 agent；手动列 = 人工闸，停下来等批准**。`[项目自述]`
5. **达成路径的形态是固定的：不动 herdr 本体，在插件里自带 daemon + 自带存储，herdr 只当执行底座。** herdr-board 原文：`boardd` 是队列/派发/生命周期的常驻 daemon，**全部看板状态存在 `~/.local/share/herdr-board/`，herdr 自己的状态从不被修改**。`[项目自述]`
6. **「Chief」那半也有现成成品。** `eliasstravik/herdr-projects`（551★）：一个 coordinator agent 永不干活，把一个目标拆成多个 thread，每个 thread 独立 agent + 独立 worktree + 独立分支，共享同一份 instructions 与 memory，侧栏按「谁需要你」分组。这正是 Multica 没有、todos 才有的编排者形态。`[项目自述]`
7. **真正到不了的只有四条，且都是「平台」属性不是「编排」属性**：服务端共享元数据与多用户、身份/权限模型、心跳 + 离线排队 + 容量闸、跨机共享（herdr-board 是单机/单 server 的）。`inferred`
8. **一条容易搞反的：herdr 的 `--machine` 不等于 Multica 的服务端。** 它是把远端那台机器的 herdr server 镜像进本地侧边栏（profile `mea` 在本机已存在但 `enabled: false`），是「多地控制」，不是「一份共享账本」。`measured`
9. **对 pacman 的意义：这不是 pacman 的对手，是同一条链的上游。** pacman 是「服务端在中间、执行在注册机器上」的中心化形态；herdr-board 是「一切在本机、daemon 就在你终端旁边」的形态。两者借的是同一批机制（可见 pane、agent 状态灯、worktree 隔离、人工闸），但账本放的地方相反。`inferred`

---

## S1 先拆真问题：两者根本不在；一张比较表上

六款编排器的分类学（[[AI Agent 编排器六款横评]] 的骨架）把 herdr 与 Multica 分在两类：

| 类 | 抽象 | 干什么 | 成员 |
|---|---|---|---|
| 终端 / 会话多路复用器 | pane、workspace | 并行跑你已有的 agent 且不替换它们，只把「谁在干什么」显出来 | Herdr, Orca |
| 管理与组织层 | 角色、任务、汇报线 | 把 agent 当**员工**发角色和任务 | Paperclip, Multica |

所以「herdr 如何达到 Multica 的效果」这句话里含着一个必须先承认的落差：**一个公司内部的终端多路复用器，和一个 AI 员工模拟器，本来不争同一个用例。** `[二手]`

但这不意味着做不到。分类学描述的是**本体**，而 herdr 有一个其他终端多路复用器（tmux、zellij）没有的东西：**一等的扩展面**——插件系统 + socket API。Multica 的效果因此可以**叠在 herdr 之上**，而不是**长在 herdr 之内**。

---

## S2 herdr 本体实测：102 个方法里没有任务

`herdr api schema --json` → `schemas.request.oneOf` 共 **102 个 method**，全量枚举如下（`measured`）：

```
服务端/客户端    ping · server.stop · server.live_handoff · server.reload_config ·
                server.ssh_agent.register · server.agent_manifests · server.reload_agent_manifests ·
                notification.show · product_announcement.dismiss · release_notes.dismiss ·
                command.invoke · client.window_title.set|clear · client_shell.surface.set · session.snapshot
工作区          workspace.create|list|get|focus|rename|move|move_block|report_metadata|close
worktree        worktree.list|create|open|remove
tab             tab.create|list|get|focus|rename|move|close
agent           agent.list|get|read|explain|send_keys|rename|view.set|view.clear|focus|start|prompt|wait
pane            pane.split|swap|move|zoom|layout|process_info|neighbor|edges|focus_direction|resize|
                scroll|clear|edit_scrollback|selection.read|copy_motion|copy_search|list|current|get|
                focus|input.set|link.activate|link.resolve|rename|send_text|send_keys|send_input|read|
                report_agent|report_agent_session|report_metadata|clear_agent_authority|release_agent|close
                · popup.close · pane.wait_for_output
布局            layout.export|apply|set_split_ratio
事件            events.subscribe · events.wait
集成/插件       integration.list|install|uninstall · plugin.link|list|unlink|enable|disable ·
                plugin.action.list|invoke · plugin.log.list · plugin.pane.open|focus|close
```

一个任务对象都没有。对照 Multica 的对象面（workspace / project / issue / run / agent / runtime / squad / autopilot），herdr 这边**只有 workspace 这一个名字碰巧撞上，而且含义完全不同**：herdr 的 workspace 是「一屏终端布局」，Multica 的 workspace 是「一个团队的共享看板」。`measured` / `[二手]`

agent 状态只有四态 `idle | working | blocked | done`（另有 `unknown`），且是 **pane 级瞬态**——agent 退出、被释放、被替换，名字与状态一起清掉（`herdr --skill` 原文：`A name follows the current pane occupant and is cleared when that agent exits, is released, or is replaced.`）。**herdr 不记录「昨天谁干完了什么」。** `measured`

---

## S3 Multica 的效果拆成可搬的机制

把 [[todos.dev 与 Multica 对照]] 里的 Multica 侧拆成机制（去掉专有名词），一共九条能搬的 + 四条只属于平台的：

**能搬的（herdr 侧有对应承重件）**

1. 工作单元对象，持久化、可回溯（issue：描述 + 状态 + 评论 + 历史）
2. agent 当经办人（身份，不是进程；触发才执行）
3. 队列 + 派发（把工作单元投给某个 agent，在它那台机器上起进程）
4. 人工闸（Multica 的真门是 **PR**；`in_review` 只是状态不是闸门）
5. 状态由 agent 自己经 CLI 显式写回（Multica 原文：server 不在 run 开始/结束时翻状态）
6. worktree 隔离（每任务一个工作目录）
7. 经验复用（`SKILL.md` 格式的 skills，随时间积累）
8. 审核（Multica 无内置，官方教程是「把 Reviewer 建成普通 agent，用 @ 触发」）
9. 编排者 / 多 agent 路由（Multica 是 Squad：leader 只路由不实现；todos 是 Chief）

**只属于平台的（要服务端/多租户才有意义）**

10. 服务端持久化元数据 + 跨设备共享（「执行在你机器上，元数据在服务端」）
11. 身份与权限（Access 三档：Only me / Entire workspace / Specific people；run 级 `mat_` token）
12. 心跳（15s）+ 离线判定（约 3 分钟）+ 排队 run 等机器回来 + 容量闸（daemon 20 / agent 6）
13. IM 五通道（飞书/Lark、Slack、钉钉、企业微信、Telegram）

---

## S4 herdr 的三个扩展点

herdr 不做这些，但它把「做这些」的门开着。三条实测事实：

1. **插件系统，而且「整个 herdr CLI 就是插件 API」。** 插件是普通 argv 命令（Bash/JS/Lua/Rust 皆可），经 `HERDR_BIN_PATH` 回调 herdr；manifest 可声明 actions、events、panes（overlay / popup / split / tab / zoomed）、link_handlers、startup 钩子。安装：`herdr plugin install owner/repo[/subdir]`（GitHub shorthand，`--ref` 可钉版本，交互预览 manifest 后确认）。`measured`
2. **socket API 有事件订阅。** `events.subscribe` 可订 `pane.agent_status_changed`、`pane.output_matched` 等生命周期事件（推送式、有序、有界批量；订阅者落后太多收 `events_lost` 而不是静默丢事件）。配套 `notification.show`（`herdr notification show "..." --body ... --sound request`）可直接弹 herdr 通知。`measured`
3. **多机是「多地控制」不是「共享账本」。** `herdr --machine <label-or-id> <cmd>` 把远端 herdr server 的命令转发过去（本机 profile `mea` 已在，但 `enabled: false`）。`herdr --skill` 明写：`herdr machine list` 列的是**连接 profile，不是跨机 pane 清单**。`measured`

结论：**herdr 把「终端 + agent 生命周期」标准化成了可编程接口，于是「任务层」变成了一个合法的第三方实现位置。** 这也是为什么生态里会有下面这些东西。

---

## S5 生态实测：已经有人做到了

`gh search repos --topic herdr-plugin`（2026-10-01 快照）里与「把 herdr 变成工作看板」直接相关的成品，按 star 排序（`measured`）：

| 仓库 | ★ | 一句话（项目自述） | 对应 Multica 的哪条 |
|---|---|---|---|
| `eliasstravik/herdr-projects` | 551 | coordinator agent 只拆不干；每任务独立 agent + worktree + branch，共享 instructions/memory，侧栏列「谁需要你」 | 编排者（Squad / Chief）+ worktree 隔离 + 状态回流 |
| `nelsonPires5/herdr-board` | 166 | **看板：卡 = prompt，列 = 流水线阶段，拖进自动列即在可见 pane 起 agent；手动列是人工闸** | 工作单元 + 队列派发 + 人工闸 + 历史 |
| `smarzban/tsk` | 162 | 「你与 agent 的终端任务板：一个共享队列，人一个 TUI，agent 一个 CLI」 | 工作对象 + 人机双接口 |
| `aemrebarut/herdr-dagr` | 91 | 把 agent 群画成活 DAG，带 review gates 与 evidence | 审核闸 + 可观测性 |
| `permgps/herdr-telegram-agents` | 72 | 从 Telegram 驱动 agent，每 agent 一个 topic | IM（Telegram 那一条） |
| `miiraheart/herdr-beads` | 35 | 把 `bd`（beads）issue 变成 List / Table / Kanban 窗口，不自己造存储 | 工作对象（外挂存储） |
| `deimantasnork/captains-deck` | 35 | 只读的 Firstmate flow 看板插件 | 看板视图 |

不属看板但补另外两条缺的：`persiyanov/herdr-reviewr`（810★，diff 侧边栏批注直接发回 agent = 审核那一条的现成交互形态）、`dcolinmorgan/herdr-remote`（398★，菜单栏 / 手机 / Telegram 监控驾驶）、`eliasstravik/herdr-agent-progress`（31★，agent 自报任务进度进侧栏）。

**读 `herdr-board` 的架构**（这是最接近 Multica 的一个，`[项目自述]`）：

```
 TUI    CLI      ← 人 与 agent 的两个接口
   └──┬──┘
   boardd        ← daemon：queue / dispatch / lifecycle
      │
    herdr        ← 一次 run 一个可见 pane
```

- **卡（card）**带 title、base prompt、harness/model/effort/permission 设置、目标 herdr session 与 workspace。
- **列（column）**可定义 system prompt、自动或手动触发、timeout、成功/失败各去哪个阶段。
- 把卡移进自动列 → 排队 → daemon 解析 session、开/复用 workspace、在可见 pane 起 agent。
- agent 读卡/run 的环境变量，用 `board` CLI 评论并上报结果 → daemon 应用列转换（下一自动阶段，或一个手动闸）。
- **手动列 = 流水线停下等人批准**；`History stays with the card`：评论、run、结果、重试、归档卡都可回看。
- 全部状态在 `~/.local/share/herdr-board/`（SQLite schema v15）；**herdr 自己的状态从不被修改**。
- 要求 herdr **0.9.0+ / socket protocol 22**（本机 protocol 22，满足）；支持 Pi / Claude Code / Codex / OpenCode / Antigravity。

它和 Multica 的机制对应关系几乎是逐条的：**卡 ≈ issue，列 ≈ 流水线阶段，手动列 ≈ 人工闸，`board done` ≈ agent 显式写状态，`boardd` ≈ daemon 派发，`card-<id>` tab ≈ worktree/会话隔离**。差别在两处：herdr-board 的闸是「列位置」，Multica 的闸是「PR」；herdr-board 的状态在本地 SQLite，Multica 的在服务端。`inferred`

---

## S6 逐机制对照：能到的 / 补一下能到的 / 到不了的

| Multica 机制 | herdr 本体 | 叠插件后 | 判据 |
|---|---|---|---|
| 工作单元对象（issue） | 无 | ✅ `herdr-board` 卡 / `tsk` 任务 / `herdr-beads` 的 bd issue | `measured` |
| agent 当经办人 | 半个：pane 里认得 agent，但不绑任务 | ✅ 卡带 harness/model/effort + 目标 session/workspace | `measured` |
| 队列 + 派发 | 无 | ✅ `boardd` daemon | `[项目自述]` |
| 人工闸 | 无 | ✅ 手动列 / dagr 的 review gate | `[项目自述]` |
| agent 经 CLI 自报状态 | 无（只有 pane 四态） | ✅ `board` CLI（comment / done） | `[项目自述]` |
| worktree 隔离 | ✅ 本体就有 `worktree.*` | ✅ 直接复用 | `measured` |
| skills（SKILL.md 累积） | 无 | 半个：`herdr-dagr` 有 producer skill；herdr-projects 有 `## Remember` 记忆回流 | `[项目自述]` |
| 审核 | 无 | ✅ `herdr-reviewr` 批注回 agent / dagr review gate | `[项目自述]` |
| 编排者 / 多 agent 路由 | 无 | ✅ `herdr-projects` coordinator | `[项目自述]` |
| 服务端元数据 + 跨设备 | ❌ | ❌ herdr-board 状态在本地；`--machine` 是多地控制不是共享账本 | `measured` |
| 身份 / 权限（Access / run token） | ❌ | ❌ 生态里没有 | `inferred` |
| 心跳 / 离线排队 / 容量闸 | ❌ | 半个：`boardd` 有队列，没有 Multica 那套 15s 心跳 + 3 分钟离线 + 排队 run 等回 | `inferred` |
| IM 五通道 | ❌ | 半个：Telegram 有（`herdr-telegram-agents`、`herdr-remote`）；飞书/钉钉/企业微信没有 | `measured` |

**到不了的四条不是「还没人做」，是「做了也不是 herdr」**：服务端共享账本、身份权限、心跳排队、多租户，四条全是**平台**属性。herdr 是**单用户本机工具**——把账本搬到服务端、给 agent 发 run token、让一台机器替别人排队，这些一旦做出来，做出来的东西就不是 herdr 了，是另一个 Multica。`inferred`

---

## S7 要落地的话，装什么

按「要什么效果」分三档（全部 `measured` 于 2026-10-01 的生态面）：

1. **要「拖卡派活 + 人工闸 + 历史」** → `herdr plugin install nelsonPires5/herdr-board`。它自带 daemon 与存储，装完 `herdr plugin action invoke open-board --plugin herdr-board` 开板。要求 herdr 0.9.0+ / protocol 22，本机满足。
2. **要「一个目标推多条并行线程 + 谁需要你」** → `herdr plugin install eliasstravik/herdr-projects`。这是 Chief 形态，且它的 thread 支持落到 saved SSH machine（跨机比 herdr-board 强）。
3. **要「手机上管」** → 叠 `herdr-remote`（菜单栏/手机/Telegram，免费隧道）或 `herdr-telegram-agents`（每 agent 一个 Telegram topic）。

要留神的三条：插件市场是 GitHub topic 自动索引（约 1,461 个，2026-10-01 快照），**官方明示「Listings aren't reviewed by Herdr」**，装前自查 manifest 与脚本；插件跑的是真 agent、烧的是真模型额度；本机目前 `herdr plugin list` 为空（零安装）。

> [入库标注 2026-10-03] 上行「零安装」为 2026-10-01 快照：截至 2026-10-03 本机已安装并启用 herdr-projects（github:eliasstravik/herdr-projects），本仓的多线程编排正在用它。

---

## S8 与 pacman 的关系

一句话：**不是对手，是同一批机制的另一种摆放。** `inferred`

- pacman（[[pacman 的编排器坐标与借鉴清单]]）= **服务端在中间**：server 是控制面，注册机器上的 daemon 是执行面，账本在 `~/.pacman` 的 SQLite，跨机是原生能力。
- herdr-board = **一切在本机**：daemon（`boardd`）就住在你终端旁边，账本在 `~/.local/share/herdr-board/`，跨机要另想办法。
- 两边的承重件其实是同一套：**可见 pane、agent 状态识别、worktree 隔离、人工闸、agent 自报状态**。pacman 的 `StepJournal`（claimed/running/done/failed）与 herdr-board 的 run/column 是同一件事的两种记法；pacman 的 `machine` + `claim` 长轮询与 `boardd` 的 queue/dispatch 是同一件事的两种记法。
- 所以这条调研对 pacman 的实际用法是：**herdr-board 可以当 pacman 之外的「本机轻量车道」**——不值得为小活起 server + enroll 机器；也**可以当一面现成的镜子**：它把「卡→列→pane→自报→闸」这条链做成了可跑的终端产品，pacman 要看「没有服务端时这条链能多短」，它是活样本。

---

## 相关

- [[todos.dev 与 Multica 对照]] — Multica 效果的一手文档底座（本页 Multica 侧全部转引自此）
- [[AI Agent 编排器六款横评]] — 三分类学（herdr 与 Multica 为何不同类）
- [[pacman 的编排器坐标与借鉴清单]] — pacman 自己的坐标与借鉴清单
- [[herdr 玩法解锁清单]] — herdr 功能面 × 本机解锁状态（`--machine` 半解锁、插件市场零安装等）
- [[herdr 原生多 agent：claude 车道派发配方]] — 本机在用的车道派发形态（手写脚本版，herdr-projects 是它的产品化）
- `docs/research/r10-multica-runtime.md` / `r11-runtime-gap.md` — Multica runtime 模型与 pacman 差距（仓内既有研究票产物）

## 来源

- 本机 herdr 实测（2026-10-01）：`herdr --version` / `herdr status` / `herdr --help` / `herdr api schema --json` / `herdr --skill` / `herdr plugin --help` / `herdr machine list --json` / `herdr plugin list --json`
- 插件 README 原文（`gh api repos/<owner>/<repo>/readme`）：`nelsonPires5/herdr-board`、`eliasstravik/herdr-projects`、`smarzban/tsk`、`aemrebarut/herdr-dagr`、`cloudmanic/herdr-plus`、`miiraheart/herdr-beads`
- 插件盘点：`gh search repos --topic herdr-plugin --limit 100`（2026-10-01）
- Multica 侧（转引，未重新复核）：wiki [[todos.dev 与 Multica 对照]]（源 = multica.ai 41 页官方文档全量精读，2026-09-30）