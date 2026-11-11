import type {
  ChiefNoticeContent,
  GitIdentity,
  SecretBox,
  StopActor,
  UserRecord,
} from '@cairn/shared';
import {
  CHIEF_NOTICE_KIND,
  coordinatorCreateTodoParamsSchema,
  coordinatorUpdateTodoParamsSchema,
  createSkillBodySchema,
  DONE_ANNOUNCEMENT,
  IN_PROGRESS_PHASES,
  isChiefConversationId,
  isWaitingPhase,
  MEMORY_LAYERS,
  MERGE_HUMAN_ONLY_COPY,
  type MemoryLayer,
  MODEL_SOURCE_RUNTIME_LABELS,
  snoozeTodoBodySchema,
  updateSkillToolParamsSchema,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  chief,
  chiefThread,
  machine,
  project,
  schedule,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { todoAuthorizesAttachment } from './attachment-authorization.js';
import { readAttachmentMeta, resolveToolAttachmentId } from './attachments.js';
import {
  applyBuildStepAction,
  assertNamedMachineForNewTask,
  cancelBuild,
  stopActiveStepsAfterExit,
} from './builds.js';
import {
  addChiefWatch,
  clearChiefWake,
  parseChiefTrigger,
  removeChiefWatches,
  requireTurnProvenance,
  setChiefWake,
  upsertChiefMessage,
} from './chief.js';
import { readHistory, searchHistory } from './chief-history.js';
import { askUserQuestionsOfParams, createOrGetQuestion } from './chief-questions.js';
import { assertToolNotRemoved, executeRouterTool, isRouterTool } from './chief-router-tools.js';
import { readConversationPage } from './conversation-page.js';
import { createRequestTodo, updateRequestTodo } from './coordinator-request.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { isGithubRepoRef, readFile } from './git.js';
import { executeGithubReadTool } from './github-reads.js';
import { readFillableProfile } from './job-applications.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { defaultMcpConfigPath, listMcpServers } from './mcp-servers.js';
import {
  deleteMemoryEntry,
  listMemoryEntries,
  saveMemoryEntry,
  searchMemoryEntries,
  updateMemoryEntry,
} from './memory.js';
import { notifyChiefMessage } from './notifications.js';
import type { OAuthClientConfig } from './oauth.js';
import { coordinatorAcceptsReview, ownershipOf } from './owner.js';
import { getModelSources } from './providers.js';
import type { VapidKeys } from './push.js';
import { createSchedule, deleteSchedule, listSchedules } from './schedules.js';
import { createSecret, deleteSecret, listSecrets, updateSecret } from './secrets.js';
import { createLocalSkill, scanLocalSkills, updateLocalSkill } from './skills.js';
import { snoozeTodo } from './snooze.js';
import { listBuildStepRoutes } from './step-route.js';
import { startThreadBuild } from './thread-message.js';
import { deleteTodo, getTodo, listTodos, setTodoPhase } from './todos.js';
import { insertGateAnnouncement } from './transcript.js';

export interface ChiefToolDeps {
  githubAppTokenSocket?: string | null | undefined;
  githubAppIdentity?: GitIdentity | null | undefined;
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  box: SecretBox;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
  convHub?: ConversationStreamHub;
  reposDir: string;
  workspacesDir?: string | undefined;
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
  turnPrompt?: string | null;
  turnMessageIds?: readonly string[];
  turnScopeProjectId?: string | null;
  turnScopeMixed?: boolean;
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

function memoryLayer(params: Params): MemoryLayer {
  const v = params.layer;
  if (v === undefined || v === null) return 'core';
  if (typeof v !== 'string' || !(MEMORY_LAYERS as readonly string[]).includes(v)) {
    throw new HttpError(400, 'invalid params.layer');
  }
  return v as MemoryLayer;
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
const PROJECT_WRITE_TOOLS = new Set([
  'create_todo',
  'split_todo',
  'update_todo',
  'delete_todos',
  'close_todos',
  'reopen_todos',
  'complete_todos',
  'message_todo',
  'update_project',
  'connect_repo',
  'schedule_todo',
  'unschedule_todo',
  'snooze_todos',
  'run_builds',
  'run_review',
  'confirm_builds',
  'cancel_builds',
  'merge_builds',
  'open_thread',
  'message_thread',
  'stop_thread',
  'save_memory',
]);

function idsOf(params: Params, keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = params[key];
    if (typeof value === 'string') return [value];
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  });
}

function requireUnarchivedTargets(db: Db, teamId: string, name: string, params: Params): void {
  if (!PROJECT_WRITE_TOOLS.has(name)) return;
  const projectIds = idsOf(params, ['projectId', 'projectIds']);
  const todoIds = idsOf(params, ['todoId', 'todoIds', 'sourceTodoId']);
  const buildIds = idsOf(params, ['buildId', 'buildIds']);
  const viaTodos =
    todoIds.length === 0
      ? []
      : db
          .select({ projectId: todo.projectId })
          .from(todo)
          .where(and(inArray(todo.id, todoIds), eq(todo.teamId, teamId)))
          .all();
  const viaBuilds =
    buildIds.length === 0
      ? []
      : db
          .select({ projectId: todo.projectId })
          .from(build)
          .innerJoin(todo, eq(todo.id, build.todoId))
          .where(and(inArray(build.id, buildIds), eq(todo.teamId, teamId)))
          .all();
  const targets = [
    ...projectIds,
    ...viaTodos.map((r) => r.projectId),
    ...viaBuilds.map((r) => r.projectId),
  ];
  if (targets.length === 0) return;
  const archived = db
    .select({ id: project.id })
    .from(project)
    .where(
      and(inArray(project.id, targets), eq(project.teamId, teamId), isNotNull(project.archivedAt)),
    )
    .get();
  if (archived) {
    throw new HttpError(409, `project ${archived.id} is archived; unarchive it before changing it`);
  }
}

const DOCS_MAX_PATHS = 24;
const DOCS_MAX_FILE_BYTES = 64 * 1024;
const DOCS_MAX_RESPONSE_BYTES = 128 * 1024;
const DOCS_MAX_JSON_EXPANSION = 6;
const DOCS_FILE_METADATA_RESERVE_BYTES = 2048;

export const CHIEF_TASK_LIST_MAX_OUTPUT_BYTES = 32 * 1024;
export const CHIEF_TASK_LIST_TITLE_MAX_CHARS = 160;
export const CHIEF_TASK_LIST_SUMMARY_MAX_CHARS = 240;

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
function requireTeamConversation(db: Db, conversationId: string, teamId: string): void {
  if (!isChiefConversationId(conversationId)) {
    requireTeamBuild(db, conversationId, teamId);
    return;
  }
  const thread = db
    .select({ id: chiefThread.id })
    .from(chiefThread)
    .where(and(eq(chiefThread.id, conversationId), eq(chiefThread.teamId, teamId)))
    .get();
  if (!thread) throw new HttpError(404, `conversation ${conversationId}`);
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
    vapidKeys: deps.vapidKeys,
    box: deps.box,
    githubAppTokenSocket: deps.githubAppTokenSocket,
    githubAppIdentity: deps.githubAppIdentity,
    ...(deps.githubFetch !== undefined ? { githubFetch: deps.githubFetch } : {}),
  };
  const chiefActor: TransitionActor = {
    kind: 'agent',
    name: 'Coordinator',
    stopActor: 'coordinator',
  };
  assertToolNotRemoved(name);
  requireUnarchivedTargets(db, ctx.teamId, name, params);
  if (isRouterTool(name)) return executeRouterTool(deps, ctx, name, params);
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
          const segments = p.toLowerCase().split(/[\\/]/);
          if (
            segments.some((segment) =>
              /^(?:\.git|\.ssh|\.aws|\.gnupg|\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\.json)?|id_rsa|id_ed25519)$/.test(
                segment,
              ),
            ) ||
            /\.(?:pem|key|p12|pfx)$/i.test(p)
          ) {
            throw new HttpError(403, 'credential file access denied');
          }
          const f = await readFile(
            { db, reposDir: deps.reposDir, workspacesDir: deps.workspacesDir },
            projectId,
            p,
            ref,
            {
              defaultBranch: true,
              maxBytes: Math.max(
                0,
                Math.min(
                  DOCS_MAX_FILE_BYTES,
                  Math.floor(
                    (DOCS_MAX_RESPONSE_BYTES -
                      Buffer.byteLength(
                        json({ projectId, name: row.name, files, omitted: paths.length }),
                      ) -
                      DOCS_FILE_METADATA_RESERVE_BYTES) /
                      DOCS_MAX_JSON_EXPANSION,
                  ),
                ),
              ),
            },
          );
          files.push({
            path: f.path,
            ref: f.ref,
            commit: f.commit,
            encoding: f.encoding,
            content: f.content,
          });
        } catch (err) {
          files.push({
            path: p.slice(0, 512),
            error: (err instanceof Error ? err.message : String(err)).slice(0, 1024),
          });
        }
        if (
          Buffer.byteLength(json({ projectId, name: row.name, files, omitted: paths.length })) >
          DOCS_MAX_RESPONSE_BYTES
        ) {
          files.pop();
          files.push({
            path: p.slice(0, 512),
            error: 'repository document response limit exceeded',
          });
          if (
            Buffer.byteLength(json({ projectId, name: row.name, files, omitted: paths.length })) >
            DOCS_MAX_RESPONSE_BYTES
          ) {
            files.pop();
            break;
          }
        }
      }
      return json({
        projectId,
        name: row.name,
        files,
        ...(paths.length > files.length ? { omitted: paths.length - files.length } : {}),
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
      const usage = db
        .select()
        .from(tokenUsage)
        .where(buildId ? and(eq(tokenUsage.buildId, buildId), owned) : owned)
        .all();
      const ownedBuildIds =
        buildId !== undefined
          ? db
              .select({ id: build.id })
              .from(build)
              .innerJoin(todo, eq(todo.id, build.todoId))
              .where(and(eq(build.id, buildId), eq(todo.teamId, ctx.teamId)))
              .all()
              .map((row) => row.id)
          : db
              .select({ id: build.id })
              .from(build)
              .innerJoin(todo, eq(todo.id, build.todoId))
              .where(eq(todo.teamId, ctx.teamId))
              .all()
              .map((row) => row.id);
      return json({ usage, routes: listBuildStepRoutes(db, ownedBuildIds) });
    }
    case 'issues':
    case 'pull_requests':
    case 'github_overlap':
    case 'workflow_runs':
      return json(await executeGithubReadTool(deps, ctx.teamId, name, params));
    case 'attachment': {
      const attachmentId = resolveToolAttachmentId(db, ctx.teamId, str(params, 'attachmentId'));
      return json(readAttachmentMeta(deps, ctx.teamId, attachmentId));
    }
    case 'conversation': {
      const conversationId = str(params, 'conversationId');
      requireTeamConversation(db, conversationId, ctx.teamId);
      return json(readConversationPage(db, conversationId, optStr(params, 'before')));
    }
    case 'search_history':
      return json(
        await searchHistory(db, ctx, {
          query: str(params, 'query'),
          limit: num(params, 'limit'),
          before: optStr(params, 'before'),
        }),
      );
    case 'read_history':
      return json(
        readHistory(db, ctx, strArr(params, 'ids'), {
          offset: num(params, 'offset'),
          maxChars: num(params, 'maxChars'),
        }),
      );

    case 'create_todo': {
      const body = parseWith(coordinatorCreateTodoParamsSchema, params, 'params');
      requireProjectRow(db, body.projectId, ctx.teamId);
      assertNamedMachineForNewTask(svc, ctx.teamId);
      const record = createRequestTodo(svc, ctx, body, {
        createdBy:
          ctx.turnPrompt !== undefined && parseChiefTrigger(ctx.turnPrompt) === 'user'
            ? ctx.userId
            : ctx.chiefAgentId,
        ownerId: ctx.userId,
      });
      db.update(todo).set({ sourceBuildId: ctx.chiefId }).where(eq(todo.id, record.id)).run();
      const buildId = startThreadBuild(svc, requireTeamTodo(db, record.id, ctx.teamId), {
        origin: 'coordinator',
        actor: 'Coordinator',
      });
      return json({ ...record, ...getTodo(svc, record.id), sourceBuildId: ctx.chiefId, buildId });
    }
    case 'update_todo': {
      const body = parseWith(coordinatorUpdateTodoParamsSchema, params, 'params');
      requireTeamTodo(db, body.todoId, ctx.teamId);
      const record = updateRequestTodo(svc, ctx, body);
      if (!record) throw new HttpError(404, `todo ${body.todoId}`);
      return json(record);
    }
    case 'delete_todos': {
      const ids = strArr(params, 'todoIds');
      for (const id of ids) requireTeamTodo(db, id, ctx.teamId);
      const deleted = ids.filter((id) => deleteTodo(svc, id));
      return json({ deleted });
    }
    case 'close_todos': {
      const supersededBy = optStr(params, 'supersededBy');
      return json(
        transitionTodos(
          deps,
          ctx.teamId,
          strArr(params, 'todoIds'),
          'closed',
          chiefActor,
          supersededBy !== undefined ? { supersededBy } : {},
        ),
      );
    }
    case 'reopen_todos': {
      const out = transitionTodos(deps, ctx.teamId, strArr(params, 'todoIds'), 'todo', chiefActor);
      const started: string[] = [];
      const notStarted: Record<string, string> = {};
      for (const id of out.transitioned) {
        try {
          startThreadBuild(svc, requireTeamTodo(db, id, ctx.teamId), {
            origin: 'coordinator',
            actor: 'Coordinator',
          });
          started.push(id);
        } catch (error) {
          notStarted[id] = error instanceof Error ? error.message : String(error);
        }
      }
      return json({
        ...out,
        started,
        ...(Object.keys(notStarted).length > 0 ? { notStarted } : {}),
      });
    }
    case 'complete_todos':
      return json(transitionTodos(deps, ctx.teamId, strArr(params, 'todoIds'), 'done', chiefActor));
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
      const projectId = optStr(params, 'projectId') ?? null;
      const existing = listSecrets(keysvc, ctx.teamId).find(
        (s) => s.name === name && s.projectId === projectId,
      );
      const value = str(params, 'value');
      const description = optStr(params, 'description') ?? null;
      if (existing) {
        return json(updateSecret(keysvc, ctx.teamId, existing.id, { name, value, description }));
      }
      const record = createSecret(keysvc, {
        teamId: ctx.teamId,
        name,
        description,
        value,
        projectId,
      });
      return json(record);
    }
    case 'delete_secrets': {
      const keysvc = { db, box: deps.box };
      const names = strArr(params, 'names');
      const projectId = optStr(params, 'projectId') ?? null;
      const all = listSecrets(keysvc, ctx.teamId);
      const deleted: string[] = [];
      for (const n of names) {
        const hit =
          all.find((s) => s.id === n) ?? all.find((s) => s.name === n && s.projectId === projectId);
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
      for (const r of rows) deleteSchedule({ db, hub: deps.hub, user: deps.user }, r.id);
      return json({ todoId, removed: rows.length });
    }

    case 'snooze_todos': {
      const todoIds = strArr(params, 'todoIds');
      const body = parseWith(
        snoozeTodoBodySchema,
        {
          until:
            typeof params.until === 'string' && /^\d+$/.test(params.until)
              ? Number(params.until)
              : params.until,
          ...(optStr(params, 'tz') ? { tz: optStr(params, 'tz') } : {}),
        },
        'params',
      );
      const snoozed: { id: string; snoozeMode: string | null; snoozedUntil: number | null }[] = [];
      const skipped: string[] = [];
      for (const id of todoIds) {
        const owned = db
          .select({ id: todo.id })
          .from(todo)
          .where(and(eq(todo.id, id), eq(todo.teamId, ctx.teamId)))
          .get();
        const record = owned ? snoozeTodo(svc, id, body) : null;
        if (!record) {
          skipped.push(id);
          continue;
        }
        snoozed.push({
          id,
          snoozeMode: record.snoozeMode ?? null,
          snoozedUntil: record.snoozedUntil ?? null,
        });
      }
      return json({ snoozed, skipped });
    }

    case 'cancel_builds': {
      const buildIds = strArr(params, 'buildIds');
      const reason = str(params, 'reason');
      for (const buildId of buildIds) requireTeamBuild(db, buildId, ctx.teamId);
      for (const buildId of buildIds) {
        cancelBuild(deps, buildId, { actor: 'coordinator', reason });
      }
      return json({ cancelled: buildIds });
    }
    case 'merge_builds': {
      const buildIds = strArr(params, 'buildIds');
      return json({ rejected: true, buildIds, reason: MERGE_HUMAN_ONLY_COPY });
    }

    case 'ask_user': {
      const provenance = requireTurnProvenance(
        ctx.turnPrompt ?? null,
        params.provenance,
        'ask_user',
      );
      const questions = askUserQuestionsOfParams(params);
      const requestId = optStr(params, 'requestId') ?? `ask-${newRecordId()}`;
      const { content } = createOrGetQuestion(
        {
          db,
          hub: deps.hub,
          user: deps.user,
          vapidKeys: deps.vapidKeys,
          ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
        },
        {
          threadId: ctx.threadId,
          requestId,
          questions,
          provenance,
          askedFor: [...(ctx.turnMessageIds ?? [])],
        },
      );
      return json({
        status: content.status,
        requestId,
        note: 'question card delivered; the blocking answer channel is POST /api/machine/ask (newer daemon builds relay it automatically)',
      });
    }
    case 'notify_user': {
      const provenance = requireTurnProvenance(
        ctx.turnPrompt ?? null,
        params.provenance,
        'notify_user',
      );
      const text = str(params, 'message');
      const notice = {
        id: newRecordId(),
        threadId: ctx.threadId,
        role: 'system' as const,
        content: JSON.stringify({
          kind: CHIEF_NOTICE_KIND,
          message: text,
          provenance,
        } satisfies ChiefNoticeContent),
        createdAt: nowMs(),
      };
      upsertChiefMessage(db, notice);
      deps.convHub?.publishMessage(ctx.threadId, notice);
      notifyChiefMessage(
        { db, hub: deps.hub, user: deps.user },
        {
          threadId: ctx.threadId,
          message: text,
          agent: { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
        },
      );
      return json({ notified: true });
    }
    case 'save_memory': {
      if (ctx.chiefAgentId === null)
        throw new HttpError(409, 'no coordinator routing rule — memory has no store');
      const explicitProject = optStr(params, 'projectId');
      if (explicitProject === undefined && ctx.turnScopeMixed === true) {
        throw new HttpError(
          400,
          'this turn now covers more than one project: pass projectId so the memory lands in the right project',
        );
      }
      const projectId = explicitProject ?? ctx.turnScopeProjectId ?? null;
      const sourceTodoId = optStr(params, 'sourceTodoId') ?? null;
      if (projectId !== null) {
        requireProjectRow(db, projectId, ctx.teamId);
        requireUnarchivedTargets(db, ctx.teamId, name, { projectId });
      }
      if (sourceTodoId !== null) requireTeamTodo(db, sourceTodoId, ctx.teamId);
      const layer = memoryLayer(params);
      const row = saveMemoryEntry(db, {
        agentId: ctx.chiefAgentId,
        teamId: ctx.teamId,
        title: str(params, 'title'),
        content: str(params, 'content'),
        force: bool(params, 'force', false),
        projectId,
        sourceTodoId,
        sourceBuildId: ctx.conversationId,
        source: 'Coordinator',
        layer,
        threadId: layer === 'scratchpad' ? ctx.threadId : null,
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
          threadId: ctx.threadId,
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
              threadId: ctx.threadId,
            });
      if (removed === 0) throw new HttpError(404, `memory ${memoryId}`);
      return json({ deleted: memoryId });
    }
    case 'memories': {
      if (ctx.chiefAgentId === null) return json([]);
      const entries = listMemoryEntries(
        db,
        { agentId: ctx.chiefAgentId, teamId: ctx.teamId, threadId: ctx.threadId },
        bool(params, 'includeInvalid', false),
      );
      const query = optStr(params, 'query');
      return json(query === undefined ? entries : searchMemoryEntries(entries, query));
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

    case 'job_profile':
      return json(readFillableProfile(db, ctx.userId));
    default:
      throw new HttpError(400, `unknown chief tool: ${name}`);
  }
}

export type TransitionActor = { kind: 'user' | 'agent'; name: string; stopActor: StopActor };

export type TransitionDeps = Pick<
  ChiefToolDeps,
  'db' | 'hub' | 'machineHub' | 'user' | 'vapidKeys' | 'convHub'
>;

export function transitionTodos(
  deps: TransitionDeps,
  teamId: string,
  todoIds: string[],
  to: 'closed' | 'todo' | 'done',
  actor: TransitionActor,
  opts: { supersededBy?: string } = {},
): { transitioned: string[]; skipped: string[]; reasons?: Record<string, string> } {
  const svc = {
    db: deps.db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    vapidKeys: deps.vapidKeys,
    convHub: deps.convHub,
  };
  if (opts.supersededBy !== undefined) {
    requireTeamTodo(deps.db, opts.supersededBy, teamId);
    if (todoIds.includes(opts.supersededBy)) {
      throw new HttpError(400, 'supersededBy must name a todo that is not being closed');
    }
  }
  const transitioned: string[] = [];
  const skipped: string[] = [];
  const reasons: Record<string, string> = {};
  for (const id of todoIds) {
    const owned = deps.db
      .select()
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
      isWaitingPhase(owned.phase) &&
      !coordinatorAcceptsReview(ownershipOf(deps.db, owned))
    ) {
      skipped.push(id);
      reasons[id] =
        '待确认/审核关口的 done 落地必须由人过闸（发起合并，或用户在看板确认）。把卡停在当前关口，用 notify_user 唤醒用户处理。';
      continue;
    }
    try {
      const record = setTodoPhase(svc, id, to);
      if (record && to === 'closed') {
        deps.db
          .update(todo)
          .set({ supersededBy: opts.supersededBy ?? null })
          .where(eq(todo.id, id))
          .run();
      }
      if (record) {
        transitioned.push(id);
        const doneFromInProgress =
          to === 'done' && (IN_PROGRESS_PHASES as readonly string[]).includes(owned.phase);
        if ((to === 'closed' && owned.phase !== 'closed') || doneFromInProgress)
          stopActiveStepsAfterExit(svc, id, {
            actor: actor.stopActor,
            reason: `${to === 'closed' ? 'closed' : 'marked done'} by ${actor.name}`,
          });
        if (to === 'done' && owned.phase !== 'done' && owned.latestBuildId !== null) {
          insertGateAnnouncement(deps, owned.latestBuildId, DONE_ANNOUNCEMENT, actor.name);
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
    vapidKeys: deps.vapidKeys,
    convHub: deps.convHub,
    reposDir: deps.reposDir,
    box: deps.box,
    githubAppTokenSocket: deps.githubAppTokenSocket,
    githubAppIdentity: deps.githubAppIdentity,
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
    await applyBuildStepAction(buildDeps(deps), buildId, { action: 'confirm' }, actor, 'automatic');
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
  sourceName: string | null;
  todoId: string;
  projectId: string | null;
  buildId: string;
  attachmentsDir: string;
  teamScoped?: boolean;
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
      const layer = memoryLayer(params);
      const row = saveMemoryEntry(db, {
        agentId: ctx.agentId,
        teamId: ctx.teamId,
        title: str(params, 'title'),
        content: str(params, 'content'),
        force: bool(params, 'force', false),
        projectId: projectId ?? ctx.projectId,
        sourceTodoId: sourceTodoId ?? ctx.todoId,
        sourceBuildId: ctx.buildId,
        source: ctx.sourceName,
        layer,
        threadId: layer === 'scratchpad' ? ctx.todoId : null,
        teamScoped: ctx.teamScoped,
      });
      return json(row);
    }
    case 'update_memory': {
      return json(
        updateMemoryEntry(db, {
          memoryId: str(params, 'memoryId'),
          agentId: ctx.agentId,
          teamId: ctx.teamId,
          threadId: ctx.todoId,
          content: str(params, 'content'),
          teamScoped: ctx.teamScoped,
        }),
      );
    }
    case 'delete_memory': {
      const memoryId = str(params, 'memoryId');
      const removed = deleteMemoryEntry(db, {
        memoryId,
        agentId: ctx.agentId,
        teamId: ctx.teamId,
        threadId: ctx.todoId,
        teamScoped: ctx.teamScoped,
      });
      if (removed === 0) throw new HttpError(404, `memory ${memoryId}`);
      return json({ deleted: memoryId });
    }
    case 'memories': {
      return json(
        listMemoryEntries(
          db,
          {
            agentId: ctx.agentId,
            teamId: ctx.teamId,
            threadId: ctx.todoId,
            teamScoped: ctx.teamScoped,
          },
          bool(params, 'includeInvalid', false),
        ),
      );
    }
    case 'attachment': {
      const attachmentId = resolveToolAttachmentId(db, ctx.teamId, str(params, 'attachmentId'));
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
