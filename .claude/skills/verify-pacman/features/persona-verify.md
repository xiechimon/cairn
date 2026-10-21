# 角色名册 + verify 步 + 三视角 fan-out + split_todo（#1250 / ADR 0018）

三层多 agent 团队的层 1 + 层 2 落地（票面 #1250；能力闸/并发语义归 #1251，
`ui-classname` 收编钉扎见下）。正本 = `docs/adr/0018-多agent团队三层与机器能力
闸.md`。

- **六员名册**：全新库首启 server 自动 seed 六个 persona agent（Planner /
  Implementer / CodeReviewer / SecurityAuditor / TestEngineer / Verifier；
  契约描述 + thinkingLevel 档位 planner=xhigh / implementer=high /
  review 族+verifier=medium）；`agent.persona` 列 + (teamId, persona) 部分唯一
  索引保证同队同角色一员。#1259 未落地 → 暂不带归属机（其迁移会把存量
  agent 回填归属）。模型位不猜：seed 时按机器 claudeCodeReport / provider
  清单取「当时可领值」，null 留空由用户/后续 PATCH 补。
- **assignment 四槽**：`plan/build/review/verify`（shared assignmentSchema；
  REST builds 面 + chief `run_builds` relay 两路都落全四槽——后者是本票
  实测补的缝，live V1 钉）。缺省指派（web startBuild）：plan/build 优先
  persona、无 persona 回落首 Agent（存量零变化）；review/verify 只在
  persona 在位时落。
- **verify 步**：review 关口抵达（build 成非 PR 分支 / CI 绿）且 verify 槽
  在位 → 入队 `kind:verify` 步（幂等/build 一条；槽空零动作）。额外 agent
  步不推进主时序（phase 留 review）；claim 恒 new session + 可写工作区
  （材料 = buildVerifyStepPrompt：证据目录 + 输出契约 + 工作区纪律）。
  done 带 `verifyVerdict`（passed/conclusion/evidence[]）→
  `VERIFY_VERDICT_KIND` 消息行；daemon 侧提取器 = `verify-verdict.ts`
  （review 提取器同族）。web：chip「验证中」优先于「审核中」，transcript
  verdict 行三态（验证通过/验证未通过/判定提取失败）+ 证据条目块。
- **三视角 fan-out**：AI 审核弹层勾「三视角并行审」→ steps `{action:review}`
  不带 agentId → CodeReviewer/SecurityAuditor/TestEngineer 三员各入队一条
  review 步（agentId 走 prompt meta header；关注点 = 用户 focus + 各自
  reviewFocus「本视角重点」）。无 persona 回落 assignment.review 单步，两者
  皆缺 400。三份 blocking verdict 只入队一条修订步（去重闸）。fixture 面
  fan-out 行零渲染（persona 只由 live members 点亮）。
- **split_todo**（层 2）：chief 工具拆大票——子卡（sourceTodo/blockedBy
  依赖边/assignment.build）+ 父方案文档（拆解方案：子卡清单+依赖+agent 名）
  + 父停 confirm 人审。confirm 派发无阻塞子卡（直执行）；子卡 done 推进
  波次；全子卡 done → 父自动收（DONE_ANNOUNCEMENT actor=Chief）。校验族：
  相位非 todo 409 / 双拆 409 / 少于两张 400 / 索引越界 400 / 环 400 /
  agent 越队 404。

服务端失败方式钉在 `apps/server/test/persona-split-verify.test.ts`（12 测：
播种/幂等/verify 入队-verdict-claim/fan-out 三步-回落-400/blocking 去重/
split 校验族/happy/confirm 派发/波次+父收）；shared 钉在
`packages/shared/test/persona.test.ts` + `verify-prompt.test.ts` +
`chief-tools.test.ts`（52 词表）；daemon 提取钉在
`apps/daemon/test/verify-verdict.test.ts`。fixture 面钉在
`apps/web/e2e/persona-verify.spec.ts`（verdict 三态 + 证据条目 + 弹层
fan-out 行零渲染负向钉）。live 真值面 = `docs/verify/1250/`（drive-1250
27/27：播种/verify 链/浏览器真点击 fan-out/拆解波次，含 chip 与 verdict
截图）。

## Sub-features

- `persona-seeding` — 全新库首启六员落库（persona 位/契约名/档位），模型位
  取当时清单可领值、null 留空；幂等补缺不覆盖用户编辑；删行复活（PATCH
  persona:null = 显式除名不复活）。
- `assignment-four-slots` — assignment 四槽持久（REST + chief relay 双路），
  verify 槽空 = 存量行为零变化（零 verify 步、无 fan-out 槽回落）。
- `verify-step-chain` — review 关口抵达入队 verify 步（幂等）→ claim（new
  session + 材料 + agent 块 = verify 槽）→ done verifyVerdict → 消息行 +
  phase 不动。提取失败兜底「判定提取失败」上浮原因；两字段皆缺 =
  「验证未返回结论」。
- `review-fanout` — 无 agentId 的 review 动作按 persona 三员 fan-out；meta
  header agentId + 本视角重点；回落/400 两兜底；blocking 去重闸。
- `split-todo` — 拆解三件（子卡+边/父方案文档/父停 confirm）+ 派发波次 +
  父自动收 + 校验族。

## How to get to it (user POV)

- 全新库首开 → 设置页成员区多出六员角色 agent（模型位需配置后才可领步）。
- 任务开始 → 缺省四槽指派（plan/build 走 persona，review/verify 在位才带）。
- build 完成进 review → 头带 chip「验证中」，verdict 行进时间线（含证据
  路径清单），人读 verdict 决定合并。
- AI 审核弹层 → 勾「三视角并行审」→ 开始 → 三份结论并行落会话。
- 总管对话「把这张大票拆了」→ chief 调 split_todo → 父卡停 confirm 展示
  拆解方案 → 确认后子卡按依赖波次推进，全 done 父卡自动收。
- 驱动:本 feature 没有 current case;已登记的都判 stale,不带 `--force` 拒跑(拒跑时打印原因),`vp.mjs list persona-verify` 列出 usage:
  - `vp.mjs drive persona-verify persona-verify`:建 agent 不带 machineId,ADR 0019 起 400。

## Gotchas

- **run_builds 自动 watch → chief gate 回合插队**：派工即 watch，相位一变
  gate 回合步入队——假机器探针要 claimUntil(目标 kind)，线性 claim 会把
  gate 回合当目标步领走（agent 块 = chief 绑定 Agent 是症状指纹）。
- **worker 步材料在 claim 载荷 instruction**：step 本体不带 prompt；DB 断言
  打 step.prompt 列，wire 断言打 instruction。
- **review 步 agentId 只在 prompt meta header**：step 表无 agentId 列。
- **message.content 双包 JSON**：drizzle json 列存字符串值带引号再包一层，
  verdict 行要 JSON.parse 两次（'{' 开头判别），纯文本宣告行一次即终值。
