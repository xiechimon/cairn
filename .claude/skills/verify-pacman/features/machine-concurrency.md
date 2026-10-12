# 机器并发上限 + 排队可见（machines 页 + chief 抽屉 + 任务详情，#1108）

一台机器同时跑 N 个回合（N = `machine.maxConcurrent`，DB NOT NULL 默认 3——
0000 migration 历史值；#503 曾摘列，摘除前提「daemon 串行永不触顶」随本票
daemon 并行循环作废）。**超过 N 才排队**：server claim 闸（`tryClaim` 数本机
claimed ≥ cap 即不发步）+ daemon 本地闸（GET me 读 cap，混版本护新 daemon
对旧 server 按 1 串行）双侧同值。排队有真实呈现：pending 步位次 + 等待对象
（server 排队投影 `stepQueueProjector`——steps 查询挂 `queue`、chief 线程挂
`turnQueue`），chief 抽屉在飞存在行与任务详情 streaming 行从「处理中...」切
「排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）」；机器页行
内「执行中 n/N」读标注 + 「并发」选择器（行内第二个活控件，Popover listbox
正典形）。空位交接：步终态 `finishStep` 发 team wake，满载机器挂起的 claim
长轮询被即时唤醒（不等 75s hold 到期）。

## Sub-features

- `mconc-cap-gate` claim 容量闸：本机 claimed 步数 ≥ `maxConcurrent` → claim
  空手、步留 pending（合法排队态，不进失败漏斗——钉选机离线/runtime 闸挡/
  零在线三族扫尾语义不变）。SQLite `machine.maxConcurrent`（integer 默认 3）
  是真值列。
- `mconc-daemon-parallel` daemon 并行循环：claim 到即发射不 await
  （`sessionHandles`/`stopRequests` 本就按 stepId 索引），canon 行
  `step <id> for conv <conv> (n running)` 的 n = 在飞计数；优雅停止 =
  循环退出后 allSettled 在飞集再 resolve。
- `mconc-local-cap` daemon 本地闸：GET me 的 `maxConcurrent` 缓存 + 随
  presence 节拍（30s）刷新；缺席（旧 server）按 1 串行。下调不抢占在飞步
  （两侧闸只挡新认领）。
- `mconc-queue-projection` 排队投影：`steps 查询` pending 行挂
  `queue{position, waitingFor}`；`GET chief/threads` 活动线程挂 `turnQueue`
  （同形）。钉选步位次只数该机可见集（钉同机或未钉——claimCandidates 同
  过滤同序）；未钉步数全队 FIFO（诚实近似，宁多报不漏报）；waitingFor =
  钉选机器 + running/capacity 快照，未钉 null。
- `mconc-queue-row-queued` 排队行标签：pending + 投影在位 → live 存在行
  `排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）`（未钉形
  `排队中：等空闲机器（前面 {ahead} 个）`）；被领取（投影退场）→ 回落
  `处理中...` 既有收敛。排队行不挂相位面（signalAt/skills——步没在跑）。
- `mconc-machine-readout` 机器页读标注：`[data-machine-running]` 文本
  `执行中 {n}/{cap}`（n = claimed 计数，GET machines 记录 `runningSteps`
  派生随行）。
- `mconc-machine-control` 机器页并发选择器：`button[aria-label="并发上限"]`
  （带 `data-machine-id`，Popover listbox 1..8 档 + API 设的 9..16 并入），
  选定 = `PATCH /api/machines/{id}` 单字段 `{maxConcurrent}`（值域 1..16，
  越界 400）；字段缺席（老 server）→ 控件与读标注整组退场。
- `mconc-finish-wake` 空位交接：`finishStep` 终态发 team wake——满载机器
  挂起的 claim 即时重试认领（enqueue wake 只覆盖新步路径）。

## How to get to it (user POV)

- 机器页（`/app/resources/machines`）：每行右段「执行中 n/N」+「并发 N」
  选择器；改 N 即改这台机器的并行额度（跑完当前批才收窄）。
- chief 抽屉：满载时发出的回合显示「排队中：等 <机器>（n/N 在跑，前面 M
  个）」；被领取后回到「处理中...」。
- 任务详情对话区：pending 步同款排队行。

## Driving conventions

- 驱动入口 = `scripts/drive-1108-concurrency.mjs`（门控 stub LLM + 真
  daemon；四族 15 checks：并行 canon 行/stub 请求区间重叠、闸拦队留、
  turnQueue/排队行/读标注、空位交接、PATCH 值域）。证据
  `docs/verify/1108/`（含复跑配方 README）。
- 单测面：server `test/machine-concurrency.test.ts`（闸/投影/写面 9）+
  `test/machine-pin.test.ts`（#1259 归属机版：步只投 agent 归属机，钉选
  过滤退役——会话亲和族随 #1259 退役删除）；daemon
  `test/machine-loop.test.ts` 并行循环 P1–P5；web
  `test/activity-live-row.test.ts` 排队标签 Q1–Q6。
- e2e 面：`machines-local.spec.ts`（行内活控件 = 两件）+
  `machines-shell-switch.spec.ts` C1–C4（PATCH 单字段/读标注/老形态退场）+
  `dead-buttons.spec.ts`（零死钮收窄钉）。

## Gotchas

- 机器页行序 = 本机 seed 行排首——探针/e2e 断言并发控件按
  `data-machine-id` 钉位，`.first()` 抓错行假红（本机行也带控件，缺省 3）。
- chief 绑 Agent 的 PATCH agent 槽要求 `thinkingLevel` 键（nullable 但必填
  键），漏键 400 且报错不点名。
- 新线程缺省钉选链 = `body.pinnedMachineId ?? chiefRow.machineId ?? null`
  ——PATCH chief 主力机即可让全部新线程钉本机（probe 用它造满载场景）。
- daemon 本地闸对 cap 变化最长 30s 才刷新（presence 节拍）——server 闸是
  权威侧，满载照拦不误；probe 时序 PATCH 早于发线程即无感。
- #503 的「行内零 button / 并发上限不许回来」负向钉随本票翻案收窄为「零
  死钮」：#503 摘的是只读死字段，现在是有真实写路径与消费链的活控件（用户
  2026-10-10 原话「在并发限制里面给一个数」即翻案依据）。
