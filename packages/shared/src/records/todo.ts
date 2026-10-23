// todo record——02 §4.1/§6.2 canonical：字段其余形状照抄 r3 §3.0
// （phaseAt/seqNum/orderIndex/tagIds/spec/assignment/agent/latestBuildId/
// lastRunAt/hasChanges/hasPlan/buildHistory/sourceTodo/v）；r5 §3.2 SSE todo
// 全文档补录溯源三字段（createdBy/ownerId/sourceBuildId）。

import { z } from 'zod';
import { CHIEF_THREAD_ID_PREFIX } from './chief.js';
import { epochMs, phaseSchema, recordId } from './common.js';
import { parseGithubRepoRef } from './project.js';
// #1261 quotaWait 投影形态（step.ts 单源——等额度读面 todo/step 同形）。
import { quotaWaitSchema } from './step.js';

/** 指派槽（02 §6.2：todo.assignment 双槽 `{plan:{agentId}, build:{agentId}}`，
 * r5 §3.4/§5 实测）。槽空 = 未指派（开始 dialog Agent 可空，r3 §3.2）——
 * 槽级 null 形状 [推断]（抓包样本两槽均有值）。
 * #1250（ADR 0018 层 1）扩四步种槽位：`review` = 缺省审核人挂接位（UI
 * 指派面用——槽位管「默认谁审」，单条 review 步实际跑谁仍由其 prompt meta
 * header 决定，两层正交）；`verify` = 验证步指派位（与 plan/build 同形，
 * claim 按本槽解析 Verifier agent）。两新槽 `.nullish()`：存量双槽行（无
 * 该键）照常解析为缺省 = 未指派，加法契约零迁移。 */
export const assignmentSlotSchema = z.object({ agentId: recordId });
export const assignmentSchema = z.object({
  plan: assignmentSlotSchema.nullable(),
  build: assignmentSlotSchema.nullable(),
  review: assignmentSlotSchema.nullish(),
  verify: assignmentSlotSchema.nullish(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

/** todo 内嵌 agent 引用（r3 §3.0 `agent` 字段；字段子集 [推断]——
 * 完整 agent record 见 records/agent.ts）。 */
export const todoAgentRefSchema = z.object({
  id: recordId,
  displayName: z.string(),
});

/** 运行历史条目（r3 §3.8：`第 1 次运行 · 当前 · 43 分钟前 · 86.6k tokens`）。
 * wire 条目形状未展开采集，最小投影 {buildId, createdAt} [推断]。 */
export const buildHistoryEntrySchema = z.object({
  buildId: recordId, // buildId ≡ conversationId（CONTEXT.md/r3 §3.0）
  createdAt: epochMs,
});

/** 任务（todo record）来源种类值域（#446 / ADR 0005 D6 + #452 / ADR 0006
 * 写向 + #640 / r14 §5.3 编排来源）：任务可绑定至多一个出处。
 * - `github-issue`：任务**来自** issue（导入面，#446）——标题真值在 GitHub
 *   侧（titleFinal），不可回填覆盖；
 * - `github-issue-self`：issue **来自**任务（自派建时出站，#452）——标题真值
 *   在 cairn 侧，占位标题仍走 agent 回填并写进 issue（ADR 0006 D3）；
 *   sourceRef=null 表示「未建成」（建 issue 失败的可重试态，ADR 0006 D2）。
 * - `orchestration`：任务**来自**一次总管编排回合（#640 / r14 §5.3）——
 *   sourceRef = 编排会话 id（per-request 粒度，`chief:<uuid>` 形，
 *   orchestrationSourceRef 单源）；答「哪次请求拆的」。与 createdBy/
 *   sourceBuildId（答「谁建的」，chief 实例级）三层各答一问，不混。
 * 出现第二种外部出处（PR / CI 失败 / 外部工单）时重审形状（ADR 0005 重开
 * 触发条款）。常量取 TASK_ 前缀而非表名前缀：pre-commit 注释纪律黑名单按
 * 大写词面匹配，表名全大写形会误伤。 */
export const TASK_SOURCE_KINDS = ['github-issue', 'github-issue-self', 'orchestration'] as const;
export const todoSourceKindSchema = z.enum(TASK_SOURCE_KINDS);
export type TodoSourceKind = z.infer<typeof todoSourceKindSchema>;

/** 外部引用格式单源（#446：`github:owner/repo#123`）。写入面（server
 * import 服务）与断言面（测试）同吃，防格式串两处漂移。 */
export function githubIssueSourceRef(owner: string, repo: string, issueNumber: number): string {
  return `github:${owner}/${repo}#${issueNumber}`;
}

/** 外部引用反解单源（#452 写向：回写标题 / 只读回显按 ref 出站）。与
 * githubIssueSourceRef 严格互逆；不匹配（含 owner/repo 段带 `/` 或 `#` 的
 * 畸形值）返回 null 由调用面降级。owner/repo 段再过 parseGithubRepoRef
 * （#1466：`.` / `..` 段的存量引用同样不出站）。 */
export function parseGithubIssueSourceRef(
  ref: string,
): { owner: string; repo: string; issueNumber: number } | null {
  const m = /^github:([^/#]+\/[^/#]+)#(\d+)$/.exec(ref);
  if (m === null) return null;
  const repoRef = parseGithubRepoRef(m[1] as string);
  if (repoRef === null) return null;
  return { ...repoRef, issueNumber: Number(m[2]) };
}

/** 编排来源引用格式单源（#640 / r14 §5.3：`chief:<uuid>`——编排会话 id 的
 * per-request 粒度指针；chief 线程 id ≡ conversation id，形
 * `chief-<uuid>`，scheme 段不重复前缀故剥掉 `chief-` 只存 uuid 段）。
 * 写入面（server chief-tools create_todo）与解析面（web 详情来源面板）
 * 同吃，防格式串两处漂移（githubIssueSourceRef 同律）。 */
export function orchestrationSourceRef(threadId: string): string {
  if (!threadId.startsWith(CHIEF_THREAD_ID_PREFIX)) {
    throw new Error(`orchestrationSourceRef: not a chief thread id: ${threadId}`);
  }
  return `chief:${threadId.slice(CHIEF_THREAD_ID_PREFIX.length)}`;
}

/** 编排来源引用反解（与 orchestrationSourceRef 严格互逆）：返回完整 chief
 * 线程 id（`chief-<uuid>`）；不匹配（scheme 错 / uuid 段空）返回 null 由
 * 调用面降级。 */
export function parseOrchestrationSourceRef(ref: string): { threadId: string } | null {
  const m = /^chief:(.+)$/.exec(ref);
  if (m === null) return null;
  return { threadId: `${CHIEF_THREAD_ID_PREFIX}${m[1]}` };
}

export const todoRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId,
  title: z.string(),
  /** 结构化描述（r3 §3.1 创建表单四行占位；chief 措辞→spec 三段式见 02 §4.3）。 */
  spec: z.string(),
  phase: phaseSchema,
  phaseAt: epochMs,
  /** 看板序号 `#seqNum`（CONTEXT.md：todo 持久且带序号）。 */
  seqNum: z.number().int(),
  /** 列内排序位（01 §4.1 拖拽面：@dnd-kit 列内 orderIndex 排序）。 */
  orderIndex: z.number(),
  tagIds: z.array(recordId),
  assignment: assignmentSchema.nullable(),
  agent: todoAgentRefSchema.nullable(),
  latestBuildId: recordId.nullable(),
  lastRunAt: epochMs.nullable(),
  hasChanges: z.boolean(),
  hasPlan: z.boolean(),
  buildHistory: z.array(buildHistoryEntrySchema),
  /** 来源任务引用；语义未特写 [推断]（r3 §3.0 字段表列名照抄）。#1250（ADR
   * 0018 层 2）落地为拆父子指针：chief split_todo 建的子卡本列 = 父卡 id
   * （存量恒 null 不变）；「子全 done 父自动收」的归账键。 */
  sourceTodo: recordId.nullable(),
  /** 依赖边（#1250 / ADR 0018 层 2，blocking 语义）：阻塞本卡的兄弟子卡 id
   * 集（chief split_todo 写入）；全集 done 前本卡不可派发（startBuilds 闸）。
   * 缺省 = 无依赖（存量行/非拆卡同形）。 */
  blockedBy: z.array(recordId).nullish(),
  /** 记录版本号（r3 §3.0 观测值 2–4；SSE 文档事件带 seq/v，02 §1.2/r5 §7.2）。 */
  v: z.number().int(),
  // —— r5 §3.2 SSE todo doc 补录（chief 派工溯源）——
  /** 创建者 = 用户或 Chief 绑定 Agent id；人工建时的取值未分离观测 [推断]。 */
  createdBy: recordId.nullable(),
  ownerId: recordId.nullable(),
  /** 来源 build（chief 回合 id，形如 `chief-…`）；人工建时 null [推断]。 */
  sourceBuildId: z.string().nullable(),
  // —— #446 来源两列（ADR 0005 D6，溯源家族位；#640 扩 orchestration 档）——
  /** 来源种类（TASK_SOURCE_KINDS 注释：导入 vs 自建的方向位 + 编排来源）；
   * local 项目 / 未连接 GitHub 的项目且非总管拆出 = null（至多一个来源，
   * 两列够用）。 */
  sourceKind: todoSourceKindSchema.nullable(),
  /** 来源引用（`github:owner/repo#123` 形 = githubIssueSourceRef 单源；
   * `chief:<uuid>` 形 = orchestrationSourceRef 单源，#640）；无来源 = null。 */
  sourceRef: z.string().nullable(),
  /** #1257 板面挂起态（server 读侧派生，不落列）：在飞 todo 的当前步挂起时
   *  透出——`quota` = 等额度（retryAt = 退避到期/下次尝试时刻，null = 不适用）；
   *  `machine` = 等机器（#1259 起语义 = 归属机不在线/团队零在线）。缺席 = 未挂
   *  起（正常排队 / 在跑 / 终态）——板面据此区分「等机器/等额度」挂起态与
   *  「执行失败」红态。optional 加法契约：老 server / fixture 面缺席 = 板面
   *  无挂起 chip，零回归。 */
  waitingOn: z
    .object({
      on: z.enum(['machine', 'quota']),
      retryAt: epochMs.nullable(),
    })
    .optional(),
  /** #1261 等额度投影（读侧派生，不存列）：latest build 活动步 waiting_quota
   * 时在位——板面卡态/横幅的数据源（哪一路 relay、下次探测时刻，形态比
   * waitingOn.on='quota' 多 lane/kind/retryAfterMs 三位）。null = 无挂起；
   * 键缺席 = fixture/老 server 面（optional 加法契约，零回归）。
   * 形态单源 = records/step.ts quotaWaitSchema。 */
  quotaWait: quotaWaitSchema.nullable().optional(),
});
export type TodoRecord = z.infer<typeof todoRecordSchema>;
export type TodoWaitingOn = NonNullable<TodoRecord['waitingOn']>;

/** POST /api/projects/{id}/todos body（r3 §3.1 抓包原样 {title, spec}；
 *  tagIds 携带位 = r9 §3.4 实测（观测样本空数组），#309 补录）。 */
export const createTodoBodySchema = z.object({
  title: z.string(),
  spec: z.string(),
  tagIds: z.array(recordId).optional(),
});
export type CreateTodoBody = z.infer<typeof createTodoBodySchema>;
