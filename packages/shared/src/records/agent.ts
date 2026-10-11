// agent record——02 §6.2（r3 §4 实测原样）。
// Agent = 配了模型、职责、技能、工具、密钥、MCP 与记忆的执行角色（CONTEXT.md）；
// Agent ≠ Machine（一个是角色，一个是承载主机）。
// 端点补录（r5 §1/§8）：列表实际走 GET teams/{id}/members（memberType:"agent"
// 行内嵌 actor 全记录）；创建 POST teams/{id}/agents → 201 {id}；
// GET teams/{id}/agents 为 405。

import { z } from 'zod';
import { BRAND } from '../brand.js';
import { phaseSchema, recordId } from './common.js';
import { SECRET_MIN_CLI_VERSION } from './secret.js';

/** 观测值仅 "active"；其余状态未采到，词表不收窄外值 [推断]。 */
export const agentStatusSchema = z.enum(['active']);

/** 权限面工具 6 开关 UI 词（r3 §4 全 list，文案 canon）。XMON-84 用户拍板 B：
 * 六档全保留。执法面现状：合并分支/推送分支 = daemon merge/push 收尾闸 +
 * server requestMerge 闸（XMON-77）；远程 shell = 机器双闸（agent 开关 ∩
 * machine.shellEnabled，claim + 每命令预检，XMON-108 R1）+ daemon 工具本体
 * （#597）+ chief 写点（XMON-115）；创建技能/更新技能 = worker relay 逐词
 * 403（chief 步免开关，信任面）。创建标签暂无执法消费方（保留期 = 照常
 * 持久化，不造假 enforcement）。词表外值（自造档）写侧过滤退役。
 * wire 值未观测（样本 tools:[] 恒空）[推断]——tools[] 不收窄为枚举。 */
export const AGENT_TOOL_SWITCHES = [
  '远程 shell',
  '合并分支',
  '创建标签',
  '推送分支',
  '创建技能',
  '更新技能',
] as const;
export type AgentToolSwitch = (typeof AGENT_TOOL_SWITCHES)[number];

/** 合并权限 = 两开关齐备（XMON-77：合并步收尾 = git merge + conv 分支 push，
 * 三形态 repo 的落地都以推送为前置）。server requestMerge 与 daemon 收尾闸
 * 共用，跨缝不复制字面量。 */
export const AGENT_TOOL_MERGE: AgentToolSwitch = '合并分支';
export const AGENT_TOOL_PUSH: AgentToolSwitch = '推送分支';
/** 技能库写路径（XMON-109 S1）的开关执法位：worker relay create_skill /
 * update_skill 逐词对照（requestMerge 同形 403）。chief 步免开关（信任面）。 */
export const AGENT_TOOL_SKILL_CREATE: AgentToolSwitch = '创建技能';
export const AGENT_TOOL_SKILL_UPDATE: AgentToolSwitch = '更新技能';

/** 远程 shell 本体闸（XMON-108 R1 起有执法面）：agent 层开关 ∩ 机器层
 * `machine.shellEnabled` 双闸齐开才在 claim 组装 localTools 含 remote_shell
 * （词值单源 = protocol/machine-wire.ts LOCAL_TOOL_REMOTE_SHELL）；步中每条
 * 命令经预检端点复核双闸（POST /api/machine/shell/{stepId}）。预检/执法
 * 先例 = requestMerge 403（builds.ts）双开关校验。 */
export const AGENT_TOOL_SHELL: AgentToolSwitch = '远程 shell';

/** 创建标签本体闸（XMON-111 T1 起有执法面）：agent 层开关开 = claim 组装
 * localTools 含 create_tag（词值单源 = protocol/machine-wire.ts
 * LOCAL_TOOL_CREATE_TAG；机器层无对应闸，与 remote_shell 的双闸形不同）。
 * 执行体 = daemon tag-tool（annotated tag 创建 + refs/tags 推送经 gitPrim，
 * per-step 凭证不出 daemon）。发布流不挂接：tag 进 origin 后用户仓自身 CI
 * 自然生效。 */
export const AGENT_TOOL_TAG: AgentToolSwitch = '创建标签';

/** 新建 Agent 的 tools 默认集（XMON-84 B4）：「推送分支」开——收尾闸落地后
 * 缺它 = 提交留本地工作分支，新建即推不了工作分支会破坏交付（不破坏交付
 * 判据）；「合并分支」不默认开——合并进默认分支属发布行为，发布决定留给人
 * （最小权限判据）。四无本体档与 MCP/密钥一律不默认开。创建路径（REST POST
 * 与 chief create_agent）同源消费；存量行回填走 migration（PR 内审）。 */
export const AGENT_TOOL_DEFAULTS: readonly AgentToolSwitch[] = [AGENT_TOOL_PUSH];

/** 权限面 6 开关各自的说明副文案（键 = AGENT_TOOL_SWITCHES 的同值域词）。
 * 文案原文实测自参考产品 Agent 详情页权限 tab（2026-09-30，#485）。 */
export const AGENT_TOOL_COPY: Record<(typeof AGENT_TOOL_SWITCHES)[number], string> = {
  '远程 shell': '允许该 Agent 在团队中已开启 shell 访问的机器上执行命令。',
  合并分支: '允许该 Agent 通过合并分支进行发布（例如将 develop 合并进 main）。',
  创建标签: '允许该 Agent 创建 git tag，这可能触发发布流程。',
  推送分支: '允许该 Agent 随时提交并推送其工作分支（自行合并发布改动时需要）。',
  创建技能: '允许该 Agent 向团队技能库添加新技能。',
  更新技能: '允许该 Agent 修改团队技能库中已有的技能。',
};

/** tools[] 写侧过滤（XMON-77 起）：词表外值（自造档）静默丢弃，词表内保留且
 * 顺序不变（读改写全量回写不被重排）。filterKnownSkillIds 同律而非 machines
 * enabledRuntimes 的 enum-400 律——UI 是读改写全量，存量残值若 400 会把
 * 用户锁死在死值上，过滤则随下一次写自然清退。 */
export function filterAgentTools(tools: string[]): string[] {
  return tools.filter((t) => (AGENT_TOOL_SWITCHES as readonly string[]).includes(t));
}

/** 权限面其余各档的说明文案（r3 §4 原文；品牌串经 brand.ts 槽，版本门常量
 * 见 records/secret.ts）。工具开关的副文案见 AGENT_TOOL_COPY。
 * defaultSkill（携带）/ skillsAllowlist（授权）两文案自 #1169 起分家。 */
export const AGENT_PERMISSION_COPY = {
  secrets: `任务执行时，该 Agent 可在需要密钥的执行步中按需取用团队密钥，每次取用都会留下记录；密钥不预置进 shell 环境。所在机器需要 ${BRAND.cliCommandName} CLI ${SECRET_MIN_CLI_VERSION} 及以上。`,
  mcpServers:
    '该 Agent 执行任务时可使用的团队 MCP 服务器，其工具以 mcp__<服务器>__<工具> 的形式出现。',
  responsibility:
    '用一两句话说明该 Agent 的职责。该说明会注入它执行的每个任务，也会提供给总管用于分派。',
  defaultSkill: '该 Agent 执行任何任务时自动携带的团队技能，无需在消息中 @ 引用。',
  skillsAllowlist:
    '该 Agent 执行任务时可读取的团队技能范围。开启「不限制」= 全量可读；关闭后仅勾选的技能可读，未勾选一律拒绝——「不限制」与全不勾是两种状态，可随时互转。',
} as const;

export const agentRecordSchema = z.object({
  id: recordId,
  displayName: z.string(),
  /** 职责；未设置时 UI 显「未设置职责」（r3 §4），null 形状 [推断]。 */
  description: z.string().nullable(),
  status: agentStatusSchema,
  avatarUrl: z.string().nullable(),
  /** provider id（r3 §4 样本 provider:"r3-gw" = BYOK 自定义服务商）。 */
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  /** 思考强度（r3 样本 null = UI「默认」；wire 值词表未采 [推断]）。 */
  thinkingLevel: z.string().nullable(),
  /** 权限 6 开关的已开集 + 授予工具；wire 项形 [推断]。读侧宽（string[]，
   * 存量行残值可读）；写侧严 = filterAgentTools（XMON-77）——machines
   * enabledRuntimes 同一读写分工。 */
  tools: z.array(z.string()),
  /** 团队密钥授权集（关联 secret id [推断]；值只写不读，02 §8）。 */
  secrets: z.array(z.string()),
  /** 默认携带技能（#1169）：单值，关联 skill id，null = 不携带。旧 agent.skills
   * 字段「skills[0] 单值」消费面（详情页概览 Select）的正本。与 skillsAllowlist
   * 互不影响：携带不必授权，授权不必携带。 */
  defaultSkill: z.string().nullable(),
  /** 授权白名单（#1169）：关联 skill id 集；**null = 不限制**（全量可读，创建
   * 缺省）；数组 = 白名单（名单外目录 Read 被 #917 deny 硬挡，bypassPermissions
   * 下仍挡）。「谁都不许读」须显式写 []——闸从意外默认变回有意选择。 */
  skillsAllowlist: z.array(z.string()).nullable(),
  /** MCP 逐个勾选（关联 mcp_server id [推断]，02 §7.1）。 */
  mcpServers: z.array(z.string()),
  /** agent 级并发上限（#1138）：该 Agent 名下同时执行的 worker 步数上限；
   * null = 不限（缺省——单用户低并发不强制默认值，只对显式设置的 Agent
   * 生效）。claim 候选级闸消费（machines.ts tryClaim，与机器 maxConcurrent
   * 双层各自 gate）。optional 形 = 加法契约（machine maxConcurrent 同律）：
   * 老 server 响应缺字段可解析（消费面回退不渲染）；server 恒发全块。 */
  maxConcurrentTasks: z.number().int().nullable().optional(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

/** POST /api/teams/{id}/agents body [推断]（r5 §1/§8 补录端点；字段 =
 * 上文 agentRecordSchema 配置面投影，创建弹窗 r3 §4：名称/职责/模型）。 */
export const createAgentBodySchema = z.object({
  displayName: z.string().min(1),
  description: z.string().nullish(),
  provider: z.string().nullish(),
  modelId: z.string().nullish(),
  thinkingLevel: z.string().nullish(),
  tools: z.array(z.string()).optional(),
  secrets: z.array(z.string()).optional(),
  /** 单值槽（#1169）：数组（含单元素）拒——携带语义不得再经数组位表达。 */
  defaultSkill: z.string().nullish(),
  /** nullish（#1169）：显式 null = 不限制（与缺省同值）；[] = 显式全拒。 */
  skillsAllowlist: z.array(z.string()).nullish(),
  mcpServers: z.array(z.string()).optional(),
  /** agent 级并发上限（#1138）：值域 1..50（Multica agent 层闸同区间，
   * r10 §5.4）；nullish——显式 null = 不限（与缺省同值）。 */
  maxConcurrentTasks: z.number().int().min(1).max(50).nullish(),
});
export type CreateAgentBody = z.infer<typeof createAgentBodySchema>;

/** Agent 详情概览「进行中」段的载荷行（`GET /api/teams/{id}/agents/{aid}/tasks`）。
 *
 * 形状来源 = 参考产品 web 包里的消费组件（Expo web，`/app/_expo/static/js/web/
 * entry-*.js`，2026-09-30 直读；该端点的响应体本身仍未采），逐字读出的渲染面：
 *   api(`/api/teams/${teamId}/agents/${agentId}/tasks`) → 整包直接进 state
 *   <SectionList label={t('agent_modal.in_progress')} count={rows.length}
 *                empty={t('agent_modal.no_active_tasks')}>
 *     rows.map(r => <TaskRow task={r} key={r.buildId} onOpen={() => open(r.todo.id)} />)
 *   TaskRow（`kind === 'build'` 支）：`#${todo.seqNum}` · `todo.title`（单行截断）
 *     · PhasePill(`state === 'waiting' ? 'queued' : todo.phase`) · 右箭头。
 *   同组件另一支是墓碑行（被删条目：`label` 删除线 + 「已删除」），本仓无生产者。
 *
 * 本 schema 只收消费面真正读到的字段（01 §6：观测不到的字段不收）。
 *
 * 列表语义 = 「该 Agent 名下正在跑的 build」，**不是**「指派给它的 todo」——
 * 实测反证：参考账号 3 条 `phase=review` 且 assignment 指向该 Agent 的 todo，
 * 该端点恒返回 `[]`（2026-09-30）。同包内 `groupProgress` 的 In progress 判据
 * 亦为 `queued || BUSY_PHASES`（见 shared IN_PROGRESS_PHASES）。
 */
export const agentTaskSchema = z.object({
  /** 行种类。观测到的字面量只有 'build'（墓碑行的字面量未采 [推断]）。 */
  kind: z.literal('build'),
  /** build 自身状态。'waiting' = 已建、尚无机器领取，消费面落 PhasePill 时
   *  映射为 `queued`。非等待态的 token 未采 [推断]——本仓发 null，消费面按
   *  `todo.phase` 渲染，渲染结果与原件同（跑起来的 build，其 todo.phase 本身
   *  就是 planning/building）。 */
  state: z.literal('waiting').nullable(),
  /** 行的 key（原件 `key={r.buildId}`）；= todo.latestBuildId。 */
  buildId: recordId,
  /** 行内被渲染的字段（含点击落点 id）。 */
  todo: z.object({
    id: recordId,
    seqNum: z.number().int(),
    title: z.string(),
    phase: phaseSchema,
  }),
});
export type AgentTask = z.infer<typeof agentTaskSchema>;

/** PATCH /api/teams/{id}/agents/{aid} body [推断]（REST 同名，02 §6.1 词表内；
 * 覆盖面 = 概览/权限 tab 编辑 + per-Agent mcpServers[] 授权勾选，02 §7.1）。 */
export const patchAgentBodySchema = createAgentBodySchema.partial().extend({
  displayName: z.string().min(1).optional(),
});
export type PatchAgentBody = z.infer<typeof patchAgentBodySchema>;
