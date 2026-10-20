# chief 派发判定（#903 / ADR 0014）

chief `run_builds` 派发任务时先规划还是直接修 = **chief 的逐次判定**（判定权归
chief，无团队设置槽；沿革见 ADR 0014「旧裁决翻转记录」）。
服务端唯一机械保证 = 缺省 fail-safe：`withPlan` 参数缺省 = true 先规划（判不准
的方向是「多问一次」）。「直接修」只跳过方案确认闸，review 闸在合并路径上、
与本参数无涉（结构上不可被跳过）。判定理由走 `dispatchReason` 参数：随工具调用
落 transcript（chief_message）可回查审计，响应原样回显；提示词责令 chief 在回执
写明「我判为直接修 / 先规划，因为 X」，用户可就地一句话推翻且只影响这一次。
判据 = 系统提示词派发判定节的静态章程 prose（Mika 判断纪律原句 + 三条可判信号），
不进代码规则表、不按任何设置合成。server 侧失败方式钉在
`apps/server/test/chief.test.ts`（#903 五测：PATCH 槽死态 / 判定节静态四要素 /
缺省先规划 / 显式 false + 理由回显 / 显式 true + 理由回显）、
`orchestration-source.test.ts` B1、`packages/shared/test/chief-tools.test.ts`
（run_builds 定义形）；fixture 面钉在 `apps/web/e2e/chief-settings.spec.ts`
（Agent tab 无「派发方式」行的僵尸控件负向钉）。

## Sub-features

- `settings-slot-dead` — 设置槽死态三面：settings Agent tab 无「派发方式」行
  （邻座机器/压缩模型行健在）；GET chief 封套无 `dispatchWithPlan` 键；PATCH
  单独该键 → 400（五槽 refine），与合法槽混发 → 该键被 zod 剥离。
- `judgment-prompt-section` — claim 载荷 `chief.systemPrompt` 的派发判定节 +
  派发回执节：静态文本（翻用户章程不变），含 Mika 判断纪律原句（「当信息会
  实质改变结果、执行方式、权限或安全时才问；否则自己决定，并说出你决定了
  什么」）、三条可判信号、审阅关口恒在、dispatchReason 义务、就地一句话推翻
  只影响这一次；全文无写死 `withPlan:false` 直执行指令、无「派发模式（团队
  设置」合成残留。
- `tool-judgment-params` — claim 载荷 remoteTools 的 `run_builds` 定义
  properties 含 `withPlan` + `dispatchReason`（皆可选），required 仅
  `['todoIds']`（缺省即判定语义，不能必填）。
- `dispatch-effect` — 判定生效落库面：`build.withPlan` + 首步 `step.kind`
  （先规划 = plan 步停 confirm 闸；直修 = build 步）。响应回显 `withPlan` +
  `dispatchReason`（缺省腿 reason = null）。

## Drive (vp.mjs)

- `vp.mjs drive chief-dispatch-judgment dispatch-judgment`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list chief-dispatch-judgment`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- 看板「开始」→ 编排回合 → chief 逐次判定派发模式，回执写明判定与理由。
- 用户对判定不满 → 会话里就地一句话推翻（chief cancel_builds 后按相反模式重派）。
- 总管设置 Agent tab 不再有「派发方式」行（判定不是配置项）。

## Driving it with drive-903-dispatch-judgment.mjs

Preconditions: `launch.mjs` 已起隔离栈（全新库）；proxy env 全 unset。

- 一键全链（12 条断言）：`env -u http_proxy -u https_proxy -u all_proxy
  VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-903-dispatch-judgment.mjs`
  → 控制台 PASS/FAIL + `evidence:<目录>`（result.json + 1 截图 + 5 API/SQLite JSON）。
- 链路：浏览器钉设置槽死态（U1）→ REST 钉 PATCH 400 + 封套无键（A1/A2）→
  三腿各开一个 chief 线程：假机器 claim chief 步（E1 取 systemPrompt 判定节 +
  工具定义实物）→ relay run_builds（E1 缺省 / E2 false+理由 / E3 true+理由）→
  响应回显对拍 + SQLite build.withPlan/首步 kind 对拍 → relay cancel_builds
  收道 → done chief 步。
- 铺底全走公开 REST（provider + agent + PATCH chief 绑定 + project + 三 todo +
  api-key + machine enroll）；零 daemon 零 LLM，chief 回合数据面与真机器同形
  （drive-agent-identity 铺底律）。

## Gotchas

- claim 响应双层包装 `{step:{step:{…}, chief, remoteTools}}`（machine-wire 律）；
  chief 步判别 = `step.kind === 'chief'`，领到 worker 步即顺序错（每腿收尾先
  done chief 步再收道 worker 步）。
- relay 端点 body = `{name, params}`（不是 `{arguments}`），响应 = `{text}`（JSON 串，
  需再 parse）——`routes-machine.ts` 的 relay 形与 transcript delta/activity/row 三形
  同径分流，判别靠 params/id/kind 键位。
- 每腿 run_builds 生成的首步（plan 或 build）是 pending worker 步，不收道会被
  下一腿的 claim 领走（FIFO 按 createdAt）。**收道 = 在本腿 chief 步内 relay
  `cancel_builds`**（pending 步 DB 直写标 failed）；别用「claim + done
  failed」——机器上报 failed 走 finishStep 的重试/replan 语义，会生成新的
  pending 步把下一腿 claim 顶歪（实测：E2 claim 领到 plan 重试步）。
- **先规划腿的 relay 必带 `assignment.plan`**：plan 步的执行 agent 按
  assignment.plan 解析，无 modelId 的步被 tryClaim 跳过（「未指派 Agent =
  不可执行」，machines.ts）——步永远 pending，任何 claim 长轮询挂到探针 8s
  AbortSignal 超时，症状是 DOMException TimeoutError 而非断言 FAIL（首轮
  实测踩中）。
- 提示词判定节断言用**原句子串**（JUDGMENT_MUSTS 数组），改提示词措辞必须同步
  probe 与 chief.test.ts / orchestration-source.test.ts 三处 canon。
- 负向钉 `withPlan:false` 字面量：判定节 prose 刻意用「withPlan=false」等号形
  描述参数——冒号形是 #892 病灶指令的指纹，两处 canon（单测 + probe）都钉
  not-contain，改提示词别把冒号形带回来。
