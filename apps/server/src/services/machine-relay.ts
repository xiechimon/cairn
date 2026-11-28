import { randomUUID } from 'node:crypto';
import type { ComputerRelayResult, MachineAskBody, MachineAskResponse } from '@cairn/shared';
import {
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  CONNECTOR_TOOL_PREFIX,
  computerToolSchema,
  createSkillBodySchema,
  derivePlaceholderTitle,
  isBuildStepKind,
  isComputerBrowserTool,
  isOwnComputerTool,
  isPhoneTool,
  OWN_COMPUTER_TOOL_NAMES,
  parseGithubIssueSourceRef,
  REQUEST_SECRET_TOOL,
  updateSkillToolParamsSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { build, chief, chiefThread, machine, type step, todo } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { attachWorkerFile } from './agent-attachments.js';
import { NotFoundError } from './builds.js';
import { requireTurnProvenance } from './chief.js';
import {
  ASK_HOLD_MS,
  announceQuestion,
  type ChiefQuestionDeps,
  createOrGetQuestion,
  holdForQuestion,
} from './chief-questions.js';
import {
  executeChiefTool,
  executeWorkerMemoryTool,
  type TransitionActor,
  transitionTodos,
} from './chief-tools.js';
import { steeredMessageScopes } from './chief-turns.js';
import { executeConnectorToolCall } from './connector-broker.js';
import {
  capturePreCallWorld,
  captureToolResult,
  existingTurnCapture,
  isCaptureTool,
} from './coordinator-turn-capture.js';
import { projectOfTodo } from './git.js';
import { resolveProjectGithubLabelIds } from './github-labels.js';
import { forwardComputerCall } from './machine-computer.js';
import { isChiefConversation, type MachineDeps, ownedStepRow } from './machines.js';
import { mcpConnectorDepsOf } from './mcp-servers.js';
import { stepScopeProjectId } from './picked-project.js';
import {
  createRelayToolRegistry,
  type RelayToolInvocation,
  type RelayToolNamespace,
} from './relay-tool-registry.js';
import { refuseRestrictedTurnTool, turnForcesOutboundApproval } from './report-turn.js';
import {
  coordinatorMemoryOwner,
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  profileForStep,
  type RouteProfile,
} from './routing-rules.js';
import { holdSecretRequest } from './secret-requests.js';
import { createLocalSkill, updateLocalSkill } from './skills.js';
import { stepNamesTask } from './task-naming.js';
import { executeThreadScheduleTool, isThreadScheduleTool } from './thread-schedule-tools.js';
import { updateAutonomousTodo } from './todos.js';
import { askWorkerQuestion, recordThreadReportLine } from './worker-questions.js';

export async function machineAsk(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  body: MachineAskBody,
  opts: { holdMs: number; signal?: AbortSignal } = { holdMs: ASK_HOLD_MS },
): Promise<MachineAskResponse> {
  const row = ownedStepRow(deps, machineId, stepId);
  refuseRestrictedTurnTool(deps.db, row.prompt, 'ask_user', {}, row.ownerMessageIds ?? []);
  if (row.kind === 'session') {
    const result = await askWorkerQuestion(deps, row, body, opts);
    deps.assertClaim?.();
    return result;
  }
  if (row.kind !== 'chief' || !isChiefConversation(row.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  if (row.status !== 'claimed') {
    throw new HttpError(409, 'ask_user requires a currently claimed turn');
  }
  const qDeps: ChiefQuestionDeps = {
    db: deps.db,
    hub: deps.hub,
    user: deps.user,
    vapidKeys: deps.vapidKeys,
    ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
  };
  const provenance = requireTurnProvenance(row.prompt, body.provenance, 'ask_user');
  const { content, created } = createOrGetQuestion(qDeps, {
    threadId: row.buildId,
    requestId: body.requestId,
    questions: body.questions,
    provenance,
    askedFor: row.ownerMessageIds ?? [],
  });
  if (!created) announceQuestion(qDeps, row.buildId, body.requestId);
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
  deps.assertClaim?.();
  return {
    status: settled.status,
    requestId: body.requestId,
    answers: settled.status === 'answered' ? (settled.answers ?? null) : null,
    reason: settled.status === 'cancelled' ? (settled.cancelReason ?? null) : null,
  };
}

export function isCoordinatorComputerTool(name: string): boolean {
  return (
    isComputerBrowserTool(name) ||
    isOwnComputerTool(name) ||
    isPhoneTool(name) ||
    name === 'attach_file' ||
    name === 'request_takeover' ||
    name === 'computer_observe' ||
    name === 'computer_act' ||
    name === 'desktop_snapshot' ||
    name === 'desktop_act'
  );
}

export async function relayComputerTool(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  name: string,
  params: Record<string, unknown>,
  toolCallId?: string,
  signal?: AbortSignal,
): Promise<ComputerRelayResult> {
  const row = ownedStepRow(deps, machineId, stepId);
  refuseRestrictedTurnTool(deps.db, row.prompt, name, params, row.ownerMessageIds ?? []);
  if (row.kind !== 'chief') {
    throw new HttpError(400, 'computer tools require a chief step');
  }
  if (!isChiefConversation(row.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  if (row.status !== 'claimed') {
    throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
  }
  return forwardComputerCall(
    deps,
    machineId,
    stepId,
    {
      computer: true,
      name: computerToolSchema.parse(name),
      toolCallId: toolCallId ?? randomUUID(),
      params,
    },
    signal !== undefined ? { signal } : {},
  );
}

interface RelayToolContext {
  readonly deps: MachineDeps;
  readonly machineId: string | null;
  readonly stepId: string;
  readonly row: typeof step.$inferSelect;
  readonly toolCallId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly runnerTokenHash?: string | null | undefined;
}

interface ChiefRelayTurn {
  readonly threadRow: typeof chiefThread.$inferSelect;
  readonly chiefRow: typeof chief.$inferSelect;
  readonly assertTurnClaim: () => void;
}

interface WorkerRelayTarget {
  readonly todoRow: typeof todo.$inferSelect;
}

function assertRestrictedToolAllowed(call: RelayToolInvocation<RelayToolContext>): void {
  const { deps, row } = call.context;
  refuseRestrictedTurnTool(deps.db, row.prompt, call.name, call.args, row.ownerMessageIds ?? []);
}

function resolveChiefRelayTurn(call: RelayToolInvocation<RelayToolContext>): ChiefRelayTurn {
  assertRestrictedToolAllowed(call);
  const { deps, machineId, stepId, row, runnerTokenHash } = call.context;
  if (!isChiefConversation(row.buildId)) {
    throw new HttpError(400, `step ${stepId} is not a chief step`);
  }
  if (row.status !== 'claimed') {
    throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
  }
  const threadId = row.buildId;
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (!threadRow) throw new NotFoundError(`chief thread ${threadId}`);
  const chiefRow = deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  if (!chiefRow) throw new NotFoundError(`chief ${threadRow.chiefId}`);
  const assertTurnClaim = () => {
    if (machineId !== null) {
      const runner = deps.db
        .select({ tokenHash: machine.tokenHash, retiredAt: machine.retiredAt })
        .from(machine)
        .where(eq(machine.id, machineId))
        .get();
      if (
        runnerTokenHash == null ||
        runner?.tokenHash !== runnerTokenHash ||
        runner.retiredAt !== null
      ) {
        throw new HttpError(401, 'unauthorized');
      }
    }
    const current = ownedStepRow(deps, machineId, stepId);
    if (current.status !== 'claimed' || current.claimedAt !== row.claimedAt) {
      throw new HttpError(409, 'Coordinator tools require a currently claimed turn');
    }
  };
  return { threadRow, chiefRow, assertTurnClaim };
}

function resolveWorkerRelayTarget(call: RelayToolInvocation<RelayToolContext>): WorkerRelayTarget {
  assertRestrictedToolAllowed(call);
  const { deps, row } = call.context;
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${row.buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${buildRow.todoId}`);
  return { todoRow };
}

function requireClaimedWorkerTarget(
  call: RelayToolInvocation<RelayToolContext>,
): WorkerRelayTarget {
  const target = resolveWorkerRelayTarget(call);
  if (call.context.row.status !== 'claimed') {
    throw new HttpError(409, 'worker tools require a currently claimed step');
  }
  return target;
}

const RELAY_TOOL_NAMESPACES: readonly RelayToolNamespace<RelayToolContext>[] = [
  {
    id: 'computer',
    matches: (name, stepKind) =>
      (isCoordinatorComputerTool(name) && (name !== 'attach_file' || stepKind === 'chief')) ||
      name.startsWith('user_computer_'),
    async execute(call) {
      const { deps, machineId, stepId, toolCallId, signal } = call.context;
      if (isCoordinatorComputerTool(call.name)) {
        return (
          await relayComputerTool(deps, machineId, stepId, call.name, call.args, toolCallId, signal)
        ).text;
      }
      assertRestrictedToolAllowed(call);
      throw new HttpError(
        400,
        `unknown own-Mac tool ${call.name}; the own-Mac tools are ${OWN_COMPUTER_TOOL_NAMES.join(', ')}`,
      );
    },
  },
  {
    id: 'thread-schedule',
    matches: (name) => isThreadScheduleTool(name),
    async execute(call) {
      assertRestrictedToolAllowed(call);
      if (!isThreadScheduleTool(call.name)) {
        throw new HttpError(400, `unknown schedule tool ${call.name}`);
      }
      const { deps, row } = call.context;
      if (row.kind !== 'plan' && !isBuildStepKind(row.kind)) {
        throw new HttpError(400, 'schedule tools require a plan or build step');
      }
      if (row.status !== 'claimed') {
        throw new HttpError(409, 'schedule tools require a currently claimed step');
      }
      const { todoRow } = requireClaimedWorkerTarget(call);
      return executeThreadScheduleTool(deps, todoRow, `worker:${row.id}`, call.name, call.args);
    },
  },
  {
    id: 'connector',
    matches: (name, stepKind) => stepKind === 'chief' && name.startsWith(CONNECTOR_TOOL_PREFIX),
    async execute(call) {
      const { deps, row, signal } = call.context;
      const { threadRow, assertTurnClaim } = resolveChiefRelayTurn(call);
      return executeConnectorToolCall(
        {
          db: deps.db,
          mcp: mcpConnectorDepsOf(deps),
          hub: deps.hub,
          user: deps.user,
          vapidKeys: deps.vapidKeys,
          reposDir: deps.reposDir,
          ...(deps.mailSend !== undefined ? { sendMail: deps.mailSend } : {}),
          ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
        },
        {
          teamId: threadRow.teamId,
          threadId: row.buildId,
          scopeProjectId: stepScopeProjectId(row),
          mcpGrant: row.mcpGrant,
          assertTurnClaim,
          ...(turnForcesOutboundApproval(deps.db, row.prompt) ? { untrustedTurn: true } : {}),
        },
        call.name,
        call.args,
        signal,
      );
    },
  },
  {
    id: 'secret-request',
    matches: (name, stepKind) => stepKind === 'chief' && name === REQUEST_SECRET_TOOL,
    async execute(call) {
      const { deps, stepId, signal } = call.context;
      const { threadRow } = resolveChiefRelayTurn(call);
      return holdSecretRequest(
        deps.db,
        { teamId: threadRow.teamId, stepId, params: call.args },
        signal !== undefined ? { signal } : {},
      );
    },
  },
  {
    id: 'chief',
    matches: (_name, stepKind) => stepKind === 'chief',
    async execute(call) {
      const { deps, stepId, row, toolCallId } = call.context;
      const { threadRow, chiefRow, assertTurnClaim } = resolveChiefRelayTurn(call);
      const threadId = row.buildId;
      const tool = isCaptureTool(call.name) ? call.name : undefined;
      const captured = tool !== undefined ? existingTurnCapture(stepId) : undefined;
      if (captured !== undefined && tool !== undefined) {
        capturePreCallWorld(deps.db, stepId, threadRow.teamId, tool, toolCallId, call.args);
      }
      let result: string;
      try {
        result = await executeChiefTool(
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
            ...(deps.githubBaseFetch !== undefined
              ? { githubBaseFetch: deps.githubBaseFetch }
              : {}),
            ...(deps.oauthClient !== undefined ? { oauthClient: deps.oauthClient } : {}),
            ...(deps.githubApp !== undefined ? { githubApp: deps.githubApp } : {}),
          },
          {
            teamId: threadRow.teamId,
            userId: threadRow.userId,
            chiefId: chiefRow.id,
            threadId,
            chiefAgentId: coordinatorMemoryOwner(deps.db, threadRow.teamId) ?? null,
            conversationId: threadId,
            ...(toolCallId !== undefined ? { toolCallId } : {}),
            stepId,
            turnPrompt: row.prompt,
            turnMessageIds: row.ownerMessageIds ?? [],
            turnScopeProjectId: stepScopeProjectId(row),
            turnScopeMixed: steeredFromAnotherScope(deps, row),
            assertTurnClaim,
          },
          call.name,
          call.args,
        );
      } catch (error) {
        deps.assertClaim?.();
        if (captured !== undefined && tool !== undefined) {
          captureToolResult(stepId, tool, {
            toolError: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      deps.assertClaim?.();
      if (captured !== undefined && tool !== undefined) captureToolResult(stepId, tool, result);
      return result;
    },
  },
  {
    id: 'worker-session',
    matches: (name, stepKind) =>
      stepKind === 'session' && (name === 'thread_report' || name === 'close_as_duplicate'),
    async execute(call) {
      const { deps, row } = call.context;
      const { todoRow } = resolveWorkerRelayTarget(call);
      if (row.status !== 'claimed') {
        throw new HttpError(409, `${call.name} requires a currently claimed step`);
      }
      if (call.name === 'thread_report') {
        if (todoRow.phase === 'closed') {
          throw new HttpError(409, 'thread_report: this task is closed');
        }
        return recordThreadReportLine(deps, row, call.args.line);
      }
      return closeThreadAsDuplicate(deps, row, todoRow, call.args);
    },
  },
  {
    id: 'worker-attachment',
    matches: (name, stepKind) => stepKind !== 'chief' && name === 'attach_file',
    async execute(call) {
      const { deps, row } = call.context;
      const { todoRow } = requireClaimedWorkerTarget(call);
      return attachWorkerFile(deps, row, todoRow, call.args);
    },
  },
  {
    id: 'worker-task-meta',
    matches: (name, stepKind) => stepKind !== 'chief' && name === 'set_task_meta',
    async execute(call) {
      const { deps, row } = call.context;
      const { todoRow } = requireClaimedWorkerTarget(call);
      if (!stepNamesTask(deps.db, row)) {
        throw new HttpError(409, 'set_task_meta is reserved for the first implementation step');
      }
      return setTaskMeta(deps, todoRow, call.args);
    },
  },
  {
    id: 'worker-skills',
    matches: (name, stepKind) =>
      stepKind !== 'chief' && (name === 'create_skill' || name === 'update_skill'),
    async execute(call) {
      const { deps, row } = call.context;
      const { todoRow } = requireClaimedWorkerTarget(call);
      const profile = profileForStep(deps.db, todoRow, row.kind, row.id);
      if (!profile) throw new HttpError(409, 'step has no routing rule — skill write has no actor');
      return executeWorkerSkillTool(
        deps,
        todoRow,
        profile,
        call.name as 'create_skill' | 'update_skill',
        call.args,
      );
    },
  },
  {
    id: 'worker-memory',
    matches: (_name, stepKind) => stepKind !== 'chief',
    async execute(call) {
      const { deps, row } = call.context;
      const { todoRow } = requireClaimedWorkerTarget(call);
      const profile = profileForStep(deps.db, todoRow, row.kind, row.id);
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
          stepId: row.id,
          attachmentsDir: deps.attachmentsDir,
        },
        call.name,
        call.args,
      );
    },
  },
];

export const relayToolRegistry = createRelayToolRegistry(RELAY_TOOL_NAMESPACES);

export async function executeRelayToolCall(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  name: string,
  params: Record<string, unknown>,
  toolCallId?: string,
  signal?: AbortSignal,
  runnerTokenHash?: string | null,
): Promise<string> {
  const row = ownedStepRow(deps, machineId, stepId);
  return relayToolRegistry.dispatch({
    name,
    args: params,
    stepKind: row.kind,
    context: {
      deps,
      machineId,
      stepId,
      row,
      toolCallId,
      signal,
      runnerTokenHash,
    },
  });
}

export function steeredFromAnotherScope(deps: MachineDeps, row: typeof step.$inferSelect): boolean {
  const scope = stepScopeProjectId(row);
  return steeredMessageScopes(deps.db, row).some((projectId) => projectId !== scope);
}

const THREAD_ACTOR: TransitionActor = { kind: 'agent', name: 'Thread', stopActor: 'system' };

function closeThreadAsDuplicate(
  deps: MachineDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  params: Record<string, unknown>,
): string {
  const { source, number } = params;
  if (projectOfTodo(deps.db, todoRow)?.repoKind !== 'github') {
    throw new HttpError(409, 'close_as_duplicate is only available in GitHub projects');
  }
  if (source !== 'task' && source !== 'github') {
    throw new HttpError(400, 'close_as_duplicate source must be "task" or "github"');
  }
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    throw new HttpError(400, 'close_as_duplicate number must be a positive integer');
  }
  if (todoRow.phase === 'closed' || todoRow.phase === 'done') {
    throw new HttpError(409, `close_as_duplicate: this task is already ${todoRow.phase}`);
  }
  let supersededBy: string | undefined;
  if (source === 'task') {
    const original = deps.db
      .select({ id: todo.id, phase: todo.phase })
      .from(todo)
      .where(
        and(
          eq(todo.teamId, todoRow.teamId),
          eq(todo.projectId, todoRow.projectId),
          eq(todo.seqNum, number),
        ),
      )
      .get();
    if (!original)
      throw new HttpError(400, `close_as_duplicate: no task #${number} in this project`);
    if (original.id === todoRow.id) {
      throw new HttpError(400, 'close_as_duplicate cannot name this task itself');
    }
    if (original.phase === 'closed') {
      throw new HttpError(409, `close_as_duplicate: task #${number} is closed, not a duplicate`);
    }
    supersededBy = original.id;
  } else {
    const ownIssue =
      todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef)?.issueNumber : null;
    const ownPulls = deps.db
      .select({ prNumber: build.prNumber })
      .from(build)
      .where(eq(build.todoId, todoRow.id))
      .all()
      .map((b) => b.prNumber);
    if (number === ownIssue || ownPulls.includes(number)) {
      throw new HttpError(
        400,
        `close_as_duplicate: #${number} is this task's own issue or pull request`,
      );
    }
  }
  const result = transitionTodos(
    deps,
    todoRow.teamId,
    [todoRow.id],
    'closed',
    THREAD_ACTOR,
    supersededBy !== undefined ? { supersededBy } : {},
  );
  if (!result.transitioned.includes(todoRow.id)) {
    throw new HttpError(409, 'close_as_duplicate: the task could not be closed');
  }
  const label = `${source === 'github' ? 'GitHub ' : ''}#${number}`;
  recordThreadReportLine(deps, row, `与 ${label} 重复，已停`);
  return `closed as a duplicate of ${label}; end your turn now`;
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
  return JSON.stringify({ todoId: record.id, title: record.title });
}

function normalizedMetaTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? derivePlaceholderTitle(raw) : '';
  if (title === '') throw new HttpError(400, 'invalid params.title: expected non-empty string');
  return title;
}

function setTaskMetaGithubForm(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  params: Record<string, unknown>,
): string {
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
  return JSON.stringify({
    todoId: record.id,
    title: record.title,
    githubLabelIds: record.githubLabelIds,
  });
}
