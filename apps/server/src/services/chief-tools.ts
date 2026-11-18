import type {
  ChiefNoticeContent,
  GitIdentity,
  SecretBox,
  StopActor,
  UserRecord,
} from '@cairn/shared';
import {
  actionByToolName,
  CHIEF_NOTICE_KIND,
  coordinatorCreateTodoParamsSchema,
  coordinatorUpdateTodoParamsSchema,
  createSkillBodySchema,
  DONE_ANNOUNCEMENT,
  fenceReportText,
  IN_PROGRESS_PHASES,
  isChiefConversationId,
  isComposioSecretName,
  isMailSecretName,
  isWaitingPhase,
  MODEL_SOURCE_RUNTIME_LABELS,
  SECRET_NAME_PATTERN,
  SECRET_NAME_RULE,
  SUGGEST_REPLIES_TOOL_NAME,
  updateSkillToolParamsSchema,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  chief,
  chiefMessage,
  chiefThread,
  machine,
  notification,
  project,
  schedule,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { proposalCardId } from './action-proposals.js';
import { executeAction } from './action-registry.js';
import { todoAuthorizesAttachment } from './attachment-authorization.js';
import { readAttachmentMeta, resolveToolAttachmentId } from './attachments.js';
import { browserPasswordIds } from './browser-passwords.js';
import {
  applyBuildStepAction,
  assertNamedMachineForNewTask,
  cancelBuild,
  requestMerge,
  stopActiveStepsAfterExit,
} from './builds.js';
import {
  addChiefWatch,
  clearChiefWake,
  insertChiefMessageOnce,
  parseChiefTrigger,
  removeChiefWatches,
  requireTurnProvenance,
  setChiefWake,
} from './chief.js';
import { channelMessages, readHistory, searchHistory } from './chief-history.js';
import {
  APPROVAL_CARD_ID_PREFIX,
  announceQuestion,
  askUserQuestionsOfParams,
  type ChiefQuestionDeps,
  createOrGetQuestion,
} from './chief-questions.js';
import { suggestQuickReplies } from './chief-quick-replies.js';
import { assertToolNotRemoved, executeRouterTool, isRouterTool } from './chief-router-tools.js';
import { readConversationPage } from './conversation-page.js';
import {
  createRequestTodo,
  refuseInfoCardReplacedByCode,
  updateRequestTodo,
} from './coordinator-request.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { effectDedupeKey } from './external-effects.js';
import { isGithubRepoRef, readFile } from './git.js';
import { executeGithubReadTool } from './github-reads.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { defaultMcpConfigPath, listMcpServers } from './mcp-servers.js';
import { executeMemoryDocumentTool } from './memory-documents.js';
import { executeMemoryEditTool } from './memory-edit.js';
import { memoryEditIdOfPrompt } from './memory-edit-turns.js';
import { notifyChiefMessage } from './notifications.js';
import type { OAuthClientConfig } from './oauth.js';
import { coordinatorAcceptsReview, ownershipOf } from './owner.js';
import { listedProjects } from './personal-space.js';
import { createProject, ensureResearchProject } from './projects.js';
import { getModelSources } from './providers.js';
import type { VapidKeys } from './push.js';
import {
  acceptReport,
  refuseRestrictedTurnTool,
  reportAcknowledged,
  reportNoticeId,
  reportRefOfCall,
  reportRefOfPrompt,
  requireCurrentReportTurn,
  turnForcesOutboundApproval,
} from './report-turn.js';
import { assertPlatformChangeAllowed, setTodoPlatform } from './routing-rules.js';
import { createSchedule, deleteSchedule, listSchedules } from './schedules.js';
import { createSecret, deleteSecret, listSecrets, updateSecret } from './secrets.js';
import { createLocalSkill, scanLocalSkills, updateLocalSkill } from './skills.js';
import { listBuildStepRoutes } from './step-route.js';
import { startThreadBuild } from './thread-message.js';
import { getTodo, listTodos, setTodoArchived, setTodoPhase } from './todos.js';
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

const PROJECT_CREATED_NEXT =
  "The project exists; a task thread cannot create projects or call the Cairn API. The task text is the owner's words verbatim, so if the owner's message also asks for work inside this project, call create_todo with quotes that cover only that work, never the sentence asking you to create the project.";

export interface ChiefToolCtx {
  teamId: string;
  userId: string;
  chiefId: string;
  threadId: string;
  chiefAgentId: string | null;
  conversationId: string;
  toolCallId?: string;
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
function json(result: unknown): string {
  return JSON.stringify(result ?? null);
}

function requireProjectRow(db: Db, projectId: string, teamId: string) {
  const row = db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), listedProjects(teamId)))
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
  'archive_todos',
  'unarchive_todos',
  'complete_todos',
  'message_todo',
  'update_project',
  'connect_repo',
  'schedule_todo',
  'unschedule_todo',
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
const SEARCH_QUERY_MAX_CHARS = 200;
const SEARCH_QUERY_MAX_TERMS = 8;
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
  const turnPrompt = ctx.turnPrompt ?? null;
  const turnMessageIds = ctx.turnMessageIds ?? [];
  refuseRestrictedTurnTool(deps.db, turnPrompt, name, params, turnMessageIds);
  const { db } = deps;
  requireCurrentReportTurn(db, turnPrompt, turnMessageIds, name, params);
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
  if (name === SUGGEST_REPLIES_TOOL_NAME) return suggestQuickReplies(deps, ctx, params);
  const action = actionByToolName(name);
  if (action?.surfaces.includes('coordinator') === true) {
    const result = executeAction(
      { db, reposDir: deps.reposDir },
      {
        id: action.id,
        input: params,
        actor: 'coordinator',
        surface: 'coordinator',
        teamId: ctx.teamId,
        threadId: ctx.threadId,
        scopeProjectId: ctx.turnScopeProjectId ?? null,
      },
    );
    if (result.status !== 'pending') return json(result);
    if (result.created) announceQuestion(deps, ctx.threadId, proposalCardId(result.proposalId));
    return json({
      ...result,
      note: '没有执行任何改动。审批卡已发给用户；只有用户在卡片上批准后服务端才会执行。告诉用户在等批准，然后结束本轮。',
    });
  }
  switch (name) {
    case 'projects': {
      const rows = db.select().from(project).where(listedProjects(ctx.teamId)).all();
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
      const query = optStr(params, 'query');
      if (query !== undefined && query.length > SEARCH_QUERY_MAX_CHARS) {
        throw new HttpError(
          400,
          `invalid params.query: at most ${SEARCH_QUERY_MAX_CHARS} characters`,
        );
      }
      const terms =
        query === undefined ? [] : [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
      if (query !== undefined && (terms.length === 0 || terms.length > SEARCH_QUERY_MAX_TERMS)) {
        throw new HttpError(
          400,
          `invalid params.query: expected 1 to ${SEARCH_QUERY_MAX_TERMS} distinct search terms`,
        );
      }
      let records = listTodos(svc, { teamId: ctx.teamId, ...(projectId ? { projectId } : {}) });
      if (phase) records = records.filter((t) => t.phase === phase);
      if (terms.length > 0) {
        records = records.filter((t) => {
          const text = `${t.title}\n${t.spec}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        });
      }
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
          capabilities: m.capabilities,
        })),
      );
    }
    case 'skills': {
      const reachEnabled = db
        .select({ capabilities: machine.capabilities })
        .from(machine)
        .where(eq(machine.teamId, ctx.teamId))
        .all()
        .some((row) => row.capabilities?.agentReach !== undefined);
      const scanned = scanLocalSkills(deps.skillsDir).filter(
        (skill) => skill.id !== 'agent-reach' || reachEnabled,
      );
      return json(scanned.map((s) => ({ id: s.id, name: s.name, description: s.description })));
    }
    case 'secrets': {
      const keysvc = { db, box: deps.box };
      return json(listSecrets(keysvc, ctx.teamId));
    }
    case 'mcp_servers': {
      return json(
        listMcpServers(
          { mcpConfigPath: deps.mcpConfigPath ?? defaultMcpConfigPath(), db },
          ctx.teamId,
        ).map((m) => ({
          id: m.id,
          label: m.label,
          slug: m.slug,
          transport: m.transport,
          url: m.url,
          source: m.source,
          ...(m.status !== null ? { status: m.status } : {}),
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
    case 'workflow_runs':
      return json(await executeGithubReadTool(deps, ctx.teamId, name, params));
    case 'attachment': {
      const attachmentId = resolveToolAttachmentId(db, ctx.teamId, str(params, 'attachmentId'));
      const meta = readAttachmentMeta(deps, ctx.teamId, attachmentId);
      const reportOf = db
        .select({ seqNum: todo.seqNum })
        .from(build)
        .innerJoin(todo, eq(todo.id, build.todoId))
        .where(and(eq(build.reportAttachmentId, attachmentId), eq(todo.teamId, ctx.teamId)))
        .get();
      return json(
        reportOf === undefined || meta.encoding !== 'utf8'
          ? meta
          : {
              ...meta,
              trust: 'untrusted-report',
              content: fenceReportText(`#${reportOf.seqNum}`, meta.content),
            },
      );
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
    case 'channel_messages':
      return json(
        await channelMessages(db, ctx, {
          channel: str(params, 'channel'),
          query: optStr(params, 'query'),
          limit: num(params, 'limit'),
          before: optStr(params, 'before'),
        }),
      );

    case 'create_todo': {
      const body = parseWith(coordinatorCreateTodoParamsSchema, params, 'params');
      assertNamedMachineForNewTask(svc, ctx.teamId);
      const untrustedTurn = turnForcesOutboundApproval(db, turnPrompt);
      const record = db.transaction(() => {
        const projectRow =
          body.projectId === undefined
            ? ensureResearchProject(db, ctx.teamId)
            : requireProjectRow(db, body.projectId, ctx.teamId);
        const created = createRequestTodo(
          svc,
          ctx,
          { ...body, projectId: projectRow.id },
          {
            createdBy:
              ctx.turnPrompt !== undefined && parseChiefTrigger(ctx.turnPrompt) === 'user'
                ? ctx.userId
                : ctx.chiefAgentId,
            ownerId: ctx.userId,
            withoutSelfIssue: untrustedTurn,
          },
        );
        db.update(todo).set({ sourceBuildId: ctx.chiefId }).where(eq(todo.id, created.id)).run();
        if (body.platform !== undefined) {
          setTodoPlatform(db, requireTeamTodo(db, created.id, ctx.teamId), body.platform);
        }
        if (!untrustedTurn)
          addChiefWatch(deps, {
            teamId: ctx.teamId,
            todo: created,
            projectName: projectRow.name,
            threadId: ctx.threadId,
          });
        return created;
      });
      if (untrustedTurn)
        return json({
          ...record,
          ...getTodo(svc, record.id),
          sourceBuildId: ctx.chiefId,
          buildId: null,
          note: 'Created but not started: this turn carries outside content, so only the owner starts the task. Tell the owner it is waiting for them.',
        });
      const buildId = startThreadBuild(svc, requireTeamTodo(db, record.id, ctx.teamId), {
        origin: 'coordinator',
        actor: 'Coordinator',
      });
      return json({ ...record, ...getTodo(svc, record.id), sourceBuildId: ctx.chiefId, buildId });
    }
    case 'update_todo': {
      const { platform, ...body } = parseWith(coordinatorUpdateTodoParamsSchema, params, 'params');
      const os = platform === undefined ? undefined : platform === 'any' ? null : platform;
      const moves =
        os !== undefined &&
        assertPlatformChangeAllowed(db, requireTeamTodo(db, body.todoId, ctx.teamId), os);
      const record = updateRequestTodo(svc, ctx, body);
      if (!record) throw new HttpError(404, `todo ${body.todoId}`);
      if (!moves || os === undefined) return json(record);
      setTodoPlatform(db, requireTeamTodo(db, body.todoId, ctx.teamId), os);
      svc.machineHub?.wake(ctx.teamId);
      return json({ ...record, ...getTodo(svc, body.todoId) });
    }
    case 'archive_todos': {
      const supersededBy = optStr(params, 'supersededBy');
      const ids = strArr(params, 'todoIds');
      if (supersededBy !== undefined) {
        const replacement = requireTeamTodo(db, supersededBy, ctx.teamId);
        refuseInfoCardReplacedByCode(
          db,
          { teamId: ctx.teamId, threadId: ctx.threadId, turnMessageIds: ctx.turnMessageIds },
          ids,
          replacement.output,
          optStr(params, 'codeChangeQuote'),
        );
      }
      const finished = new Set(
        db
          .select({ id: todo.id })
          .from(todo)
          .where(and(inArray(todo.id, ids), eq(todo.teamId, ctx.teamId), eq(todo.phase, 'done')))
          .all()
          .map((row) => row.id),
      );
      const out = transitionTodos(
        deps,
        ctx.teamId,
        ids.filter((id) => !finished.has(id)),
        'closed',
        chiefActor,
        supersededBy !== undefined ? { supersededBy } : {},
      );
      for (const id of finished) setTodoArchived(svc, id, true);
      return json({ ...out, archived: [...finished, ...out.transitioned] });
    }
    case 'unarchive_todos': {
      const unarchived: string[] = [];
      const skipped: string[] = [];
      const started: string[] = [];
      const notStarted: Record<string, string> = {};
      for (const id of strArr(params, 'todoIds')) {
        const owned = db
          .select({ phase: todo.phase, archivedAt: todo.archivedAt })
          .from(todo)
          .where(and(eq(todo.id, id), eq(todo.teamId, ctx.teamId)))
          .get();
        if (
          !owned ||
          (owned.archivedAt === null && owned.phase !== 'closed') ||
          !setTodoArchived(svc, id, false)
        ) {
          skipped.push(id);
          continue;
        }
        unarchived.push(id);
        if (owned.phase !== 'closed') continue;
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
        unarchived,
        skipped,
        started,
        ...(Object.keys(notStarted).length > 0 ? { notStarted } : {}),
      });
    }
    case 'complete_todos': {
      const complete = () =>
        transitionTodos(deps, ctx.teamId, strArr(params, 'todoIds'), 'done', chiefActor, {
          silentSettleThreadId: ctx.threadId,
        });
      const report = reportRefOfCall(turnPrompt, turnMessageIds, name, params);
      if (report === null) return json(complete());
      const { result, ack } = acceptReport(
        db,
        ctx.threadId,
        report,
        params.silent === true,
        complete,
      );
      if (ack !== null) deps.convHub?.publishMessage(ctx.threadId, ack);
      return json(result);
    }
    case 'create_project': {
      const row = await createProject(deps, {
        name: str(params, 'name'),
        teamId: ctx.teamId,
        ...(optStr(params, 'repoKind') === 'hosted' ? { kind: 'hosted' as const } : {}),
      });
      return json({
        id: row.id,
        name: row.name,
        repoKind: row.repoKind,
        repoName: row.repoName,
        next: PROJECT_CREATED_NEXT,
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
      if (isMailSecretName(name) || isComposioSecretName(name))
        throw new HttpError(400, SECRET_NAME_RULE);
      const projectId = optStr(params, 'projectId') ?? null;
      const existing = listSecrets(keysvc, ctx.teamId).find(
        (s) => s.name === name && s.projectId === projectId,
      );
      const browser = browserPasswordIds(db, ctx.teamId);
      if (
        listSecrets(keysvc, ctx.teamId).some(
          (s) =>
            s.name === name &&
            (s.delivery === 'http' || s.kind === 'pair' || browser.has(s.id)) &&
            (s.projectId === null || projectId === null || s.projectId === projectId),
        )
      )
        throw new HttpError(
          400,
          `secret ${name} uses protected delivery and can only be changed in settings`,
        );
      const value = str(params, 'value');
      const description = optStr(params, 'description') ?? null;
      if (existing) {
        return json(
          updateSecret(keysvc, ctx.teamId, existing.id, {
            name,
            value,
            description,
            kind: 'secret',
          }),
        );
      }
      if (!SECRET_NAME_PATTERN.test(name)) throw new HttpError(400, SECRET_NAME_RULE);
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
      const browser = browserPasswordIds(db, ctx.teamId);
      if (all.some((s) => browser.has(s.id) && (names.includes(s.name) || names.includes(s.id))))
        throw new HttpError(400, 'browser passwords can only be deleted in settings');
      if (all.some((s) => s.kind === 'pair' && (names.includes(s.name) || names.includes(s.id))))
        throw new HttpError(400, 'username+password pairs can only be deleted in settings');
      if (
        all.some(
          (s) => isComposioSecretName(s.name) && (names.includes(s.name) || names.includes(s.id)),
        )
      )
        throw new HttpError(400, 'connector keys can only be deleted in settings');
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
      if (parseChiefTrigger(ctx.turnPrompt ?? null) !== 'user')
        throw new HttpError(403, 'A user instruction is required to merge; events cannot merge');
      for (const buildId of buildIds) requireTeamBuild(db, buildId, ctx.teamId);
      for (const buildId of buildIds)
        await requestMerge(buildDeps(deps), buildId, deps.user.displayName);
      return json({ merged: buildIds });
    }

    case 'ask_user': {
      const provenance = requireTurnProvenance(
        ctx.turnPrompt ?? null,
        params.provenance,
        'ask_user',
      );
      const questions = askUserQuestionsOfParams(params);
      const requestId = optStr(params, 'requestId') ?? `ask-${newRecordId()}`;
      if (requestId.startsWith(APPROVAL_CARD_ID_PREFIX)) {
        throw new HttpError(
          400,
          'invalid params.requestId: approval cards are written by the server',
        );
      }
      const questionDeps: ChiefQuestionDeps = {
        db,
        hub: deps.hub,
        user: deps.user,
        vapidKeys: deps.vapidKeys,
        ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
      };
      const { content, created } = createOrGetQuestion(questionDeps, {
        threadId: ctx.threadId,
        requestId,
        questions,
        provenance,
        askedFor: [...(ctx.turnMessageIds ?? [])],
      });
      if (!created) announceQuestion(questionDeps, ctx.threadId, requestId);
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
      const report = reportRefOfPrompt(ctx.turnPrompt ?? null);
      if (report !== null && reportAcknowledged(db, ctx.threadId, report)) {
        return json({ notified: false, reason: 'already-acknowledged' });
      }
      const text =
        report === null
          ? str(params, 'message')
          : str(params, 'message').replaceAll(report.attachmentId, '报告');
      const noticeId =
        report === null
          ? `notice-${effectDedupeKey(ctx.threadId, ctx.turnPrompt ?? '', provenance, text)}`
          : reportNoticeId(ctx.threadId, report);
      const notice = {
        id: noticeId,
        threadId: ctx.threadId,
        role: 'system' as const,
        content: JSON.stringify({
          kind: CHIEF_NOTICE_KIND,
          message: text,
          provenance,
          ...(report !== null
            ? { report: { todoId: report.todoId, buildId: report.buildId } }
            : {}),
        } satisfies ChiefNoticeContent),
        createdAt: nowMs(),
      };
      const stored = insertChiefMessageOnce(db, notice);
      if (stored === null) {
        const existing = db.select().from(chiefMessage).where(eq(chiefMessage.id, noticeId)).get();
        if (existing !== undefined) {
          deps.convHub?.publishMessage(ctx.threadId, existing);
          const notificationId = `${deps.user.id}:${ctx.threadId}`;
          const announced =
            db
              .select({ id: notification.id })
              .from(notification)
              .where(eq(notification.id, notificationId))
              .get() !== undefined;
          if (!announced) {
            notifyChiefMessage(
              { db, hub: deps.hub, user: deps.user },
              {
                threadId: ctx.threadId,
                message: text,
                agent: { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
              },
            );
          }
        }
        return json({ notified: true, duplicate: true });
      }
      deps.convHub?.publishMessage(ctx.threadId, stored);
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
    case 'save_memory':
    case 'update_memory':
    case 'delete_memory':
    case 'memories': {
      if (ctx.chiefAgentId === null)
        throw new HttpError(409, 'no coordinator routing rule — memory has no store');
      const owner = {
        agentId: ctx.chiefAgentId,
        teamId: ctx.teamId,
        projectId: ctx.turnScopeProjectId ?? null,
        source: 'Coordinator',
        sourceBuildId: ctx.conversationId,
      };
      const editId = memoryEditIdOfPrompt(ctx.turnPrompt ?? null);
      if (editId !== null) {
        if (ctx.toolCallId === undefined)
          throw new HttpError(409, 'memory-edit turn requires a tool call id');
        const receipt = executeMemoryEditTool(db, owner, editId, ctx.toolCallId, name, params);
        return json(receipt.output);
      }
      return json(executeMemoryDocumentTool(db, owner, name, params));
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
  opts: { supersededBy?: string; silentSettleThreadId?: string } = {},
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
      throw new HttpError(400, 'supersededBy must name a todo that is not being archived');
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
      reasons[id] = '计划批准和报告验收保留用户的决定；不要把等待用户的任务直接标为完成。';
      continue;
    }
    try {
      const record = setTodoPhase(
        svc,
        id,
        to,
        {},
        opts.silentSettleThreadId !== undefined
          ? { silentSettleThreadId: opts.silentSettleThreadId }
          : {},
      );
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
    await applyBuildStepAction(
      buildDeps(deps),
      buildId,
      { action: 'confirm' },
      actor,
      'coordinator',
    );
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
    case 'save_memory':
    case 'update_memory':
    case 'delete_memory':
    case 'memories':
      return json(
        executeMemoryDocumentTool(
          db,
          {
            agentId: ctx.agentId,
            teamId: ctx.teamId,
            projectId: ctx.projectId,
            teamScoped: ctx.teamScoped,
            workerScope: true,
            source: ctx.sourceName,
            sourceTodoId: ctx.todoId,
            sourceBuildId: ctx.buildId,
          },
          name,
          params,
        ),
      );
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
