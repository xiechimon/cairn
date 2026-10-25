# #892 量闸 — 真闭环实测里的 withPlan 分布、闸被跳过的路径全枚举与橡皮图章信号

> Settled item: `docs/spec/18-positioning-and-differentiation.md` §5 honest-list item 2, "withPlan usage unknown".
> 结论先行：**担忧在数据里成立，且形态比「橡皮图章化」更差——是「物理绕过」而非「走过场」**。
> 本机真跑数据 28 个 build / 17 张 done 卡里：confirm 闸 13 次进闸只有 3 次按了确认钮，
> review 闸 6 次进闸只有 1 次走 merge 步放行；**15/17（88%）的 done 卡经看板手动改相
> （拖拽）落地，两道闸全跳**。数据、口径、逐条路径全部可复算，见下。

## 0. 裁决摘要

| 问题 | 答案 |
|---|---|
| withPlan 分布 | 28 build：withPlan=1 **17 个（61%）**，直执行 **11 个（39%）**。chief 派发 **8/8 全部直执行**（代码默认 + 系统提示词明令）；user 侧 3 个直执行 = 1 次首发直启（#2，2026-09-25）+ 2 次失败重启（继承 chief 原轮的 withPlan=false） |
| confirm 闸被跳过的路径 | 代码面 6 条可绕/可代按（§4 全枚举 20 条写面中的关键 8 条）；数据面实证 3 种被实际用上：chief 直执行、拖拽 confirm→done、失败重启继承直执行 |
| review 闸被跳过的路径 | 拖拽 review→done（无 merge 步，3 例）、chief `complete_todos`（review→done 无 merge 步，1 例有全链日志铁证） |
| 橡皮图章信号 | 真按过闸的 4 次动作 dwell 都不短（confirm 4m43s / review 7m30s 起）——**不是橡皮图章**；但它们只占 done 落地的 2/17。8s 的 chief 自过闸是唯一「即进即放」样本 |
| 版本化方案文档 | `plan` 表 28 个 build **0 行**——「可逐版对比的方案文档」这一差异化支柱在观测窗内**零使用**（含 #560 上传通道落地后的 5 个 withPlan build） |

**判读**：主张「两道硬闸」在真闭环里的实际形态 = 「一道闸 + 一个仪式」的反面也不是——是
**「两道闸 + 一把侧门钥匙」**：正经漏斗只在第一个任务（#1 hello.txt，2026-09-23）完整走过
一次；此后所有 done 落地全部或部分绕闸。同时样本偏斜要如实说：18 张卡里 12 张是连通性
测试/寒暄卡（本来无码可审），真实工作卡 3 张（#1、#16、#18）里 1 张全程走闸、2 张经 chief
直执行。改进票建议见 §6。

## 1. 口径说明（可复算）

**数据源**：本机真实部署的 SQLite——`~/.pacman/server/server.db`（snapshot 2026-10-05 16:5x，
WAL 态直读）。一律**只读 URI 模式**打开：

```sh
sqlite3 'file:<home>/.pacman/server/server.db?mode=ro' "<SQL>"
```

第二数据集（mea 上用户自己的部署）：`ssh mea` 后同款只读查询，见附录 C。

**表结构速览**（本文用到的列）：`build(id, todoId, withPlan, prevPhase, triggerSource,
createdAt)`；`step(id, buildId, kind[plan|build|merge|review|chief], status, createdAt,
claimedAt, prompt)`；`todo(id, seqNum, title, phase, phaseAt, hasPlan, hasChanges,
latestBuildId)`；`notification(type[plan_ready|build_review|chief_message], entityId,
createdAt)`；`plan(id, buildId, version, content)`；`chief_message(threadId, role, content,
createdAt)`。**conversationId ≡ buildId**（UUIDv7），build 会话的 transcript 在 `message` 表，
chief 会话在 `chief_message` 表。

**三个口径约定**（复算前必读，不读会算错）：

1. **notification 行是 upsert**（`services/notifications.ts:114` upsertAndPublish，主键 =
   `userId:todoId`）——`plan_ready`/`build_review` 的 `createdAt` 是**最后一次**进闸时刻，
   不是第一次。多次进闸的卡（#5、#12、#14、#18）的 dwell 从最后一条算。本数据集里只有
   #12 受实质影响（首次进闸时刻被 build B 覆盖，用对话行回推，见附录 A 注）。
2. **`todo.phaseAt` 是最后一次改相时刻**，不是 done 的原始落地时刻（#1 的 done 实际落在
   09-23 20:07，phaseAt 显示 10-01 06:44——之后还有一次无日志的改相，机制 [未验证]）。
3. **confirm 闸「放行」的判据** = 该 todo 的某个 **withPlan=1** build 里出现了 kind='build'
   的 step 行（`builds.ts:510-514` 确认动作 → enqueue build 步，动作本身不留日志行）。
   review 闸「正经放行」的判据 = 出现 kind='merge' 的 step 行（REST merge / chief
   merge_builds 都会入队 merge 步，`builds.ts:699`）。**没有 merge 步的 review→done 只能
   来自 `complete_todos` 或手动改相**——两者可由 chief_message 的 toolcall 日志区分。

**总分布与逐 build 台账的复算 SQL**（本机，输出即 §2/§3/附录 A 的数）：

```sh
# withPlan × triggerSource 分布
sqlite3 'file:<home>/.pacman/server/server.db?mode=ro' \
  "SELECT withPlan, triggerSource, COUNT(*) FROM build GROUP BY 1,2"

# 逐 build：todo 序号、直/带方案、步构成、plan 落库行数
sqlite3 -header 'file:<home>/.pacman/server/server.db?mode=ro' "
SELECT b.id, t.seqNum, b.withPlan, b.triggerSource, b.prevPhase,
  (SELECT COUNT(*) FROM step s WHERE s.buildId=b.id AND s.kind='plan')  AS planSteps,
  (SELECT COUNT(*) FROM step s WHERE s.buildId=b.id AND s.kind='build') AS buildSteps,
  (SELECT COUNT(*) FROM step s WHERE s.buildId=b.id AND s.kind='merge') AS mergeSteps,
  (SELECT COUNT(*) FROM plan  p WHERE p.buildId=b.id)                   AS planDocs
FROM build b JOIN todo t ON t.id=b.todoId ORDER BY b.createdAt"

# 进闸时刻（最后一条）
sqlite3 'file:<home>/.pacman/server/server.db?mode=ro' \
  "SELECT entityId, type, datetime(createdAt/1000,'unixepoch','localtime')
   FROM notification WHERE type IN ('plan_ready','build_review') ORDER BY createdAt"

# done 落地时刻 + 卡的终态
sqlite3 -header 'file:<home>/.pacman/server/server.db?mode=ro' \
  "SELECT seqNum, phase, hasPlan, hasChanges, datetime(phaseAt/1000,'unixepoch','localtime')
   FROM todo ORDER BY seqNum"
```

**dwell 计算**（附录 A 台账 + §5 dwell 表由它生成）：confirm dwell = `plan_ready` 时刻 →
（确认动作的 build 步 createdAt，或拖去 done 的 phaseAt，取先到者）；review dwell =
`build_review` 时刻 →（merge 步 createdAt / `complete_todos` 的 toolcall createdAt / phaseAt，
取先到者）。等价 Python 脚本（零依赖，跑在只读连接上）：

```python
# ledger.py — python3 ledger.py   (db path 按需替换)
import sqlite3, datetime
db = sqlite3.connect("file:<home>/.pacman/server/server.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
c = db.cursor()
cin  = {r["entityId"]: r["createdAt"] for r in c.execute(
        "SELECT entityId, createdAt FROM notification WHERE type='plan_ready'")}
rin  = {r["entityId"]: r["createdAt"] for r in c.execute(
        "SELECT entityId, createdAt FROM notification WHERE type='build_review'")}
for t in c.execute("SELECT * FROM todo ORDER BY seqNum"):
    builds = c.execute("SELECT * FROM build WHERE todoId=? ORDER BY createdAt",(t["id"],)).fetchall()
    steps  = c.execute("""SELECT s.* FROM step s JOIN build b ON s.buildId=b.id
                          WHERE b.todoId=? ORDER BY s.createdAt""",(t["id"],)).fetchall()
    confirm_out = next((s["createdAt"] for s in steps if s["kind"]=="build"
                        and next(b for b in builds if b["id"]==s["buildId"])["withPlan"]), None)
    merge_out   = next((s["createdAt"] for s in steps if s["kind"]=="merge"), None)
    print(t["seqNum"], t["phase"], len(builds),
          "confirm:", (cin.get(t["id"]) or 0) and
          round(((confirm_out or t["phaseAt"]) - cin[t["id"]])/3.6e9, 2) or "-",
          "review:", (rin.get(t["id"]) or 0) and
          round(((merge_out or t["phaseAt"]) - rin[t["id"]])/3.6e9, 2) or "-")
```

**数据集边界**：18 卡 / 28 build / 99 step，窗 2026-09-23 19:53 → 2026-10-05 15:42（12.8 天）。
单人（用户本人）单机自用真跑记录——正是 §2「自用第一」判据要的那面镜子，但 n 小、且 12/18
是冒烟卡；结论读作「形态学证据」而非统计显著。观测窗内三个已知机制版本变动影响解读，逐条
标在 §5。

## 2. 数据集概览

- 1 team、2 project、18 todo、28 build、99 step、761 build 会话消息、769 chief 消息、29 通知行。
- todo 终态：17 done + 1 review（#18 README 图标，观测窗截止时在闸上）。
- 构成：**12 张连通性测试/寒暄卡**（标题即「测试消息/你好/空消息」类，无码可审）、
  3 张真实工作卡（#1 hello.txt、#16 核对 README、#18 README 图标）、3 张其余（#2 M6 凭证
  验证、#5/#14 同名测试卡的多次重跑）。
- `schedule` 表 0 行——定时器路径（§4 #4）在本地**从未启用**，数据面零实证。
- chief 存在且活跃：16 个 chief 线程、41 个 chief 步、8 个 chief 触发的 build。

## 3. 结论一：withPlan 分布

28 build 全量（复算 SQL 见 §1）：

| withPlan | triggerSource | n | 说明 |
|---|---|---|---|
| 1 | user | 17 | 全部来自 web 面直接建卡跑的（#640 前 UI 仍走 startBuilds 显式带 plan） |
| 0 | chief | 8 | **100% 直执行**。代码默认 `chief-tools.ts:673`（withPlan 缺省 false）+ 系统提示词明令「单一工作单元：直接 run_builds 派该任务（withPlan:false…）」（`chief.ts:687-688`） |
| 0 | user | 3 | #2 M6（2026-09-25 一次首发直启，人工选的直执行）；#18 的两次失败重启（`builds.ts:465` 重启继承原轮 withPlan——原轮是 chief 的直执行） |

user 侧首发选择（去掉重启继承）：17 带方案 vs 1 直执行——**首发面上 94% 选了带方案**。
但这 17 个带方案的 build 里最终**只有 3 个按过确认钮**（§5），所以「选了走闸」和「真走完
闸」是两回事。chief 侧则是 8/8 无一例外直执行——**用户从没在 chief 派发上拥有过 plan/直
执行的选择权**（#640 起开始按钮唯一入口是 orchestrate，选 withPlan 的是 chief 的 LLM）。

## 4. 结论二：闸被跳过的全部路径（代码枚举 + 数据实证）

服务端**全部 20 条**能改相位 / 建 build / 过闸的写面已在附录 B 逐条钉死（file:line）。这里
只列**数据里实际被踩到的 + 高危未踩的**：

### 4.1 实证踩到的（本数据集真实发生）

| 路径 | 代码点 | 实证 |
|---|---|---|
| **A. chief 直执行跳 confirm** | `chief-tools.ts:673`（默认 false）+ `chief.ts:687-688`（提示词明令）+ `builds.ts:396`（首步= build 步） | 8/8 chief build 全部 withPlan=0；chief_message 里 10 次 `run_builds` 派发（1 次原生 + 9 次 `mcp__pacman__run_builds` 工具名变体）：9 次显式 `withPlan:false` + 1 次缺省（工具默认亦为 false） |
| **B. 看板拖拽 → done（两闸全跳）** | `routes.ts:1257` PATCH → `todos.ts:355-378` → `canBoardDrop(_, 'done')` 对**除 failed 外所有源相**返回 true（`packages/shared/src/phase.ts:112-113`）；只写 phase/phaseAt，**不建 build、不入 merge 步、不发通知、不记 actor** | **15/17 done 卡**无 merge 步、无 complete_todos 调用记录 → 只能落在本面。三簇扫除：09-30 16:06:08–11（5 卡/4 秒）、10-04 14:17:42–45（3 卡/4 秒）、10-04 14:20:14–15（2 卡/2 秒），加 5 张单发。包含 confirm 相直接拖到 done（#4–#11、#13、#15：10 张**从未按确认**的卡）与 review 相拖到 done（#2/#16/#17：3 张**在闸上拖走**的卡） |
| **C. chief `complete_todos` 过 review 闸** | `chief-tools.ts:850-880`（review→done **无 merge 步**，funnel 外无权限闸） | #14：`build_review` 通知 23:04:13 → chief 收到 [wake:gate]（提示词明说「需要用户确认或答复时，说明下一步动作」）→ 23:04:21 chief 调 `complete_todos`（chief_message 有完整 toolcall 与 `{"transitioned":[...]}` 回执）→ done。**进闸到 agent 自过闸 8 秒，零人参与** |
| **D. 失败重启继承直执行** | `builds.ts:465`（restart 继承原轮 withPlan） | #18 两次 user 触发的直执行 build（10762/10767）都是 failed→queued 重启，原轮是 chief 的直执行——用户在失败面上发反馈重启，拿到的是无 confirm 闸的新轮 |

### 4.2 高危但本数据集未踩到的

| 路径 | 代码点 | 为什么高危 |
|---|---|---|
| E. 定时重跑一律直执行 + 顶替闸上停驻 | `scheduler.ts:80`（withPlan:false 写死）+ `scheduler.ts:51-63`（cancelGateBuild：confirm/review 停驻的 build 被 Cancelled 后直执行重跑——**人在闸上的待决被定时器静默丢弃**） | 本地 schedule 0 行未启用；一旦启用，「闸的价值命题 = 排队走人」场景（§5 第 1 条）恰恰是它服务的场景，而它每次 fire 都跳 confirm |
| F. agent 侧自按 confirm / 自 merge | chief `confirm_builds`（`chief-tools.ts:726-730`）、MCP `confirm_builds`/`merge_builds`（`mcp-face.ts:342-357`，钥匙授权一次性预授） | 本数据集 0 次调用（chief 的 `merge_builds` 试过 1 次被 **XMON-77 agent 权限闸 403 拦下**——这条防线实测有效，是正面发现）；`complete_todos` 已实证（C），confirm_builds 同族同险 |
| G. REST 面零认证 | `routes.ts:354-359`（auto-login cookie，唯一服务端闸是可选全局 PACMAN_TOKEN，默认关） | PATCH phase=done / steps confirm / merge 任何 HTTP 客户端可裸调；单机自用模型下威胁模型接受，但意味着「过闸动作无身份」是结构性的 |
| H. 执行 agent 经自带 MCP 回环 | `machines.ts:711-718`（claimMcpSlugs：若用户给 agent 配了指回本 pacman 的 MCP server + 有 Confirm/Merge 授权的 key） | 执行者可以自己按自己的闸。0 实证，配置面问题 |

**review 闸正门从未被 withPlan 跳过**：build 步 done 必停 review（`builds.ts:983-987`）——
直执行只跳 confirm，review 的绕法只有 B/C/拖拽。**failed→done 在所有面上都被挡**
（系统边表 `phase.ts:44` + 手动矩阵 `phase.ts:104` + complete_todos funnel）——#702 的
裁决实测完好。

## 5. 结论三：橡皮图章信号（可量化的「仪式化」指标）

**confirm 闸 dwell 分布**（13 次进闸；进闸时刻口径见 §1）：

| 出口 | n | dwell 分布 |
|---|---|---|
| 按确认钮（build 步出现） | **3** | #1 4m43s（对话行回推，通知行缺失）；#3 **114.6h**（卡在闸上 4.8 天后才按，随即停止了 build——更像清障不像审批）；#12 ≈5h11m |
| 拖去 done（从未按确认） | 10 | 30s（#10：plan_ready 到拖走半分钟）、1.0h、1.1h、1.3h、1.4h、3.4h、11.6h、20.4h、27.1h、59.5h |
| 进闸后卡死/被拖回待开始（409 收尾） | 0 单列（计入上面两行的卡里） | #5 build A、#14 的 withPlan 轮：plan 步完成时相位已被拖回 todo，机器 done 报文撞 `illegal phase transition: todo -> confirm` 409（daemon.log 3 处）——**闸上卡被拖回待开始但不停在飞步**的第三类手动干预 |

**review 闸 dwell 分布**（6 次进闸）：

| 出口 | n | dwell |
|---|---|---|
| merge 步放行（正门） | **1** | #1 7m30s（19:58 build_review → 20:05 用户点合并；期间用户在会话里让 agent 自查过 diff——**这是唯一一次「人看 diff 后放行」**） |
| chief complete_todos | 1 | #14 **8 秒**（进闸通知到 agent 自过闸；唯一「即进即放」样本，但按下的是 agent 不是人） |
| 拖去 done（无 merge 步） | 3 | #2 120.1h、#16 24.7h、#17 16.7h（三张都在 review 相停了 1–5 天后被扫除；#16/#17 的拖走发生在 chief 报告「merge_builds 被 403 拒」5 分钟后——人看到 agent 过不了闸，就用侧门替它过了） |
| 在闸上 | 1 | #18（观测窗截止仍在 review） |

**「有物可看」面**（闸上到底有没有东西可审）：

- **plan 面**：28 build 的 `plan` 表 **0 行**；`hasPlan` 位只有 #1 置位。12 次进 confirm 闸
  **全部是 B-C10 时代**（#703 于 2026-10-03 22:00 才堵住「两轮无 plan.md 仍进 confirm」）
  ——闸上只有会话文本、没有方案文档。**版本化方案文档支柱（§1 主张三件之一）在观测窗内
  零使用**，含 #560（plan 上传落库，2026-10-01）之后的 5 个 withPlan build 也是 0 行
  ——通道在窗内**零真实样本**，好坏 [未验证]。
- **review 面**：6 次进闸里 3 次有 diff 可看（#1 有 1 文件、#16/#18 hasChanges=1）；
  #2/#14/#17 hasChanges=0——**review 闸上一半时间没有变更产物可审**（B-C11 同族，
  同样是 #703 前的旧病）。

**橡皮图章判读**：把「仪式化」定义为「人按了闸但没看」——数据里**仅有的 4 次人按闸**
（#1 confirm 4m43s、#12 confirm 5h11m、#3 confirm 114.6h、#1 merge 7m30s）dwell 都不是
即按即放，**不构成橡皮图章**；问题不在「按得太快」，在**88% 的 done 根本不从闸过**。
§5 主张的退化形态需要更正：不是「一道闸 + 一个仪式」，是「两道闸 + 一条没人守的正门
和一条人人走的侧门」。

**正面发现**（如实记录，防止结论只往坏里读）：

- #1（第一个任务）全程走闸：confirm 4m43s + review 7m30s + merge 步落地——**漏斗在
  真实使用里完整跑通过一次**，且两次放行都有实质 dwell。
- XMON-77 agent 权限闸实测有效：chief 试图 `merge_builds` 被 403「Agent Chief 未获
  『合并分支』授权」拦下（2026-10-04 14:15:33，chief_message 有完整回执）——**有牙齿的
  执法在这个面上真的咬了**。缺口是 `complete_todos` 不在该权限模型内（C 路径实证）。
- mea 第二数据集（附录 C）：16/18 withPlan、AI 审核步跑了 5 次（3 成 2 败）、卡至今
  failed 未过闸——**审核的「牙齿」在那边真实咬住了合并**。

## 6. 改进票建议（只建议，不动手）

按「主张存续影响 × 实证踩到」排序：

1. **chief 不得自过 review 闸**——`complete_todos`（chief/MCP 面）把 review→done 做成了
   无 merge 步、无权限闸、无 actor 记录的一次性写。建议：纳入 XMON-77 权限模型（与
   merge_builds 同列「合并分支」授权族），或改为只允许把卡**停在 review 并唤醒人**。
   实证：#14 8 秒自过闸。
2. **手动改相 → done 加确认 + 审计行**——PATCH phase（`routes.ts:1257`）是 88% done 落地
   的实际通道，但 confirm→done/review→done 跳的是两道硬闸的全部语义，且**零通知、零
   actor、零时间线行**（`todos.ts:399-403` 明确不挂通知）。建议：从 confirm/review 相拖向
   done 时要求显式确认弹层（复用 #755 reset 闸的形态）+ 落一条 announcement 行。实证：
   15/17。
3. **过闸动作记 actor**——`steps {action:'confirm'}`（`builds.ts:510-514`）与 complete_todos
   都不记「谁」。主张是「人强制在场」，但库里无法回答「在场的是谁」。建议：动作面写
   announcement 行（与 merge/review 已有的同族，`builds.ts:693-698`/`:533-538`）。这是
   1、2 的公共前置——没有 actor，「闸被人按过」永远只能是推断。
4. **chief 派发的 plan/直执行选择权交还 charter 或人**——`chief.ts:687-688` 提示词把
   withPlan:false 写死成默认行为，8/8 实证。若两道闸是产品主张，编排者不应在每次派发上
   单方面撤销其中一道。建议：charter 加一档「派发走 plan」或 orchestrate 请求带显式
   withPlan 透传。
5. **plan.md 落库通道补真实样本验证**——#560 之后 0 行、0 样本。建议：一张 e2e/verify
   票钉「withPlan build 产 plan.md → plan 表落行 → confirm 卡有物可看」全链（机制生效
   验收取实物，别读码验收）。

不建议做（数据不支持）：砍掉拖拽捷径本身——10 张无码可审的测试卡从 confirm 拖去 done
是对「无事可审」的合理人肉清理；问题只在**有产物在审的卡**（#2/#16/#17）也从这条门走
了，2 号票的确认弹层恰好只咬这种情况。

## 7. 与诚实清单第 2 条的对账

The original criterion in `docs/spec/18-positioning-and-differentiation.md` §5 item 2 — "count the withPlan distribution in a real closed-loop run" —
本文件就是那个数。**该条从「未知」变为「已量，担忧成立」**：直执行 39%（chief 侧 100%）、
confirm 放行率 3/13、review 正门放行 1/6、done 经拖拽 15/17、版本化方案文档 0 行。
spec §5 第 2 条的更新随本 PR 落（把「使用率未知」改为已量结论 + 指针），第 1 条
（「闸的价值命题与无人值守互为前提」）与第 5 条（Chief 存废）各拿到一枚新证据：
定时器路径启用前就该先过 6 号改进票；Chief 在数据里是闸的主要绕行者而非消费者。

## 附录 A：逐 todo 台账（本机，2026-10-05 快照）

列：seq / 标题（截断）/ 终态 / build 数（W=带方案 D=直执行）/ confirm 进·出 / review
进·出 / done 落地机制。「-」= 无行。

| seq | 标题 | 终态 | builds | confirm 进→出 | review 进→出 | done 机制 |
|---|---|---|---|---|---|---|
| 1 | 写一个 hello.txt | done | 1W | [通知缺行，对话回推]→**19:58 按确认**（4m43s） | 19:58→**20:05 merge 步**（7m30s） | **正门全程**（phaseAt 10-01 06:44 的后触 [未验证]） |
| 2 | M6 凭证链路验证:回一行字 | done | 1D | 未进（直执行） | 09-25 18:07→拖走 09-30 18:15（120.1h，无 merge） | review 拖到 done |
| 3 | 测试 | done | 1W | 09-25 20:21→09-30 14:56 按确认（114.6h，build 随即 stopped） | 未进 | confirm 后拖到 done |
| 4 | 你好 | done | 1W | 09-29 11:36→拖走 09-30 14:40（27.1h） | 未进 | confirm 拖到 done |
| 5 | 空消息，待用户说明需求 | done | 2W | 22:30→拖走 09-30 10:08（11.6h）；build A 的 done 报文撞 409（卡被拖回待开始） | 未进 | confirm 拖到 done |
| 6 | 检查 README 是否需要更新 | done | 1W | 11:30→拖走 14:54（3.4h） | 未进 | confirm 拖到 done |
| 7 | 请求重新规划任务… | done | 1W | 14:40→拖走 16:06（1.4h） | 未进 | confirm 拖到 done（扫除簇 1） |
| 8 | 测试消息，无实际任务 | done | 1W | 14:48→拖走 16:06（1.3h） | 未进 | confirm 拖到 done（扫除簇 1） |
| 9 | 确认是否可开工的寒暄询问 | done | 1W | 15:02→拖走 16:06（1.1h） | 未进 | confirm 拖到 done（扫除簇 1） |
| 10 | 测试消息，无实际任务 | done | 1W | 16:12:07→拖走 16:12:37（**30s**） | 未进 | confirm 拖到 done |
| 11 | 用户打招呼，暂无具体任务 | done | 1W | 10-01 02:19→拖走 22:44（20.4h） | 未进 | confirm 拖到 done |
| 12 | 测试消息，确认链路可用 | done | 2W | build A 进闸 ≈10-01 17:33→22:44 按确认（≈5h11m，首次进闸行被 upsert 覆盖，时刻取对话行回推）；build B 进闸 10-02 17:26→未按 | 未进（build A 的 build 步 done 但 build_review 行缺失，进闸 [未验证]） | confirm 后拖到 done（扫除簇 2，10-04 14:17:42） |
| 13 | 发送测试消息确认连通 | done | 1W | 10-02 02:45→拖走 10-04 14:17（59.5h） | 未进 | confirm 拖到 done（扫除簇 2） |
| 14 | 测试消息确认连通性 | done | 2W+1D | withPlan 轮的 done 报文撞 409（卡被拖回待开始）；chief 轮直执行未进 | 10-02 23:04:13→23:04:21 | **chief complete_todos**（8s，chief_message 全证） |
| 15 | 用户打招呼，纯寒暄 | done | 1W | 10-02 17:48→拖走 10-04 14:17（44.5h） | 未进 | confirm 拖到 done（扫除簇 2） |
| 16 | 核对 README 是否需更新… | done | 1D | 未进（chief 直执行） | 10-03 13:38→拖走 10-04 14:20（24.7h；此前 14:15 chief merge_builds 被 403 拒） | review 拖到 done（扫除簇 3） |
| 17 | 测试消息，回复ok即可 | done | 1D | 未进（chief 直执行） | 10-03 21:37→拖走 10-04 14:20（16.7h） | review 拖到 done（扫除簇 3） |
| 18 | README 页首加应用图标… | **review** | 7D（6 chief + 2 user 重启） | 未进（全直执行；3 个 plan 步全 failed/stopped——review verdict 自动回流轮） | 10-05 15:42 进闸，**在闸上** | — |

「拖到 done」的判定依据：无 merge 步 + 无 complete_todos toolcall + phaseAt 时刻落点
（机制归并为手动改相面；**逐卡是「拖拽 UI」还是「裸 PATCH」不可分**——两者同一服务端
入口且都零审计行，这本身就是 3 号改进票的论据）。

## 附录 B：服务端写面全枚举（20 条，file:line）

以下为只读代码勘察的完整清单（worktree @ 67509706）。每条：入口 / 调用者身份 /
能跳/能过的闸 / 条件 / 是否需要人的一次性动作。

| # | 入口 | file:line | 调用者 | 闸影响 | 条件 | 人一次性动作？ |
|---|---|---|---|---|---|---|
| 1 | REST `POST /api/projects/:id/builds` withPlan=false | routes.ts:1122 → builds.ts:396 | 任意 HTTP 客户端（web hooks.ts:648-661 仍接线；UI 已不走） | 跳 confirm | body 显式 false | 有意识选择 |
| 2 | `POST /api/todos/:id/orchestrate` → chief run_builds 默认 false | routes.ts:600；chief.ts:687-688；chief-tools.ts:673 | web 开始按钮 / 拖入执行中（#640 后唯一入口）→ chief LLM | 跳 confirm | 提示词明令 + 工具默认 | **否** |
| 3 | MCP `run_builds` 默认 false | mcp-face.ts:315 | 外部 MCP 客户端（持 'Run Builds' 授权 key） | 跳 confirm | withPlan 缺省 | 授权时一次 |
| 4 | 定时重跑 withPlan:false 写死 | scheduler.ts:80；cancelGateBuild :51-63 | 定时器 | 跳 confirm（每次 fire）；顶替闸上停驻 | schedule 到期 | 挂定时器时一次 |
| 5 | REST `PATCH /api/todos/:id` phase=done | routes.ts:1257 → todos.ts:355-378 → shared phase.ts:112-113 | web 拖拽 / 任意裸 HTTP | **两闸全跳**（除 failed 源外任意相→done） | canBoardDrop(from,'done')===true | 有（但零审计） |
| 6 | 同上 phase=building（todo/queued 源） | manual-drop-matrix.test.ts:124-129 | 裸 PATCH（web 已改走 orchestrate） | 落 post-confirm 相且无 build | 待开始列源 | 有 |
| 7 | chief `complete_todos` | chief-tools.ts:449 → :850-880 | chief LLM | **过 review**（无 merge 步） | 相位=review | **否**（无权限闸） |
| 8 | MCP `complete_todos` | mcp-face.ts:370-371 | MCP 客户端（'Complete Todos' 授权） | 过 review（同上） | 相位=review | 授权时一次 |
| 9 | chief `confirm_builds` | chief-tools.ts:726-730 → builds.ts:510 | chief LLM | **agent 按人闸** | 相位=confirm | **否** |
| 10 | MCP `confirm_builds` | mcp-face.ts:342-349 | MCP 客户端（'Confirm Builds' 授权） | agent 按人闸 | 相位=confirm | 授权时一次 |
| 11 | chief `merge_builds` | chief-tools.ts:742 → builds.ts:656-701 | chief LLM | agent 过 review（XMON-77 工具闸在 :675-689） | 相位=review（或 #702 恢复） | 否 |
| 12 | MCP `merge_builds` | mcp-face.ts:350-357 | MCP 客户端（'Merge Builds' 授权） | 同上 | 同上 | 授权时一次 |
| 13 | REST `POST /api/builds/:id/merge` | routes.ts:1140 | 任意 HTTP（web 合并弹层） | 过 review（入队 merge 步） | 相位=review | 有 |
| 14 | REST `POST /api/builds/:id/steps {confirm}` | routes.ts:1213 → builds.ts:510-514 | 任意 HTTP（web 确认钮） | **就是 confirm 闸本身**；无 actor 记录 | 相位=confirm | 有 |
| 15 | 机器面 `POST /api/machine/done/:stepId`（merge 步） | routes-machine.ts:385 → machines.ts:1670-1800 → builds.ts:1049-1051 | 机器 daemon（机器 token） | review 落地 done（hosted 服务端 ff 校验 :1807-1835；github/local 信机器回报） | 步被该机 claim | 否（机器可信面） |
| 16 | 机器面 claim（build 步）queued→building | routes-machine.ts:228；machines.ts:946-948 | 机器 daemon | withPlan=false 时 claim 即跳闸时刻 | 首步=build | 否 |
| 17 | 执行 agent 自带 MCP 回环 | machines.ts:711-718 | 执行 agent（若配置了指回 pacman 的 MCP + 授权 key） | 两闸皆可自过 | agent.mcpServers 配置 | 配置一次 |
| 18 | `steps {restart}` | builds.ts:447-507 | web 失败面 | 无（failed→queued；**withPlan 继承** :465） | 相位=failed | 有 |
| 19 | `restoreFailedReview` | builds.ts:625-652（调用方 :663/:520） | merge/审核动作面 | 无（是闸**入口**，数据闸 :637-647） | build 腿 done+产物在 | 有 |
| 20 | scheduler `cancelGateBuild` | scheduler.ts:51-63 | 定时器 | 丢弃闸上待决（旧 build Cancelled） | confirm/review 停驻+latestBuildId | fire 时无人 |

认证模型（谁能调什么）：REST `/api/*` **事实上无认证**（auto-login cookie，routes.ts:354-359；
唯一服务端闸 = 可选全局 PACMAN_TOKEN，token-auth.ts:68-86，默认关）；机器面 = Bearer
机器 token（routes-machine.ts:118-125）；MCP 面 = Bearer apiKey + 每钥匙工具授权
（mcp-face.ts:441-455；授权清单含 Confirm/Merge/Complete Todos，shared mcp.ts:44-58）；
chief 无自有凭证——由 REST 消息触发、机器 claim 时拿到全量 51 工具（machines.ts:849），
是明文的「trust face」（chief-tools.ts:5-8）。执行 agent 的 relay 工具面**不含**闸工具
（machines.ts:1122-1123）——执行者绕闸只能走 #17 自配 MCP 一条路。

**非绕过面（核实过）**：stop 只回退（builds.ts:228-238/246-279）；plan 步无 plan.md 只补写
一轮（:962-975，#703 后闸死 :901-928）；reset 只回 todo（todos.ts:489-562）；review verdict
blocking 只回流 planning（:1022-1046）。failed→done 全面封死。

## 附录 C：mea 第二数据集（对照，非合并进主结论）

mea 上用户自己的部署（`/home/measure/.pacman/server/server.db`，只读查询）：1 todo、18
build、窗 10-01 23:52 → 10-02 03:31。withPlan=1 16 个、直执行 2 个（末轮）；15 个 plan 步
failed（#519 那晚的 relay/540s 墙问题，见 wiki 记录）；**AI 审核步跑 5 次（3 done 2
failed）**；todo 至今 failed——**闸在那边咬住了，没有过**。它补的证据：AI 审核的牙齿
在真实失败流里真实咬过（2 次 blocking 后回流重试）；直执行只发生在「plan 轮 15 连败后的
人工换道」。[未验证] 项：mea 侧 chief 0 线程——chief 绕闸路径在该机无数据。

## 附：证据锚点

- 本机 DB 快照查询全部可由 §1 SQL 复算；对话/chief_message 佐证行（#14 的
  complete_todos toolcall、#16 的 merge_builds 403、#1 的确认/合并注入行）可用
  `SELECT … FROM message WHERE conversationId='<buildId>'` /
  `SELECT … FROM chief_message WHERE threadId='chief-<id>'` 逐条重放。
- 代码引用基准 = 本 PR 分支（67509706 基线上加本文件与 spec §5 更新）。
- [未验证] 清单：① #1 的 done 后触改相（phaseAt 10-01 06:44）机制；② #12 build A 的
  review 进闸缺行；③ 拖拽 vs 裸 PATCH 逐卡不可分（同入口零审计）；④ plan 上传通道
  （#560 后）零真实样本，质量未知；⑤ mea 侧 chief 路径零数据。
