---
name: verify-step-claim
description: pacman 步的领取 / 心跳 / 失联释放 / 收尾回报 / 关卡停止的 TLA+ 模型检查（TLC，一条命令约 1 分钟）。改到 tryClaim、heartbeatStep、ownedStep、finishStep、sweepAbandonedBuildSteps、sweepStaleMachines、sweepQuotaWaitSteps、stopActiveStepsAfterExit、fetchStop、scheduler tick 顺序，或 daemon 的领取循环、recover、deliverStop、runStep 的心跳 / 会话登记 / 收尾时用；判断改动有没有让「同一步被两处同时跑」「旧执行者的结果被采纳」「关卡后又被领走」「已接收的停止信号丢失」变得更好或更坏。
---

# verify-step-claim

一个步（`step` 行）从 pending 被某台机器领走、跑完、回报结果，中间会被四方同时碰：daemon（领取、心跳、回报、重启恢复、停止投递）、server 调度一拍（翻离线机器、扫失联步、放回配额到期步）、用户（关卡 / 标完成）、环境（断网、进程崩溃、时间流逝、改绑归属机）。测试只覆盖写测试的人想到的顺序；本技能用 TLC 把有界范围内的**所有**顺序走一遍。

模型：`model/StepClaim.tla`（除首行外不写注释，动作与代码的对应只记在本文件）。每条性质一个配置：`model/P*.cfg`。预期结果：`expected.txt`。

## 什么时候跑

改动碰到下面「覆盖记录」里的任一文件里的列出函数，或者改了 `scheduler.ts` 里 `tick` 的扫尾顺序，就跑。只改文案、日志行、与步状态无关的字段（PR 回填内容、token 记账、transcript）不用跑。拿不准就跑。

## 怎么跑

```sh
.claude/skills/verify-step-claim/scripts/run.sh            # 四条全跑，8 核约 1 分钟（四条都是 PASS，每条十几秒，视机器负载）
.claude/skills/verify-step-claim/scripts/run.sh P1_SingleExecutorPerMachine   # 只跑一条，几秒
```

前置：Java 11+（本机 `~/.sdkman/candidates/java/current/bin/java`，17.0.7）和 `~/.cache/pacman/tla2tools-1.7.4.jar`。jar 缺失时脚本打印下载命令并退出 2；脚本校验 SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`（v1.7.4 官方 release，2,274,532 字节）。路径可用 `PACMAN_TLA_JAR`、`JAVA` 覆盖。TLC 的中间产物全写在 `$TMPDIR/verify-step-claim.*`，不进仓。

`expected.txt` 每行：配置名、预期结果，预期 FAIL 的还记着反例的动作序列（逗号分隔，不含初始状态）。预期 FAIL 的性质用单线程跑（几百到几千个状态，一两秒），反例是确定的；预期 PASS 的用全部核。

退出码：
- 0 = 每条结果与 `expected.txt` 一致，预期 FAIL 的反例动作序列也一致。
- 1 = 有一条变了：新违反、已知发现不再违反，或已知发现的反例换了一条路径。最后一种也要当回事：同一条性质出现了更短的新路径，或者原路径被堵上、剩下一条更长的。
- 2 = 工具或模型错误，包括 TLC 报的违反不是这条配置的性质（比如 `TypeOK`）。

脚本最后列出 `sync-commit` 之后改过覆盖文件的提交和未提交改动；`sync-commit` 不在本地历史里（浅克隆）时只打印一行说明。

## 四条性质（一句承诺 + 一句伤害）

- **P1 `SingleExecutorPerMachine`**：同一台机器上，同一个步任一时刻最多一个 runStep 在准备或运行。坏了 = 两个 agent 在同一个 worktree（`workspace.ts:122` 按会话号建目录）、同一条分支上同时改代码和推送。
- **P2 `OnlyHolderResultApplied`**：server 只采纳当前这次领取的执行者的回报。坏了 = 旧执行者的结果把步和卡片改掉，而新执行者还在跑；卡片会在「审核」和「失败」之间被来回改写。
  - #1473 起幽灵变量的口径（措辞不变）：旧口径「被采纳的回报不是 `holder` 发的就算违反」；新口径多一条例外：`orphan`（发回报的 daemon 已崩溃）在 await 之后的复查里对上了**当前这次领取**，就不算。证据：`orphan` 只能从 `applying` 来，那时 journal 已是 `awaiting`；重启后 recover 起的执行者走 `resumePendingUpload`，重放的是同一份 `doneBody`，两者是同一次执行的同一份结果。没有这条例外，TLC 报的唯一反例就是这条（领取 → 会话 → 收尾 → 所有权校验 → daemon 崩溃 → recover → orphan 落账）。
- **P3 `NoClaimAfterClose`**：卡片关闭 / 标完成后，这个步不会再变成 claimed。坏了 = 用户关掉的任务又被 agent 领走开工。
- **P4 `AcceptedStopReachesWorkers`**：daemon 处理过一条停止信号后，本机上为这个步干活的执行者都已被打断。坏了 = 用户关卡后 agent 继续跑完整轮会话（烧额度、推提交、可能开 PR）。

## 当前结果与已知发现（sync-commit 时）

`P1 PASS`、`P2 PASS`、`P3 PASS`、`P4 PASS`（各 685,500 个不同状态，8 核各十几秒）。F1 / F2 由 #1473 修掉，F3 由停止投递修复修掉（见下）。F3 修复后停止不再经会话句柄投递，模型去掉了 `handle` / `stopReq` 两个变量，状态数从 794,525 降到 685,500。以后哪条变成 FAIL，先按「怎么分辨真 bug 和模型写错」判断；**不要为了让它通过去削弱性质或模型。**

`sync-commit` 指向 #1473 的 squash 提交 659d8cb5，模型同时已跟到 F3 修复。本仓 squash 合并，分支上的提交号合并后不在 main 上：F3 修复合并后，把 `sync-commit` 推到那个 squash 提交。

F1、F2 已由 #1473 修掉（下面保留原发现，供对照）：
- daemon `runStep` 入口即起心跳，会话结束与失败回报前各自停，`finally` 兜住其余出口（`runner.ts:420-440`、`failStep` 2375）。模型：`HeartbeatStep` / `KeepsFresh` 在 `preparing` 也成立，`StartSession` 不再清 `beat`。
- daemon 领取循环：领到的步号已在 `inFlight` 里就什么也不起（`machine-loop.ts:687`），在飞那份就是新这次领取的执行者。模型：`TryClaim` / `TryClaimResponseLost` 在本机有 `Live` 执行者时只把 `holder` 交给它（`Carrier(m)`），不建新执行者、不动 journal。
- server `finishStep`：步已不是 claimed（记名本机，或已放回、无记名且同团队）就答 ok、只回收 git 凭证（`machines.ts:1788-1799`）；await 之后复查「同机、同一次领取（`claimedAt`）、仍 claimed」，不符就 409，之前不写步 / build / 卡片（`machines.ts:1827-1836`）。模型：`FinishStepOwnedCheck` 在 `sm = m` 或（`sm = NoMachine` 且不是 claimed）时先判 `st`，success 记下 `seen = claims`；`FinishStepApply` 复查不过就丢弃（daemon 侧 = done 失败，journal 留着）。

**F1（P1，已修）同机重领，同一步两个执行者。**
1. 机器 m1 的 daemon 领到步（`tryClaim`），runStep 开始准备工作区（clone / 等同项目锁 / `.agents/setup`，后者上限 20 分钟）。
2. 心跳计时器在准备完成后才启动（`runner.ts:1133`），所以 120 秒内没有任何心跳落地。
3. 调度一拍：步 claimed、心跳超 120 秒、`lastHeartbeatAt` 从未推进 → `sweepAbandonedBuildSteps` 在机器**在线**时也把它放回 pending、清掉 `machineId`，并唤醒等待中的领取请求。
4. 同一台 daemon 的领取循环立刻又领到它（归属机只有 m1；领取循环不查这个步是否已在本机跑，`machine-loop.ts:666-689`）→ 第二个 runStep。
笔记本合盖或断网超过 150 秒也能走到这里（机器先被 `sweepStaleMachines` 翻离线，再被释放）。

**F2（P2，已修）旧执行者的回报被采纳。** 接 F1 第 4 步：第一个 runStep 准备失败（比如 setup 失败）报 `done(failed)` → `ownedStep` 只比机器号（`machines.ts:1265-1270`）→ 采纳，步变 failed、卡片变 failed，而第二个 runStep 还在跑。`finishStep` / `completeStep` 都不检查步当前状态，第二个执行者之后的回报同样被采纳。单次领取也能违反（交接时用诊断不变式确认过，时间窗窄）：success 回报通过 `ownedStep` 后在 await（`mergedPrElsewhere` 查 GitHub / `applyMergeLanding`）期间，扫尾把步放回 pending，await 结束后照样写成 done。

**F4（无性质覆盖，推断）回报丢一次，步就一直卡在执行中。** 模型里用诊断不变式走到过这条 8 步路径，真代码没跑过：
1. 会话开始，心跳已落地（`lastHeartbeatAt` 推进过）。
2. 断网，会话结束，`client.done` 抛错（`machine-client.ts` 的 `request` 不重试），runner 留着 journal 直接返回（`runner.ts:2222-2228`）。
3. 网络恢复，presence 照常，机器在线。
4. 扫尾：心跳超时，但机器在线且心跳推进过 → 当成歧义态不动（`builds.ts:1515-1524`）。没有执行者，也没有人补报，直到 daemon 重启走 recover。
四条性质都是安全性质，抓不到「一直不前进」；要抓需要加带公平性假设的活性性质（见「不在范围」）。

**F3（P4，已修）准备期收到的停止信号被丢掉。**
修复前（23a39da9）：步已被 m1 领走、runStep 还在准备（会话句柄要到开会话后才登记）时用户关卡 → `stopActiveStepsAfterExit` 写 `stop_pending` 并推 stop 事件 → daemon `deliverStop` 经 `fetchStop` 拉到 discard，server 随即删掉 `stop_pending` 行 → `sessionHandles.get(stepId)` 为空，记一行 `stop dropped (no live session)` 就返回 → 会话照常开始并跑完，回报 success。同一结局还有两条路径：F1 的双执行者状态下停止只投到最新登记的那个会话（`sessionHandles` 按步号覆盖；#1473 后同机不再有双执行者）；关卡后 daemon 崩溃重启，recover 按 journal 把这一步重跑，而 server 的停止记录已删。
修复（server 的拉取即确认不变，`fetchStop` 照旧删行）：
1. 停止按 run 投递，不按会话句柄投递（`apps/daemon/src/step-stops.ts`）。runStep 进门登记本次 run 的停止位（`runner.ts:433`），`deliverStop` 把请求记到这一步在本机每一次还没收尾的 run 上（`machine-loop.ts:532`），再中断其中会话已开的。会话未开时只记下请求：开会话前查到就不开会话、直接报 stopped（`runner.ts:1462`）；开会话途中到的，会话一开即中断（`runner.ts:1488`）。run 在收尾读停止位时 settle（`runner.ts:1827`），之后到的停止不再接收，照旧记 `stop dropped (no live session)`。
2. 有 run 接收时，`deliverStop` 在中断会话之前写 journal 的 `stopRequest`（`machine-loop.ts:538`；写失败只记日志，不挡投递；中断调用抛错就清掉这条记录）。recover 见到它就报 stopped、不重跑（`machine-loop.ts:444` → `runner.ts:2335` `resumeStoppedStep`）；awaiting-upload 残留仍按快照补报（会话已跑完，完成优先）。不开会话报 stopped 时与正常收尾同序：终稿快照落 journal、回传已有 transcript（任务行不丢）、再报 done。
验证：P4 PASS；把修复在模型里退回会再报违反（见「证明检查能失败」）。测试先红后绿：`apps/daemon/test/machine-stop.test.ts`「已接收的停止送达本机每一次 run（F3）」、`runner-stop.test.ts` 失败方式 5、`runner-network-retry.test.ts` 失败方式 5b、`machine-recover.test.ts` 两条「重启前已接收停止」。

### 复现证据（23a39da9 时实测，F1 / F2 修复前）

测试源码、输出和 `run.sh` 的输出存在 `docs/verify/step-claim-tla/`：`repro-server.test.ts.txt`、`repro-daemon.test.ts.txt`（复现时去掉 `.txt` 放回 `apps/server/test/`、`apps/daemon/test/` 跑，跑完删掉，不进产品测试集）、`repro-output.txt`、`run-full.txt`、`run-p3-break.txt`。

- server 半（F1 / F2）：在 `apps/server/test/` 下用 `bootServer()` 建一台在线机器 + 归属该机的 agent + pending build 步；`claimStep` → 推进 121 秒跑 `sweepAbandonedBuildSteps` → 步变 pending、`machineId` 清空 → 同机 `claimStep` 返回同一步 → 旧执行者 `heartbeatStep` 被接受 → 旧执行者 `finishStep(success)` 被接受（步 done、卡片 review）→ 新执行者 `finishStep(failed)` 也被接受（步 failed、卡片 failed）。
- daemon 半（F1）：`apps/daemon/test/machine-loop-harness.ts` 的 `FakeMachineApi`，`mePatch = { maxConcurrent: 1 }`，两次推同一个 `CLAIMED`（步 s1）→ `createSession` 被调用 2 次、两次 `done(success)`。
- daemon 半（F3）：同一 harness，`createSession` 挂住期间推 `{type:'stop', stepId:'s1'}`、`stopResponse = true` → 日志 `stop dropped (no live session)` → 放开后回报 `done(success)`，会话 `stop()` 调用 0 次。修复时改写成提交的测试，断言修复后的行为（见 F3「验证」）。

## 怎么分辨真 bug 和模型写错

TLC 报违反时，脚本打印反例：每一步是模型里的动作名，下面是这一步改变的变量。拿下面的动作对照表，逐步问「代码里这一步真能在这个状态下发生吗」：

- 每一步都能在代码里找到对应、且前置条件在代码里也成立 → 真 bug。用代码里的名词写成步骤（像上面的 F1-F3），报告给用户，**不改业务代码**，除非用户要求。
- 某一步在代码里不可能（前置条件比代码宽、把代码里一个同步块拆成了两步、漏了代码里的某个检查）→ 模型写错。改模型，写清楚错在哪，再跑。
- 拿不准时写一个不提交的复现测试（见上面三条的搭法），用真代码走一遍。

## 动作 ↔ 代码对照（`runner.ts` / `machine-loop.ts` 行号为 F3 修复时，其余为 sync-commit 时）

server 是单进程、better-sqlite3 同步写：两个 `await` 之间的代码不会被别的请求插进来。模型按 `await` 切原子步，这是忠实度的核心。

- `TryClaim(m)` / `TryClaimResponseLost(m)`：`apps/server/src/services/machines.ts` `tryClaim`（924）的 worker 分支，`status = pending` 条件写 1077-1091；`claimStep` 长轮询 1240。daemon 侧：`apps/daemon/src/machine-loop.ts` 648 起的循环，步号已在 `inFlight` 就跳过（687，`Carrier(m)`），否则发 runStep → 进门登记停止位（`runner.ts:433`）、`runner.ts:535` `journal.claim`，与领取响应同一同步段。ResponseLost = server 已写 claimed、daemon 没收到响应（B-C7 移交竞态）；本机有在飞执行者时，它照样是这次领取的执行者（server 所有权按机器号判）。
- `StartSession(e)`：`runner.ts:692` `workspace.prepare` 结束 → 1462 停止位已有请求就不开会话（模型里这个 run 不走 StartSession，由 `FinishSession` 给 stopped）→ 1486 `sessionHandles.set` → 1488 `stop.attach`（开会话途中到的停止在这里兑现）。准备期 = 模型里的 `preparing`。心跳在 runStep 入口（429）就已起，不随会话开始重置。
- `HeartbeatStep(e)`：`runner.ts:429-431`（失败被吞；`preparing` / `running` 都发）→ `machines.ts:1263` `heartbeatStep`，所有权只看 `ownedStep`（1270，只比机器号）。
- `FinishSession(e)`：会话结束停心跳（`runner.ts:1798`）、读本次 run 的停止位并 settle（1827）定结果，`journal.update(awaiting-upload)`（2211）。准备期失败走 `failStep`（2375，先停心跳），模型只给 `failed`；准备期停止位有请求 → 1462 直接报 stopped，模型给 `stopped`。`ex[e].halt` = 本次 run 的停止位有请求（会话已开则已中断）。
- `FinishStepOwnedCheck(e)` / `FinishStepApply(e)`：`machines.ts:1776` `finishStep`。先 `ownedStep`，步已不是 claimed → 只回收凭证、答 ok（1788-1799）。只有 success 回报可能带 `prUrl`（`runner.ts:2200`）或是合并落地，才会在 1813 / 1820 处 await，所以只有 success 被拆成两步；await 后复查同机、同 `claimedAt`、仍 claimed，不符 409（1827-1836）；其余结果校验和写入在同一同步块。写入：配额 → `quota-wait.ts:87` `applyQuotaWaitStep`；success → `builds.ts:1611` `completeStep`；stopped → `builds.ts:292` `applyStoppedStep`；failed → `builds.ts:1407` `applyStepFailure`；全部先清 `stop_pending`（`machines.ts:1938`）。
- `SchedulerTick`：`apps/server/src/services/scheduler.ts:130` `tick` 一整拍原子，按 179 `sweepStaleMachines`（`machines.ts:646`）→ 186 `sweepAbandonedBuildSteps`（`builds.ts:1482`：先停已关 / 已完成卡片的 pending / waiting_quota 残留，再判 claimed：心跳超时且（机器离线或心跳从未推进）→ 已关卡片 `stopStepKeepPhase`（1522 → 414），否则 `releaseClaimedStep`（1532））→ 192 `sweepQuotaWaitSteps`（`quota-wait.ts:142`）的顺序。
- `CloseCard`：`builds.ts:465` `stopActiveStepsAfterExit` → 469 `prepareStopFor`：pending / waiting_quota 即停，claimed 写 `stop_pending` + `stopSignal`。
- `DeliverStopFetch(m)` / `DeliverStopToRuns(m)`：`machine-loop.ts:528` `deliverStop` 先 `await client.stop` → `machines.ts:254` `fetchStop`（claimed + 机器号匹配才返回并删行），再在同一同步段里把请求记到本机这一步每一次还没 settle 的 run 上（532，`step-stops.ts` `StepStops.accept`；模型里本机所有 Working 执行者 `halt`），有 run 接收才写 journal `stopRequest`（538，模型 `jstop`），然后中断已开的会话。
- `MarkPresence(m)` / `PresenceAges(m)`：`machines.ts:577` `markPresence`；daemon 启动时一次（`machine-loop.ts:304`），之后 30 秒定时器（592，recover 结束后才启动）。
- `DaemonCrash(m)` / `DaemonStartRecover(m)` / `DaemonRecoverDone(m)`：`machine-loop.ts:429` recover，`machines.ts:669` `recoverSteps`（claimed + 本机）；有 journal 时：awaiting-upload 只补报，带 `stopRequest` 报 stopped 不重跑（444，`resumeStoppedStep`），否则 `await runStep`；没有 journal 就报 failed；recover 期间不推送流、不发 presence、不领取。journal 在磁盘上，`jstop` 跨崩溃保留。
- `MachineStreamAbort(m)`：`apps/server/src/routes-machine.ts:317` 推送流 `onAbort` 立即 `markOffline`，并丢掉还没送到的 stop 事件。模型允许它在机器在线的任何时刻发生（daemon 退出、断网、代理掐断长连接、server 重启都会触发）。
- `DaemonCrash(m)` 时正在被 server 处理的回报（`applying`）变成 `orphan`：server 照常走完（复查过了就写，没过就 409 丢掉），但发请求的进程已经没了，所以不再动这台机器的 journal（含 `jstop`）。
- `HeartbeatAges`、`QuotaProbeDue`、`Partition(m)`、`Reconnect(m)`、`RebindHomeMachine(m)`：时间流逝 / 网络 / 用户改 agent 归属机。

## 边界与假设

- 规模：2 台机器（m1 是初始归属机），1 个任务 1 个 build 1 个步，最多 2 次执行（`ExecIds = {1, 2}`、`MaxClaims = 2`：两次领取，或一次领取 + 一次 recover），断网最多 1 次，daemon 崩溃最多 1 次，改绑归属机最多 1 次。超出这些界的顺序没查。通过 = 在这个界内所有顺序都满足，不是整个系统正确。
- 时间不建钟表：「有一个在跑的执行者在本机、网络通、心跳已经落过地」时心跳视为新鲜（30 秒一拍 ≪ 120 秒阈值），否则可以超时；presence 同理（30 秒 ≪ 150 秒）。这依赖事件循环不被卡住 90 秒以上。
- 一台机器同时只有一个 daemon（`apps/daemon/src/supervisor.ts:32` 单实例锁）；daemon 崩溃时它的执行者一起结束（claude-code 子进程会不会成为孤儿进程未核实）。
- 停止事件只在关卡那一刻推给当时在线、处于 up 状态的 daemon；断线后不重放（代码如此，模型如此）。
- 拉取响应在 daemon 收到之前丢掉（崩溃、断线）时停止也丢：server 已删行，journal 还没写。模型里这时 `stopDelivered` 不置位，P4 不算它。
- 状态视图 `StateView` 去掉了不影响后续行为的字段（非 claimed 时的心跳位、非 waiting_quota 时的探测位、非 awaiting 时的 journal 结果），只用于去重。
- 只区分卡片「仍在执行」和「已离开执行」（`builds.ts:194` `hasLeftExecution`）；P3 / P4 只看后者。

**不在范围**：活性（「最终会前进 / 最终会被停下」），所以 F4 这类卡死只能靠诊断不变式看到；chief 步（`chief.ts` 另一套扫尾）；并发上限闸、能力 / runtime 闸、模型位缺失；同一 build 内多个步的先后（plan → build → review）；重开 / 新建 build、定时重跑；CI 磨绿环；steer；旧 daemon 的文本分类配额挂起（`holdStepForQuota`，靠 60 秒退避 > 15 秒 tick 的时序保护，无钟模型表达不了）；停止事件因断线丢失后无人重发（会让关卡后的步跑完整轮，模型里没设性质抓它）；回报被 409 拒掉后（await 期间换了领取），新这次领取没人跑，要等心跳超时被扫尾放回再领（活性，不查）；跨机器的双执行（断网期间改绑归属机后两台机器各跑一份是租约机制绕不开的，P1 只管同机）；server 多实例同库；daemon 孤儿子进程。

## 更新验证（代码改了之后）

1. 跑 `run.sh`，记下结果。末尾会列出 `sync-commit` 之后改过覆盖文件的提交，逐个读 diff。
2. 对每个改动判断：不影响模型（文案、无关字段）/ 模型需要跟着改（原子步拆分或合并、条件变了、新路径写同一批字段）/ 承诺本身有意改变（要有提交说明、测试或文档为证）/ 可能破坏承诺（没有证据说有意）。
3. 按代码改模型，不按结果改：先写好再跑。一个代码同步块仍是一个模型动作；新增 `await` 就拆动作。动作名保持与代码函数名对应，并更新上面的对照表行号。
4. 只有承诺有意改变才改性质：在本文件写下旧措辞、新措辞和证据。不缩小界，除非改动让界失效；缩小了要在报告里说。
5. 重跑。结果变了：FAIL → PASS 要先确认代码确实修了，再把破坏动作在代码里重做一遍、确认模型仍能报出（见下节），然后改 `expected.txt`；PASS → FAIL 按「怎么分辨真 bug 和模型写错」处理。
6. 确认模型描述的是新提交的代码之后，才把下面的 `sync-commit` 推到那个提交，并更新「当前结果与已知发现」。

## 证明检查能失败（交接时做过一次）

在真代码里把 `apps/server/src/services/builds.ts:1522` 的「已关 / 已完成卡片的失联 claimed 步 → `stopStepKeepPhase`」改成一律 `releaseClaimedStep`，按第 3 步把模型 `SchedulerTick` 里 `stopIt` / `release` 的判定跟着改（`release == stale`、`stopIt == FALSE`），跑 `run.sh P3_NoClaimAfterClose`：模型没改时 P3 仍通过，但末尾提示 `builds.ts` 有未提交改动；模型跟改后 P3 报违反（领取 → 推送流断开 → 关卡 → 心跳超时 → 扫尾放回 pending → 又被领走），退出 1。输出见 `docs/verify/step-claim-tla/run-p3-break.txt`。撤掉代码和模型两处改动，再跑一遍确认回到 `expected.txt`。P4 见下面 F3 那一段。

#1473 修完 F1 / F2 后各做了一次：
- P1：把 daemon 领取循环的在飞判断撤掉（模型 `TryClaim` 恒建新执行者），P1 报违反：领取 → 心跳超时 → 扫尾放回 → 同机再领，即原 F1 路径。只有入口心跳不够，`HeartbeatAges` 在第一拍心跳落地前仍可发生（断网同理）。
- P2：把 `finishStep` await 后的复查撤掉（模型 `FinishStepApply` 恒落账），P2 报违反：领取 → 会话 → 收尾 → 所有权校验 → 心跳超时 → 扫尾放回 → 落账，即原 F2 的单次领取路径。
- 两处撤回后跑全量，回到 `expected.txt`。真代码一侧的对应断言在 `apps/daemon/test/step-reclaim.test.ts` 与 `apps/server/test/step-claim-report.test.ts`，修复前全红。

F3 修完后做过一次（P4，模型副本里单线程跑）：
- `DeliverStopToRuns` 只给 `running` 的执行者置 `halt`（停止只到会话已开的 run），P4 报违反：`TryClaim,CloseCard,DeliverStopFetch,DeliverStopToRuns`，即准备期丢停止。
- `DaemonStartRecover` 的 `jstop` 判定改成 `FALSE`（recover 不看 journal 里的停止），P4 报违反：`TryClaim,CloseCard,DeliverStopFetch,DeliverStopToRuns,DaemonCrash,DaemonStartRecover`，即关卡后崩溃重启。
- 只给编号最大的 Working 执行者置 `halt`：不再违反，因为 #1473 之后同机不会有两个执行者。在 #1473 之前的模型上这一条报过违反（释放后同机重领再关卡）。
- 真代码一侧由 F3「验证」里的测试抓住：把 `runner.ts` 里的 `stop.attach` 去掉，或让 `RunStop.accept` 不看 settle，对应测试都会红。

## 覆盖记录

`run.sh` 读下面两处：`sync-commit` 行和 `coverage` 代码块（每行两个空格开头的路径）。

sync-commit: 659d8cb5

```coverage
  apps/server/src/services/machines.ts
  apps/server/src/services/builds.ts
  apps/server/src/services/quota-wait.ts
  apps/server/src/services/scheduler.ts
  apps/daemon/src/machine-loop.ts
  apps/daemon/src/runner.ts
  apps/daemon/src/journal.ts
  apps/daemon/src/step-stops.ts
  apps/daemon/src/workspace.ts
```

覆盖到的函数：`machines.ts` 的 `tryClaim`、`claimStep`、`heartbeatStep`、`ownedStep`、`finishStep`、`fetchStop`、`markPresence`、`sweepStaleMachines`、`recoverSteps`；`builds.ts` 的 `sweepAbandonedBuildSteps`、`releaseClaimedStep`、`stopActiveStepsAfterExit`、`prepareStopFor`、`stopStepKeepPhase`、`applyStoppedStep`、`applyStepFailure`、`completeStep`（只到写步状态与 `hasLeftExecution` 判定）；`quota-wait.ts` 的 `applyQuotaWaitStep`、`sweepQuotaWaitSteps`；`scheduler.ts` 的 `tick` 扫尾顺序；`machine-loop.ts` 的启动 presence、recover（含 `stopRequest` 分支）、`deliverStop`、领取循环；`runner.ts` 的停止位登记、`journal.claim`、心跳起止、`workspace.prepare` 与会话登记 / 开会话前停止检查的先后、停止位读取、收尾回报、`resumeStoppedStep`；`journal.ts` 的状态与 `stopRequest`；`step-stops.ts` 的 `RunStop`、`StepStops`；`workspace.ts` 的会话目录与项目锁。
