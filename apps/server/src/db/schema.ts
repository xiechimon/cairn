// Drizzle schema——01 §6 锁定清单（24 record 投影表 + `todo_tag` 纯 join 表）。
// 纪律：列 = 02 §6.2 record 形状投影（字段即契约，02/A9）；不发明 02 之外的
// wire 字段。内部列（journal 状态、密文槽、哈希槽）按 01 §6 表注/02 §8 展开，
// 标注 [内部]；表名 = shared DB_TABLES 单源（test/schema.test.ts 对拍）。

import type {
  ActiveRun,
  Assignment,
  AutonomyGateReason,
  AutonomyKind,
  AutonomySettings,
  BlockerHandoffRecord,
  ChiefWatch,
  ClaudeCodeReport,
  DocumentDiffFile,
  MachineCapabilities,
  ModelRef,
  PersonaRole,
  Phase,
  ProjectRepoKind,
  ProviderApi,
  ProviderCompat,
  ProviderModel,
  RequiredCapabilities,
  SkillInjectionRecord,
  SplitPolicy,
  StepKind,
  TodoSourceKind,
  TriggerSource,
} from '@cairn/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** epoch 毫秒（records/common.ts epochMs 同族）。 */
const epochMs = (name: string) => integer(name);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

// —— user（seed 一行，02 §2.1）—————————————————————————————————————————
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  displayName: text('displayName').notNull(),
  avatarUrl: text('avatarUrl'),
});

// —— team（seed 一行；plan 形状保留、不参与门控，02 §2.2/A3）———————————————
export const team = sqliteTable('team', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  plan: text('plan').notNull().default('free'),
  avatarStyle: text('avatarStyle'),
});

// —— project（repo 形态：托管 bare / GitHub 接入 / local 本机仓，02 §3/A4 +
// spec 12）———————————————————————————————————————————————————————————————
export const project = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  splitPolicy: text('splitPolicy').$type<SplitPolicy>().notNull().default('human'),
  /** 项目描述（#1242 设置页可编辑面；PATCH 五字段之一）。可空 = 无描述。 */
  description: text('description'),
  repoKind: text('repoKind').$type<ProjectRepoKind>(),
  /** 托管形态：bare repo 名段（远端 URL `<teamId>/<repoName>`，r3 §1.4）。 */
  repoName: text('repoName'),
  /** GitHub 接入形态：`owner/repo`（02 §3；字段名 [推断]）。 */
  githubRepo: text('githubRepo'),
  /** local 形态：用户本机 git 工作树仓绝对路径（spec 12 / #359；server 端
   * `~` 展开 + 三态校验后的规范化值，daemon 镜像 clone 同源消费）。 */
  localPath: text('localPath'),
  /** 后台自动任务的闸设置（#1491）：null = 用 shared DEFAULT_AUTONOMY_SETTINGS。 */
  autonomy: json<AutonomySettings | null>('autonomy'),
});

// —— todo（02 §4.1 字段表全量；tagIds/buildHistory/agent 为派生面不存列）——————
export const todo = sqliteTable('todo', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id),
  title: text('title').notNull(),
  spec: text('spec').notNull().default(''),
  phase: text('phase').$type<Phase>().notNull().default('todo'),
  phaseAt: epochMs('phaseAt').notNull(),
  seqNum: integer('seqNum').notNull(),
  orderIndex: real('orderIndex').notNull().default(0),
  assignment: json<Assignment | null>('assignment'),
  latestBuildId: text('latestBuildId'),
  lastRunAt: epochMs('lastRunAt'),
  hasChanges: bool('hasChanges').notNull().default(false),
  hasPlan: bool('hasPlan').notNull().default(false),
  /** 来源任务引用（r3 §3.0 列名照抄；#1250 / ADR 0018 层 2 落位拆父子指针：
   *  chief split_todo 建的子卡本列 = 父卡 id——「子全 done 父自动收」的归账键
   *  + 父 confirm 派发子的回溯键）。存量恒 null。 */
  sourceTodo: text('sourceTodo'),
  /** 依赖边（#1250 / ADR 0018 层 2，blocking 语义）：阻塞本卡的兄弟子卡 id
   *  集（json 数组，chief split_todo 写入；分派闸 = startBuilds 全 done 才放
   *  行，波次推进 = done 落地时解锁自动派发）。null = 无依赖。 */
  blockedBy: json<string[]>('blockedBy'),
  v: integer('v').notNull().default(1),
  createdBy: text('createdBy'),
  ownerId: text('ownerId'),
  sourceBuildId: text('sourceBuildId'),
  /** 来源种类（#446 / ADR 0005 D6，溯源家族位）：null | 'github-issue'
   * （值域单源 = shared TASK_SOURCE_KINDS）。任务至多一个来源。 */
  sourceKind: text('sourceKind').$type<TodoSourceKind | null>(),
  /** 外部引用（#446）：形如 `github:owner/repo#123`（shared
   * githubIssueSourceRef 单源）；无来源 = null。 */
  sourceRef: text('sourceRef'),
});

// tag record 三位补全（#309，r9 §3.4 实测 wire {id, projectId, name, color,
// createdAt, v}）。列 default 仅为 migration 对既有行的回填位（此前无写路径，
// 存量行几乎不存在）；服务面写入时恒给真值。
export const tag = sqliteTable('tag', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  createdAt: epochMs('createdAt').notNull().default(0),
  v: integer('v').notNull().default(1),
});

// —— todo_tag（纯 join 表，01 §6；无 wire record 形状）————————————————————
export const todoTag = sqliteTable(
  'todo_tag',
  {
    todoId: text('todoId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    tagId: text('tagId')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.todoId, t.tagId] })],
);

// —— build（buildId ≡ conversationId，CONTEXT.md/02 §4.2）——————————————————
export const build = sqliteTable('build', {
  id: text('id').primaryKey(),
  todoId: text('todoId')
    .notNull()
    .references(() => todo.id, { onDelete: 'cascade' }),
  withPlan: bool('withPlan').notNull(),
  prevPhase: text('prevPhase').$type<Phase | null>(),
  triggerSource: text('triggerSource').$type<TriggerSource>().notNull(),
  planDocId: text('planDocId'),
  errorMessage: text('errorMessage'),
  prUrl: text('prUrl'),
  prNumber: integer('prNumber'),
  /** 变更投影（#704 失败方式 5）：非 hosted 形态（github/local）的 conv 分支
   * diff——真值源 = daemon 步收尾 done.changesDiff（parseUnifiedDiff 解析后
   * 落此列），readBuildChanges 非 hosted 分支消费。null = 未上报（hosted 形态
   * 恒 null——真值源是 bare repo；旧 build / 上报失败同形）。空数组 = 已上报
   * 且零改动（与 null 语义分离，不把「没报」误当「没改」）。
   * #1313：解析结果为空但原始 diff 有 `diff --git` 头时，落
   * `{ files: [], changed: true }`，完成弹层不把这类改动当成空提交。 */
  changes: json<DocumentDiffFile[] | { files: DocumentDiffFile[]; changed: true }>('changes'),
  diffHash: text('diffHash'),
  baseSha: text('baseSha'),
  harnessHash: text('harnessHash'),
  createdAt: epochMs('createdAt').notNull(),
});

// —— step（三类步队列 server 持有、机器 claim，02 §4.2/A6；M4a +chief 步）—————

/** #1261 step.quotaBlock 列形态：daemon 上报的 quotaBlock（kind/providerId/
 * label/reason/retryAfterMs）+ server 侧挂起史（firstSeenAt 首挂时刻、lastAt
 * 本次挂起时刻、attempts 连续挂起次数）+ probeAt 下次探测时刻（到期 sweep
 * 释放回 pending——「额度恢复自动续跑」的 server 半）。 */
export interface QuotaWaitRow {
  kind: 'quota' | 'capacity';
  providerId: string;
  label: string | null;
  reason: string;
  retryAfterMs: number | null;
  firstSeenAt: number;
  lastAt: number;
  attempts: number;
  probeAt: number;
}

/** #1493 step.fallback 列形态：降级链在本步上的进度。model = 本步当前改跑
 * 的备选（null = 跑 agent 主模型）；tried = 本步已试过的 `<provider>/<modelId>`
 * （含主模型，同一步不重复试同一模型，链走完即停）；zeroUsageRetried = 已因
 * 「成功但 0 token」重试过一次。 */
export interface StepFallbackRow {
  model: ModelRef | null;
  tried: string[];
  zeroUsageRetried: boolean;
}

export const step = sqliteTable('step', {
  id: text('id').primaryKey(),
  /** ≡ conversationId。worker 步 = build.id（cascade 随行）；chief 步 =
   * `chief-<uuid>`（线程 id，无 build 行——Chief 回合 = 机器 step 实测
   * r5 §3.1，队列复用 [设计]，故本列不带 FK，级联面在 chief_thread）。 */
  buildId: text('buildId').notNull(),
  kind: text('kind').$type<StepKind>().notNull(),
  machineId: text('machineId'),
  /** [内部] journal 状态（02 §5.4；M3a 展开：claimed = 机器领取未收尾；
   * stopped = 停止钮中断，M7 #308）。 */
  status: text('status')
    .$type<'pending' | 'claimed' | 'done' | 'failed' | 'stopped' | 'waiting_quota'>()
    .notNull()
    .default('pending'),
  /** [内部] #1261 配额挂起块（status=waiting_quota 时在位）：kind/providerId/
   * label/reason/retryAfterMs + 挂起史（firstSeenAt/lastAt/attempts）+ 探测时刻
   * （probeAt，sweep 释放判据）。json 列不拆散——读面按步级一次性投影
   * （quotaWait），列内字段集单源 = shared quotaBlockSchema + services/quota-wait.ts
   * 的 QuotaWaitRow 形。null = 未挂起。 */
  quotaBlock: json<QuotaWaitRow>('quotaBlock'),
  /** [内部] #1493 降级链进度（StepFallbackRow）。null = 未降级、未重试。 */
  fallback: json<StepFallbackRow>('fallback'),
  /** [内部] 引擎会话标识（done 回传；continue session 复用面——合并轮/重规划轮
   * 同 conv 续跑，02 §4.2/§5.7）。 */
  sessionId: text('sessionId'),
  /** [内部] 步收尾时 conv 分支 HEAD sha（M3b done 回传 commit 字段）：
   * per-step checkpoint（「恢复到此处」数据源，r3 §3.5/02 §4.2 [推断] 语义）
   * + 合并步 fast-forward 落地键（r3 §3.9「目标提交」同族）。 */
  checkpointCommit: text('checkpointCommit'),
  /** [内部] claim 时刻（陈旧领取判定用 [设计]）。 */
  claimedAt: epochMs('claimedAt'),
  /** [内部] heartbeat/<stepId> 续活时刻（02 §5.4）。 */
  lastHeartbeatAt: epochMs('lastHeartbeatAt'),
  /** [内部] 步收尾时刻（#1403 段 3：builds.ts 把 build 的步写成 done / failed / stopped 时
   * 落；chief 回合步不落）。「最后推送的提交」按它排；迁移之前的行为 null，回落最后一次报到。 */
  finishedAt: epochMs('finishedAt'),
  /** [内部] 入队时合成的续轮指令（M4a [设计]）：驳回 feedback 注入重规划轮
   * （r5 §4「v2 内容忠实执行反馈」宿主等价物）、chief 回合任务文本/wake 事实
   * （r5 §3.1/§3.5）。claim 载荷 `instruction` 位透出。 */
  prompt: text('prompt'),
  /** [内部] #931 返工轮边界：本步必须开新引擎会话（claim session.action
   * 强制 'new'，会话亲和闸不挡）。置位 = restart 复用 PR build 的首步（用户
   * 裁定「只复用分支、上下文真空」——分支继续、会话全新）；后续步照常续接
   * 本轮新开的会话。 */
  freshSession: bool('freshSession').notNull().default(false),
  /** [内部] #1106 派发技能注入选择：worker 步 claim 时服务端对「任务文本 ×
   * 授予技能目录」的规则选择结果（每条命中含规则与原因，形状单源 =
   * shared skillInjectionSchema）。null = 未计算（chief 步 / 旧数据）；
   * hits=[] = 已计算零命中（零注入不是故障）。ids 经 claim 载荷
   * agent.injectedSkills 透传 daemon 收窄目录注入；本列 = 任务详情面的
   * 回查正本（「本任务注入了哪些技能、为何选中」）。 */
  skillInjection: json<SkillInjectionRecord>('skillInjection'),
  blockerHandoff: json<BlockerHandoffRecord>('blockerHandoff'),
  /** [内部] #1257 额度挂起面：done(failed) 分类为 quota 时步不判死，挂起
   *  等额度（重领退避）。holdReason = 挂起原因（现值 'quota'）；null = 未
   *  挂起。重领成功即清位（挂起是退避态不是持久属性）。 */
  holdReason: text('holdReason'),
  /** [内部] #1257 退避到期时刻（epoch ms）：claim 候选过滤 holdUntil > now
   *  的步（到期 = 下一次重领即探测额度是否恢复）。 */
  holdUntil: epochMs('holdUntil'),
  /** [内部] #1257 连续挂起次数（退避档位 escalator，QUOTA_HOLD_BACKOFF_MS
   *  按 1 起计数）。 */
  holdCount: integer('holdCount').notNull().default(0),
  createdAt: epochMs('createdAt').notNull(),
});

// —— message（transcript 消息/工具行，经 upload-urls 回传落库，02 §1.3；wire 细形归 M3）——
export const message = sqliteTable('message', {
  id: text('id').primaryKey(),
  /** ≡ buildId（conversation 与 build 同 UUID，CONTEXT.md）。 */
  conversationId: text('conversationId').notNull(),
  role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
  content: json<unknown>('content').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  /** 过闸宣告行的动作主体 displayName（#902：人 = 用户、chief 工具面 =
   * Chief 绑定 Agent）。仅 server 动作面写入的行携带；daemon 上传行与存量
   * 旧行恒 NULL（呈现层回落当前用户名）。 */
  actor: text('actor'),
});

// —— branch_sync（M7 #319，08 册 §3 story 10 + 附录 B）——————————————————————
// 分支对话框「同步到机器」状态机（pending → running → synced | failed）。
// 状态机走内部表（INTERNAL_ONLY_TABLES；读位 = `GET /api/builds/{id}/branch-sync`
// 端点封套 + team stream `branch_sync` 事件载荷），不另开 record projection。
// createdAt/startedAt/finishedAt = 阶段切时点（finishedAt = synced|failed 终态
// 时刻），错误信息落 errorMessage；服务端无权写 startedAt/finishedAt 之外的
// 字段（daemon 端通过 POST /api/machine/sync-result/{syncId} 改 status +
// startedAt/finishedAt/errorMessage）。
export const branchSync = sqliteTable('branch_sync', {
  id: text('id').primaryKey(),
  /** ≡ buildId = conversationId（02 §4.2/CONTEXT.md 实体等式）。 */
  buildId: text('buildId')
    .notNull()
    .references(() => build.id, { onDelete: 'cascade' }),
  machineId: text('machineId')
    .notNull()
    .references(() => machine.id),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  /** 目标同步目录（机器本机路径；web 默认 `~/<homeDirName>/workspaces/<buildId>`，
   * 用户可改——r1 changelog 09-13 文本）。 */
  directory: text('directory').notNull(),
  /** 分支名（`cairn/conv-<uuid>`，brand conversationBranch）。 */
  ref: text('ref').notNull(),
  /** 完整 40hex sha（spec 展示形 = 12hex，但 wire 用全 sha 简化对拍）。 */
  commit: text('commit').notNull(),
  /** force 语义 = 丢弃修改 + 删未跟踪文件（保留 .gitignore 内容），仅本次生效。 */
  force: integer('force', { mode: 'boolean' }).notNull().default(false),
  status: text('status')
    .$type<'pending' | 'running' | 'synced' | 'failed'>()
    .notNull()
    .default('pending'),
  errorMessage: text('errorMessage'),
  createdAt: epochMs('createdAt').notNull(),
  startedAt: epochMs('startedAt'),
  finishedAt: epochMs('finishedAt'),
});

// —— steer_pending（W3 #278，06 册 D9：build 会话运行中的补充说明单槽）——————
// conversation 维度一行（单槽覆盖，spec #277「双发竞态不排队」）；定向的
// claimed 步 = 拉取校验 + 旧步丢弃判定（步收尾换新步后 pending 不可复活）。
export const steerPending = sqliteTable('steer_pending', {
  /** ≡ conversationId ≡ buildId（单槽键）。 */
  conversationId: text('conversationId').primaryKey(),
  /** 定向的 claimed 步（拉取-确认的校验位）。 */
  stepId: text('stepId').notNull(),
  content: text('content').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

// —— stop_pending（M7 #308：停止钮中断请求单槽，steer_pending 同形）——————
// conversation 维度一行（双 stop 覆盖）；定向的 claimed 步 = 拉取校验 +
// 旧步丢弃判定。discard = 确认弹层「丢弃本轮修改」勾选位（r9 §3.3，
// daemon 侧 rewind worktree 到步起点 checkpoint）。
export const stopPending = sqliteTable('stop_pending', {
  /** ≡ conversationId ≡ buildId（单槽键）。 */
  conversationId: text('conversationId').primaryKey(),
  /** 定向的 claimed 步（拉取-确认的校验位）。 */
  stepId: text('stepId').notNull(),
  discard: bool('discard').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

// —— plan（build facet：plan 即文件 plan.md，版本 = 文件版本，02 §4.2/r5 §4）————
export const plan = sqliteTable('plan', {
  /** = build.planDocId（documents/{id}/diff 的 {id} 同值）。 */
  id: text('id').primaryKey(),
  buildId: text('buildId')
    .notNull()
    .references(() => build.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  /** [内部] plan.md 文件内容（diff 端点源，r5 §4 文件级 unified diff）。 */
  content: text('content').notNull().default(''),
  /** [内部] 上传该版的步（#1026 幂等键「步+内容」的步半）：同一恢复重传不落
   * 重复版本、换步重规划同文照落新版本。存量行 null = 不参与去重（升级窗口
   * 按旧语义放行新版本）。wire 投影不含本列（planRecordSchema 不动）。 */
  stepId: text('stepId'),
  createdAt: epochMs('createdAt').notNull(),
});

// —— schedule（02 §6.2/§9.2；cron 闭环 = services/schedules + scheduler）——————
export const schedule = sqliteTable('schedule', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  projectId: text('projectId').notNull(),
  todoId: text('todoId').notNull(),
  kind: text('kind').$type<'once' | 'hourly' | 'daily' | 'weekly'>().notNull(),
  at: epochMs('at'),
  tz: text('tz').notNull(),
  nextRunAt: epochMs('nextRunAt'),
  createdBy: text('createdBy').notNull(),
});

// —— notification（02 §9.1 三事件矩阵 r5 §7.2；SSE 事件面 = services/notifications.ts）——
export const notification = sqliteTable('notification', {
  /** 组合键 `"<userId>:<entityId>"`（r5 §7.2 原样）。 */
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  userId: text('userId').notNull(),
  type: text('type')
    .$type<'plan_ready' | 'build_review' | 'chief_message' | 'quota_wait' | 'model_fallback'>()
    .notNull(),
  entityId: text('entityId').notNull(),
  entityRef: json<{ title: string; projectId: string | null; seqNum: number | null }>(
    'entityRef',
  ).notNull(),
  agentName: text('agentName').notNull(),
  agentAvatarUrl: text('agentAvatarUrl'),
  snippet: text('snippet'),
  readAt: epochMs('readAt'),
  createdAt: epochMs('createdAt').notNull(),
  channels: json<['in_app']>('channels').notNull().default(['in_app']),
});

// —— agent（02 §6.2；关联面 = JSON 列（01 §6 表注「关联表」在锁定 24+1 表清单内
// 无独立表位，DB_TABLES 单源不扩）；成员/端点面归 M2b+）————————————————————
export const agent = sqliteTable(
  'agent',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    displayName: text('displayName').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    avatarUrl: text('avatarUrl'),
    provider: text('provider'),
    modelId: text('modelId'),
    thinkingLevel: text('thinkingLevel'),
    /** persona 角色位（#1250 / ADR 0018 决策 0）：seeded 角色 agent 的身份键
     *  ——幂等键（ensurePersonasSeeded 按本列查重）+ fan-out 三视角解析 +
     *  web 指派面默认槽位。null = 普通 agent。唯一性 = (teamId, persona)
     *  partial unique index（一队一角色，fan-out 查重确定性）；词表单源 =
     *  shared records/agent.ts PERSONA_ROLES，写侧 zod 闸（personaRoleSchema）。 */
    persona: text('persona').$type<PersonaRole | null>(),
    /** 归属机（#1259）：该 agent 的步只投这台机器——创建必填。 */
    machineId: text('machineId').references(() => machine.id),
    tools: json<string[]>('tools').notNull().default(sql`'[]'`),
    secrets: json<string[]>('secrets').notNull().default(sql`'[]'`),
    /** 默认携带技能（#1169）：单值，可空——旧 skills 列拆出的「skills[0] 单值」半边。 */
    defaultSkill: text('defaultSkill'),
    /** 授权白名单（#1169）：可空 json——null = 不限制（创建缺省，本票默认语义），
     * 数组 = 白名单（#917 deny），[] = 显式全拒（有意选择）。旧 skills 列的
     * 授权半边；notNull + default '[]' 的旧形随迁移退役（[] 行已迁 null）。 */
    skillsAllowlist: json<string[]>('skillsAllowlist'),
    mcpServers: json<string[]>('mcpServers').notNull().default(sql`'[]'`),
    /** agent 级并发上限（#1138）：该 Agent 名下同时执行的 worker 步数 N。
     * NULL = 不限（缺省——存量行与未设置的新建行同值，不强制默认值；只对
     * 显式设置的 Agent 生效）。消费面 = claim 候选级闸（machines.ts tryClaim
     * 在 agentForStep 之后按 agent 计数 gate）+ PATCH 写位（值域 1..50，与
     * Multica agent 层闸同区间，r10 §5.4）。机器 maxConcurrent 是机器面容量
     * 闸，本列是 agent 面公平性闸——两层各自 gate（合成 = min 的自然结果）。
     *  chief 步同占本闸（#1260：chief 步经 chiefThread→chief.agentId 归账绑定 Agent）。 */
    maxConcurrentTasks: integer('maxConcurrentTasks'),
    /** 能力要求声明（#1251 / ADR 0018 决策 4.2）：该 Agent 的步对执行机的
     *  能力要求（MCP slug 集 / claude-code 模型 id 集）。NULL = 无要求（缺省/
     *  存量行——闸恒开，零回归）。消费面 = dispatch-eligibility 能力闸
     *  （claim/sweep/排队投影/machine-fit 四处单源）。JSON 列（tools 同形）。 */
    requiredCapabilities: json<RequiredCapabilities | null>('requiredCapabilities'),
    /** 降级链（#1493）：有序备选模型（上限 5，写侧 zod 闸 fallbackModelsSchema）。
     *  NULL = 不降级（缺省/存量行——行为不变）。消费面 = machines.ts finishStep
     *  的降级分支（services/model-fallback.ts）。 */
    fallbackModels: json<ModelRef[] | null>('fallbackModels'),
  },
  (t) => [
    // (teamId, persona) partial unique（#1250）：一队一角色——fan-out 与
    // seeding 的查重确定性；普通 agent（persona null）不受约束。
    uniqueIndex('agent_team_persona_unique')
      .on(t.teamId, t.persona)
      .where(sql`${t.persona} is not null`),
  ],
);

// —— agent_memory（02 §4.4/r5 §6：配额 100 + 三级溯源；写路径归 M4）———————————
export const agentMemory = sqliteTable('agent_memory', {
  id: text('id').primaryKey(),
  agentId: text('agentId').notNull(),
  teamId: text('teamId').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  projectId: text('projectId'),
  sourceTodoId: text('sourceTodoId'),
  sourceBuildId: text('sourceBuildId'),
  createdAt: epochMs('createdAt').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
});

// skill 表已退役（spec 13 #367）：技能 = 本地目录现扫只读投影，不入库——
// drop migration 前旧行导出到 <home>/legacy-export-<ts>.json（db/legacy-export.ts）。

// —— mcp_server：已随 spec 13（#368）撤除——MCP 面改本地 `~/.claude.json`
// 只读制（server 投影 services/mcp-servers.ts，daemon 执行面解析
// backend/mcp-config.ts），无表位；旧行经 db/legacy-export.ts 导出后由
// migration drop。

// —— skill_audit（XMON-109 S1）：技能写审计行。REST（member）/ worker
// relay（agent，开关执法面）/ chief relay（绑定 agent 或 member）三入口
// 同表；只写不读出 wire（INTERNAL_ONLY_TABLES 登记）。actorType 词 =
// 'member' | 'agent'，action 词 = 'create' | 'update'，bytes = 本次写面
// 落盘内容字节数（列出文件 content 之和）。
export const skillAudit = sqliteTable('skill_audit', {
  id: text('id').primaryKey(),
  skillId: text('skillId').notNull(),
  actorType: text('actorType').notNull(),
  actorId: text('actorId').notNull(),
  action: text('action').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

// —— provider（38 presets + custom，02 §6.2；apiKey 密文经 SecretBox，02 §8）——————
export const provider = sqliteTable('provider', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  kind: text('kind').notNull().default('custom'),
  providerId: text('providerId').notNull(),
  label: text('label').notNull(),
  baseUrl: text('baseUrl').notNull(),
  api: text('api').$type<ProviderApi>().notNull(),
  authHeader: bool('authHeader').notNull().default(true),
  compat: json<ProviderCompat>('compat').notNull(),
  models: json<ProviderModel[]>('models').notNull().default(sql`'[]'`),
  /** [内部] SecretBox 信封（v1 头 + iv + ciphertext + authTag，01 §4.2）；只写不读（02 §8）。 */
  apiKeyCipher: text('apiKeyCipher'),
  createdBy: text('createdBy').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
});

// —— secret（值密文经 SecretBox，只写不读，02 §8；服务面 = services/secrets.ts）————
export const secret = sqliteTable('secret', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  name: text('name').notNull(),
  description: text('description'),
  /** [内部] SecretBox 信封；GET 永不返回值（02 §8 API 面纪律）。 */
  valueCipher: text('valueCipher'),
});

// —— api_key（哈希 + 白名单，02 §6.2/§8；存哈希不存可逆值 [设计]）————————————————
export const apiKey = sqliteTable('api_key', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  name: text('name'),
  gitAccess: bool('gitAccess').notNull().default(false),
  mcpAccess: bool('mcpAccess').notNull().default(false),
  toolGrants: json<{ read: string[]; write: string[] }>('toolGrants').notNull(),
  /** [内部] key 哈希（登录校验只需匹配，02 §8）。 */
  keyHash: text('keyHash').notNull(),
  /** [内部] 列表行掩码（`cairn_afe07565…`；展示规则 r3 §6，前缀随品牌槽）。 */
  masked: text('masked').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

// —— webhook_token（#1137 GitHub webhook 入口的路径 token；api_key 同族：
// 存哈希不存可逆值 + 行掩码，多 lastUsedAt 请求段追踪位）———————————————————
export const webhookToken = sqliteTable(
  'webhook_token',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    name: text('name'),
    /** [内部] token 哈希（receiver 按路径段反查，hashCredential 同族）。 */
    tokenHash: text('tokenHash').notNull(),
    /** [内部] 列表行掩码（maskApiKey 同规则）。 */
    masked: text('masked').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    /** 最近一次 receiver 命中时刻（请求段追踪位；null = 从未投递）。 */
    lastUsedAt: epochMs('lastUsedAt'),
  },
  (t) => [uniqueIndex('webhook_token_tokenHash_unique').on(t.tokenHash)],
);

// —— machine（02 §6.2 + presence 状态，02 §1.2；token 存哈希 02 §8；接入面归 M3）———
export const machine = sqliteTable('machine', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  name: text('name').notNull(),
  online: bool('online').notNull().default(false),
  /** [内部] 机器 token 哈希（64hex 原文不落库，02 §8）。 */
  tokenHash: text('tokenHash'),
  /** [内部] 注册用 API key（重注册复用同一 machineId = 按 key/team 认机器，
   * r3 §1.2 实测 + [推断]）。 */
  apiKeyId: text('apiKeyId'),
  latestCliVersion: text('latestCliVersion'),
  /** 本机 vs 接入机（spec 11 A9，#357）：seed / hostname 匹配 enroll 落
   * 'local'；值域钉 shared machineRecordSchema.kind。 */
  kind: text('kind').notNull().default('remote'),
  /** per-runtime 开关态（spec 11 A9）：MACHINE_RUNTIMES 词表子集。#682 起是
   * claim 真闸（机器未开的 runtime，步不投给该机）；服务面写路径（seed /
   * enroll）缺省 `['pi']`（bootstrap 不空转），存量 `[]` 行由 0022 回填
   * `['pi']`。JSON 列（chief.watches 同形）。 */
  enabledRuntimes: json<string[]>('enabledRuntimes').notNull().default(sql`'[]'`),
  /** 机器层 shell 访问闸（XMON-108 R1）：默认 false，存量行 migration 回填。
   * 与 agent 层「远程 shell」开关双闸齐开才有 remote_shell（claim localTools
   * 组装 + 每命令预检复核本列）。 */
  shellEnabled: bool('shellEnabled').notNull().default(false),
  /** 本机 claude-code 模型上报（#707）：daemon 读本机 settings.json 经
   * enroll/presence 上行，server 按机器聚合进 model-sources。null = 从未
   * 上报过（旧 daemon），封套缺席该机、不下发假清单。JSON 列（chief.watches
   * 同形）。 */
  claudeCodeReport: json<ClaudeCodeReport | null>('claudeCodeReport'),
  /** 机器并发上限（#1108）：该机同时执行的步数 N。NOT NULL 默认 3（0000
   * migration 历史值同数，#503 曾摘列——摘除前提「daemon 串行永不触顶」
   * 随本列回归并被 daemon 并行循环作废）。消费面 = claim 闸（machines.ts
   * tryClaim 数本机 claimed 步）+ daemon 本地闸（GET me 读数）+ 机器页
   * `执行中 n/N` 读标注与 PATCH 写位。 */
  maxConcurrent: integer('maxConcurrent').notNull().default(3),
  /** #1241：用户是否写过并发数。true = 心跳不再用推荐值覆盖 maxConcurrent。
   *  存量行回填 false（继续吃推荐值，缺指纹时推荐值就是本列默认 3）。 */
  maxConcurrentOverridden: bool('maxConcurrentOverridden').notNull().default(false),
  /** 最近一次 presence 心跳时刻（#1136）：markPresence 每拍覆写，陈旧判定
   * （sweepStaleMachines）的第二真值源——online 的第一翻转源 SSE abort
   * 抓不住静默死机（无 FIN）。NULL = 从未走过新 markPresence（升级前
   * 存量行）：无数据不判，下一拍 presence（≤30s）补齐，绝不当场翻
   * offline。 */
  lastSeenAt: epochMs('lastSeenAt'),
  /** 机器能力清单（#1251 / ADR 0018 决策 4.1）：daemon 经 enroll/presence
   *  上报的已装 MCP slug 集 + 本机技能名集。NULL = 从未上报（老 daemon——
   *  能力闸对未知快照放行，显示面标「未上报」）。字段级容错在写路径
   *  （markPresence/enrollMachine 单独 safeParse，坏字段丢弃保留旧值——
   *  心跳红线 02 §5.4）。JSON 列（claudeCodeReport 同形）。 */
  capabilities: json<MachineCapabilities | null>('capabilities'),
});

// —— shell_command（XMON-108 R1 机器 shell 审计）：预检/回写两写端点的
// 审计行（02 §8「每次取用都会留下记录」纪律的 shell 同族）。无 FK——审计
// 历史独立于 machine/agent/step 行的存废（branch_sync 是活状态表带 FK；本表
// 是历史账，行终态后永不再改写）。状态机：denied（预检拒绝，插入即终态——
// 未授权命令从未跑过）/ running（预检放行，先于执行落库）→ done | failed
// （daemon 回写，终态只写一次；重复回写幂等不改行）。卡 running 的兜底口径
// （daemon 崩溃未回写）：行保持 running 原样——结局未知本身就是审计事实，
// 步级 done/failed 提供外层结局，不做 TTL 回收改写。 ————————————————
export const shellCommand = sqliteTable('shell_command', {
  /** = 预检响应 runId（recordId 形，结果回写键）。 */
  id: text('id').primaryKey(),
  stepId: text('stepId').notNull(),
  machineId: text('machineId').notNull(),
  agentId: text('agentId').notNull(),
  teamId: text('teamId').notNull(),
  /** 预检上行的命令原文（daemon 发什么记什么，不截断）。 */
  command: text('command').notNull(),
  status: text('status').$type<'denied' | 'running' | 'done' | 'failed'>().notNull(),
  /** done 形可空 = daemon 拿不到退出码；denied/running = null。 */
  exitCode: integer('exitCode'),
  /** 截断后的命令输出（上限 = shared SHELL_OUTPUT_CHAR_LIMIT）。 */
  output: text('output'),
  /** failed 形的失败原因（超时杀等；上限 2000 字符）。 */
  errorMessage: text('errorMessage'),
  createdAt: epochMs('createdAt').notNull(),
  /** 终态时刻（denied = 插入时刻）。 */
  finishedAt: epochMs('finishedAt'),
});

// —— token_usage（build × model 四维计数，02 §6.2/r3 §3.8；记账归 M3。成本五
// 列 = #927：pi 报的 USD 成本按 per-message usage 累积，real 列——pi
// calculateCost 产物是小数；无价格来源的行恒 0）———————————
export const tokenUsage = sqliteTable(
  'token_usage',
  {
    buildId: text('buildId').notNull(),
    /** `<provider>/<modelId>` 串（r3 §1.5）。 */
    model: text('model').notNull(),
    input: integer('input').notNull().default(0),
    output: integer('output').notNull().default(0),
    cacheRead: integer('cacheRead').notNull().default(0),
    cacheWrite: integer('cacheWrite').notNull().default(0),
    costInput: real('costInput').notNull().default(0),
    costOutput: real('costOutput').notNull().default(0),
    costCacheRead: real('costCacheRead').notNull().default(0),
    costCacheWrite: real('costCacheWrite').notNull().default(0),
    costTotal: real('costTotal').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.buildId, t.model] })],
);

// —— chief（02 §4.3/r5 §3.6 GET /chief 的 chief 记录本体；M4a 回写 01 §6：
// 原锁定清单仅列线程面两表，chief 记录——绑定 Agent/charter/watches/wakes——
// 无表位。watches/wakes 为 per-chief 小数组，随记录存 JSON 列 [设计]，
// 与 GET /chief 响应封套同形，不另立表）—————————————————————————————————
export const chief = sqliteTable('chief', {
  /** `chief-<userId>-<teamId>`（records/chief.ts chiefIdFormat，r5 §3.6）。 */
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  /** 绑定 Agent id（PATCH /chief + 二次确认，记忆不迁移告示，r5 §2）；未绑定
   *  null。#1260：chief = 名册里的普通 agent——步的去处（归属机）、模型、
   *  思考强度、并发槽全部取绑定 Agent 自身配置，chief 行不再持覆盖槽。 */
  agentId: text('agentId'),
  /** 章程 = 常设指示（r5 §2 章程 tab；raw 默认空串）。 */
  charter: text('charter').notNull().default(''),
  /** watch 条目集（records/chief.ts chiefWatchSchema[]；派工即建、settle/failed
   * 自动解除，r5 §3.5）；JSON 列 [设计]。 */
  watches: json<ChiefWatch[]>('watches').notNull().default(sql`'[]'`),
  /** wakes[] 非空形态未实测（r5 §10：set_wake 实走遗留）[推断]，开放条目。 */
  wakes: json<Record<string, unknown>[]>('wakes').notNull().default(sql`'[]'`),
  lastTurnAt: epochMs('lastTurnAt'),
  createdAt: epochMs('createdAt').notNull(),
  /** 用户时区（raw chief-record-testA.json 一手 tz）。 */
  tz: text('tz'),
});

// —— chief_thread（02 §4.3/r5 §3.6 线程面；Chief 编排归 M4）————————————————————
export const chiefThread = sqliteTable('chief_thread', {
  /** `chief-<uuid>`（UUIDv7，conversation 名同值）。 */
  id: text('id').primaryKey(),
  /** `chief-<userId>-<teamId>`（records/chief.ts chiefIdFormat）。 */
  chiefId: text('chiefId').notNull(),
  userId: text('userId').notNull(),
  teamId: text('teamId').notNull(),
  title: text('title').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
  lastTurnAt: epochMs('lastTurnAt'),
  sessionRuntime: text('sessionRuntime').notNull().default('pi'),
  sessionId: text('sessionId').notNull(),
  sessionOpenedAt: epochMs('sessionOpenedAt').notNull(),
  pendingSessionResumeAt: epochMs('pendingSessionResumeAt'),
  toolDefHashes: json<Record<string, string>>('toolDefHashes').notNull().default(sql`'{}'`),
  toolResultHashes: json<Record<string, string>>('toolResultHashes').notNull().default(sql`'{}'`),
  activeRun: json<ActiveRun>('activeRun'),
});

// —— chief_message（records/message.ts 同族 role/content 形状，r5 §3.6）————————————
export const chiefMessage = sqliteTable('chief_message', {
  id: text('id').primaryKey(),
  threadId: text('threadId')
    .notNull()
    .references(() => chiefThread.id, { onDelete: 'cascade' }),
  role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
  content: json<unknown>('content').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

// —— whats_new（形状保留、内容自选，02 §6.1 [设计]）————————————————————————————
export const whatsNew = sqliteTable('whats_new', {
  id: text('id').primaryKey(),
  body: json<Record<string, unknown>>('body').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

// —— attachment（#310，r9 §3.1/§4）：附件上传存储面，wire 形状从 grant 落 key
// 起的全过程——DB 行 status 漂移 pending → ready；content/spec 内嵌 markdown
// `attachment:<storageKey>` 解析走 read 端；scope = spec（新建任务描述）|
// message（chat composer）。MIME 白名单在 services/attachments.ts 守门，
// 单文件 ≤10MiB。团队归属校验贯穿 grant/upload/read/工具四关。—————
export const attachment = sqliteTable('attachment', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  /** 创建者用户 id；chief 派工 agent 路径未至，无 chiefAgentId 槽。 */
  createdBy: text('createdBy').notNull(),
  fileName: text('fileName').notNull(),
  mimeType: text('mimeType').notNull(),
  sizeBytes: integer('sizeBytes').notNull(),
  /** 相对 `<attachmentsDir>/<storageKey>`；layout = `<teamId>/<id>.<ext>`。 */
  storageKey: text('storageKey').notNull(),
  /** grant 端与上传端的串联位（HMAC 签名内含,upload 时回查一致）。 */
  grantId: text('grantId').notNull(),
  scope: text('scope').$type<'spec' | 'message'>().notNull(),
  /** pending = grant 落库未上传；ready = 文件落盘；failed = 上传过程报错。 */
  status: text('status').$type<'pending' | 'ready' | 'failed'>().notNull().default('pending'),
  createdAt: epochMs('createdAt').notNull(),
});

// —— github_connection（spec 12 / #359，#352 族）：GitHub OAuth 连接行 ——————
// teamId 单行（重认证 = 覆盖、断开 = 删行；DAO = services/github-connection.ts）。
// accessToken 经 SecretBox 密封落 accessTokenCipher（[内部] 列，provider.
// apiKeyCipher 同族纪律 02 §8：只写不读出 wire——唯一消费点 = server 出站边界
// Authorization 头（repos 代理）与 daemon 执行凭证下发（spec 12 G2-T2），
// never 落 argv / log / plaintext 列）。连接状态读面（login/scope）内嵌认证面
// 端点封套（spec 12 G2-T4），不立 record 投影（INTERNAL_ONLY_TABLES）。
export const githubConnection = sqliteTable('github_connection', {
  teamId: text('teamId')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  /** GitHub 登录名（OAuth 令牌面 `GET /user` login；picker 展示位）。 */
  login: text('login').notNull(),
  /** [内部] SecretBox 信封（v1 头 + iv + ciphertext + authTag，01 §4.2）。 */
  accessTokenCipher: text('accessTokenCipher').notNull(),
  /** 授权 scope 串（空格分隔，`repo` 位 = spec 12 GitHub 执行面前提）。 */
  scope: text('scope').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

// —— 合并就绪闸（#1404 P3，ADR 0021 D1–D4，spec 28 P3）的 server 独占四表 ——————
// 判定不再从 message 行读：机器的 transcript 上传接受任意 role 与内容、调用方
// 自定 id，冲突即覆盖，机器能伪造。四表只由 server 的闸代码写（S5a 起），机器
// 回传路径（routes-machine.ts、services/machine*.ts）不写。全部挂 build 级联：
// 删构建（重置、删任务、删项目三条现有路径）带走闸行，不留孤儿也不挡删除。
// 闸行只该随构建删除。drizzle 在一个事务里跑迁移，PRAGMA foreign_keys=OFF 在事务
// 里不生效，故此后按 drizzle 形状重建 build（或经 build.todoId 级联的 todo）的迁移，
// DROP TABLE 的隐式删行会清空四表：那条迁移须先把闸行挪开再写回
// （merge-gate-tables.test.ts F19 跑本迁移之后的全部迁移查这一点）。
// 列形取自 S1（packages/shared/src/records/merge-gate.ts、
// services/merge-gate/digest.ts）与 S2（services/merge-gate/readiness.ts）；schema
// 不 import 闸代码，词表以 $type 字面量照抄，各列注明对应的 S1/S2 类型。值域不设 CHECK：
// 词表随 S5a–S8 增长时不必重建表。内部表，无 wire record（INTERNAL_ONLY_TABLES）。

/** S2 GateVerdictView['kind']。 */
type GateVerdictKind = 'review' | 'verify' | 'decision';
/** S2 GateVerdictView['outcome']。 */
type GateVerdictOutcome =
  | 'pass'
  | 'block'
  | 'extraction_failed'
  | 'step_failed'
  | 'tampered'
  | 'unbound'
  | 'evidence_invalid';
/** S1 MergePolicy（MERGE_POLICIES）。 */
type GatePolicy = 'human' | 'shadow' | 'autonomous';
/** S2 MergeBlocker（mergeBlockerSchema）：code 取 MERGE_BLOCKERS 的码，class 取
 * BLOCKER_CLASSES；detail 是 readiness 写好的名单（名字已转义、有长度与条数上限）。 */
interface GateBlockerRow {
  code: string;
  class: 'policy' | 'transient' | 'human';
  label: string;
  detail: string[];
}
/** gate_round.state（S7 的轮次协调持有）：open = 在收判定或等 chief；fixing =
 * 本补丁的 [review-fix] 步已派；fix_no_change = 该修复步收尾而摘要没变（S2
 * round.fixNoChange）；closed = 已决、已被新补丁取代或已交给人。 */
type GateRoundState = 'open' | 'fixing' | 'fix_no_change' | 'closed';
/** gate_round.dispatches 的值：某 (kind, 视角) 在本摘要上派过几次、最近一次的
 * 时刻（GATE_LIMITS.perspectiveRetries 与 perspectiveDeadlineMs 按它判）。 */
interface GateRoundDispatch {
  count: number;
  lastAt: number;
}

// gate_digest：构建的 PR 在某个 head 上的补丁摘要（S1 computePatchDigest 的结果，
// 只在摘要可得时落行；不可得时 gate_state 的快照带 patchDigest null 与对应 blocker）。
// 每 (buildId, headSha) 一行；update-branch 后新 head 同摘要另落一行。摘要按三点
// compare {base}...{head} 算，merge-base 一变（PR 改了 base 分支）同一 head 也会得出
// 新摘要，故写入方按主键覆盖本行，不把旧行当成新 compare 的结果。
export const gateDigest = sqliteTable(
  'gate_digest',
  {
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    /** compare {base}...{headSha} 的 head，40 位小写 hex。 */
    headSha: text('headSha').notNull(),
    /** S1 PatchDigestResult.patchDigest（非 null）：`<版本>:<sha256 hex>`，前缀 =
     * PATCH_DIGEST_VERSION（S1 现为 pd2），算法一改前缀即变。 */
    patchDigest: text('patchDigest').notNull(),
    /** S1 PatchDigestResult.countedFiles：整张补丁的文件数，含证据，改名记两个
     * （D4 的 40 文件上限）。 */
    countedFiles: integer('countedFiles').notNull(),
    /** S1 PatchDigestResult.countedLines：整张补丁的增删行数，含证据（D4 的 800 行上限）。 */
    countedLines: integer('countedLines').notNull(),
    /** S1 PatchDigestResult.kept.length：进摘要的条目数（docs/verify/ 之外）。 */
    keptFiles: integer('keptFiles').notNull(),
    /** S1 PatchDigestResult.kept 的 additions + deletions 之和。 */
    keptLines: integer('keptLines').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [primaryKey({ columns: [t.buildId, t.headSha] })],
);

// gate_round：每 (buildId, patchDigest) 一轮（S7）。补丁改回旧摘要时沿用旧轮，判定
// 仍绑在那份补丁上。round 是轮在构建内的序号，(buildId, round) 唯一，GATE_LIMITS.
// roundsMax 按它数；fixRound 记本补丁出自第几个 [review-fix] 轮，fixRoundsMax 按它数。
export const gateRound = sqliteTable(
  'gate_round',
  {
    id: text('id').primaryKey(),
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    /** 同 gate_digest.patchDigest（S1 PatchDigestResult.patchDigest，非 null）。 */
    patchDigest: text('patchDigest').notNull(),
    /** 构建内第几轮，从 1 起（S2 round.gateRoundsExhausted 的计数）。 */
    round: integer('round').notNull(),
    /** 本补丁出自第几个 [review-fix] 轮；0 = 不是修复轮的产物（S2
     * round.fixRoundsExhausted 的计数）。 */
    fixRound: integer('fixRound').notNull().default(0),
    state: text('state').$type<GateRoundState>().notNull().default('open'),
    /** S2 round.perspectives：建轮时冻结的审核视角。 */
    perspectives: json<string[]>('perspectives').notNull(),
    /** S2 round.timedOut：超时且重试用完的视角。 */
    timedOut: json<string[]>('timedOut').notNull().default(sql`'[]'`),
    /** 派步计数，键 = `<kind>` 或 `<kind>:<视角>`（按 (kind, 视角, 摘要) 封顶，摘要即本行）。 */
    dispatches: json<Record<string, GateRoundDispatch>>('dispatches').notNull().default(sql`'{}'`),
    startedAt: epochMs('startedAt').notNull(),
  },
  (t) => [
    uniqueIndex('gate_round_build_digest_unique').on(t.buildId, t.patchDigest),
    uniqueIndex('gate_round_build_round_unique').on(t.buildId, t.round),
  ],
);

// gate_verdict：一步一条判定（S2 GateVerdictView 的来源）。stepId 是主键但不设外键
// （同 plan / steer_pending / stop_pending 的 stepId）：步 id 由派步的 server 闸代码
// 写入；外键带级联时，删一步（构建还在）会悄悄抹掉记下的 block / tampered 判定，
// 此后按 drizzle 形状重建 step 的迁移也会经 DROP TABLE step 清空本表（F17/F18）。
// chief 小合并步的 step.buildId 是 chief 线程，故被审构建另记 buildId（外键到
// build，判定随构建删除）。
export const gateVerdict = sqliteTable(
  'gate_verdict',
  {
    stepId: text('stepId').primaryKey(),
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<GateVerdictKind>().notNull(),
    /** S2 GateVerdictView['perspective']：审核视角；verify 为 null，chief 为 'chief'。 */
    perspective: text('perspective'),
    outcome: text('outcome').$type<GateVerdictOutcome>().notNull(),
    /** S2 GateVerdictView['patchDigest']：本判定计入的摘要；null = 判定的 head
     * 与 expectedHeadSha 对不上，不计入任何摘要。 */
    patchDigest: text('patchDigest'),
    /** 判定自报的 head（spec 28 P3：判定带 headSha，摘要按它现算）；null = 没报
     * （提取失败、步失败）。 */
    headSha: text('headSha'),
    /** server 派步时写下的 head；判定只在两者一致时绑定摘要。 */
    expectedHeadSha: text('expectedHeadSha').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [index('gate_verdict_buildId_idx').on(t.buildId)],
);

// gate_state：每构建最新一份 readiness 快照（S2 MergeReadiness，S6a 起写），任务
// 详情页、chief 工具与 status 同源读它。
export const gateState = sqliteTable('gate_state', {
  buildId: text('buildId')
    .primaryKey()
    .references(() => build.id, { onDelete: 'cascade' }),
  /** MergeReadiness.ready（⇔ blockers 为空）。 */
  ready: bool('ready').notNull(),
  /** MergeReadiness.headSha；null = 读不到 PR。 */
  headSha: text('headSha'),
  /** MergeReadiness.patchDigest；null = 摘要不可得。 */
  patchDigest: text('patchDigest'),
  policy: text('policy').$type<GatePolicy>().notNull(),
  /** MergeReadiness.blockers，按 MERGE_BLOCKERS 的固定顺序。 */
  blockers: json<GateBlockerRow[]>('blockers').notNull(),
  evaluatedAt: epochMs('evaluatedAt').notNull(),
});

// —— #1491 后台自动任务触发闸 ——————————————————————————————————————————————

// autonomy_state：每 (项目, 任务种类) 一行。lastStartedAt 供冷却，baselineSha
// 供休眠（上次开跑时 main 的头），lastBlockedReason 供设置页显示。
export const autonomyState = sqliteTable(
  'autonomy_state',
  {
    projectId: text('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AutonomyKind>().notNull(),
    lastStartedAt: epochMs('lastStartedAt'),
    /** 上次开跑时 main 的头；null = 不用休眠闸的任务，或没读到。 */
    baselineSha: text('baselineSha'),
    /** 最近一次判定被拦的原因；null = 最近一次放行。 */
    lastBlockedReason: text('lastBlockedReason').$type<AutonomyGateReason | null>(),
    lastEvaluatedAt: epochMs('lastEvaluatedAt'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.kind] })],
);

// member_activity：人（board 上的成员，经 /api/ 鉴权面发的写请求）最近一次写
// 操作的时刻。agent 走 /api/mcp、机器走 /api/machine、webhook 走 /api/webhook，
// 都不记。scope 眼下只有 'server' 一行（本实例上任何项目的写操作都算）。
export const memberActivity = sqliteTable('member_activity', {
  scope: text('scope').primaryKey(),
  at: epochMs('at').notNull(),
});

export const buildFeedback = sqliteTable(
  'build_feedback',
  {
    id: text('id').primaryKey(),
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'revision' | 'restart'>().notNull(),
    side: text('side').$type<'plan' | 'build'>().notNull(),
    feedback: text('feedback').notNull(),
    actor: text('actor').notNull(),
    stepId: text('stepId'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [index('build_feedback_buildId_idx').on(t.buildId)],
);
