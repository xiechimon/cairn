import type { MachineAskBody, MachineAskResponse } from '@cairn/shared';
import {
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  createSkillBodySchema,
  derivePlaceholderTitle,
  FIXED_TAGS,
  updateSkillToolParamsSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { agent, build, chief, chiefThread, type step, todo } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { NotFoundError } from './builds.js';
import {
  ASK_HOLD_MS,
  type ChiefQuestionDeps,
  createOrGetQuestion,
  holdForQuestion,
} from './chief-questions.js';
import { executeChiefTool, executeWorkerMemoryTool } from './chief-tools.js';
import { projectOfTodo } from './git.js';
import { isChiefConversation, type MachineDeps, ownedStep } from './machines.js';
import { createLocalSkill, updateLocalSkill } from './skills.js';
import { resolveFixedTagId, resolveProjectTagIds } from './tags.js';
import { updateTodo, writebackSelfIssueTitle } from './todos.js';

export async function machineAsk(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  body: MachineAskBody,
  opts: { holdMs: number; signal?: AbortSignal } = { holdMs: ASK_HOLD_MS },
): Promise<MachineAskResponse> {
  const row = ownedStep(deps, machineId, stepId);
  if (row.kind !== 'chief' || !isChiefConversation(row.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  const qDeps: ChiefQuestionDeps = {
    db: deps.db,
    hub: deps.hub,
    user: deps.user,
    ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
  };
  const { content } = createOrGetQuestion(qDeps, {
    threadId: row.buildId,
    requestId: body.requestId,
    questions: body.questions,
  });
  const final =
    content.status === 'pending'
      ? await holdForQuestion(qDeps, {
          threadId: row.buildId,
          requestId: body.requestId,
          holdMs: opts.holdMs,
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        })
      : content;
  const settled = final ?? content;
  return {
    status: settled.status,
    requestId: body.requestId,
    answers: settled.status === 'answered' ? (settled.answers ?? null) : null,
    reason: settled.status === 'cancelled' ? (settled.cancelReason ?? null) : null,
  };
}

export async function executeRelayToolCall(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const row = ownedStep(deps, machineId, stepId);
  if (row.kind !== 'chief') {
    return executeWorkerMemoryToolCall(deps, row, name, params);
  }
  if (!isChiefConversation(row.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  const threadId = row.buildId;
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (!threadRow) throw new NotFoundError(`chief thread ${threadId}`);
  const chiefRow = deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  if (!chiefRow) throw new NotFoundError(`chief ${threadRow.chiefId}`);
  return executeChiefTool(
    {
      db: deps.db,
      hub: deps.hub,
      machineHub: deps.machineHub,
      box: deps.box,
      user: deps.user,
      reposDir: deps.reposDir,
      attachmentsDir: deps.attachmentsDir,
      skillsDir: deps.skillsDir,
      ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
      ...(deps.mcpConfigPath !== undefined ? { mcpConfigPath: deps.mcpConfigPath } : {}),
      ...(deps.githubFetch !== undefined ? { githubFetch: deps.githubFetch } : {}),
    },
    {
      teamId: threadRow.teamId,
      userId: threadRow.userId,
      chiefId: chiefRow.id,
      threadId,
      chiefAgentId: chiefRow.agentId,
      conversationId: threadId,
    },
    name,
    params,
  );
}

async function executeWorkerMemoryToolCall(
  deps: MachineDeps,
  row: typeof step.$inferSelect,
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${row.buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${buildRow.todoId}`);
  if (name === 'set_task_meta') return setTaskMeta(deps, todoRow, params);
  const slot = row.kind === 'plan' ? todoRow.assignment?.plan : todoRow.assignment?.build;
  const agentId = slot?.agentId;
  if (name === 'create_skill' || name === 'update_skill') {
    if (!agentId) throw new HttpError(409, 'step has no assigned agent — skill write has no actor');
    return executeWorkerSkillTool(deps, todoRow, agentId, name, params);
  }
  if (!agentId) throw new HttpError(409, 'step has no assigned agent — memory has no store');
  return executeWorkerMemoryTool(
    deps.db,
    {
      teamId: todoRow.teamId,
      agentId,
      todoId: todoRow.id,
      projectId: projectOfTodo(deps.db, todoRow)?.id ?? null,
      buildId: row.buildId,
      attachmentsDir: deps.attachmentsDir,
    },
    name,
    params,
  );
}

async function executeWorkerSkillTool(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  agentId: string,
  name: 'create_skill' | 'update_skill',
  params: Record<string, unknown>,
): Promise<string> {
  const agentRow = deps.db.select().from(agent).where(eq(agent.id, agentId)).get();
  if (!agentRow) throw new NotFoundError(`agent ${agentId}`);
  const want = name === 'create_skill' ? AGENT_TOOL_SKILL_CREATE : AGENT_TOOL_SKILL_UPDATE;
  if (!agentRow.tools.includes(want)) {
    throw new HttpError(
      403,
      `Agent ${agentRow.displayName} 未获「${want}」授权（Agent 详情页权限 tab），无法${name === 'create_skill' ? '创建' : '更新'}技能`,
    );
  }
  const opts = {
    db: deps.db,
    skillsDir: deps.skillsDir,
    teamId: todoRow.teamId,
    actor: { type: 'agent' as const, id: agentId },
  };
  if (name === 'create_skill') {
    const body = parseWith(createSkillBodySchema, params, 'params');
    return JSON.stringify(createLocalSkill(opts, body));
  }
  const body = parseWith(updateSkillToolParamsSchema, params, 'params');
  return JSON.stringify(updateLocalSkill(opts, body.skillId, body));
}

async function setTaskMeta(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  params: Record<string, unknown>,
): Promise<string> {
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (!projectRow) throw new HttpError(404, `project ${todoRow.projectId}`);
  if (projectRow.repoKind === 'github') return setTaskMetaGithubForm(deps, todoRow, params);
  const title = normalizedMetaTitle(params.title);
  let tagIds: string[] | undefined;
  if (params.tag !== undefined) {
    const tagName = params.tag;
    if (typeof tagName !== 'string' || !FIXED_TAGS.some((t) => t.name === tagName)) {
      throw new HttpError(
        400,
        `invalid params.tag: expected one of ${FIXED_TAGS.map((t) => t.name).join(', ')}`,
      );
    }
    const tagId = resolveFixedTagId(deps.db, todoRow.projectId, tagName);
    if (tagId === null) throw new HttpError(400, `tag ${tagName} not seeded in project`);
    tagIds = [tagId];
  }
  const record = updateTodo(
    { db: deps.db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
    todoRow.id,
    { title, ...(tagIds !== undefined ? { tagIds } : {}) },
  );
  if (!record) throw new NotFoundError(`todo ${todoRow.id}`);
  return JSON.stringify({ todoId: record.id, title: record.title, tagIds: record.tagIds });
}

function normalizedMetaTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? derivePlaceholderTitle(raw) : '';
  if (title === '') throw new HttpError(400, 'invalid params.title: expected non-empty string');
  return title;
}

async function setTaskMetaGithubForm(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  params: Record<string, unknown>,
): Promise<string> {
  let title: string | undefined;
  if (params.title !== undefined) {
    if (todoRow.sourceKind === 'github-issue') {
      throw new HttpError(400, 'invalid params.title: title is final (issue-sourced)');
    }
    title = normalizedMetaTitle(params.title);
  }
  let tagIds: string[] | undefined;
  const rawTags = params.tags !== undefined ? params.tags : params.tag;
  if (rawTags !== undefined) {
    const names = typeof rawTags === 'string' ? [rawTags] : rawTags;
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string' || n === '')) {
      throw new HttpError(400, 'invalid params.tags: expected an array of tag names');
    }
    const resolved = resolveProjectTagIds(deps.db, todoRow.projectId, names);
    for (const name of names) {
      if (!resolved.has(name)) {
        throw new HttpError(400, `tag ${name} not in project tag set`);
      }
    }
    tagIds = [...new Set(names.map((n) => resolved.get(n)))].filter(
      (id): id is string => id !== undefined,
    );
  }
  if (title === undefined && tagIds === undefined) {
    throw new HttpError(400, 'invalid params: expected at least one of title / tags');
  }
  const todoDeps = {
    db: deps.db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    box: deps.box,
    ...(deps.githubFetch !== undefined ? { githubFetch: deps.githubFetch } : {}),
  };
  const record = updateTodo(todoDeps, todoRow.id, {
    ...(title !== undefined ? { title } : {}),
    ...(tagIds !== undefined ? { tagIds } : {}),
  });
  if (!record) throw new NotFoundError(`todo ${todoRow.id}`);
  if (title !== undefined && record.sourceKind === 'github-issue-self') {
    await writebackSelfIssueTitle(todoDeps, todoRow.id, record.title).catch(() => undefined);
  }
  return JSON.stringify({ todoId: record.id, title: record.title, tagIds: record.tagIds });
}
