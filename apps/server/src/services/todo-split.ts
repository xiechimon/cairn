// 拆卡执行面（#1250 / ADR 0018 层 2）：chief split_todo 工具的落库半边。
// 依赖方向纪律：本文件只 import todos.ts（createTodo/setTodoPhase）与 db
// schema——builds.ts（波次派发）与 chief-tools.ts（工具入口）import 本文件，
// 不反向（machines → builds 是既有正向边的同族约束）。
//
// 落库内容：
// - N 张子卡（createTodo 同通道 + sourceTodo=父 id + blockedBy 依赖边 +
//   assignment.build=各钉角色 agent）；子卡落 todo 相位等派发。
// - 父卡的「拆解方案」= 一份 plan 文档（子卡清单 + 依赖边 + 各钉 agent），
//   挂在新建的父 build 上，父卡停 confirm 关口（todo→confirm 边，phase.ts
//   #1250）——人审整棵拆解树（premortem 3：可整树驳回；驳回走既有 revision
//   面，父卡 assignment.plan=Planner persona，重规划轮有主）。
// - 确认派发与波次推进不在此文件（builds.ts confirmSplitParent /
//   advanceSplitWaves——它们要 startBuilds，本文件不 import builds）。

import { SPLIT_ANNOUNCEMENT, type UserRecord } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, build, machine, plan as planTable, project, team, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { checkSplitPlan, type SplitCheckerAgent } from './todo-split-checker.js';
import { createTodo, setTodoPhase } from './todos.js';
import { insertGateAnnouncement, insertMessageRow } from './transcript.js';

/** split_todo 子卡入参（工具 params 的 server 形）。 */
export interface SplitSubtodoInput {
  title: string;
  spec: string;
  agentId: string;
  /** 1-based 兄弟序号（工具层约定）；server 解析为子卡 id。 */
  blockedBy?: number[];
}

export interface SplitDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  user: UserRecord;
  convHub?: ConversationStreamHub;
}

/** 执行拆解：建子卡 + 依赖边 + 父方案文档 + 父停 confirm。返回子卡行（chief
 *  工具回执用）。全量校验先行（失败零落库）——半截拆解树是最糟残态。 */
export function createSplitTodo(
  deps: SplitDeps,
  input: {
    parentId: string;
    subtodos: SplitSubtodoInput[];
    /** 溯源三件（chief 派工同律，create_todo 工具位语义）。 */
    chiefAgentId: string | null;
    chiefId: string;
    threadId: string;
    /** 宣告行 actor（Chief 绑定 Agent displayName；未绑定回落 'Chief'）。 */
    actorName: string;
  },
): {
  parentId: string;
  parentBuildId: string;
  children: { id: string; title: string }[];
  autoStart: boolean;
} {
  const { db } = deps;
  const parent = db.select().from(todo).where(eq(todo.id, input.parentId)).get();
  if (parent === undefined) throw new HttpError(404, `todo ${input.parentId}`);
  // 拆解门：只拆未开工的卡（todo 相位）。运行中/已交付的卡再拆 = 半途换轨，
  // 现有产物与子卡边界对不上；重拆诉求先 close 旧卡再建新卡。
  if (parent.phase !== 'todo') {
    throw new HttpError(409, `split 仅适用于未开工任务（当前相位 ${parent.phase}）`);
  }
  // 双拆防御：已有子项的父卡再拆 = 边界漂移（旧子卡还挂着依赖边）。
  const existing = db
    .select({ id: todo.id })
    .from(todo)
    .where(eq(todo.sourceTodo, input.parentId))
    .all();
  if (existing.length > 0) {
    throw new HttpError(409, `todo ${input.parentId} 已拆解（${existing.length} 张子卡在位）`);
  }
  const items = input.subtodos;
  const projectRow = db.select().from(project).where(eq(project.id, parent.projectId)).get();
  const teamRow = db.select().from(team).where(eq(team.id, parent.teamId)).get();
  const splitPolicy = projectRow?.splitPolicy ?? 'human';
  let checkerPassed = false;
  let checkerReasons: string[] = [];
  if (splitPolicy !== 'human') {
    const checkerAgents: SplitCheckerAgent[] = db
      .select({
        id: agent.id,
        status: agent.status,
        provider: agent.provider,
        modelId: agent.modelId,
        requiredCapabilities: agent.requiredCapabilities,
        machine: {
          online: machine.online,
          enabledRuntimes: machine.enabledRuntimes,
          capabilities: machine.capabilities,
          claudeCodeReport: machine.claudeCodeReport,
        },
      })
      .from(agent)
      .leftJoin(machine, eq(agent.machineId, machine.id))
      .where(eq(agent.teamId, parent.teamId))
      .all()
      .map((row) => ({ ...row, machine: row.machine?.online === undefined ? null : row.machine }));
    const checked = checkSplitPlan({ subtodos: items, agents: checkerAgents });
    checkerPassed = checked.ok;
    checkerReasons = checked.reasons;
    if (splitPolicy === 'auto' && teamRow?.autonomyPaused === true) {
      checkerPassed = false;
      checkerReasons = ['团队自治已暂停'];
    }
  }
  if (items.length < 2) {
    throw new HttpError(400, 'subtodos 至少两张：单卡诉求不是拆解，直接派发或改写 spec');
  }
  // agentId 团队归属先行校验（requireTeamAgent 同律：错 id 当场 400 折回工具
  // 结果，chief 可重挑——不留「指派不存在 agent」的静默残态）。
  for (const item of items) {
    if (item.title.trim() === '' || item.spec.trim() === '') {
      throw new HttpError(400, 'subtodos 每项 title/spec 必填非空');
    }
    const row = db
      .select({ id: agent.id, displayName: agent.displayName })
      .from(agent)
      .where(and(eq(agent.id, item.agentId), eq(agent.teamId, parent.teamId)))
      .get();
    if (row === undefined) {
      throw new HttpError(404, `agent ${item.agentId}（不在本团队，或 id 抄错了）`);
    }
  }
  // 依赖边校验：索引界内、无自指、无环（对解析后的边做 DFS）。
  const edges: { from: number; to: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    for (const idx of item.blockedBy ?? []) {
      if (!Number.isInteger(idx) || idx < 1 || idx > items.length) {
        throw new HttpError(400, `blockedBy 索引越界：${idx}（1..${items.length}）`);
      }
      if (idx === i + 1) throw new HttpError(400, 'blockedBy 不能自指');
      edges.push({ from: idx - 1, to: i });
    }
  }
  {
    const adj = new Map<number, number[]>();
    for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    const state = new Uint8Array(items.length); // 0=未访 1=在栈 2=完
    const visit = (n: number): void => {
      if (state[n] === 1) throw new HttpError(400, 'blockedBy 依赖成环（DFS 检测命中）');
      if (state[n] === 2) return;
      state[n] = 1;
      for (const next of adj.get(n) ?? []) visit(next);
      state[n] = 2;
    };
    for (let i = 0; i < items.length; i++) visit(i);
  }

  // —— 全部校验过 → 落库（先子卡，后父 build/plan/confirm）——
  const children: {
    id: string;
    title: string;
    spec: string;
    agentId: string;
    blockedBy: string[];
  }[] = [];
  for (const item of items) {
    const record = createTodo(
      { db: deps.db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
      {
        teamId: parent.teamId,
        projectId: parent.projectId,
        title: item.title,
        spec: item.spec,
        createdBy: input.chiefAgentId,
        ownerId: parent.ownerId,
        orchestration: { threadId: input.threadId },
      },
    );
    children.push({
      id: record.id,
      title: item.title,
      spec: item.spec,
      agentId: item.agentId,
      blockedBy: [],
    });
  }
  items.forEach((item, index) => {
    const child = children[index];
    if (child === undefined) throw new Error(`split child ${index + 1} missing`);
    const blockerIds = (item.blockedBy ?? []).map((idx) => {
      const blocker = children[idx - 1];
      if (blocker === undefined) throw new Error(`split blockedBy index ${idx} not resolvable`);
      return blocker.id;
    });
    child.blockedBy = blockerIds;
    db.update(todo)
      .set({
        sourceTodo: parent.id,
        blockedBy: blockerIds.length > 0 ? blockerIds : null,
        assignment: { plan: null, build: { agentId: item.agentId } },
        sourceBuildId: input.chiefId,
      })
      .where(eq(todo.id, child.id))
      .run();
  });

  // 父 build + 拆解方案 plan 文档（stepId null = server 落稿非步上传）。
  const parentBuildId = newUuidv7();
  db.insert(build)
    .values({
      id: parentBuildId,
      todoId: parent.id,
      withPlan: true,
      prevPhase: parent.phase,
      triggerSource: 'chief',
      planDocId: null,
      errorMessage: null,
      prUrl: null,
      prNumber: null,
      changes: null,
      diffHash: null,
      createdAt: nowMs(),
    })
    .run();
  const planId = newRecordId();
  db.insert(planTable)
    .values({
      id: planId,
      buildId: parentBuildId,
      version: 1,
      content: renderSplitPlan(db, parent.title, children),
      stepId: null,
      createdAt: nowMs(),
    })
    .run();
  db.update(build).set({ planDocId: planId }).where(eq(build.id, parentBuildId)).run();
  // 父卡：停 confirm（拆解方案等人审）+ hasPlan + 指回父 build；assignment.plan
  // = Planner persona（缺省无 persona 时 null——revision 重规划步回落 plan 槽
  // 的失败收尾面）。拆解宣告行随父会话落库（actor = 谁拆的）。
  const planner = db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.teamId, parent.teamId), eq(agent.persona, 'planner')))
    .get();
  const autoStart = splitPolicy === 'auto' && checkerPassed;
  setTodoPhase(
    { db: deps.db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
    parent.id,
    'confirm',
    {
      hasPlan: true,
      latestBuildId: parentBuildId,
      lastRunAt: nowMs(),
      ...(!autoStart && planner !== undefined
        ? { assignment: { plan: { agentId: planner.id }, build: null } }
        : {}),
    },
  );
  if (autoStart) {
    setTodoPhase(
      { db: deps.db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
      parent.id,
      'building',
      { lastRunAt: nowMs() },
    );
  }
  insertGateAnnouncement(deps, parentBuildId, SPLIT_ANNOUNCEMENT, input.actorName);
  const checkerText =
    splitPolicy === 'human'
      ? '检查器结果：回落人审 + 项目策略为 human'
      : checkerPassed
        ? splitPolicy === 'auto'
          ? '检查器结果：已自动开跑'
          : '检查器结果：若自动会开跑（shadow）'
        : `检查器结果：回落人审 + ${checkerReasons.join('；')}`;
  insertMessageRow(deps, parentBuildId, {
    id: newRecordId(),
    role: 'user',
    content: checkerText,
    createdAt: nowMs(),
    actor: input.actorName,
  });
  return {
    parentId: parent.id,
    parentBuildId,
    children: children.map((c) => ({ id: c.id, title: c.title })),
    autoStart,
  };
}

/** 拆解方案文档（父卡 plan 面 = confirm 人审材料）：子卡清单 + 依赖 + 各钉
 *  agent + 收口规则，读卡即懂整棵树。 */
function renderSplitPlan(
  db: Db,
  parentTitle: string,
  children: { id: string; title: string; spec: string; agentId: string; blockedBy: string[] }[],
): string {
  const names = new Map(
    db
      .select({ id: agent.id, name: agent.displayName })
      .from(agent)
      .all()
      .map((r) => [r.id, r.name] as const),
  );
  const agentName = (agentId: string): string => names.get(agentId) ?? agentId;
  const lines: string[] = [
    `# 拆解方案：${parentTitle}`,
    '',
    `由 Chief 拆为 ${children.length} 张子卡（blocking 依赖边）。确认后：无阻塞子卡自动派发直执行；后续波次随阻塞子卡 done 自动推进；子卡全 done 时父卡自动收口。各子卡独立走 build→review→merge 流水线（合并闸逐卡留人）。`,
    '',
    '## 子卡清单',
  ];
  children.forEach((child, i) => {
    const deps =
      child.blockedBy.length === 0
        ? '无（确认后即派发）'
        : child.blockedBy
            .map((id) => `子卡 ${children.findIndex((c) => c.id === id) + 1}`)
            .join('、');
    lines.push(
      `### 子卡 ${i + 1}：${child.title}`,
      `- 执行 agent：${agentName(child.agentId)}`,
      `- 依赖：${deps}`,
      '',
      child.spec,
      '',
    );
  });
  return lines.join('\n');
}
