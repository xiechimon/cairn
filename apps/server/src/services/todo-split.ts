import type { TodoOutputKind } from '@cairn/shared';
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

export interface SplitSubtodoInput {
  title: string;
  spec: string;
  agentId: string;
  blockedBy?: number[];
  output?: TodoOutputKind;
}

export interface SplitDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  user: UserRecord;
  convHub?: ConversationStreamHub;
}

export function createSplitTodo(
  deps: SplitDeps,
  input: {
    parentId: string;
    subtodos: SplitSubtodoInput[];
    chiefAgentId: string | null;
    chiefId: string;
    threadId: string;
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
  if (parent.phase !== 'todo') {
    throw new HttpError(409, `split 仅适用于未开工任务（当前相位 ${parent.phase}）`);
  }
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
    const checked = checkSplitPlan({
      subtodos: items,
      agents: checkerAgents,
      autonomyPaused:
        db
          .select({ paused: team.autonomyPaused })
          .from(team)
          .where(eq(team.id, parent.teamId))
          .get()?.paused !== false,
    });
    checkerPassed = checked.ok;
    checkerReasons = checked.reasons;
  }
  if (items.length < 2) {
    throw new HttpError(400, 'subtodos 至少两张：单卡诉求不是拆解，直接派发或改写 spec');
  }
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
    const state = new Uint8Array(items.length);
    const visit = (n: number): void => {
      if (state[n] === 1) throw new HttpError(400, 'blockedBy 依赖成环（DFS 检测命中）');
      if (state[n] === 2) return;
      state[n] = 1;
      for (const next of adj.get(n) ?? []) visit(next);
      state[n] = 2;
    };
    for (let i = 0; i < items.length; i++) visit(i);
  }

  const children: {
    id: string;
    title: string;
    spec: string;
    agentId: string;
    blockedBy: string[];
    output?: TodoOutputKind;
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
        ...(item.output !== undefined ? { output: item.output } : {}),
      },
    );
    children.push({
      id: record.id,
      title: item.title,
      spec: item.spec,
      agentId: item.agentId,
      blockedBy: [],
      ...(item.output !== undefined ? { output: item.output } : {}),
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
      ? 'checker verdict: falls back to human review + project policy is human'
      : checkerPassed
        ? splitPolicy === 'auto'
          ? 'checker verdict: started automatically'
          : 'checker verdict: would start automatically (shadow)'
        : `checker verdict: falls back to human review + ${checkerReasons.join('; ')}`;
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

function renderSplitPlan(
  db: Db,
  parentTitle: string,
  children: {
    id: string;
    title: string;
    spec: string;
    agentId: string;
    blockedBy: string[];
    output?: TodoOutputKind;
  }[],
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
      ...(child.output === 'info' ? ['- 产出：信息类（报告附件交付，不进合并）'] : []),
      '',
      child.spec,
      '',
    );
  });
  return lines.join('\n');
}
