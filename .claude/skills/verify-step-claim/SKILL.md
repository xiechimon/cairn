---
name: verify-step-claim
description: pacman 步的领取 / 心跳 / 失联释放 / 收尾回报 / 关卡停止的 TLA+ 模型检查（TLC，一条命令约 1.5 到 2.5 分钟）。改到 tryClaim、heartbeatStep、ownedStep、finishStep、sweepAbandonedBuildSteps、sweepStaleMachines、sweepQuotaWaitSteps、stopActiveStepsAfterExit、fetchStop、scheduler tick 顺序，或 daemon 的领取循环、recover、deliverStop、runStep 的心跳 / 会话登记 / 收尾时用；判断改动有没有让「同一步被两处同时跑」「旧执行者的结果被采纳」「关卡后又被领走」「已接收的停止信号丢失」变得更好或更坏。
---

# verify-step-claim

一个步（`step` 行）从 pending 被某台机器领走、跑完、回报结果，中间会被四方同时碰：daemon（领取、心跳、回报、重启恢复、停止投递）、server 调度一拍（翻离线机器、扫失联步、放回配额到期步）、用户（关卡 / 标完成）、环境（断网、进程崩溃、时间流逝、改绑归属机）。测试只覆盖写测试的人想到的顺序；本技能用 TLC 把有界范围内的**所有**顺序走一遍。

模型：`model/StepClaim.tla`（除首行外不写注释，动作与代码的对应只记在本文件）。每条性质一个配置：`model/P*.cfg`。预期结果：`expected.txt`。

## 什么时候跑

改动碰到下面「覆盖记录」里的任一文件里的列出函数，或者改了 `scheduler.ts` 里 `tick` 的扫尾顺序，就跑。只改文案、日志行、与步状态无关的字段（PR 回填内容、token 记账、transcript）不用跑。拿不准就跑。

## 怎么跑

```sh
.claude/skills/verify-step-claim/scripts/run.sh            # 四条全跑，8 核约 1.5 到 2.5 分钟（P3 占绝大部分，视机器负载）
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
- **P3 `NoClaimAfterClose`**：卡片关闭 / 标完成后，这个步不会再变成 claimed。坏了 = 用户关掉的任务又被 agent 领走开工。
- **P4 `AcceptedStopReachesWorkers`**：daemon 处理过一条停止信号后，本机上为这个步干活的执行者都已被打断。坏了 = 用户关卡后 agent 继续跑完整轮会话（烧额度、推提交、可能开 PR）。

## 当前结果与已知发现（sync-commit 时）

`P1 FAIL`、`P2 FAIL`、`P3 PASS`（2,193,222 个不同状态，8 核 88 到 132 秒）、`P4 FAIL`。三条 FAIL 是代码里的真问题，不是模型错误：每条反例都对着真代码复现过（见下文「复现证据」）。**不要为了让它们通过去削弱性质或模型。** 修掉代码问题后，按「更新验证」改模型，结果变 PASS，再把 `expected.txt` 那一行改成 PASS。

**F1（P1）同机重领，同一步两个执行者。**
1. 机器 m1 的 daemon 领到步（`tryClaim`），runStep 开始准备工作区（clone / 等同项目锁 / `.agents/setup`，后者上限 20 分钟）。
2. 心跳计时器在准备完成后才启动（`runner.ts:1133`），所以 120 秒内没有任何心跳落地。
3. 调度一拍：步 claimed、心跳超 120 秒、`lastHeartbeatAt` 从未推进 → `sweepAbandonedBuildSteps` 在机器**在线**时也把它放回 pending、清掉 `machineId`，并唤醒等待中的领取请求。
4. 同一台 daemon 的领取循环立刻又领到它（归属机只有 m1；领取循环不查这个步是否已在本机跑，`machine-loop.ts:666-689`）→ 第二个 runStep。
笔记本合盖或断网超过 150 秒也能走到这里（机器先被 `sweepStaleMachines` 翻离线，再被释放）。

**F2（P2）旧执行者的回报被采纳。** 接 F1 第 4 步：第一个 runStep 准备失败（比如 setup 失败）报 `done(failed)` → `ownedStep` 只比机器号（`machines.ts:1265-1270`）→ 采纳，步变 failed、卡片变 failed，而第二个 runStep 还在跑。`finishStep` / `completeStep` 都不检查步当前状态，第二个执行者之后的回报同样被采纳。单次领取也能违反（交接时用诊断不变式确认过，时间窗窄）：success 回报通过 `ownedStep` 后在 await（`mergedPrElsewhere` 查 GitHub / `applyMergeLanding`）期间，扫尾把步放回 pending，await 结束后照样写成 done。

**F4（无性质覆盖，推断）回报丢一次，步就一直卡在执行中。** 模型里用诊断不变式走到过这条 8 步路径，真代码没跑过：
1. 会话开始，心跳已落地（`lastHeartbeatAt` 推进过）。
2. 断网，会话结束，`client.done` 抛错（`machine-client.ts` 的 `request` 不重试），runner 留着 journal 直接返回（`runner.ts:2188-2195`）。
3. 网络恢复，presence 照常，机器在线。
4. 扫尾：心跳超时，但机器在线且心跳推进过 → 当成歧义态不动（`builds.ts:1499-1508`）。没有执行者，也没有人补报，直到 daemon 重启走 recover。
四条性质都是安全性质，抓不到「一直不前进」；要抓需要加带公平性假设的活性性质（见「不在范围」）。

**F3（P4）准备期收到的停止信号被丢掉。**
1. 步已被 m1 领走，runStep 还在准备（会话句柄尚未登记，`runner.ts:1454` 才登记）。
2. 用户关卡 → `stopActiveStepsAfterExit` 写 `stop_pending` 并推 stop 事件。
3. daemon `deliverStop` → `GET /api/machine/stop` → `fetchStop` 返回 discard 并**删掉** `stop_pending` 行（`machines.ts:269`）。
4. daemon 查 `sessionHandles.get(stepId)` 为空 → 记一行 `stop dropped (no live session)` 就返回（`machine-loop.ts:527-530`）。
5. 准备完成后会话照常开始并跑完，回报 success；server 端再无停止记录，扫尾也不会停它（心跳新鲜）。
模型还给出另外两条走到同一结局的路径（交接时用诊断不变式单独确认过）：F1 的双执行者状态下关卡，停止只投到最新登记的那个会话（`sessionHandles` 按步号覆盖），旧的那个继续跑；关卡后 daemon 崩溃重启，recover 按 journal 把这一步重新跑起来，而 `stop_pending` 已被 `fetchStop` 删掉，没人再去停它。

### 复现证据（sync-commit 时实测）

测试源码、输出和 `run.sh` 的输出存在 `docs/verify/step-claim-tla/`：`repro-server.test.ts.txt`、`repro-daemon.test.ts.txt`（复现时去掉 `.txt` 放回 `apps/server/test/`、`apps/daemon/test/` 跑，跑完删掉，不进产品测试集）、`repro-output.txt`、`run-full.txt`、`run-p3-break.txt`。

- server 半（F1 / F2）：在 `apps/server/test/` 下用 `bootServer()` 建一台在线机器 + 归属该机的 agent + pending build 步；`claimStep` → 推进 121 秒跑 `sweepAbandonedBuildSteps` → 步变 pending、`machineId` 清空 → 同机 `claimStep` 返回同一步 → 旧执行者 `heartbeatStep` 被接受 → 旧执行者 `finishStep(success)` 被接受（步 done、卡片 review）→ 新执行者 `finishStep(failed)` 也被接受（步 failed、卡片 failed）。
- daemon 半（F1）：`apps/daemon/test/machine-loop-harness.ts` 的 `FakeMachineApi`，`mePatch = { maxConcurrent: 1 }`，两次推同一个 `CLAIMED`（步 s1）→ `createSession` 被调用 2 次、两次 `done(success)`。
- daemon 半（F3）：同一 harness，`createSession` 挂住期间推 `{type:'stop', stepId:'s1'}`、`stopResponse = true` → 日志 `stop dropped (no live session)` → 放开后回报 `done(success)`，会话 `stop()` 调用 0 次。

## 怎么分辨真 bug 和模型写错

TLC 报违反时，脚本打印反例：每一步是模型里的动作名，下面是这一步改变的变量。拿下面的动作对照表，逐步问「代码里这一步真能在这个状态下发生吗」：

- 每一步都能在代码里找到对应、且前置条件在代码里也成立 → 真 bug。用代码里的名词写成步骤（像上面的 F1-F3），报告给用户，**不改业务代码**，除非用户要求。
- 某一步在代码里不可能（前置条件比代码宽、把代码里一个同步块拆成了两步、漏了代码里的某个检查）→ 模型写错。改模型，写清楚错在哪，再跑。
- 拿不准时写一个不提交的复现测试（见上面三条的搭法），用真代码走一遍。

## 动作 ↔ 代码对照（行号为 sync-commit 时）

server 是单进程、better-sqlite3 同步写：两个 `await` 之间的代码不会被别的请求插进来。模型按 `await` 切原子步，这是忠实度的核心。

- `TryClaim(m)` / `TryClaimResponseLost(m)`：`apps/server/src/services/machines.ts` `tryClaim`（923）的 worker 分支，归属机闸 1001，`status = pending` 条件写 1074-1091；`claimStep` 长轮询 1235。daemon 侧领到即发 runStep：`apps/daemon/src/machine-loop.ts` 634 起的循环、`runner.ts:512` `journal.claim`。ResponseLost = server 已写 claimed、daemon 没收到响应（B-C7 移交竞态）。
- `StartSession(e)`：`runner.ts:662` `workspace.prepare` 结束 → 1133 心跳计时器启动 → 1454 `sessionHandles.set`。准备期 = 模型里的 `preparing`。
- `HeartbeatStep(e)`：`runner.ts:1133-1135`（失败被吞）→ `machines.ts:1258` `heartbeatStep`，所有权只看 `ownedStep`（1265，只比机器号）。
- `FinishSession(e)`：会话结束、读 `stopRequests`（`runner.ts:1790`）定结果，`journal.update(awaiting-upload)`（2175）。准备期失败走 `failStep`，模型只给 `failed`。
- `FinishStepOwnedCheck(e)` / `FinishStepApply(e)`：`machines.ts:1771` `finishStep`。只有 success 回报可能带 `prUrl`（`runner.ts:2062` 条件）或是合并落地，才会在 1839 / 1860 处 await，所以只有 success 被拆成两步；其余结果校验和写入在同一同步块。写入：配额 → `quota-wait.ts:87` `applyQuotaWaitStep`；success → `builds.ts:1595` `completeStep`；stopped → `builds.ts:291` `applyStoppedStep`；failed → `builds.ts:1391` `applyStepFailure`；全部先清 `stop_pending`（`machines.ts:1901`）。都不检查步当前状态。
- `SchedulerTick`：`apps/server/src/services/scheduler.ts:95` `tick` 一整拍原子，按 144 `sweepStaleMachines`（`machines.ts:645`）→ 151 `sweepAbandonedBuildSteps`（`builds.ts:1466`：先停已关 / 已完成卡片的 pending / waiting_quota 残留，再判 claimed：心跳超时且（机器离线或心跳从未推进）→ 已关卡片 `stopStepKeepPhase`（424），否则 `releaseClaimedStep`（1516））→ 157 `sweepQuotaWaitSteps`（`quota-wait.ts:142`）的顺序。
- `CloseCard`：`builds.ts:464` `stopActiveStepsAfterExit` → 468 `prepareStopFor`：pending / waiting_quota 即停，claimed 写 `stop_pending` + `stopSignal`。
- `DeliverStopFetch(m)` / `DeliverStopToHandle(m)`：`machine-loop.ts:523` `deliverStop` 先 `await client.stop` → `machines.ts:253` `fetchStop`（claimed + 机器号匹配才返回并删行），再查 `sessionHandles`。
- `MarkPresence(m)` / `PresenceAges(m)`：`machines.ts:576` `markPresence`；daemon 启动时一次（`machine-loop.ts:303`），之后 30 秒定时器（578，recover 结束后才启动）。
- `DaemonCrash(m)` / `DaemonStartRecover(m)` / `DaemonRecoverDone(m)`：`machine-loop.ts:428` recover，`machines.ts:668` `recoverSteps`（claimed + 本机）；有 journal 就 `await runStep`（awaiting-upload 只补报），没有就报 failed；recover 期间不推送流、不发 presence、不领取。
- `MachineStreamAbort(m)`：`apps/server/src/routes-machine.ts:318` 推送流 `onAbort` 立即 `markOffline`，并丢掉还没送到的 stop 事件。模型允许它在机器在线的任何时刻发生（daemon 退出、断网、代理掐断长连接、server 重启都会触发）。
- `DaemonCrash(m)` 时正在被 server 处理的回报（`applying`）变成 `orphan`：server 照常写完，但发请求的进程已经没了，所以不再动这台机器的 journal 和会话句柄。
- `HeartbeatAges`、`QuotaProbeDue`、`Partition(m)`、`Reconnect(m)`、`RebindHomeMachine(m)`：时间流逝 / 网络 / 用户改 agent 归属机。

## 边界与假设

- 规模：2 台机器（m1 是初始归属机），1 个任务 1 个 build 1 个步，最多 2 次执行（`ExecIds = {1, 2}`、`MaxClaims = 2`：两次领取，或一次领取 + 一次 recover），断网最多 1 次，daemon 崩溃最多 1 次，改绑归属机最多 1 次。超出这些界的顺序没查。通过 = 在这个界内所有顺序都满足，不是整个系统正确。
- 时间不建钟表：「有一个在跑的执行者在本机、网络通、心跳已经落过地」时心跳视为新鲜（30 秒一拍 ≪ 120 秒阈值），否则可以超时；presence 同理（30 秒 ≪ 150 秒）。这依赖事件循环不被卡住 90 秒以上。
- 一台机器同时只有一个 daemon（`apps/daemon/src/supervisor.ts:32` 单实例锁）；daemon 崩溃时它的执行者一起结束（claude-code 子进程会不会成为孤儿进程未核实）。
- 停止事件只在关卡那一刻推给当时在线、处于 up 状态的 daemon；断线后不重放（代码如此，模型如此）。
- 状态视图 `StateView` 去掉了不影响后续行为的字段（非 claimed 时的心跳位、非 waiting_quota 时的探测位、非 awaiting 时的 journal 结果），只用于去重。
- 只区分卡片「仍在执行」和「已离开执行」（`builds.ts:194` `hasLeftExecution`）；P3 / P4 只看后者。

**不在范围**：活性（「最终会前进 / 最终会被停下」），所以 F4 这类卡死只能靠诊断不变式看到；chief 步（`chief.ts` 另一套扫尾）；并发上限闸、能力 / runtime 闸、模型位缺失；同一 build 内多个步的先后（plan → build → review）；重开 / 新建 build、定时重跑；CI 磨绿环；steer；旧 daemon 的文本分类配额挂起（`holdStepForQuota`，靠 60 秒退避 > 15 秒 tick 的时序保护，无钟模型表达不了）；停止事件因断线丢失后无人重发（会让关卡后的步跑完整轮，模型里没设性质抓它）；扫尾把已关卡片的步停掉后，原执行者迟到的回报仍会把状态改成 done（模型允许，P2 不算它）；跨机器的双执行（断网期间改绑归属机后两台机器各跑一份是租约机制绕不开的，P1 只管同机）；server 多实例同库；daemon 孤儿子进程。

## 更新验证（代码改了之后）

1. 跑 `run.sh`，记下结果。末尾会列出 `sync-commit` 之后改过覆盖文件的提交，逐个读 diff。
2. 对每个改动判断：不影响模型（文案、无关字段）/ 模型需要跟着改（原子步拆分或合并、条件变了、新路径写同一批字段）/ 承诺本身有意改变（要有提交说明、测试或文档为证）/ 可能破坏承诺（没有证据说有意）。
3. 按代码改模型，不按结果改：先写好再跑。一个代码同步块仍是一个模型动作；新增 `await` 就拆动作。动作名保持与代码函数名对应，并更新上面的对照表行号。
4. 只有承诺有意改变才改性质：在本文件写下旧措辞、新措辞和证据。不缩小界，除非改动让界失效；缩小了要在报告里说。
5. 重跑。结果变了：FAIL → PASS 要先确认代码确实修了，再把破坏动作在代码里重做一遍、确认模型仍能报出（见下节），然后改 `expected.txt`；PASS → FAIL 按「怎么分辨真 bug 和模型写错」处理。
6. 确认模型描述的是新提交的代码之后，才把下面的 `sync-commit` 推到那个提交，并更新「当前结果与已知发现」。

## 证明检查能失败（交接时做过一次）

在真代码里把 `apps/server/src/services/builds.ts:1506` 的「已关 / 已完成卡片的失联 claimed 步 → `stopStepKeepPhase`」改成一律 `releaseClaimedStep`，按第 3 步把模型 `SchedulerTick` 里 `stopIt` / `release` 的判定跟着改（`release == stale`、`stopIt == FALSE`），跑 `run.sh P3_NoClaimAfterClose`：模型没改时 P3 仍通过，但末尾提示 `builds.ts` 有未提交改动；模型跟改后 P3 报违反（领取 → 推送流断开 → 关卡 → 心跳超时 → 扫尾放回 pending → 又被领走），退出 1。输出见 `docs/verify/step-claim-tla/run-p3-break.txt`。撤掉代码和模型两处改动，再跑一遍确认回到 `expected.txt`。P1 / P2 / P4 本身在当前代码上失败，反例即证明；它们由上面的复现测试对着真代码确认过。

## 覆盖记录

`run.sh` 读下面两处：`sync-commit` 行和 `coverage` 代码块（每行两个空格开头的路径）。

sync-commit: 23a39da9

```coverage
  apps/server/src/services/machines.ts
  apps/server/src/services/builds.ts
  apps/server/src/services/quota-wait.ts
  apps/server/src/services/scheduler.ts
  apps/daemon/src/machine-loop.ts
  apps/daemon/src/runner.ts
  apps/daemon/src/journal.ts
  apps/daemon/src/workspace.ts
```

覆盖到的函数：`machines.ts` 的 `tryClaim`、`claimStep`、`heartbeatStep`、`ownedStep`、`finishStep`、`fetchStop`、`markPresence`、`sweepStaleMachines`、`recoverSteps`；`builds.ts` 的 `sweepAbandonedBuildSteps`、`releaseClaimedStep`、`stopActiveStepsAfterExit`、`prepareStopFor`、`stopStepKeepPhase`、`applyStoppedStep`、`applyStepFailure`、`completeStep`（只到写步状态与 `hasLeftExecution` 判定）；`quota-wait.ts` 的 `applyQuotaWaitStep`、`sweepQuotaWaitSteps`；`scheduler.ts` 的 `tick` 扫尾顺序；`machine-loop.ts` 的启动 presence、recover、`deliverStop`、领取循环；`runner.ts` 的 `journal.claim`、`workspace.prepare` 与心跳 / 会话登记的先后、`stopRequests` 读取、收尾回报；`journal.ts` 的状态；`workspace.ts` 的会话目录与项目锁。
