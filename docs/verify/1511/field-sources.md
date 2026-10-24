# trajectoryPack 字段来源

一条包对应 build.id。这里只定义契约，不增加采集器或数据库列。按本次任务禁止新增代码注释的要求，字段来源记录于此。

- buildId：build.id。
- input.spec / sourceRef：todo.spec / todo.sourceRef，经 build.todoId 关联。采集时需保存运行输入，不能把后来编辑的任务当作历史快照。
- input.baseSha：运行起点 Git SHA。现有 build / step 没有对应列，需后续采集并保存；不能用收尾 checkpointCommit 冒充。
- input.persona / agentId / model：agent.persona / agent.id / agent.provider + agent.modelId，需在派发时快照；降级模型以运行事实为准，不能事后读取当前配置冒充。
- input.skillInjection：step.skillInjection，null 表示未计算，hits=[] 表示零命中。多步变化时 input 保存起始注入快照。
- input.harnessHash：运行时 harness 内容摘要，现无对应数据库列，需后续采集；只描述提示词、技能、工具描述、上下文组装与路由，不涉及模型权重。
- process.steps[].stepId / kind / checkpointCommit：step.id / kind / checkpointCommit。
- process.steps[].transcript：message.role / content 及上传记录中的扩展字段，包括 stopReason、usage 和工具调用。现有 message 表没有 stepId 列，且 receiveUpload 仅保存 role / content / createdAt，不保存顶层 stopReason / usage；按步归属与这些扩展事实需由采集端从原始上传记录保存，不能仅从 message 表还原或从 conversationId 猜测。
- process.plans：plan.id / buildId / version / createdAt / content，保留各版本。
- process.token_usage：token_usage 全行，按 buildId 关联。
- judgments.plan / diff：确认、打回与重启动作及反馈。现有 message.content 宣告与 step.prompt 可供回查，但没有独立完整的结构化裁决列；后续采集端需记录动作及理由，未留理由为 null。
- judgments.gate_verdict：gate_verdict 全行，按 buildId 关联。
- judgments.ciFixRounds：按 step.prompt 的 [ci-fix] 头标记计数，与 services/ci-loop.ts 的轮数口径一致。
- outcome.merged（#1659）：取 build 会话里最近一条交付记录。完成行（services/delivery-rows.ts 的 DONE_ROW）为 true，PR 关闭未合并行为 false，两者都没有为 null。只读库内数据，不调 GitHub。
- outcome.revertedWithin7d（#1659）：merged=true 时，合并后 7 天内同票出现首步提示以 [revert] 开头的后续 build 为 true。窗口已满且没有该标记为 false；导出时刻早于窗口结束为 null，导出摘要的 revert_window_open 计数。merged 不是 true 时为 null。
- outcome.fixedByLaterPr（#1659）：merged=true 时，合并后同票出现带 PR 号且不是回滚的后续 build 为 true。没有该信号时窗口已满为 false，窗口未满为 null。CI 纠错工单是 GitHub issue 不在库内，ci-fix 转绿事件发生在合并前，两者都不作信号。
- outcome.costTotal：token_usage.costTotal 按 buildId 求和，USD；未完成记账时为 null。

outcome 必须存在，允许整个为 null；开始回填后各字段也允许 null。其余字段必须存在，仅明确声明 nullable 的字段允许 null。空数组表示已采集且没有记录，不表示字段缺失。
