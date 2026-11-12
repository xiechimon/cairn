import { createHash } from 'node:crypto';
import type { MachineAskBody, MachineAskResponse } from '@cairn/shared';
import {
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  createSkillBodySchema,
  derivePlaceholderTitle,
  isBuildStepKind,
  isComputerBrowserTool,
  updateSkillToolParamsSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { build, chief, chiefThread, type step, todo } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { attachWorkerFile } from './agent-attachments.js';
import { NotFoundError } from './builds.js';
import { requireTurnProvenance } from './chief.js';
import { assertChiefDigestTool } from './chief-digest.js';
import {
  ASK_HOLD_MS,
  type ChiefQuestionDeps,
  createOrGetQuestion,
  holdForQuestion,
} from './chief-questions.js';
import { executeChiefTool, executeWorkerMemoryTool } from './chief-tools.js';
import { steeredMessageScopes } from './chief-turns.js';
import { captureToolBoundary, isCaptureTool, openTurnCapture } from './coordinator-turn-capture.js';
import { projectOfTodo } from './git.js';
import { resolveProjectGithubLabelIds } from './github-labels.js';
import { forwardComputerCall } from './machine-computer.js';
import { isChiefConversation, type MachineDeps, ownedStep } from './machines.js';
import { refuseMailTurnTool } from './mail.js';
import { stepScopeProjectId } from './picked-project.js';
import {
  coordinatorProfile,
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  profileForStep,
  type RouteProfile,
} from './routing-rules.js';
import { createLocalSkill, updateLocalSkill } from './skills.js';
import { stepNamesTask } from './task-naming.js';
import { executeThreadScheduleTool, isThreadScheduleTool } from './thread-schedule-tools.js';
import { updateAutonomousTodo, writebackSelfIssueTitle } from './todos.js';
import { askWorkerQuestion, recordThreadReportLine } from './worker-questions.js';

export async function machineAsk(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  body: MachineAskBody,
  opts: { holdMs: number; signal?: AbortSignal } = { holdMs: ASK_HOLD_MS },
): Promise<MachineAskResponse> {
  const row = ownedStep(deps, machineId, stepId);
  refuseMailTurnTool(row.prompt, 'ask_user');
  if (row.kind === 'session') {
    return askWorkerQuestion(deps, row, body, opts);
  }
  if (row.kind !== 'chief' || !isChiefConversation(row.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  const qDeps: ChiefQuestionDeps = {
    db: deps.db,
    hub: deps.hub,
    user: deps.user,
    vapidKeys: deps.vapidKeys,
    ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
  };
  const provenance = requireTurnProvenance(row.prompt, body.provenance, 'ask_user');
  const { content } = createOrGetQuestion(qDeps, {
    threadId: row.buildId,
    requestId: body.requestId,
    questions: body.questions,
    provenance,
    askedFor: row.ownerMessageIds ?? [],
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
  machineId: string | null,
  stepId: string,
  name: string,
  params: Record<string, unknown>,
  toolCallId?: string,
  signal?: AbortSignal,
): Promise<string> {
  const row = ownedStep(deps, machineId, stepId);
  refuseMailTurnTool(row.prompt, name);
  if (isComputerBrowserTool(name)) {
    if (row.kind !== 'chief') {
      throw new HttpError(400, 'browser tools require a chief step');
    }
    if (!isChiefConversation(row.buildId)) {
      throw new HttpError(400, `step ${stepId} is not a chief step`);
    }
    if (row.status !== 'claimed') {
      throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
    }
    const callId =
      toolCallId ??
      createHash('sha256')
        .update(`${stepId}\0${name}\0${JSON.stringify(params)}`)
        .digest('hex');
    const result = await forwardComputerCall(
      deps,
      machineId,
      stepId,
      {
        computer: true,
        name,
        toolCallId: callId,
        params,
      },
      signal !== undefined ? { signal } : {},
    );
    return result.text;
  }
  if (isThreadScheduleTool(name)) {
    if (row.kind !== 'plan' && !isBuildStepKind(row.kind)) {
      throw new HttpError(400, 'schedule tools require a plan or build step');
    }
    if (row.status !== 'claimed') {
      throw new HttpError(409, 'schedule tools require a currently claimed step');
    }
  }
  if (row.kind !== 'chief') {
    return executeWorkerMemoryToolCall(deps, row, name, params);
  }
  if (!isChiefConversation(row.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  if (row.status !== 'claimed') {
    throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
  }
  const threadId = row.buildId;
  assertChiefDigestTool(threadId, name);
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (!threadRow) throw new NotFoundError(`chief thread ${threadId}`);
  const chiefRow = deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  if (!chiefRow) throw new NotFoundError(`chief ${threadRow.chiefId}`);
  const captured = isCaptureTool(name) ? openTurnCapture(stepId) : undefined;
  const result = await executeChiefTool(
    {
      db: deps.db,
      hub: deps.hub,
      machineHub: deps.machineHub,
      box: deps.box,
      githubAppTokenSocket: deps.githubAppTokenSocket,
      githubAppIdentity: deps.githubAppIdentity,
      user: deps.user,
      vapidKeys: deps.vapidKeys,
      reposDir: deps.reposDir,
      workspacesDir: deps.workspacesDir,
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
      chiefAgentId: coordinatorProfile(deps.db, threadRow.teamId)?.id ?? null,
      conversationId: threadId,
      turnPrompt: row.prompt,
      turnMessageIds: row.ownerMessageIds ?? [],
      turnScopeProjectId: stepScopeProjectId(row),
      turnScopeMixed: steeredFromAnotherScope(deps, row),
    },
    name,
    params,
  );
  if (captured !== undefined)
    if (captured !== undefined && isCaptureTool(name))
      captureToolBoundary(deps.db, stepId, threadRow.teamId, name, toolCallId, params, result);
  return result;
}

export function steeredFromAnotherScope(deps: MachineDeps, row: typeof step.$inferSelect): boolean {
  const scope = stepScopeProjectId(row);
  return steeredMessageScopes(deps.db, row).some((projectId) => projectId !== scope);
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
  if (isThreadScheduleTool(name)) {
    return executeThreadScheduleTool(deps, todoRow, `worker:${row.id}`, name, params);
  }
  if (name === 'thread_report' && row.kind === 'session') {
    if (row.status !== 'claimed') {
      throw new HttpError(409, 'thread_report requires a currently claimed step');
    }
    return recordThreadReportLine(deps, row, params.line);
  }
  if (name === 'attach_file') return attachWorkerFile(deps, row, todoRow, params);
  if (name === 'set_task_meta') {
    if (!stepNamesTask(deps.db, row)) {
      throw new HttpError(409, 'set_task_meta is reserved for the first implementation step');
    }
    return setTaskMeta(deps, todoRow, params);
  }
  const profile = profileForStep(deps.db, todoRow, row.kind, row.id);
  if (name === 'create_skill' || name === 'update_skill') {
    if (!profile) throw new HttpError(409, 'step has no routing rule — skill write has no actor');
    return executeWorkerSkillTool(deps, todoRow, profile, name, params);
  }
  if (!profile) throw new HttpError(409, 'step has no routing rule — memory has no store');
  return executeWorkerMemoryTool(
    deps.db,
    {
      teamId: todoRow.teamId,
      agentId: memoryOwnerOf(deps.db, todoRow.teamId, row.kind),
      sourceName: profile.displayName,
      teamScoped: memoryOpsAreTeamScoped(row.kind),
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
  agentRow: RouteProfile,
  name: 'create_skill' | 'update_skill',
  params: Record<string, unknown>,
): Promise<string> {
  const agentId = agentRow.id;
  const want = name === 'create_skill' ? AGENT_TOOL_SKILL_CREATE : AGENT_TOOL_SKILL_UPDATE;
  if (!agentRow.tools.includes(want)) {
    throw new HttpError(
      403,
      `${agentRow.displayName} 未获「${want}」授权（工作策略 tools），无法${name === 'create_skill' ? '创建' : '更新'}技能`,
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
  parseWith(
    z
      .object({
        tag: z.never().optional(),
        tags: z.never().optional(),
        tagIds: z.never().optional(),
      })
      .passthrough(),
    params,
    'params',
  );
  const title = todoRow.request !== null ? undefined : normalizedMetaTitle(params.title);
  const record = updateAutonomousTodo(
    {
      db: deps.db,
      hub: deps.hub,
      machineHub: deps.machineHub,
      user: deps.user,
      vapidKeys: deps.vapidKeys,
    },
    todoRow.id,
    {
      ...(title !== undefined ? { title } : {}),
    },
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
    if (todoRow.sourceKind === 'github-issue' || todoRow.request !== null) {
      throw new HttpError(
        400,
        'invalid params.title: title is final (issue-sourced or owner words)',
      );
    }
    title = normalizedMetaTitle(params.title);
  }
  let githubLabelIds: string[] | undefined;
  const rawTags = params.tags !== undefined ? params.tags : params.tag;
  if (rawTags !== undefined) {
    const names = typeof rawTags === 'string' ? [rawTags] : rawTags;
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string' || n === '')) {
      throw new HttpError(400, 'invalid params.tags: expected an array of tag names');
    }
    const resolved = resolveProjectGithubLabelIds(deps.db, todoRow.projectId, names);
    for (const name of names) {
      if (!resolved.has(name)) {
        throw new HttpError(400, `tag ${name} not in project tag set`);
      }
    }
    githubLabelIds = [...new Set(names.map((n) => resolved.get(n)))].filter(
      (id): id is string => id !== undefined,
    );
  }
  if (title === undefined && githubLabelIds === undefined) {
    throw new HttpError(400, 'invalid params: expected at least one of title / tags');
  }
  const todoDeps = {
    db: deps.db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    vapidKeys: deps.vapidKeys,
    box: deps.box,
    githubAppTokenSocket: deps.githubAppTokenSocket,
    githubAppIdentity: deps.githubAppIdentity,
    ...(deps.githubFetch !== undefined ? { githubFetch: deps.githubFetch } : {}),
  };
  const record = updateAutonomousTodo(todoDeps, todoRow.id, {
    ...(title !== undefined ? { title } : {}),
    ...(githubLabelIds !== undefined ? { githubLabelIds } : {}),
  });
  if (!record) throw new NotFoundError(`todo ${todoRow.id}`);
  if (title !== undefined && record.sourceKind === 'github-issue-self') {
    await writebackSelfIssueTitle(todoDeps, todoRow.id, record.title).catch(() => undefined);
  }
  return JSON.stringify({
    todoId: record.id,
    title: record.title,
    githubLabelIds: record.githubLabelIds,
  });
}
