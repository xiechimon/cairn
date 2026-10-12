# #1248 ADR 0018 结构自检记录（2026-10-12）

## 四段齐核验

| 段 | 在位 |
|---|---|
| Problem Statement | 是（三正交子题：票内/票间/跨机） |
| 侦察事实 | 是（F1–F11，全部带出处） |
| Decision | 是（决策 0 名册 + 层 1/2/3 + 协调模型） |
| Premortem | 是（三死因 + 护栏） |
| 末节：与 ADR 0017 关系 | 是（正交不冲突，选源判定先于能力闸） |
| 末节：施工票拆分 | 是（#1250/#1251 + 落位注记 F11） |

## 覆盖对照表

### #1248 票面交付三箱

| 票面交付 | ADR 位置 |
|---|---|
| docs/adr/0018-*.md 入账（三层 + 协调模型 + 与 0017 关系） | 全文 + 「与 ADR 0017 的关系」节 |
| 02 册 agent/机器节补能力闸语义 | 02 册 §4.2 末条 + §5.4 末条（指针式注记，不复制正文——正本纪律） |
| 施工票拆分建议写 ADR 末节 | 「施工票拆分」节（#1250/#1251 + #1249 占用注记） |

### #1248 票面定案三层

| 定案 | ADR 位置 |
|---|---|
| 层 1 票内流水线（四角色/四步种/assignment 扩展/confirm+merge 留人） | Decision 1 |
| 层 2 split_todo 拆票 + 依赖边 + 子全 done 父自动收 + confirm 人审 | Decision 2 |
| 层 3 角色并发 + #1241 机器推荐并发跨机并行 | Decision 3 |
| 协调模型（能力清单上报/requiredCapabilities/能力闸/可见 reason/skills 单源/MCP 对账） | Decision 4 |

### 七点设计输入（#1248 评论）

| 输入 | ADR 位置 |
|---|---|
| ① Skill=how/Persona=who/Command=when 三层分离 + persona 契约 | Decision 0 |
| ② personas do not invoke other personas、编排单层 | Decision 0 硬律条 |
| ③ meta-orchestrator 反模式 + chief 值回 criteria | Decision 0 Chief 行 |
| ④ fan-out 三视角 + 小合并 go/no-go | Decision 1 review fan-out 条 |
| ⑤ 决策矩阵拆解判据 | Decision 2 |
| ⑥ /build auto 先例佐证 confirm 留人 | Decision 1 confirm 条 |
| ⑦ mcpServers frontmatter 被静默忽略 → MCP 协调归机器/daemon 层 | Decision 4 第 6 条 |

### 名册定案（会话补正 2026-10-12）

| 名册项 | ADR 位置 |
|---|---|
| 7 员（Chief + Planner + Implementer + CodeReviewer/SecurityAuditor/TestEngineer + Verifier）逐条职责 + artifact | Decision 0 表 |
| WebPerf 不设 agent，作 Verifier 条件 skill hop | Decision 0 |
| 合并动作留人不在名册 | Decision 0 |
| Composition 块要求 | Decision 0 首段 |
| 模型档位按角色注记（具体值留 #1250 seeding） | Decision 0 末条 |
| TestEngineer 与 Verifier 分工（读 diff 批评 vs 跑真系统取证） | Decision 0 表 Verifier 行 |

## Edge case 核对

- 与 ADR 0017 无矛盾：0017 localPath 加速位语义不动，关系节明写「选源判定先于能力闸，两条判定不互相改写」——交叉读通过。
- #1241 只引用不重定义（Decision 3 明写「以其 plan 交接物为准」）。
- 依赖边两说并存如实入账（F8 + Decision 2），承载留 #1250。
- review meta header 语义不动（Decision 1 承载钉法：槽位管默认、meta header 管实际）。
- 纯文档票：零 .ts 改动；02 册只加两条指针注记。

## 验证

- `pnpm spec:parse` PASS（输出存同目录 spec-parse-gate.txt，exit=0）。
- 本文件 + spec-parse-gate.txt = docs/verify/1248/ 证据包。
