import {
  BRAND,
  CHIEF_REMOTE_TOOLS,
  githubReadToolParamsSchemas,
  MCP_TOOL_REGISTRY,
  MERGE_HUMAN_ONLY_COPY,
  type UserRecord,
} from '@cairn/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  chiefThread,
  machine,
  message,
  project,
  schedule,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { verifyApiKey } from './api-keys.js';
import { cancelBuild, startBuilds } from './builds.js';
import type { ChiefToolDeps, TransitionActor } from './chief-tools.js';
import { confirmBuild, transitionTodos } from './chief-tools.js';
import { readConversationPage } from './conversation-page.js';
import { executeGithubReadTool } from './github-reads.js';
import { isChiefConversation } from './machines.js';
import { createSchedule, deleteSchedule, listSchedules } from './schedules.js';
import { scanLocalSkills } from './skills.js';
import { createTodo, listTodos, updateTodo } from './todos.js';

export interface McpCallerCtx {
  teamId: string;
  user: UserRecord;
  grants: ReadonlySet<string>;
}

const s = z.string();
const sArr = z.array(z.string());

const TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  todos: { projectId: s.optional(), phase: s.optional() },
  projects: {},
  conversation: { conversationId: s, before: s.optional() },
  agents: {},
  schedules: {},
  attachment: { attachmentId: s },
  skills: {},
  machines: {},
  issues: githubReadToolParamsSchemas.issues.shape,
  pull_requests: githubReadToolParamsSchemas.pull_requests.shape,
  workflow_runs: githubReadToolParamsSchemas.workflow_runs.shape,
  create_todo: { projectId: s, title: s, spec: s },
  update_todo: { todoId: s, title: s.optional(), spec: s.optional(), tagIds: sArr.optional() },
  message_todo: { todoId: s, content: s },
  run_builds: {
    todoIds: sArr,
    withPlan: z.boolean().optional(),
    assignment: z
      .object({
        plan: z.object({ agentId: s }).nullable().optional(),
        build: z.object({ agentId: s }).nullable().optional(),
      })
      .optional(),
  },
  run_review: { buildId: s },
  confirm_builds: { buildIds: sArr },
  merge_builds: { buildIds: sArr },
  cancel_builds: { buildIds: sArr },
  complete_todos: { todoIds: sArr },
  close_todos: { todoIds: sArr },
  reopen_todos: { todoIds: sArr },
  schedule_todo: {
    todoId: s,
    kind: z.enum(['once', 'hourly', 'daily', 'weekly']),
    at: z.number(),
  },
  unschedule_todo: { todoId: s },
};

const CHIEF_DESCRIPTIONS = new Map(CHIEF_REMOTE_TOOLS.map((t) => [t.name, t.description]));

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

function requireTeamAgent(db: Db, agentId: string, teamId: string) {
  const row = db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.id, agentId), eq(agent.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `agent ${agentId}`);
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

type Args = Record<string, unknown>;
function str(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v === '') throw new HttpError(400, `invalid ${key}`);
  return v;
}
function optStr(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
function strArrOf(args: Args, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    throw new HttpError(400, `invalid ${key}`);
  return v as string[];
}

export async function executeMcpTool(
  deps: ChiefToolDeps,
  ctx: McpCallerCtx,
  name: string,
  args: Args,
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
  const mcpActor: TransitionActor = { kind: 'user', name: deps.user.displayName };
  switch (name) {
    case 'todos': {
      const projectId = optStr(args, 'projectId');
      const phase = optStr(args, 'phase');
      let records = listTodos(svc, { teamId: ctx.teamId, ...(projectId ? { projectId } : {}) });
      if (phase) records = records.filter((t) => t.phase === phase);
      return json(records);
    }
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
    case 'conversation': {
      const conversationId = str(args, 'conversationId');
      if (isChiefConversation(conversationId)) {
        const thread = db
          .select({ id: chiefThread.id })
          .from(chiefThread)
          .where(and(eq(chiefThread.id, conversationId), eq(chiefThread.teamId, ctx.teamId)))
          .get();
        if (!thread) throw new HttpError(404, `conversation ${conversationId}`);
      } else {
        requireTeamBuild(db, conversationId, ctx.teamId);
      }
      return json(readConversationPage(db, conversationId, optStr(args, 'before')));
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
        })),
      );
    }
    case 'schedules':
      return json(listSchedules({ db, hub: deps.hub }, ctx.teamId));
    case 'attachment': {
      const attachmentId = str(args, 'attachmentId');
      const { readAttachmentMeta } = await import('./attachments.js');
      return json(
        readAttachmentMeta(
          { db: deps.db, attachmentsDir: deps.attachmentsDir },
          ctx.teamId,
          attachmentId,
        ),
      );
    }
    case 'skills': {
      const scanned = scanLocalSkills(deps.skillsDir);
      return json(scanned.map((k) => ({ id: k.id, name: k.name, description: k.description })));
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
    case 'issues':
    case 'pull_requests':
    case 'workflow_runs':
      return json(await executeGithubReadTool(deps, ctx.teamId, name, args));

    case 'create_todo': {
      const projectId = str(args, 'projectId');
      requireProjectRow(db, projectId, ctx.teamId);
      return json(
        createTodo(svc, {
          teamId: ctx.teamId,
          projectId,
          title: str(args, 'title'),
          spec: str(args, 'spec'),
          createdBy: null,
          ownerId: ctx.user.id,
        }),
      );
    }
    case 'update_todo': {
      const todoId = str(args, 'todoId');
      requireTeamTodo(db, todoId, ctx.teamId);
      const record = updateTodo(svc, todoId, {
        ...(optStr(args, 'title') !== undefined ? { title: optStr(args, 'title') } : {}),
        ...(optStr(args, 'spec') !== undefined ? { spec: optStr(args, 'spec') } : {}),
        ...(args.tagIds !== undefined ? { tagIds: strArrOf(args, 'tagIds') } : {}),
      });
      if (!record) throw new HttpError(404, `todo ${todoId}`);
      return json(record);
    }
    case 'message_todo': {
      const todoId = str(args, 'todoId');
      const row = requireTeamTodo(db, todoId, ctx.teamId);
      const conversationId = row.latestBuildId;
      if (conversationId) {
        db.insert(message)
          .values({
            id: newRecordId(),
            conversationId,
            role: 'user',
            content: str(args, 'content'),
            createdAt: nowMs(),
          })
          .run();
      }
      return json({ todoId, conversationId, posted: conversationId !== null });
    }
    case 'run_builds': {
      const todoIds = strArrOf(args, 'todoIds');
      const withPlan = args.withPlan === true;
      const assignmentIn = args.assignment as
        | { plan?: { agentId?: string } | null; build?: { agentId?: string } | null }
        | undefined;
      const assignment = {
        plan: assignmentIn?.plan?.agentId ? { agentId: assignmentIn.plan.agentId } : null,
        build: assignmentIn?.build?.agentId ? { agentId: assignmentIn.build.agentId } : null,
      };
      for (const slot of [assignment.plan, assignment.build]) {
        if (slot !== null) requireTeamAgent(db, slot.agentId, ctx.teamId);
      }
      const rows = todoIds.map((todoId) => {
        const row = requireTeamTodo(db, todoId, ctx.teamId);
        requireProjectRow(db, row.projectId, ctx.teamId);
        return row;
      });
      const started: unknown[] = [];
      for (const row of rows) {
        started.push(
          ...startBuilds(svc, {
            projectId: row.projectId,
            todoIds: [row.id],
            assignment,
            withPlan,
            triggerSource: 'user',
          }),
        );
      }
      return json({ builds: started, withPlan, triggerSource: 'user' });
    }
    case 'run_review': {
      const buildId = str(args, 'buildId');
      return json({ buildId, note: 'independent review run not wired [推断]' });
    }
    case 'confirm_builds': {
      const buildIds = strArrOf(args, 'buildIds');
      for (const buildId of buildIds) {
        requireTeamBuild(db, buildId, ctx.teamId);
        await confirmBuild(deps, buildId);
      }
      return json({ confirmed: buildIds });
    }
    case 'merge_builds': {
      const buildIds = strArrOf(args, 'buildIds');
      for (const buildId of buildIds) requireTeamBuild(db, buildId, ctx.teamId);
      throw new HttpError(403, MERGE_HUMAN_ONLY_COPY);
    }
    case 'cancel_builds': {
      const buildIds = strArrOf(args, 'buildIds');
      for (const buildId of buildIds) {
        requireTeamBuild(db, buildId, ctx.teamId);
        cancelBuild(svc, buildId);
      }
      return json({ cancelled: buildIds });
    }
    case 'complete_todos':
      return json(transitionTodos(deps, ctx.teamId, strArrOf(args, 'todoIds'), 'done', mcpActor));
    case 'close_todos':
      return json(transitionTodos(deps, ctx.teamId, strArrOf(args, 'todoIds'), 'closed', mcpActor));
    case 'reopen_todos':
      return json(transitionTodos(deps, ctx.teamId, strArrOf(args, 'todoIds'), 'todo', mcpActor));
    case 'schedule_todo': {
      const todoId = str(args, 'todoId');
      const row = requireTeamTodo(db, todoId, ctx.teamId);
      requireProjectRow(db, row.projectId, ctx.teamId);
      const at = args.at;
      if (typeof at !== 'number' || !Number.isFinite(at)) throw new HttpError(400, 'invalid at');
      return json(
        createSchedule(
          { db, hub: deps.hub },
          {
            teamId: ctx.teamId,
            projectId: row.projectId,
            todoId,
            kind: args.kind as 'once' | 'hourly' | 'daily' | 'weekly',
            at,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            createdBy: ctx.user.id,
          },
        ),
      );
    }
    case 'unschedule_todo': {
      const todoId = str(args, 'todoId');
      requireTeamTodo(db, todoId, ctx.teamId);
      const rows = db.select().from(schedule).where(eq(schedule.todoId, todoId)).all();
      for (const r of rows) deleteSchedule({ db, hub: deps.hub }, r.id);
      return json({ todoId, removed: rows.length });
    }
    default:
      throw new HttpError(400, `unknown mcp tool: ${name}`);
  }
}

export function buildMcpFaceServer(deps: ChiefToolDeps, ctx: McpCallerCtx): McpServer {
  const server = new McpServer(
    { name: BRAND.cliCommandName, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  for (const entry of MCP_TOOL_REGISTRY) {
    if (!ctx.grants.has(entry.grant)) continue;
    server.registerTool(
      entry.name,
      {
        title: entry.grant,
        description: CHIEF_DESCRIPTIONS.get(entry.name) ?? entry.grant,
        inputSchema: TOOL_SCHEMAS[entry.name] ?? {},
      },
      async (rawArgs) => {
        try {
          const text = await executeMcpTool(deps, ctx, entry.name, (rawArgs ?? {}) as Args);
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text' as const, text: `error: ${msg}` }], isError: true };
        }
      },
    );
  }
  return server;
}

export async function handleMcpRequest(
  deps: ChiefToolDeps & { db: Db },
  request: Request,
): Promise<Response> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return Response.json({ error: 'mcp authentication required' }, { status: 401 });
  }
  const key = verifyApiKey({ db: deps.db }, header.slice('Bearer '.length));
  if (!key) {
    return Response.json({ error: 'invalid api key' }, { status: 401 });
  }
  if (!key.mcpAccess) {
    return Response.json({ error: 'mcp access not enabled for this key' }, { status: 403 });
  }
  const ctx: McpCallerCtx = {
    teamId: key.teamId,
    user: deps.user,
    grants: new Set([...key.toolGrants.read, ...key.toolGrants.write]),
  };
  const server = buildMcpFaceServer(deps, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export function grantedToolNames(grants: ReadonlySet<string>): string[] {
  return MCP_TOOL_REGISTRY.filter((t) => grants.has(t.grant)).map((t) => t.name);
}
