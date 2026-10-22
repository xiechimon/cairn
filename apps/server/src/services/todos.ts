// todo 服务面：CRUD + record 投影（wire 形状 = shared todoRecordSchema，
// 02 §4.1/§6.2 字段即契约）+ 变更即发 team stream 文档事件（r5 §7.2 双保险
// 复刻侧：SSE 文档事件直更 + 前端重取兜底）。
// 派生字段（不存列）：tagIds（todo_tag join）、agent（assignment.build 槽 →
// agent 行）、buildHistory（build 表投影 {buildId, createdAt}，records/todo.ts
// 最小投影 [推断]）。

import type {
  Assignment,
  GithubRepoRef,
  Phase,
  SecretBox,
  TodoRecord,
  TodoSourceKind,
  UserRecord,
} from '@pacman/shared';
import {
  DONE_ANNOUNCEMENT,
  derivePlaceholderTitle,
  githubIssueSourceRef,
  IN_PROGRESS_PHASES,
  orchestrationSourceRef,
  PLACEHOLDER_TITLE_FALLBACK,
  parseGithubIssueSourceRef,
} from '@pacman/shared';
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  machine,
  message,
  plan as planTable,
  project,
  steerPending,
  step,
  stopPending,
  tag,
  todo,
  todoTag,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubCreateIssue, githubUpdateIssueTitle } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { triggerChiefWakes } from './chief.js';
import {
  agentForStep as agentForStepEligibility,
  capabilityGatePasses,
  runtimeGatePasses,
} from './dispatch-eligibility.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { githubRepoOfProject } from './git.js';
import { hasGithubConnection, openGithubToken } from './github-connection.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { notifyTodoPhase } from './notifications.js';
import { assertPhaseTransition, canManualMovePhase } from './phase.js';
import { insertGateAnnouncement } from './transcript.js';

type TodoRow = typeof todo.$inferSelect;

export interface TodoDeps {
  db: Db;
  hub: TeamStreamHub;
  /** chief wake 派发通道（triggerChiefWakes 入队即 wake，02 §5.4）。 */
  machineHub?: MachineWakeHub;
  /** 通知收件人（phase 漏斗挂 plan_ready/build_review，02 §9.1）。 */
  user: UserRecord;
  /** conversation stream 通道（#901 闸相位 done 落地审计行的 live 推送；
   * 缺省 = 只落库不推流，单测/内部流形态）。 */
  convHub?: ConversationStreamHub;
  /** GitHub 写向 deps（#452 / ADR 0006：自建 issue + 标题回写）。box =
   * github_connection token 解密位；缺省 = 写向关闭（单测/纯本地形态，
   * local 项目行为逐字节不变）。 */
  box?: SecretBox;
  /** GitHub 出站注入位（AppContext.githubFetch 同族；缺省 globalThis.fetch，
   * 测试注入 mock——零真实出站）。 */
  githubFetch?: FetchLike;
}

/** phase 漏斗的通知挂接：进 confirm/review 发 in-app 事件（r5 §7.2 矩阵；
 * done/failed 无事件照抄）+ chief watch/wake 主动回路挂接（gate/settle/failed
 * 三触发，r5 §3.5）。setTodoPhase 与 updateTodo 两路共用。 */
function notifyPhaseEntry(deps: TodoDeps, record: TodoRecord, from: Phase, to: Phase): void {
  if (from === to) return;
  if (to === 'confirm' || to === 'review') notifyTodoPhase(deps, record, to);
  triggerChiefWakes(deps, record, to);
}

export function toTodoRecord(deps: TodoDeps, row: TodoRow): TodoRecord {
  const { db } = deps;
  const tagIds = db
    .select({ tagId: todoTag.tagId })
    .from(todoTag)
    .where(eq(todoTag.todoId, row.id))
    .all()
    .map((r) => r.tagId);
  const history = db
    .select({ buildId: build.id, createdAt: build.createdAt })
    .from(build)
    .where(eq(build.todoId, row.id))
    .orderBy(asc(build.createdAt))
    .all();
  // agent = assignment.build 槽引用（开始 dialog 执行侧 Agent，r5 §3.4/§5）。
  const buildAgentId = row.assignment?.build?.agentId ?? null;
  const agentRow = buildAgentId
    ? db.select().from(agent).where(eq(agent.id, buildAgentId)).get()
    : undefined;
  // #1261 等额度投影：latest build 的活动步 waiting_quota 时在位（板面卡态/
  // 横幅数据源）。此处不 import services/quota-wait.ts（那边 apply/sweep 消费
  // 本模块 getTodo——反向即环）；行内查询 + 投影与 toQuotaWait 同形，漂移由
  // quota-wait.test W3 的读面断言钉住。
  let quotaWait: TodoRecord['quotaWait'] = null;
  if (row.latestBuildId !== null) {
    const waiting = db
      .select()
      .from(step)
      .where(and(eq(step.buildId, row.latestBuildId), eq(step.status, 'waiting_quota')))
      .all()
      .at(-1);
    const block = waiting?.quotaBlock ?? null;
    if (block !== null) {
      quotaWait = {
        kind: block.kind,
        providerId: block.providerId,
        label: block.label,
        retryAfterMs: block.retryAfterMs,
        probeAt: block.probeAt,
      };
    }
  }
  // #1257 板面挂起态（等机器/等额度）——与 quotaWait 并存（1261 板面消费
  // quotaWait，waitingOn 供后续板面挂起 chip 消费）。
  const waitingOn = waitingOnOf(deps, row);
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    title: row.title,
    spec: row.spec,
    phase: row.phase,
    phaseAt: row.phaseAt,
    seqNum: row.seqNum,
    orderIndex: row.orderIndex,
    tagIds,
    assignment: row.assignment ?? null,
    agent: agentRow ? { id: agentRow.id, displayName: agentRow.displayName } : null,
    latestBuildId: row.latestBuildId,
    lastRunAt: row.lastRunAt,
    hasChanges: row.hasChanges,
    hasPlan: row.hasPlan,
    buildHistory: history,
    sourceTodo: row.sourceTodo,
    blockedBy: row.blockedBy ?? null,
    v: row.v,
    createdBy: row.createdBy,
    ownerId: row.ownerId,
    sourceBuildId: row.sourceBuildId,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    // #1257 板面挂起态（读侧派生；缺省不带键）。
    ...(waitingOn !== undefined ? { waitingOn } : {}),
    // #1261 等额度投影（null 时也带键——web 面以 null 清态，SSE 全量文档
    // 事件需要字段在位才能把挂起态翻回去）。
    quotaWait,
  };
}

/** #1257 板面挂起态派生（等机器/等额度）：在飞 todo 的 latest build 存在
 *  pending 步且（额度挂起中 | 归属机不在/闸挡/未设 | 团队零在线）时透出；
 *  健康排队（机器在、能领，只是没轮到）与终态/未启动恒缺席——挂起 ≠ 排队
 *  ≠ 失败。读侧派生不落列：机器 presence 变化不重写 todo 行，板面新鲜度走
 *  web 侧 machine_presence → todos 失效重取（sse-team-events，#1257 补的
 *  失效键）。 */
function waitingOnOf(
  deps: TodoDeps,
  row: TodoRow,
): { on: 'machine' | 'quota'; retryAt: number | null } | undefined {
  if (!(IN_PROGRESS_PHASES as readonly string[]).includes(row.phase) || row.latestBuildId === null)
    return undefined;
  const pendingSteps = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, row.latestBuildId), eq(step.status, 'pending')))
    .all();
  if (pendingSteps.length === 0) return undefined;
  // 等额度：任一 pending 步处于 quota 挂起（退避中；到期未重领仍算挂起，
  // 重领成功即由 claim 面清位）。
  const held = pendingSteps.find((s) => s.holdReason === 'quota');
  if (held !== undefined) {
    return { on: 'quota', retryAt: held.holdUntil ?? null };
  }
  // 等机器（#1259 起语义 = 归属机）：任一 pending 步的 Agent 未设归属机、
  // 归属机行不在/离线、或在线但 runtime 闸挡本步 → 等机器；或团队零在线。
  // 归属机在线且闸开 = 正常排队（忙/将领，只是没轮到）——挂起 ≠ 排队。
  // 无 Agent 的步不判（claim 面 #1104 失败收口，本派生不重复判）。
  for (const s of pendingSteps) {
    const agentRow = agentForStepEligibility(deps.db, row, s.kind, s.prompt);
    if (agentRow === null) continue;
    // 未设归属机：任何机器都不可领——等机器（补设即解锁）。
    if (agentRow.machineId === null) {
      return { on: 'machine', retryAt: null };
    }
    const home = deps.db.select().from(machine).where(eq(machine.id, agentRow.machineId)).get();
    if (home === undefined || !home.online) {
      return { on: 'machine', retryAt: null };
    }
    if (!runtimeGatePasses(home, agentRow.provider)) {
      return { on: 'machine', retryAt: null };
    }
    // #1251：归属机在线且 runtime 闸开，但能力快照缺 Agent 声明项——机器
    // 在也领不走（claim 面 capabilityGatePasses 同判据），同为「等机器」chip
    // 态（缺项点名 + 修法文案在步队列 blocked 面，读侧单源
    // dispatch-eligibility）。
    if (!capabilityGatePasses(home, agentRow)) {
      return { on: 'machine', retryAt: null };
    }
  }
  const online = deps.db
    .select({ id: machine.id })
    .from(machine)
    .where(and(eq(machine.teamId, row.teamId), eq(machine.online, true)))
    .all();
  if (online.length === 0) {
    return { on: 'machine', retryAt: null };
  }
  return undefined;
}

function getRow(deps: TodoDeps, id: string): TodoRow | undefined {
  return deps.db.select().from(todo).where(eq(todo.id, id)).get();
}

export function listTodos(
  deps: TodoDeps,
  filter: { teamId?: string; projectId?: string } = {},
): TodoRecord[] {
  const conds = [
    filter.teamId !== undefined ? eq(todo.teamId, filter.teamId) : undefined,
    filter.projectId !== undefined ? eq(todo.projectId, filter.projectId) : undefined,
  ].filter((c) => c !== undefined);
  const rows = deps.db
    .select()
    .from(todo)
    .where(conds.length > 0 ? and(...conds) : sql`1=1`)
    .orderBy(asc(todo.seqNum))
    .all();
  return rows.map((row) => toTodoRecord(deps, row));
}

export function getTodo(deps: TodoDeps, id: string): TodoRecord | null {
  const row = getRow(deps, id);
  return row ? toTodoRecord(deps, row) : null;
}

/** POST /api/projects/{id}/todos body {title, spec}（r3 §3.1 抓包原样）+
 *  tagIds 携带位（r9 §3.4 实测，#309）。tagIds 限本项目 tag 集——界外/未知
 *  id 400（项目边界防御 [设计]，错误语义 wire 未观测）。
 *
 *  #452 / ADR 0006 写向收口（三条创建路径共用）：已连接 GitHub 的 github
 *  形态项目，任务以 `sourceKind='github-issue-self'` + `sourceRef=null`
 *  （未建成）落库，随后**关键路径之外**（fire-and-forget，返回前零 GitHub
 *  await）出站建 issue、成功补 sourceRef。导入面显式携带 sourceKind =
 *  不触发（防双 issue）；local/hosted/未连接 = 现行为逐字节不变。 */
export function createTodo(
  deps: TodoDeps,
  input: {
    teamId: string;
    projectId: string;
    title: string;
    spec: string;
    tagIds?: string[];
    /** 人工建 = seed 用户 id；Chief 派工 = 绑定 Agent id（records/todo.ts
     * 人工建取值未分离观测 [推断]，按属主用户填）。 */
    createdBy: string | null;
    ownerId: string | null;
    /** 来源两列（#446 / ADR 0005 D6）：github issue 导入面携带；其余建任
     * 路面缺省 = null（wire 形状恒在，records/todo.ts）。 */
    sourceKind?: TodoSourceKind;
    sourceRef?: string;
    /** 编排来源（#640 / r14 §5.3）：chief 回合建卡携带 = 编排会话 id 落
     * sourceKind='orchestration' + sourceRef（orchestrationSourceRef 单源，
     * 答「哪次请求拆的」）。至多一个来源：GitHub 接入项目的自建 issue 写向
     * 优先占槽（#452 出站零回归；r14 §5.7 GitHub 镜像面开放问题）。 */
    orchestration?: { threadId: string };
  },
): TodoRecord {
  const { db, hub } = deps;
  // 去重防御：重复 id 会撞 todo_tag 复合主键（wire 语义未定义重复，UI 面
  // 恒发唯一集——非 UI 客户端的健壮位 [设计]）。
  const tagIds = [...new Set(input.tagIds ?? [])];
  if (tagIds.length > 0) {
    const owned = new Set(
      db
        .select({ id: tag.id })
        .from(tag)
        .where(and(eq(tag.projectId, input.projectId), inArray(tag.id, tagIds)))
        .all()
        .map((r) => r.id),
    );
    for (const tagId of tagIds) {
      if (!owned.has(tagId)) throw new HttpError(400, `tag ${tagId} not in project`);
    }
  }
  // seqNum = 团队内持久序号（CONTEXT.md `#seqNum`；观测 #11–#14 跨项目递增，
  // 团队级计数 [推断]）。
  const seqRow = db
    .select({ n: max(todo.seqNum) })
    .from(todo)
    .where(eq(todo.teamId, input.teamId))
    .get();
  const seqNum = (seqRow?.n ?? 0) + 1;
  // orderIndex = 「待开始」列尾（列内排序位，records/todo.ts）。
  const orderRow = db
    .select({ n: max(todo.orderIndex) })
    .from(todo)
    .where(and(eq(todo.projectId, input.projectId), eq(todo.phase, 'todo')))
    .get();
  const now = nowMs();
  const id = newRecordId();
  // spec 15 #394：标题空白 = 占位标题派生（正文首个非空行 ≤50 字符，shared
  // 单源）；正式标题由执行 agent 经 set_task_meta 回填（ADR 0002 D2/D3）。
  // 全空白 spec 的兜底文案实践中不可达（web 保存闸拦空正文；chief/mcp 面
  // 恒传显式标题）。
  const title =
    input.title.trim() || derivePlaceholderTitle(input.spec) || PLACEHOLDER_TITLE_FALLBACK;
  // #452 / ADR 0006 D1/D2：自建 issue 目标判定——纯本地读（project 形态 +
  // 连接行存在性，不解密不出站），createTodo 返回前零 GitHub await（关键
  // 路径硬约束，test/github-writeback.test.ts A6 钉死）。导入面显式带
  // sourceKind = 不触发；box 缺位的 deps（纯本地单测面）= 写向关闭。
  const selfIssue =
    input.sourceKind === undefined ? planSelfIssue(deps, input.teamId, input.projectId) : null;
  db.insert(todo)
    .values({
      id,
      teamId: input.teamId,
      projectId: input.projectId,
      title,
      spec: input.spec,
      phase: 'todo',
      phaseAt: now,
      seqNum,
      orderIndex: (orderRow?.n ?? -1) + 1,
      assignment: null,
      latestBuildId: null,
      lastRunAt: null,
      hasChanges: false,
      hasPlan: false,
      sourceTodo: null,
      v: 1,
      createdBy: input.createdBy,
      ownerId: input.ownerId,
      sourceBuildId: null,
      // 自建 issue 目标（#452）：落库即「未建成」态（sourceRef=null，ADR
      // 0006 D2 状态值不新开列），异步建成后补 ref。槽位优先级单源在此：
      // 显式 sourceKind > 镜像写向 > 编排来源（#640，至多一个来源）。
      sourceKind:
        input.sourceKind ??
        (selfIssue !== null
          ? 'github-issue-self'
          : input.orchestration !== undefined
            ? 'orchestration'
            : null),
      sourceRef:
        input.sourceRef ??
        (selfIssue === null && input.orchestration !== undefined
          ? orchestrationSourceRef(input.orchestration.threadId)
          : null),
    })
    .run();
  for (const tagId of tagIds) {
    db.insert(todoTag).values({ todoId: id, tagId }).run();
  }
  const record = getTodo(deps, id);
  if (!record) throw new Error('todo missing after insert');
  hub.publishTodoDoc(input.teamId, record);
  // fire-and-forget（关键路径之外，D2 硬约束）：出站成败不影响本函数返回。
  if (selfIssue !== null) scheduleSelfIssueCreate(deps, id);
  return record;
}

/** PATCH /api/todos/{id}（[推断] REST 同名，02 §6.1 DELETE 面同规则；
 * update_todo 词表证据 r5 §3.1）。字段级 patch；任何变更 v++ 并发文档事件。 */
export function updateTodo(
  deps: TodoDeps,
  id: string,
  patch: {
    title?: string;
    spec?: string;
    phase?: Phase;
    tagIds?: string[];
    orderIndex?: number;
    /** 指派槽级 patch（#208「编辑分配」）：提供的槽覆盖，未提供的槽保持现状；
     * 槽形状 = shared assignmentSlotSchema（02 §6.2 双槽词表；#1250 扩
     * review/verify 槽——四槽同 merge 语义）。 */
    assignment?: {
      plan?: NonNullable<Assignment['plan']>;
      build?: NonNullable<Assignment['build']>;
      review?: NonNullable<Assignment['review']>;
      verify?: NonNullable<Assignment['verify']>;
    };
  },
  /** manualPhase = HTTP PATCH 面（#160 看板拖拽手动改相）：目标 ∈ 六列
   *  dropPhase 时绕过系统漏斗（phase.ts canManualMovePhase）；内部流不传。 */
  opts: { manualPhase?: boolean } = {},
): TodoRecord | null {
  const { db, hub } = deps;
  const row = getRow(deps, id);
  if (!row) return null;

  const sets: Partial<TodoRow> = {};
  if (patch.title !== undefined) sets.title = patch.title;
  if (patch.spec !== undefined) sets.spec = patch.spec;
  if (patch.orderIndex !== undefined) sets.orderIndex = patch.orderIndex;
  if (patch.assignment !== undefined) {
    // 槽级 merge：未提供的槽保持现状（字段级 patch 语义延伸）。真值 = todo 表
    // JSON 列（db/schema.ts assignment 列），agent 投影随 build 槽自动派生。
    // #1250：review/verify 槽同 merge 语义（存量行无该键 = 未指派）。
    const merged: NonNullable<TodoRow['assignment']> = {
      plan:
        patch.assignment.plan !== undefined
          ? patch.assignment.plan
          : (row.assignment?.plan ?? null),
      build:
        patch.assignment.build !== undefined
          ? patch.assignment.build
          : (row.assignment?.build ?? null),
    };
    if (patch.assignment.review !== undefined || row.assignment?.review != null) {
      merged.review =
        patch.assignment.review !== undefined
          ? patch.assignment.review
          : (row.assignment?.review ?? null);
    }
    if (patch.assignment.verify !== undefined || row.assignment?.verify != null) {
      merged.verify =
        patch.assignment.verify !== undefined
          ? patch.assignment.verify
          : (row.assignment?.verify ?? null);
    }
    sets.assignment = merged;
  }
  let manualPhaseApplied = false;
  if (patch.phase !== undefined && patch.phase !== row.phase) {
    manualPhaseApplied = opts.manualPhase === true && canManualMovePhase(row.phase, patch.phase);
    if (!manualPhaseApplied) assertPhaseTransition(row.phase, patch.phase);
    // #702：failed→review 是条件边（数据闸在 builds.ts restoreFailedReview，
    // 唯一放行点 = merge / 审核重跑动作面）。手动 PATCH 漏斗虽经边表放行该边，
    // 但 raw 改相不带数据闸（半完成 build 会被误放行）——本面拒收，恢复只走
    // 动作面（#701 同律：闸是 phase 机的一部分，不许客户端直改相位）。
    if (row.phase === 'failed' && patch.phase === 'review') {
      throw new HttpError(
        409,
        'failed 任务的审核关口恢复由合并/审核重跑动作发起（build 腿已交付时），手动改相不收',
      );
    }
    // #753：done→review = 已完成 拖回 待处理 的重开落位，要求变更产物在——
    // todos.dev 2026-10-04 live 实测：无变更的 done 卡拖拽时 待处理 列恒素面
    // （没有可供重开验收的东西）。web 面同判（columns.ts canDropOnColumn 按
    // hasChanges 收边），本闸 = raw PATCH 面的纵深防御。
    if (row.phase === 'done' && patch.phase === 'review' && !row.hasChanges) {
      throw new HttpError(409, '无变更产物的已完成任务不能拖回待处理（没有可重开验收的东西）');
    }
    sets.phase = patch.phase;
    sets.phaseAt = nowMs();
  }
  if (Object.keys(sets).length > 0) {
    sets.v = row.v + 1;
    db.update(todo).set(sets).where(eq(todo.id, id)).run();
  }
  if (patch.tagIds !== undefined) {
    db.delete(todoTag).where(eq(todoTag.todoId, id)).run();
    for (const tagId of patch.tagIds) {
      db.insert(todoTag).values({ todoId: id, tagId }).run();
    }
    if (Object.keys(sets).length === 0) {
      db.update(todo)
        .set({ v: row.v + 1 })
        .where(eq(todo.id, id))
        .run();
    }
  }

  // #901/#902：闸相位 done 落地（confirm/review → done，看板拖拽与 raw PATCH
  // 同一写面）往 todo 最新 build 会话落审计行——88% done 落地经本通道且此前
  // 零通知/零 actor/零时间线行（#892 §6 建议 2）。行的落库不依赖弹层（web
  // 确认闸只是 UI 位，raw PATCH 绕过弹层也必须有痕）。无 latestBuildId =
  // 无会话可挂：静默跳过（改相本身不变）。
  if (
    sets.phase === 'done' &&
    (row.phase === 'confirm' || row.phase === 'review') &&
    row.latestBuildId !== null
  ) {
    insertGateAnnouncement(deps, row.latestBuildId, DONE_ANNOUNCEMENT, deps.user.displayName);
  }

  const record = getTodo(deps, id);
  if (!record) return null;
  hub.publishTodoDoc(record.teamId, record);
  // 手动改相（#160 拖拽）不挂 phase 进入通知/chief wake：拖到待验收 ≠
  // 「改动就绪」，拖到已完成 ≠ 合并落地——系统漏斗流转才触发（02 §9.1）
  if (patch.phase !== undefined && !manualPhaseApplied) {
    notifyPhaseEntry(deps, record, row.phase, patch.phase);
  }
  // #1250：手动 done 落地同样触发父卡自动收口（settleSplitOnDone 注见
  // setTodoPhase 尾部——漏斗 done 与手动 done 两路都要挂）。
  if (sets.phase === 'done') settleSplitOnDone(deps, id);
  return record;
}

/** phase 流转（服务面统一入口：流转表校验 + phaseAt/v 维护 + 文档事件）。
 *  同相位幂等（XMON-59）：from === to 是已完成流转的重放（机器 done 重报 /
 *  daemon recover 重发 / MCP 批量流转重入），不是非法边——对齐 notifyPhaseEntry
 *  既有的 from === to 早退与 updateTodo 的同相位跳写，此前走 assert 抛 409 会
 *  把整条 done 收尾连同后续事件一起吞掉。无伴随位或伴随位与现值全同 = 零副
 *  作用 no-op（重放不改任何可观测状态）；伴随位有实变化 = 只落伴随位 + v（
 *  phase/phaseAt 不动）+ 文档事件。流转表严格性不动：异相位仍逐边 assert。 */
export function setTodoPhase(
  deps: TodoDeps,
  id: string,
  to: Phase,
  extra: Partial<
    Pick<TodoRow, 'hasChanges' | 'hasPlan' | 'latestBuildId' | 'lastRunAt' | 'assignment'>
  > = {},
): TodoRecord | null {
  const { db } = deps;
  const row = getRow(deps, id);
  if (!row) return null;
  if (row.phase === to) {
    const changed = (Object.keys(extra) as (keyof typeof extra)[]).filter(
      (k) => extra[k] !== undefined && JSON.stringify(extra[k]) !== JSON.stringify(row[k]),
    );
    if (changed.length === 0) return getTodo(deps, id);
    db.update(todo)
      .set({ ...extra, v: row.v + 1 })
      .where(eq(todo.id, id))
      .run();
    const record = getTodo(deps, id);
    if (!record) return null;
    deps.hub.publishTodoDoc(record.teamId, record);
    return record;
  }
  assertPhaseTransition(row.phase, to);
  db.update(todo)
    .set({ ...extra, phase: to, phaseAt: nowMs(), v: row.v + 1 })
    .where(eq(todo.id, id))
    .run();
  const record = getTodo(deps, id);
  if (!record) return null;
  deps.hub.publishTodoDoc(record.teamId, record);
  notifyPhaseEntry(deps, record, row.phase, to);
  // #1250（ADR 0018 层 2）：done 落地即查父卡收口——本卡是拆卡子项
  //（sourceTodo 指父）且兄弟全 done 时父自动收（「子全 done 父自动收」的
  // 漏斗半边；done 落地的全路径 = 本漏斗 + updateTodo 手动面，两处都挂）。
  // 幂等：重放（from === to 早退）不到这里；父已 done 时收口函数自跳过。
  if (to === 'done') settleSplitOnDone(deps, id);
  return record;
}

// —— 拆卡状态原语（#1250 / ADR 0018 层 2；查询半边在此单源，builds.ts
//    波次派发与 chief split_todo 消费——写半边 = services/todo-split.ts）———

/** 父卡的子项行集（sourceTodo = 父 id；序 = seqNum）。 */
export function childrenOfTodo(db: Db, parentId: string): TodoRow[] {
  return db
    .select()
    .from(todo)
    .where(eq(todo.sourceTodo, parentId))
    .orderBy(asc(todo.seqNum))
    .all();
}

/** 子项的阻塞是否全部解除（blockedBy 全 done）；无依赖行恒 true。 */
export function splitBlockersSatisfied(db: Db, row: TodoRow): boolean {
  const ids = row.blockedBy ?? [];
  if (ids.length === 0) return true;
  const done = new Set(
    db
      .select({ id: todo.id })
      .from(todo)
      .where(and(inArray(todo.id, ids), eq(todo.phase, 'done')))
      .all()
      .map((r) => r.id),
  );
  return ids.every((id) => done.has(id));
}

/** 父卡自动收口（#1250「子全 done 父自动收」）：本卡 done 落地时，若它是
 *  拆卡子项（sourceTodo 在位），检查父的全部子项——全 done 则父卡经
 *  building→done 边落地（phase.ts #1250 边），父会话落 DONE_ANNOUNCEMENT
 *  审计行（actor = Chief——收口是编排面动作，不是人手）。已 done / 子未齐
 *  / 父行缺失 = 零副作用。嵌套拆卡自然递归：子父收口落 done 又触发对更上
 *  层父的同一检查。 */
export function settleSplitOnDone(deps: TodoDeps, childId: string): void {
  const { db } = deps;
  const child = getRow(deps, childId);
  if (child === undefined || child.sourceTodo === null) return;
  const parent = getRow(deps, child.sourceTodo);
  if (parent === undefined || parent.phase === 'done') return;
  const children = childrenOfTodo(db, parent.id);
  if (children.length === 0) return;
  if (!children.every((c) => c.phase === 'done')) return;
  setTodoPhase(deps, parent.id, 'done', { lastRunAt: nowMs() });
  if (parent.latestBuildId !== null) {
    insertGateAnnouncement(deps, parent.latestBuildId, DONE_ANNOUNCEMENT, 'Chief');
  }
}

/** 任务重置闸的 started 判据（#755，todos.dev 看板指南「已开始的卡片拖回
 *  待开始会重置任务」）：进行中相位（queued/planning/building，shared
 *  IN_PROGRESS_PHASES）或携带任何构建历史（latestBuildId / lastRunAt /
 *  hasPlan / hasChanges 任一位在位）。confirm/review/failed/done 但零历史 =
 *  无可中断、无可清空，走静默改相（与 web columns.ts needsResetGate 同表，
 *  server test 与 columns.test 双面对拍，任一改判据另一面必红）。 */
export function isStartedTodoRow(row: {
  phase: Phase;
  latestBuildId: string | null;
  lastRunAt: number | null;
  hasChanges: boolean;
  hasPlan: boolean;
}): boolean {
  if ((IN_PROGRESS_PHASES as readonly string[]).includes(row.phase)) return true;
  return row.latestBuildId != null || row.lastRunAt != null || row.hasChanges || row.hasPlan;
}

/** 任务重置（#755）：拖回待开始的确认落位——中断在飞构建 + 清空任务产物 +
 *  相位回 todo，一次调用内完成（phase PATCH 与构建中断两次写 = 部分失败会
 *  留下「todo 相位上跑着构建」的残态，本函数是唯一把三者钉在一起的写面）。
 *  - 中断：claimed 步 = stop_pending 单槽 upsert + machineHub.stopSignal（停止
 *    钮 requestStop 同律——在线执行机经 machine stream stop 事件即时中断；
 *    信号发出后行随 build 删除（daemon 只在 SSE 触发时拉取-确认，不轮询，
 *    故离线残留进程与按钮面同律够不着——dialog 文案如实声明，不虚构送达）。
 *    pending 步无机器可通知，随 build 行删除而消失（claim 面按 build join，
 *    无 build 即无领取）。
 *  - 清空 = 硬删除（参考站「清空对话、方案和改动记录」字面）：build 行 +
 *    step/message/plan/steer/stop 单槽。分支
 *    同步行随 build FK cascade；todo 行保留（标题/需求/标签/指派是
 *    任务定义，不是产物）。执行机工作区文件与会话资产不动（daemon 本地物，
 *    server 够不着——dialog 文案如实声明）。
 *  - 迟到回报天然免疫：daemon 侧持有的 step/buildId 在删除后任何上报
 *    （heartbeat/completion）都落进 NotFoundError 404 被忽略，不存在「已删
 *    build 的落账把相位拽走」的路径（与 applyStoppedStep 的 gate 回落无交集，
 *    本函数不经过它）。
 *  非 started 卡 = 无操作返回现记录（调用方本不该调；raw 调用无害）。
 *  expected 相位/build 快照对不上 = { stale: true } + 现记录（构建在 dialog
 *  打开后推进了——调用方刷新 dialog 文案重新确认，不得按旧文案重置）。 */
export function resetTodo(
  deps: TodoDeps & { convHub?: ConversationStreamHub },
  id: string,
  expected?: { phase?: Phase; buildId?: string | null },
): { stale: boolean; record: TodoRecord } | null {
  const { db, hub } = deps;
  const row = getRow(deps, id);
  if (!row) return null;
  const current = getTodo(deps, id);
  if (!current) return null;
  if (expected?.phase !== undefined && expected.phase !== row.phase) {
    return { stale: true, record: current };
  }
  if (expected?.buildId !== undefined && expected.buildId !== row.latestBuildId) {
    return { stale: true, record: current };
  }
  if (!isStartedTodoRow(row)) return { stale: false, record: current };

  const buildRows = db.select().from(build).where(eq(build.todoId, id)).all();
  const buildIds = buildRows.map((b) => b.id);
  if (buildIds.length > 0) {
    // 先发中断信号（在线 daemon 在行消失前收到 stop；离线则 stop_pending 持久
    // 化等重连——删除后才发会落进 404 被 daemon 丢弃）。
    for (const b of buildRows) {
      const active = db
        .select()
        .from(step)
        .where(and(eq(step.buildId, b.id), inArray(step.status, ['pending', 'claimed'])))
        .orderBy(asc(step.createdAt))
        .all()
        .at(-1);
      if (active?.status === 'claimed') {
        db.insert(stopPending)
          .values({ conversationId: b.id, stepId: active.id, discard: false, createdAt: nowMs() })
          .onConflictDoUpdate({
            target: stopPending.conversationId,
            set: { stepId: active.id, discard: false, createdAt: nowMs() },
          })
          .run();
        deps.machineHub?.stopSignal(row.teamId, active.id);
      }
    }
    db.delete(stopPending).where(inArray(stopPending.conversationId, buildIds)).run();
    db.delete(steerPending).where(inArray(steerPending.conversationId, buildIds)).run();
    db.delete(step).where(inArray(step.buildId, buildIds)).run();
    db.delete(message).where(inArray(message.conversationId, buildIds)).run();
    db.delete(planTable).where(inArray(planTable.buildId, buildIds)).run();
    db.delete(build).where(eq(build.todoId, id)).run();
    for (const bid of buildIds) deps.convHub?.clearConversationBuffer(bid);
  }
  db.update(todo)
    .set({
      phase: 'todo',
      phaseAt: nowMs(),
      hasPlan: false,
      hasChanges: false,
      latestBuildId: null,
      lastRunAt: null,
      v: row.v + 1,
    })
    .where(eq(todo.id, id))
    .run();

  const record = getTodo(deps, id);
  if (!record) return null;
  hub.publishTodoDoc(record.teamId, record);
  // 手动改相 parity（updateTodo 手动面）：拖回待开始 ≠ 关口进入，不挂
  // phase 进入通知/chief wake。
  return { stale: false, record };
}

/** DELETE /api/todos/{id}（DELETE_FACE：REST 同名 DELETE [推断]；
 * delete_todos 词表证据 r5 §3.1）。build 经 FK cascade 随行；step 的 buildId FK
 * 已随 M4a chief 步队列复用移除（无 build 行的 chief conv），故 step 手动清
 * （按本 todo 的 build 集）；message.conversationId 本无 FK（既有面）。 */
export function deleteTodo(deps: TodoDeps, id: string): boolean {
  const { db } = deps;
  const row = getRow(deps, id);
  if (!row) return false;
  const buildIds = db
    .select({ id: build.id })
    .from(build)
    .where(eq(build.todoId, id))
    .all()
    .map((r) => r.id);
  if (buildIds.length > 0) {
    db.delete(step).where(inArray(step.buildId, buildIds)).run();
  }
  db.delete(todo).where(eq(todo.id, id)).run();
  return true;
}

// —— GitHub 写向（#452 / ADR 0006）：自建 issue + 标题回写 ————————————————
//
// 状态机（来源两列，不新开列）：
// - `sourceKind='github-issue-self'` + `sourceRef=null` = 未建成（可重试）；
// - `sourceKind='github-issue-self'` + `sourceRef='github:o/r#N'` = 已建成；
// - `sourceKind='github-issue'`（导入面，#446）不触发本段任何出站。
// 写操作穷举律（ADR 0006 premortem 护栏三）：本段是全仓仅有的两处
// api.github.com 写入消费位——githubCreateIssue（POST）与
// githubUpdateIssueTitle（PATCH），token 一律经 openGithubToken 唯一读出点。

/** 在飞自建 issue 写出册（todoId → settled promise）：fire-and-forget 与
 * 重试入口共用——重试撞在飞 = 409（A10 重试竞态护栏，不双建）；测试面经
 * flushSelfIssueWrites 确定性等待。 */
const selfIssueInFlight = new Map<string, Promise<unknown>>();

/** 等待全部在飞自建 issue 写出落定（测试确定性钩子；失败语义 = 停留未建成，
 * 本函数永不 throw）。 */
export async function flushSelfIssueWrites(): Promise<void> {
  await Promise.all([...selfIssueInFlight.values()]);
}

/** 自建 issue 目标判定（createTodo 关键路径，纯本地读零出站）：github 形态
 * + 连接表有行 + deps 带 box（写向开启）→ 目标在；否则 null——local/hosted/
 * 未连接 = 现行为逐字节不变（A1/A8：不建、不报错、不亮失败态）。连接行只判
 * 存在性不解密：密文损坏留给异步 job 出站时降级（停留未建成，可重试）。
 * owner/repo 经 githubRepoOfProject 拆段：存量值不合法（#1466）同按非 github
 * 形态，不进自建面。 */
function planSelfIssue(deps: TodoDeps, teamId: string, projectId: string): GithubRepoRef | null {
  if (deps.box === undefined) return null;
  const proj = deps.db
    .select({ repoKind: project.repoKind, githubRepo: project.githubRepo })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  const ref = githubRepoOfProject(proj);
  if (ref === null) return null;
  if (!hasGithubConnection(deps.db, teamId)) return null;
  return ref;
}

/** fire-and-forget 派发（createTodo 落库后调用；返回前零 GitHub await——
 * D2/关键路径硬约束）。失败全吞：任务已是「未建成」态，重试入口兜底。 */
function scheduleSelfIssueCreate(deps: TodoDeps, todoId: string): void {
  const pending = runSelfIssueCreate(deps, todoId)
    .catch(() => undefined)
    .finally(() => {
      if (selfIssueInFlight.get(todoId) === pending) selfIssueInFlight.delete(todoId);
    });
  selfIssueInFlight.set(todoId, pending);
}

/** 自建 issue 执行体（fire-and-forget 与重试共用）：现读 todo 行——标题用
 * **当前值**（agent 可能已回填正式标题，A13/D3：重试与后建都不用过时占
 * 位）。成功 → 补 sourceRef + v++ + 文档事件（看板实时刷新，A14）。失败 →
 * HttpError 上抛由调用面分流（schedule 吞、retry 直透）。竞态防御：出站前
 * 后两次读行，任务被删 / ref 已被补（并发重试）→ 静默放弃不覆盖。 */
async function runSelfIssueCreate(deps: TodoDeps, todoId: string): Promise<TodoRecord | null> {
  const { db, hub, box } = deps;
  const row = getRow(deps, todoId);
  if (row?.sourceKind !== 'github-issue-self' || row.sourceRef !== null) return null;
  if (!box) throw new HttpError(502, 'github writeback unavailable (no secret box)');
  const proj = db
    .select({ repoKind: project.repoKind, githubRepo: project.githubRepo })
    .from(project)
    .where(and(eq(project.id, row.projectId), eq(project.teamId, row.teamId)))
    .get();
  const repoRef = githubRepoOfProject(proj);
  if (repoRef === null) throw new HttpError(404, 'project is not github-backed');
  const token = openGithubToken({ db, box }, row.teamId);
  if (token === null) throw new HttpError(404, 'github connection not found');
  const { owner, repo } = repoRef;
  const { number } = await githubCreateIssue(deps.githubFetch ?? fetch, token, owner, repo, {
    title: row.title,
    body: row.spec,
  });
  const fresh = getRow(deps, todoId);
  if (!fresh || fresh.sourceRef !== null) return null; // 删除/已补（并发面）→ 放弃
  const ref = githubIssueSourceRef(owner, repo, number);
  db.update(todo)
    .set({ sourceRef: ref, v: fresh.v + 1 })
    .where(eq(todo.id, todoId))
    .run();
  const record = getTodo(deps, todoId);
  if (record) hub.publishTodoDoc(record.teamId, record);
  return record;
}

/** POST /api/todos/{id}/github-issue/retry 服务面（AC3 重试入口）：未建成 →
 * 同步重试建站（本请求 await 上游——重试非建任务关键路径，错误直透映射成
 * 响应状态）。已建成 → 409（A11 不建第二枚）；在飞（fire-and-forget 未落
 * 定或并发重试）→ 409（A10 竞态）；非自建来源 → 404。重试自身也进在飞册
 * ——两次并发重试只有一个出站。 */
export async function retrySelfIssueCreate(deps: TodoDeps, todoId: string): Promise<TodoRecord> {
  const row = getRow(deps, todoId);
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  if (row.sourceKind !== 'github-issue-self') {
    throw new HttpError(404, 'todo has no self-created github issue');
  }
  if (row.sourceRef !== null) throw new HttpError(409, 'github issue already created');
  if (selfIssueInFlight.has(todoId)) {
    throw new HttpError(409, 'github issue creation already in flight');
  }
  const raw = runSelfIssueCreate(deps, todoId);
  const guarded = raw
    .catch(() => undefined)
    .finally(() => {
      if (selfIssueInFlight.get(todoId) === guarded) selfIssueInFlight.delete(todoId);
    });
  selfIssueInFlight.set(todoId, guarded);
  const record = await raw; // 上游失败直透（404/429/502 映射归 lib 面）
  if (!record) throw new HttpError(409, 'github issue already created');
  return record;
}

/** 回填标题写进 issue（ADR 0006 D3/D5，setTaskMeta server 侧收口调用）：
 * 仅自建已建成任务出站 PATCH；未建成静默跳过（B3：后建 issue 时自然用当前
 * 标题）。失败上抛由调用面吞（B2：本地标题已生效，relay 不回滚不报错，
 * 漂移交只读回显提示面）。 */
export async function writebackSelfIssueTitle(
  deps: TodoDeps,
  todoId: string,
  title: string,
): Promise<void> {
  const { db, box } = deps;
  if (!box) return;
  const row = getRow(deps, todoId);
  if (row?.sourceKind !== 'github-issue-self' || row.sourceRef === null) return;
  const parsed = parseGithubIssueSourceRef(row.sourceRef);
  if (parsed === null) return;
  const token = openGithubToken({ db, box }, row.teamId);
  if (token === null) return;
  await githubUpdateIssueTitle(
    deps.githubFetch ?? fetch,
    token,
    parsed.owner,
    parsed.repo,
    parsed.issueNumber,
    title,
  );
}
