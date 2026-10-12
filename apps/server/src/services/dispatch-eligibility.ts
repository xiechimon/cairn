// 认领资格判定原语（#881 单源）：步的 Agent 解析 + runtime 闸判。
//
// 为什么单列叶子：tryClaim（machines.ts，claim 面）与失联扫尾（builds.ts /
// chief.ts 的 sweep 面）要用**同一份判据**回答「这台机器开没开这条步的
// runtime」。#864 把「钉选机在线但 runtime 闸挡」登记为已知缝，原因正是
// 判定藏在 machines.ts 里、sweep 侧值 import 会成环（machines → builds/
// chief 是既有正向边）。下沉到本叶子（只依赖 db schema 与 shared，不 import
// 任何 service），claim 面与 sweep 面共用一份事实——两处判定一旦漂移，后果
// 是 sweep 误杀 claim 能领的步，或放过 claim 永远领不了的步（后者即无期
// pending 的缝本身）。

import {
  type Assignment,
  type ClaudeCodeReport,
  capabilityMissingLabels,
  isBackendRuntimeId,
  type MachineCapabilities,
  parseReviewPromptMeta,
  type RequiredCapabilities,
  type StepKind,
} from '@pacman/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, build, chief, chiefThread, step, todo } from '../db/schema.js';

/** #682 enabledRuntimes 真闸——步的 runtime 判定（与 daemon runner 的
 *  backendFor 同律：agent provider ∈ BACKEND_RUNTIME_IDS → claude-code，
 *  其余（含 BYOK 自定义 provider）→ pi）。判定单源在此；claim 侧与 sweep
 *  侧（#881 钉选在线被挡判据）共同消费，机器侧开关 = machine.enabledRuntimes
 *  （PATCH 热写，秒级生效）。 */
export function stepRuntimeFor(agentProvider: string | null | undefined): 'pi' | 'claude-code' {
  return isBackendRuntimeId(agentProvider) ? 'claude-code' : 'pi';
}

/** 机器未开步所需的 runtime = 不可领该步（步留 pending 给能跑的机器——
 *  spec 11 A8「我可以决定本机跑 pi 还是 Claude Code 任务」的兑现位）。 */
export function runtimeGatePasses(
  machineRow: { enabledRuntimes: string[] },
  agentProvider: string | null | undefined,
): boolean {
  return machineRow.enabledRuntimes.includes(stepRuntimeFor(agentProvider));
}

// —— #1251 能力闸（ADR 0018 决策 4.3，本叶子加钉点=F4）———————————————
// 机器上报的能力快照不满足 agent.requiredCapabilities = 不领该 Agent 的步
// （步留 pending 给能力齐的机器）。判据单源在本文件：claim 面（tryClaim /
// buildChiefClaim）、sweep 面（④d 有界等待）、排队投影（queue.blocked）、
// machine-fit 读面四处共同消费——与 runtimeGatePasses 同一份纪律（两处判定
// 漂移 = sweep 误杀 claim 能领的步 / 显示面撒谎）。
//
// fail-open 律（版本墙纪律，Premortem 2 护栏「闸只看 server 侧已收到的上报
// 快照」）：机器从未上报该维快照（capabilities 列 null / claudeCodeReport
// null）= 未知 ≠ 缺失 → 该维放行。老 daemon 行为完全不变；错杀方向由可见
// reason 兜底（缺项点名 + 修法），漏杀方向由 daemon 既有降级语义兜底（未知
// MCP slug 执行侧跳过不阻断）。

/** 能力闸的机器事实位（machine 行子集；两处快照列 + runtime 开关）。 */
export interface MachineCapabilityFacts {
  capabilities: MachineCapabilities | null;
  claudeCodeReport: { models: { id: string }[] } | null;
}

/** 逐维缺项（slug 小写归一后比对——parseClaudeMcpEntries 律同源；模型 id
 *  精确比对 claudeCodeReport.models[].id）。快照缺席的维度 = 空缺（fail-open
 *  律）；required 缺省/null = 两维全空（闸恒开，零回归）。 */
export function missingCapabilityItems(
  machineRow: MachineCapabilityFacts,
  required: RequiredCapabilities | null | undefined,
): { mcpServers: string[]; models: string[] } {
  if (required == null) return { mcpServers: [], models: [] };
  const reportedMcp = machineRow.capabilities?.mcpServers;
  const reportedModels = machineRow.claudeCodeReport?.models;
  return {
    mcpServers:
      reportedMcp === undefined
        ? []
        : (required.mcpServers ?? [])
            .map((slug) => slug.toLowerCase())
            .filter((slug) => !reportedMcp.includes(slug)),
    models:
      reportedModels === undefined
        ? []
        : (required.models ?? []).filter((id) => !reportedModels.some((m) => m.id === id)),
  };
}

/** 缺项的可读名集（capabilityMissingLabels 单源——reason 文案 / 排队
 *  blocked.missing / machine-fit.missing 三处同词）。空集 = 闸通过。 */
export function missingCapabilities(
  machineRow: MachineCapabilityFacts,
  agentRow: { requiredCapabilities: RequiredCapabilities | null | undefined },
): string[] {
  return capabilityMissingLabels(missingCapabilityItems(machineRow, agentRow.requiredCapabilities));
}

/** 能力闸判定（runtimeGatePasses 同形消费面）：缺项非空 = 不可领该步。 */
export function capabilityGatePasses(
  machineRow: MachineCapabilityFacts,
  agentRow: { requiredCapabilities: RequiredCapabilities | null | undefined },
): boolean {
  return missingCapabilities(machineRow, agentRow).length === 0;
}

/** MCP 对账面（ADR 0018 决策 4.6「缺口可见」）：agent.mcpServers 声明 vs
 *  机器实装的差集（小写归一）。null = 机器未上报快照（未知，显示面闭嘴）；
 *  数组 = 缺口清单（可见不挡——daemon 对未知 slug 的既有语义是跳过降级，
 *  硬闸只吃 requiredCapabilities 显式声明）。 */
export function declaredMcpGaps(
  machineRow: { capabilities: MachineCapabilities | null },
  agentRow: { mcpServers: string[] },
): string[] | null {
  if (machineRow.capabilities === null) return null;
  const installed = machineRow.capabilities.mcpServers;
  return agentRow.mcpServers
    .map((slug) => slug.toLowerCase())
    .filter((slug) => !installed.includes(slug));
}

/** 步的 Agent id 解析（槽位单源，无 DB 查询）：agentForStep 的解析半边
 *  （agent 表存在性查询留在那半边）。#1138 起计数面（agent 在跑计数）单独
 *  消费本原语——归账只要槽位指向，不需要行存在（指向已删 Agent 的在跑步
 *  恒不会被任何候选命中，存在性检查对计数无增益）。 */
export function agentIdForStep(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null = null,
): string | null {
  // review 步：agentId 经 prompt meta header 透出（r8 §3.1：模态选 Agent
  // 入队，不走 assignment 槽——执行/规划 Agent 不一定适合审核）。
  if (kind === 'review') {
    return parseReviewPromptMeta(prompt)?.agentId ?? null;
  }
  // verify 步（#1250 / ADR 0018 层 1）：assignment.verify 槽（与 plan/build
  // 同形，不回落 build 槽——Verifier 是独立角色，回落会让验证步静默跑在
  // Implementer 名下，「验自己的活」破坏独立验证语义）。
  if (kind === 'verify') {
    return todoRow.assignment?.verify?.agentId ?? null;
  }
  return planSlotFor(todoRow, kind, prompt)?.agentId ?? null;
}

/** 步的 Agent 解析（claim 载荷组装与 #881 sweep 判据共用）：
 *  - review 步：agentId 在 prompt meta header 里（M7 #330，step 表无 agentId
 *    列；测试已钉此口径，apps/server/test/review.test.ts）；
 *  - 其它步类：assignment 双槽按步类取（02 §4.2/r5 §5）——规划步 → plan 槽；
 *    执行/合并步 → build 槽（合并轮复用执行轮会话，同 Agent）。
 *  - 规划步的返工回落（#1204）：带续轮指令的规划步（revision 打回 / #330
 *    自动回流 / 失败重启轮 / #113 补写轮——prompt 非空即此族）plan 槽空时
 *    回落 build 槽（持有全部施工上下文，本就是最合适的 replan 者）；两槽
 *    皆空才无主。首轮规划步（prompt 空）不回落——#1104 B 的失败收尾是
 *    chief 400 自纠回路的既有语义，首跑行为是回归红线。
 *  无 Agent（槽空 / 槽指向已删 Agent / review meta 无 agentId）= null：claim
 *  面按失败收尾该步（#1104 B：applyStepFailure 落 build.errorMessage + todo
 *  → failed 终态，不再静默跳过候选）；sweep 面无从计算 runtime（不进闸挡判）。 */
export function agentForStep(
  db: Db,
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  /** review 步的 prompt（meta header 解析用）；规划步的返工判别（#1204：
   *  prompt 非空 = 带续轮指令的返工步，plan 槽空回落 build 槽）。 */
  prompt: string | null = null,
): typeof agent.$inferSelect | null {
  const agentId = agentIdForStep(todoRow, kind, prompt);
  if (agentId === null) return null;
  return db.select().from(agent).where(eq(agent.id, agentId)).get() ?? null;
}

/** 规划步的槽位解析（agentForStep 与 unassignedStepReason 同一映射，本文件
 *  单源）：返工步（prompt 非空）plan 槽空 → 回落 build 槽；首轮步与执行/
 *  合并步按步类直取。 */
function planSlotFor(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null,
): Assignment['plan'] | Assignment['build'] {
  if (kind !== 'plan') return todoRow.assignment?.build ?? null;
  if (todoRow.assignment?.plan != null) return todoRow.assignment.plan;
  return prompt !== null ? (todoRow.assignment?.build ?? null) : null;
}

/** #1104 B 无主步失败文案（agentForStep 返 null 的三族分类）：assignment 槽
 * 空 / 槽指向已删 Agent / review meta 缺 agentId。与 agentForStep 同文件同
 * 槽位映射（planSlotFor 单源），各族点名各自的补法，落 build.errorMessage
 * （看板失败终态可见），claim 面失败收尾时消费。#1204：规划步返工族文案
 * 按回落后的事实点名——两槽皆空说两槽（回落已试），首轮步维持 plan 槽单点。 */
export function unassignedStepReason(
  todoRow: typeof todo.$inferSelect,
  kind: StepKind,
  prompt: string | null,
): string {
  if (kind === 'review') {
    return 'review 步无 Agent：审核 prompt meta 未携带 agentId，无人可领。';
  }
  if (kind === 'verify') {
    const slot = todoRow.assignment?.verify;
    if (slot?.agentId == null) {
      return 'verify 步无指派 Agent：assignment 的 verify 槽为空，无人可领。指派 Verifier（assignment.verify 槽）后重新运行任务。';
    }
    return `verify 步指派的 Agent 不存在（agentId ${slot.agentId} 已删除或不在本团队），无人可领。改派 Verifier 后重新运行任务。`;
  }
  if (kind !== 'plan') {
    const slot = todoRow.assignment?.build;
    if (slot?.agentId == null) {
      return `build 步无指派 Agent：assignment 的 build 槽为空，无人可领。指派 Agent 后重新运行任务。`;
    }
    return `build 步指派的 Agent 不存在（agentId ${slot.agentId} 已删除或不在本团队），无人可领。改派 Agent 后重新运行任务。`;
  }
  // 规划步：返工族（prompt 非空）回落后仍无主 = 两槽皆空；首轮族 = plan 槽空。
  if (todoRow.assignment?.plan?.agentId != null) {
    return `plan 步指派的 Agent 不存在（agentId ${todoRow.assignment.plan.agentId} 已删除或不在本团队），无人可领。改派 Agent 后重新运行任务。`;
  }
  if (prompt !== null) {
    return `plan 步无指派 Agent：assignment 的 plan 槽与 build 槽均为空（返工步已尝试回落 build 槽），无人可领。指派 Agent 后重新运行任务。`;
  }
  return `plan 步无指派 Agent：assignment 的 plan 槽为空，无人可领。指派 Agent 后重新运行任务。`;
}

/** #1108 机器在跑步数（worker + chief 同数——#1260 起 chief 占并发槽，
 *  容量闸、机器页 `执行中 n/N`、排队快照三处同源同数）。#1219 从
 *  machines.ts 下沉本叶子：sweepAbandonedBuildSteps（builds.ts）的 ④c
 *  宽限判据要「归属机有无空闲并发位」——machines → builds 是既有正向
 *  边，值 import 会成环，与 #881 把 runtime 判定下沉至此同理。
 *  machines.ts re-export 保持既有导入面不变。 */
export function machineRunningCount(db: Db, machineId: string): number {
  return db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
    .all().length;
}

/** #1138 agent 级在跑计数：该 Agent 名下 claimed 步数（机器无关——agent
 *  池跨机器，与 Multica agent 层闸同形，r10 §5.4）。worker 步归账 = 槽位
 *  解析（本文件 agentIdForStep 单源，与 claim 候选解析同一份事实）：join
 *  step⋈build⋈todo，孤儿步（无 build 行——测试占位与极端残行）天然不计；
 *  chief 步归账 = chiefThread→chief.agentId（#1260：chief = 普通 agent，
 *  其回合占绑定 Agent 的槽——Multica leader 无并发特权同律，agent 表
 *  max_concurrent_tasks 对 leader 一视同仁）。步领取后 assignment 改派的
 *  窄窗按当前槽位归账（闸是公平性约束，不是所有权账本——现读口径）。
 *  与 machineRunningCount 同居本叶子：消费同文件的 agentIdForStep，
 *  machines.ts 的 tryClaim 跨文件消费（machines → 本叶子是既有正向边，
 *  本文件不 import 任何 service，无环）。 */
export function agentRunningCount(db: Db, agentId: string): number {
  const rows = db
    .select({ kind: step.kind, prompt: step.prompt, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'claimed'), ne(step.kind, 'chief')))
    .all();
  const workerCount = rows.filter(
    (r) => agentIdForStep(r.todoRow, r.kind, r.prompt) === agentId,
  ).length;
  const chiefCount = db
    .select({ id: step.id })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .where(and(eq(step.status, 'claimed'), eq(step.kind, 'chief'), eq(chief.agentId, agentId)))
    .all().length;
  return workerCount + chiefCount;
}

/** #1259 归属机校验（创建/换绑/整机迁移共用单源）：归属机必须启用该 agent
 *  的 runtime；claude-code agent 的 modelId 还须在该机上报的模型清单内
 *  （modelId 空 = 跟随该机默认槽，恒过；pi 等 server 下发配置的 provider
 *  免模型查）。返回 null = 通过，否则 = 人话原因（点名缺什么、怎么修）。
 *  机器未上报过模型清单（老 daemon）= 拒——无法证明该机配了该模型。 */
export function homeMachineRejectReason(
  machineRow: {
    name: string;
    enabledRuntimes: string[];
    claudeCodeReport: ClaudeCodeReport | null;
  },
  agentRow: { provider: string | null | undefined; modelId: string | null | undefined },
): string | null {
  const runtime = stepRuntimeFor(agentRow.provider);
  if (!machineRow.enabledRuntimes.includes(runtime)) {
    return `机器 ${machineRow.name} 未启用 ${runtime} runtime（在机器页开启后再试）。`;
  }
  if (runtime === 'claude-code' && agentRow.modelId != null && agentRow.modelId !== '') {
    const report = machineRow.claudeCodeReport;
    if (report == null) {
      return `机器 ${machineRow.name} 尚未上报模型清单（daemon 版本过旧或未上线），无法校验模型 ${agentRow.modelId}。`;
    }
    if (!report.installed || !report.models.some((m) => m.id === agentRow.modelId)) {
      return `机器 ${machineRow.name} 未配置模型 ${agentRow.modelId}（在该机 ~/.claude/settings.json 配上，或为 agent 换模型）。`;
    }
  }
  return null;
}
