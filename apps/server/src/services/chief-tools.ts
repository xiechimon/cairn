import type { SecretBox, UserRecord } from '@cairn/shared';
import {
  AGENT_TOOL_DEFAULTS,
  createSkillBodySchema,
  DONE_ANNOUNCEMENT,
  IN_PROGRESS_PHASES,
  MERGE_HUMAN_ONLY_COPY,
  MODEL_SOURCE_RUNTIME_LABELS,
  todoOutputSchema,
  updateSkillToolParamsSchema,
} from '@cairn/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  chief,
  chiefThread,
  machine,
  message,
  project,
  schedule,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { todoAuthorizesAttachment } from './attachment-authorization.js';
import {
  advanceSplitWaves,
  applyBuildStepAction,
  cancelBuild,
  startBuilds,
  stopActiveStepsAfterExit,
} from './builds.js';
import { addChiefWatch, clearChiefWake, removeChiefWatches, setChiefWake } from './chief.js';
import { askUserQuestionsOfParams, createOrGetQuestion } from './chief-questions.js';
import { readConversationPage } from './conversation-page.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { isGithubRepoRef, readFile } from './git.js';
import { executeGithubReadTool } from './github-reads.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { defaultMcpConfigPath, listMcpServers } from './mcp-servers.js';
import {
  deleteMemoryEntry,
  listMemoryEntries,
  saveMemoryEntry,
  updateMemoryEntry,
} from './memory.js';
import { notifyChiefMessage } from './notifications.js';
import type { OAuthClientConfig } from './oauth.js';
import { getModelSources } from './providers.js';
import { createSchedule, deleteSchedule, listSchedules } from './schedules.js';
import { createSecret, deleteSecret, listSecrets, updateSecret } from './secrets.js';
import { createLocalSkill, scanLocalSkills, updateLocalSkill } from './skills.js';
import { seedFixedTags } from './tags.js';
import { createSplitTodo, type SplitSubtodoInput } from './todo-split.js';
import { createTodo, deleteTodo, getTodo, listTodos, setTodoPhase, updateTodo } from './todos.js';
import { insertGateAnnouncement } from './transcript.js';

export interface ChiefToolDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  box: SecretBox;
  user: UserRecord;
  convHub?: ConversationStreamHub;
  reposDir: string;
  attachmentsDir: string;
  skillsDir: string;
  mcpConfigPath?: string;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
}

export interface ChiefToolCtx {
  teamId: string;
  userId: string;
  chiefId: string;
  threadId: string;
  chiefAgentId: string | null;
  conversationId: string;
}

function skillAuditActor(ctx: ChiefToolCtx): { type: 'member' | 'agent'; id: string } {
  return ctx.chiefAgentId !== null
    ? { type: 'agent', id: ctx.chiefAgentId }
    : { type: 'member', id: ctx.userId };
}

type Params = Record<string, unknown>;

function str(params: Params, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v === '')
    throw new HttpError(400, `invalid params.${key}: expected non-empty string`);
  return v;
}
function optStr(params: Params, key: string): string | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `invalid params.${key}: expected string`);
  return v;
}
function optTodoOutput(params: Params, key: string): 'code' | 'info' | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  const parsed = todoOutputSchema.safeParse(v);
  if (!parsed.success) {
    throw new HttpError(400, `invalid params.${key}: expected "code" or "info"`);
  }
  return parsed.data;
}
function strArr(params: Params, key: string): string[] {
  const v = params[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new HttpError(400, `invalid params.${key}: expected string[]`);
  }
  return v as string[];
}
function num(params: Params, key: string): number | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new HttpError(400, `invalid params.${key}: expected number`);
  }
  return v;
}
function bool(params: Params, key: string, fallback: boolean): boolean {
  const v = params[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new HttpError(400, `invalid params.${key}: expected boolean`);
  return v;
}

function json(result: unknown): string {
  return JSON.stringify(result ?? null);
}

function requireProjectRow(db: Db, projectId: string, teamId: string) {
  const row = db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `project ${projectId}`);
  return row;
}
function requireTeamTodo(db: Db, todoId: string, teamId: string) {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  return row;
}
const DOCS_MAX_PATHS = 24;

export const CHIEF_TASK_LIST_MAX_OUTPUT_BYTES = 32 * 1024;
export const CHIEF_TASK_LIST_TITLE_MAX_CHARS = 160;
export const CHIEF_TASK_LIST_SUMMARY_MAX_CHARS = 240;

function requireTeamAgent(db: Db, agentId: string, teamId: string) {
  const row = db
    .select()
    .from(agent)
    .where(and(eq(agent.id, agentId), eq(agent.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `agent ${agentId}（不在本团队，或 id 抄错了）`);
  return row;
}
function requireTeamBuild(db: Db, buildId: string, teamId: string) {
  const row = db.select({ todoId: build.todoId }).from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new HttpError(404, `build ${buildId}`);
  const owned = db
    .select({ id: todo.id })
    .from(todo)
    .where(and(eq(todo.id, row.todoId), eq(todo.teamId, teamId)))
    .get();
  if (!owned) throw new HttpError(404, `build ${buildId}`);
  return row;
}
export async function executeChiefTool(
  deps: ChiefToolDeps,
  ctx: ChiefToolCtx,
  name: string,
  params: Params,
): Promise<string> {
  const { db } = deps;
  const svc = {
    db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    box: deps.box,
    ...(deps.githubFetch !== undefined ? { githubFetch: deps.githubFetch } : {}),
  };
  const boundChiefName =
    ctx.chiefAgentId !== null
      ? db
          .select({ name: agent.displayName })
          .from(agent)
          .where(eq(agent.id, ctx.chiefAgentId))
          .get()?.name
      : undefined;
  const chiefActor: TransitionActor = { kind: 'agent', name: boundChiefName ?? 'Chief' };
  switch (name) {
    case 'projects': {
      const rows = db.select().from(project).where(eq(project.teamId, ctx.teamId)).all();
      return json(
        rows.map((p) => {
          const todoCount = db
            .select({ n: sql<number>`count(*)` })
            .from(todo)
            .where(eq(todo.projectId, p.id))
            .get();
          return { id: p.id, name: p.name, repoKind: p.repoKind, todoCount: todoCount?.n ?? 0 };
        }),
      );
    }
    case 'todos': {
      const todoId = optStr(params, 'todoId');
      if (todoId !== undefined) {
        requireTeamTodo(db, todoId, ctx.teamId);
        return json(getTodo(svc, todoId));
      }
      const offset = num(params, 'offset') ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new HttpError(400, 'invalid params.offset: expected non-negative safe integer');
      }
      const projectId = optStr(params, 'projectId');
      const phase = optStr(params, 'phase');
      let records = listTodos(svc, { teamId: ctx.teamId, ...(projectId ? { projectId } : {}) });
      if (phase) records = records.filter((t) => t.phase === phase);
      const todos: { id: string; seqNum: number; title: string; phase: string; summary: string }[] =
        [];
      const response = { todos, total: records.length, nextOffset: null as number | null };
      for (const record of records.slice(offset)) {
        todos.push({
          id: record.id,
          seqNum: record.seqNum,
          title: record.title.slice(0, CHIEF_TASK_LIST_TITLE_MAX_CHARS),
          phase: record.phase,
          summary: record.spec.slice(0, CHIEF_TASK_LIST_SUMMARY_MAX_CHARS),
        });
        response.nextOffset = offset + todos.length < records.length ? offset + todos.length : null;
        if (Buffer.byteLength(json(response), 'utf8') > CHIEF_TASK_LIST_MAX_OUTPUT_BYTES) {
          todos.pop();
          response.nextOffset = offset + todos.length;
          break;
        }
      }
      return json(response);
    }
    case 'agents': {
      const rows = db.select().from(agent).where(eq(agent.teamId, ctx.teamId)).all();
      return json(
        rows.map((a) => ({
          id: a.id,
          displayName: a.displayName,
          description: a.description,
          provider: a.provider,
          modelId: a.modelId,
          thinkingLevel: a.thinkingLevel,
          tools: a.tools,
          defaultSkill: a.defaultSkill,
          skillsAllowlist: a.skillsAllowlist,
          mcpServers: a.mcpServers,
        })),
      );
    }
    case 'models': {
      const keysvc = { db, box: deps.box };
      const rows: {
        provider: string;
        providerLabel: string;
        modelId: string;
        modelName: string;
      }[] = [];
      const seen = new Set<string>();
      const push = (row: (typeof rows)[number]) => {
        const key = row.provider === 'claude-code' ? `${row.provider}/${row.modelId}` : row.modelId;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(row);
      };
      for (const source of getModelSources(keysvc, ctx.teamId).sources) {
        const providerLabel = MODEL_SOURCE_RUNTIME_LABELS[source.runtime] ?? source.runtime;
        for (const m of source.models) {
          if (m.id === '') continue;
          push({ provider: source.runtime, providerLabel, modelId: m.id, modelName: m.name });
        }
      }
      return json(rows);
    }
    case 'machines': {
      const rows = db.select().from(machine).where(eq(machine.teamId, ctx.teamId)).all();
      return json(
        rows.map((m) => ({
          id: m.id,
          name: m.name,
          online: m.online,
          latestCliVersion: m.latestCliVersion,
        })),
      );
    }
    case 'skills': {
      const scanned = scanLocalSkills(deps.skillsDir);
      return json(scanned.map((s) => ({ id: s.id, name: s.name, description: s.description })));
    }
    case 'secrets': {
      const keysvc = { db, box: deps.box };
      return json(listSecrets(keysvc, ctx.teamId));
    }
    case 'mcp_servers': {
      const rows = listMcpServers(
        { mcpConfigPath: deps.mcpConfigPath ?? defaultMcpConfigPath() },
        ctx.teamId,
      );
      return json(
        rows.map((m) => ({
          id: m.id,
          label: m.label,
          slug: m.slug,
          transport: m.transport,
          url: m.url,
        })),
      );
    }
    case 'schedules': {
      return json(listSchedules({ db, hub: deps.hub }, ctx.teamId));
    }
    case 'docs': {
      const projectId = str(params, 'projectId');
      const row = requireProjectRow(db, projectId, ctx.teamId);
      const paths = strArr(params, 'paths');
      if (paths.length === 0) {
        return json({ projectId, name: row.name, repoKind: row.repoKind, files: [] });
      }
      const capped = paths.slice(0, DOCS_MAX_PATHS);
      const ref = optStr(params, 'ref');
      const files: Record<string, unknown>[] = [];
      for (const p of capped) {
        try {
          const f = await readFile({ db, reposDir: deps.reposDir }, projectId, p, ref);
          files.push({ path: f.path, ref: f.ref, encoding: f.encoding, content: f.content });
        } catch (err) {
          files.push({ path: p, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return json({
        projectId,
        name: row.name,
        files,
        ...(paths.length > capped.length ? { omitted: paths.length - capped.length } : {}),
      });
    }
    case 'usage': {
      const buildId = optStr(params, 'buildId');
      const teamBuildIds = db
        .select({ id: build.id })
        .from(build)
        .innerJoin(todo, eq(todo.id, build.todoId))
        .where(eq(todo.teamId, ctx.teamId));
      const teamThreadIds = db
        .select({ id: chiefThread.id })
        .from(chiefThread)
        .where(eq(chiefThread.teamId, ctx.teamId));
      const owned = or(
        inArray(tokenUsage.buildId, teamBuildIds),
        inArray(tokenUsage.buildId, teamThreadIds),
      );
      const rows = db
        .select()
        .from(tokenUsage)
        .where(buildId ? and(eq(tokenUsage.buildId, buildId), owned) : owned)
        .all();
      return json(rows);
    }
    case 'issues':
    case 'pull_requests':
    case 'workflow_runs':
    case 'github_overlaps':
      return json(await executeGithubReadTool(deps, ctx.teamId, name, params));
    case 'attachment': {
      const attachmentId = str(params, 'attachmentId');
      const { readAttachmentMeta } = await import('./attachments.js');
      return json(readAttachmentMeta(deps, ctx.teamId, attachmentId));
    }
    case 'conversation': {
      const conversationId = str(params, 'conversationId');
      return json(readConversationPage(db, conversationId, optStr(params, 'before')));
    }

    case 'create_todo': {
      const projectId = str(params, 'projectId');
      requireProjectRow(db, projectId, ctx.teamId);
      const output = optTodoOutput(params, 'output');
      const record = createTodo(svc, {
        teamId: ctx.teamId,
        projectId,
        title: str(params, 'title'),
        spec: str(params, 'spec'),
        createdBy: ctx.chiefAgentId,
        ownerId: ctx.userId,
        orchestration: { threadId: ctx.threadId },
        ...(output !== undefined ? { output } : {}),
      });
      db.update(todo).set({ sourceBuildId: ctx.chiefId }).where(eq(todo.id, record.id)).run();
      return json({ ...record, sourceBuildId: ctx.chiefId });
    }
    case 'split_todo': {
      const todoId = str(params, 'todoId');
      requireTeamTodo(db, todoId, ctx.teamId);
      const rawSubtodos = params.subtodos;
      if (!Array.isArray(rawSubtodos) || rawSubtodos.length === 0) {
        throw new HttpError(400, 'invalid params.subtodos: expected non-empty array');
      }
      const subtodos: SplitSubtodoInput[] = rawSubtodos.map((raw, i) => {
        if (typeof raw !== 'object' || raw === null) {
          throw new HttpError(400, `invalid params.subtodos[${i}]: expected object`);
        }
        const item = raw as Record<string, unknown>;
        const blockedByRaw = item.blockedBy;
        const blockedBy =
          blockedByRaw === undefined || blockedByRaw === null
            ? undefined
            : Array.isArray(blockedByRaw)
              ? blockedByRaw.map((n) => {
                  if (typeof n !== 'number' || !Number.isInteger(n)) {
                    throw new HttpError(
                      400,
                      `invalid params.subtodos[${i}].blockedBy: expected integer[]`,
                    );
                  }
                  return n;
                })
              : (() => {
                  throw new HttpError(
                    400,
                    `invalid params.subtodos[${i}].blockedBy: expected array`,
                  );
                })();
        const output = optTodoOutput(item, 'output');
        return {
          title: str(item, 'title'),
          spec: str(item, 'spec'),
          agentId: str(item, 'agentId'),
          ...(blockedBy !== undefined ? { blockedBy } : {}),
          ...(output !== undefined ? { output } : {}),
        };
      });
      const result = createSplitTodo(
        { db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
        {
          parentId: todoId,
          subtodos,
          chiefAgentId: ctx.chiefAgentId,
          chiefId: ctx.chiefId,
          threadId: ctx.threadId,
          actorName: chiefActor.name,
        },
      );
      return json(result);
    }
    case 'update_todo': {
      const todoId = str(params, 'todoId');
      requireTeamTodo(db, todoId, ctx.teamId);
      const record = updateTodo(svc, todoId, {
        ...(optStr(params, 'title') !== undefined ? { title: optStr(params, 'title') } : {}),
        ...(optStr(params, 'spec') !== undefined ? { spec: optStr(params, 'spec') } : {}),
        ...(params.tagIds !== undefined ? { tagIds: strArr(params, 'tagIds') } : {}),
        ...(optStr(params, 'projectId') !== undefined
          ? { projectId: optStr(params, 'projectId') }
          : {}),
      });
      if (!record) throw new HttpError(404, `todo ${todoId}`);
      return json(record);
    }
    case 'delete_todos': {
      const ids = strArr(params, 'todoIds');
      for (const id of ids) requireTeamTodo(db, id, ctx.teamId);
      const deleted = ids.filter((id) => deleteTodo(svc, id));
      return json({ deleted });
    }
    case 'close_todos':
      return json(
        transitionTodos(deps, ctx.teamId, strArr(params, 'todoIds'), 'closed', chiefActor),
      );
    case 'reopen_todos':
      return json(transitionTodos(deps, ctx.teamId, strArr(params, 'todoIds'), 'todo', chiefActor));
    case 'complete_todos':
      return json(transitionTodos(deps, ctx.teamId, strArr(params, 'todoIds'), 'done', chiefActor));
    case 'message_todo': {
      const todoId = str(params, 'todoId');
      const row = requireTeamTodo(db, todoId, ctx.teamId);
      const conversationId = row.latestBuildId;
      if (conversationId) {
        db.insert(message)
          .values({
            id: newRecordId(),
            conversationId,
            role: 'user',
            content: str(params, 'content'),
            createdAt: nowMs(),
          })
          .run();
      }
      return json({ todoId, conversationId, posted: conversationId !== null });
    }
    case 'create_project': {
      const name = str(params, 'name');
      const repoKind = optStr(params, 'repoKind');
      const id = newRecordId();
      db.insert(project)
        .values({
          id,
          name,
          teamId: ctx.teamId,
          repoKind: repoKind === 'hosted' ? 'hosted' : null,
          repoName: null,
          githubRepo: null,
        })
        .run();
      seedFixedTags(db, id);
      return json({
        id,
        name,
        note: repoKind === 'hosted' ? 'hosted repo provisioning via REST face' : 'plain project',
      });
    }
    case 'update_project': {
      const projectId = str(params, 'projectId');
      requireProjectRow(db, projectId, ctx.teamId);
      const name = optStr(params, 'name');
      if (name !== undefined)
        db.update(project).set({ name }).where(eq(project.id, projectId)).run();
      return json({ id: projectId, name });
    }
    case 'connect_repo': {
      const projectId = str(params, 'projectId');
      requireProjectRow(db, projectId, ctx.teamId);
      const githubRepo = str(params, 'githubRepo');
      if (!isGithubRepoRef(githubRepo))
        throw new HttpError(400, 'invalid params.githubRepo: expected "owner/repo"');
      db.update(project)
        .set({ repoKind: 'github', githubRepo })
        .where(eq(project.id, projectId))
        .run();
      return json({ id: projectId, repoKind: 'github', githubRepo });
    }
    case 'create_agent': {
      const id = newRecordId();
      db.insert(agent)
        .values({
          id,
          teamId: ctx.teamId,
          displayName: str(params, 'displayName'),
          description: optStr(params, 'description') ?? null,
          status: 'active',
          avatarUrl: null,
          provider: optStr(params, 'provider') ?? null,
          modelId: optStr(params, 'modelId') ?? null,
          thinkingLevel: null,
          tools: [...AGENT_TOOL_DEFAULTS],
          secrets: [],
          defaultSkill: null,
          skillsAllowlist: null,
          mcpServers: [],
        })
        .run();
      return json({ id });
    }
    case 'update_agent': {
      const agentId = str(params, 'agentId');
      const row = db
        .select()
        .from(agent)
        .where(and(eq(agent.id, agentId), eq(agent.teamId, ctx.teamId)))
        .get();
      if (!row) throw new HttpError(404, `agent ${agentId}`);
      const sets: Partial<typeof row> = {};
      const dn = optStr(params, 'displayName');
      const desc = optStr(params, 'description');
      const prov = optStr(params, 'provider');
      const model = optStr(params, 'modelId');
      if (dn !== undefined) sets.displayName = dn;
      if (desc !== undefined) sets.description = desc;
      if (prov !== undefined) sets.provider = prov;
      if (model !== undefined) sets.modelId = model;
      if (Object.keys(sets).length > 0)
        db.update(agent).set(sets).where(eq(agent.id, agentId)).run();
      return json({ id: agentId, ...sets });
    }
    case 'delete_agents': {
      const ids = strArr(params, 'agentIds');
      for (const id of ids)
        db.delete(agent)
          .where(and(eq(agent.id, id), eq(agent.teamId, ctx.teamId)))
          .run();
      return json({ deleted: ids });
    }
    case 'create_skill': {
      const body = parseWith(createSkillBodySchema, params, 'params');
      return json(
        createLocalSkill(
          {
            db,
            skillsDir: deps.skillsDir,
            teamId: ctx.teamId,
            actor: skillAuditActor(ctx),
          },
          body,
        ),
      );
    }
    case 'update_skill': {
      const body = parseWith(updateSkillToolParamsSchema, params, 'params');
      return json(
        updateLocalSkill(
          {
            db,
            skillsDir: deps.skillsDir,
            teamId: ctx.teamId,
            actor: skillAuditActor(ctx),
          },
          body.skillId,
          body,
        ),
      );
    }
    case 'set_secret': {
      const keysvc = { db, box: deps.box };
      const name = str(params, 'name');
      const existing = listSecrets(keysvc, ctx.teamId).find((s) => s.name === name);
      const value = str(params, 'value');
      const description = optStr(params, 'description') ?? null;
      if (existing) {
        return json(updateSecret(keysvc, ctx.teamId, existing.id, { name, value, description }));
      }
      const record = createSecret(keysvc, { teamId: ctx.teamId, name, description, value });
      return json(record);
    }
    case 'delete_secrets': {
      const keysvc = { db, box: deps.box };
      const names = strArr(params, 'names');
      const all = listSecrets(keysvc, ctx.teamId);
      const deleted: string[] = [];
      for (const n of names) {
        const hit = all.find((s) => s.name === n || s.id === n);
        if (hit && deleteSecret(keysvc, ctx.teamId, hit.id)) deleted.push(n);
      }
      return json({ deleted });
    }
    case 'schedule_todo': {
      const todoId = str(params, 'todoId');
      const row = requireTeamTodo(db, todoId, ctx.teamId);
      const kind = str(params, 'kind') as 'once' | 'hourly' | 'daily' | 'weekly';
      const at = num(params, 'at');
      if (at === undefined) throw new HttpError(400, 'invalid params.at: expected number');
      const record = createSchedule(
        { db, hub: deps.hub },
        {
          teamId: ctx.teamId,
          projectId: row.projectId,
          todoId,
          kind,
          at,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          createdBy: ctx.userId,
        },
      );
      return json(record);
    }
    case 'unschedule_todo': {
      const todoId = str(params, 'todoId');
      requireTeamTodo(db, todoId, ctx.teamId);
      const rows = db.select().from(schedule).where(eq(schedule.todoId, todoId)).all();
      for (const r of rows) deleteSchedule({ db, hub: deps.hub }, r.id);
      return json({ todoId, removed: rows.length });
    }

    case 'run_builds': {
      const todoIds = strArr(params, 'todoIds');
      const withPlan = bool(params, 'withPlan', true);
      const dispatchReason = optStr(params, 'dispatchReason') ?? null;
      const assignmentIn = params.assignment as
        | {
            plan?: { agentId?: string };
            build?: { agentId?: string };
            review?: { agentId?: string };
            verify?: { agentId?: string };
          }
        | undefined;
      const assignment = {
        plan: assignmentIn?.plan?.agentId ? { agentId: assignmentIn.plan.agentId } : null,
        build: assignmentIn?.build?.agentId ? { agentId: assignmentIn.build.agentId } : null,
        review: assignmentIn?.review?.agentId ? { agentId: assignmentIn.review.agentId } : null,
        verify: assignmentIn?.verify?.agentId ? { agentId: assignmentIn.verify.agentId } : null,
      };
      if (assignment.plan === null && assignment.build === null) {
        throw new HttpError(
          400,
          'assignment 整参缺失或两槽全空：无指派 Agent 的 build 无人可领。请传 assignment 指派 Agent（至少一个槽非空），例如 {"assignment":{"build":{"agentId":"<agentId>"}}}，然后重试 run_builds。',
        );
      }
      for (const slot of [
        assignment.plan,
        assignment.build,
        assignment.review,
        assignment.verify,
      ]) {
        if (slot !== null) requireTeamAgent(db, slot.agentId, ctx.teamId);
      }
      const targets = todoIds.map((todoId) => {
        const row = requireTeamTodo(db, todoId, ctx.teamId);
        return { todoId, row, projectName: requireProjectRow(db, row.projectId, ctx.teamId).name };
      });
      const started: unknown[] = [];
      for (const { todoId, row, projectName } of targets) {
        const builds = startBuilds(
          { db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
          {
            projectId: row.projectId,
            todoIds: [todoId],
            assignment,
            withPlan,
            triggerSource: 'chief',
          },
        );
        started.push(...builds);
        const todoRecord = getTodo(svc, todoId);
        if (todoRecord) {
          addChiefWatch(deps, {
            teamId: ctx.teamId,
            todo: todoRecord,
            projectName,
            threadId: ctx.threadId,
          });
        }
      }
      return json({ builds: started, withPlan, dispatchReason, triggerSource: 'chief' });
    }
    case 'run_review': {
      const buildId = str(params, 'buildId');
      requireTeamBuild(db, buildId, ctx.teamId);
      await applyBuildStepAction(deps, buildId, { action: 'review' }, chiefActor.name);
      return json({ buildId, review: 'fanned-out', dispatchedBy: 'chief' });
    }
    case 'confirm_builds': {
      const buildIds = strArr(params, 'buildIds');
      for (const buildId of buildIds) await confirmBuild(deps, buildId, chiefActor.name);
      return json({ confirmed: buildIds });
    }
    case 'cancel_builds': {
      const buildIds = strArr(params, 'buildIds');
      for (const buildId of buildIds) {
        requireTeamBuild(db, buildId, ctx.teamId);
        cancelBuild(deps, buildId);
      }
      return json({ cancelled: buildIds });
    }
    case 'merge_builds': {
      const buildIds = strArr(params, 'buildIds');
      return json({ rejected: true, buildIds, reason: MERGE_HUMAN_ONLY_COPY });
    }

    case 'ask_user': {
      const questions = askUserQuestionsOfParams(params);
      const requestId = optStr(params, 'requestId') ?? `ask-${newRecordId()}`;
      const { content } = createOrGetQuestion(
        {
          db,
          hub: deps.hub,
          user: deps.user,
          ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
        },
        {
          threadId: ctx.threadId,
          requestId,
          questions,
        },
      );
      return json({
        status: content.status,
        requestId,
        note: 'question card delivered; the blocking answer channel is POST /api/machine/ask (newer daemon builds relay it automatically)',
      });
    }
    case 'notify_user': {
      const text = str(params, 'message');
      const agentRow = ctx.chiefAgentId
        ? db.select().from(agent).where(eq(agent.id, ctx.chiefAgentId)).get()
        : undefined;
      notifyChiefMessage(
        { db, hub: deps.hub, user: deps.user },
        {
          threadId: ctx.threadId,
          message: text,
          agent: agentRow
            ? { name: agentRow.displayName, avatarUrl: agentRow.avatarUrl }
            : { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
        },
      );
      return json({ notified: true });
    }
    case 'save_memory': {
      if (ctx.chiefAgentId === null)
        throw new HttpError(409, 'chief agent not bound — memory has no store');
      const projectId = optStr(params, 'projectId') ?? null;
      const sourceTodoId = optStr(params, 'sourceTodoId') ?? null;
      if (projectId !== null) requireProjectRow(db, projectId, ctx.teamId);
      if (sourceTodoId !== null) requireTeamTodo(db, sourceTodoId, ctx.teamId);
      const row = saveMemoryEntry(db, {
        agentId: ctx.chiefAgentId,
        teamId: ctx.teamId,
        title: str(params, 'title'),
        content: str(params, 'content'),
        force: bool(params, 'force', false),
        projectId,
        sourceTodoId,
        sourceBuildId: ctx.conversationId,
      });
      return json(row);
    }
    case 'update_memory': {
      const memoryId = str(params, 'memoryId');
      if (ctx.chiefAgentId === null) throw new HttpError(404, `memory ${memoryId}`);
      return json(
        updateMemoryEntry(db, {
          memoryId,
          agentId: ctx.chiefAgentId,
          teamId: ctx.teamId,
          content: str(params, 'content'),
        }),
      );
    }
    case 'delete_memory': {
      const memoryId = str(params, 'memoryId');
      const removed =
        ctx.chiefAgentId === null
          ? 0
          : deleteMemoryEntry(db, {
              memoryId,
              agentId: ctx.chiefAgentId,
              teamId: ctx.teamId,
            });
      if (removed === 0) throw new HttpError(404, `memory ${memoryId}`);
      return json({ deleted: memoryId });
    }
    case 'memories': {
      if (ctx.chiefAgentId === null) return json([]);
      return json(
        listMemoryEntries(
          db,
          { agentId: ctx.chiefAgentId, teamId: ctx.teamId },
          bool(params, 'includeInvalid', false),
        ),
      );
    }
    case 'watch_todos': {
      const todoIds = strArr(params, 'todoIds');
      const reason = optStr(params, 'reason');
      const targets = todoIds.flatMap((todoId) => {
        const record = getTodo(svc, todoId);
        if (!record || record.teamId !== ctx.teamId) return [];
        return [{ record, projectName: requireProjectRow(db, record.projectId, ctx.teamId).name }];
      });
      for (const { record, projectName } of targets) {
        addChiefWatch(deps, {
          teamId: ctx.teamId,
          todo: record,
          projectName,
          threadId: ctx.threadId,
          ...(reason ? { reason } : {}),
        });
      }
      return json({ watched: todoIds });
    }
    case 'unwatch_todos': {
      const todoIds = strArr(params, 'todoIds');
      removeChiefWatches(deps, ctx.teamId, todoIds);
      return json({ unwatched: todoIds });
    }
    case 'wakes': {
      const row = db.select().from(chief).where(eq(chief.id, ctx.chiefId)).get();
      return json(row?.wakes ?? []);
    }
    case 'set_wake': {
      const at = num(params, 'at');
      if (at === undefined) throw new HttpError(400, 'invalid params.at: expected number');
      const wake = setChiefWake(deps, ctx.teamId, {
        at,
        ...(optStr(params, 'note') ? { note: optStr(params, 'note') } : {}),
        ...(optStr(params, 'todoId') ? { todoId: optStr(params, 'todoId') } : {}),
        threadId: ctx.threadId,
      });
      return json(wake);
    }
    case 'clear_wake': {
      const ok = clearChiefWake(deps, ctx.teamId, str(params, 'wakeId'));
      return json({ cleared: ok });
    }

    default:
      throw new HttpError(400, `unknown chief tool: ${name}`);
  }
}

export type TransitionActor = { kind: 'user' | 'agent'; name: string };

export type TransitionDeps = Pick<ChiefToolDeps, 'db' | 'hub' | 'machineHub' | 'user' | 'convHub'>;

export function transitionTodos(
  deps: TransitionDeps,
  teamId: string,
  todoIds: string[],
  to: 'closed' | 'todo' | 'done',
  actor: TransitionActor,
): { transitioned: string[]; skipped: string[]; reasons?: Record<string, string> } {
  const svc = {
    db: deps.db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    convHub: deps.convHub,
  };
  const transitioned: string[] = [];
  const skipped: string[] = [];
  const reasons: Record<string, string> = {};
  for (const id of todoIds) {
    const owned = deps.db
      .select({ id: todo.id, phase: todo.phase, latestBuildId: todo.latestBuildId })
      .from(todo)
      .where(and(eq(todo.id, id), eq(todo.teamId, teamId)))
      .get();
    if (!owned) {
      skipped.push(id);
      continue;
    }
    if (
      to === 'done' &&
      actor.kind === 'agent' &&
      (owned.phase === 'review' || owned.phase === 'confirm')
    ) {
      skipped.push(id);
      reasons[id] =
        '待确认/审核关口的 done 落地必须由人过闸（发起合并，或用户在看板确认）。把卡停在当前关口，用 notify_user 唤醒用户处理。';
      continue;
    }
    try {
      const record = setTodoPhase(svc, id, to);
      if (record) {
        transitioned.push(id);
        const doneFromInProgress =
          to === 'done' && (IN_PROGRESS_PHASES as readonly string[]).includes(owned.phase);
        if ((to === 'closed' && owned.phase !== 'closed') || doneFromInProgress)
          stopActiveStepsAfterExit(svc, id);
        if (to === 'done' && owned.phase !== 'done' && owned.latestBuildId !== null) {
          insertGateAnnouncement(deps, owned.latestBuildId, DONE_ANNOUNCEMENT, actor.name);
        }
        if (to === 'done' && owned.phase !== 'done') {
          advanceSplitWaves(
            { db: deps.db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
            id,
          );
        }
      } else skipped.push(id);
    } catch {
      skipped.push(id);
    }
  }
  return Object.keys(reasons).length > 0
    ? { transitioned, skipped, reasons }
    : { transitioned, skipped };
}

function buildDeps(deps: ChiefToolDeps) {
  return {
    db: deps.db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    convHub: deps.convHub,
    reposDir: deps.reposDir,
    box: deps.box,
    githubFetch: deps.githubFetch,
    oauthClient: deps.oauthClient,
  };
}
export async function confirmBuild(
  deps: ChiefToolDeps,
  buildId: string,
  actor?: string,
): Promise<void> {
  if (!deps.db.select().from(build).where(eq(build.id, buildId)).get()) {
    throw new HttpError(404, `build ${buildId}`);
  }
  try {
    await applyBuildStepAction(buildDeps(deps), buildId, { action: 'confirm' }, actor);
  } catch (err) {
    if (
      err instanceof HttpError &&
      err.status === 409 &&
      err.message.endsWith('当前相位 building')
    ) {
      return;
    }
    throw err;
  }
}

export interface WorkerMemoryCtx {
  teamId: string;
  agentId: string;
  todoId: string;
  projectId: string | null;
  buildId: string;
  attachmentsDir: string;
}

export async function executeWorkerMemoryTool(
  db: Db,
  ctx: WorkerMemoryCtx,
  name: string,
  params: Params,
): Promise<string> {
  switch (name) {
    case 'save_memory': {
      const projectId = optStr(params, 'projectId');
      const sourceTodoId = optStr(params, 'sourceTodoId');
      if (projectId !== undefined) requireProjectRow(db, projectId, ctx.teamId);
      if (sourceTodoId !== undefined) requireTeamTodo(db, sourceTodoId, ctx.teamId);
      const row = saveMemoryEntry(db, {
        agentId: ctx.agentId,
        teamId: ctx.teamId,
        title: str(params, 'title'),
        content: str(params, 'content'),
        force: bool(params, 'force', false),
        projectId: projectId ?? ctx.projectId,
        sourceTodoId: sourceTodoId ?? ctx.todoId,
        sourceBuildId: ctx.buildId,
      });
      return json(row);
    }
    case 'update_memory': {
      return json(
        updateMemoryEntry(db, {
          memoryId: str(params, 'memoryId'),
          agentId: ctx.agentId,
          teamId: ctx.teamId,
          content: str(params, 'content'),
        }),
      );
    }
    case 'delete_memory': {
      const memoryId = str(params, 'memoryId');
      const removed = deleteMemoryEntry(db, {
        memoryId,
        agentId: ctx.agentId,
        teamId: ctx.teamId,
      });
      if (removed === 0) throw new HttpError(404, `memory ${memoryId}`);
      return json({ deleted: memoryId });
    }
    case 'memories': {
      return json(
        listMemoryEntries(
          db,
          { agentId: ctx.agentId, teamId: ctx.teamId },
          bool(params, 'includeInvalid', false),
        ),
      );
    }
    case 'attachment': {
      const { readAttachmentMeta } = await import('./attachments.js');
      const attachmentId = str(params, 'attachmentId');
      if (!todoAuthorizesAttachment(db, ctx.todoId, attachmentId)) {
        throw new HttpError(404, `attachment ${attachmentId}`);
      }
      return json(
        readAttachmentMeta({ db, attachmentsDir: ctx.attachmentsDir }, ctx.teamId, attachmentId),
      );
    }
    default:
      throw new HttpError(400, `tool ${name} is not relayed for worker steps`);
  }
}
