// MCP server 面（02 §7.2，00/D4 薄桥的 server 半；M4b）——外部 MCP 客户端
// （Claude Code/Codex/VS Code…）← pacman。端点 /api/mcp（路径保形），
// Authorization: Bearer <apiKey>；调用以 key 属主身份执行（r3 §5.2）。
// 权限模型（r3 §6 矩阵 1:1）：key 级工具白名单 24 件 = 读 11 组 + 写 13 项
// （MCP_TOOL_REGISTRY 单源）；「The key's tool selection limits every call」=
// 只注册授出工具（list 与 call 同受限）；「Removing every MCP tool disables
// MCP for that key」= 零授权 → 空工具面（机器自持 machine token 不受影响）。
// 工具语义 = docs 六能力组（MCP_CAPABILITY_GROUPS）投影，与 chief 词表同族
// （r5 §3.1「与 docs MCP server 面六能力组同构」）——description 单源复用
// CHIEF_REMOTE_TOOLS；身份语义差：key 属主 = 用户（triggerSource 'user'、
// 无 chief 溯源/watch）。
// 传输 = sdk WebStandardStreamableHTTPServerTransport stateless（每请求独立
// server+transport，enableJsonResponse——self-host 单机无会话粘滞需求 [设计]）。
// 缝纪律（00/D4、01 §7.3）：本文件 = server 侧唯一 sdk 消费位（biome override）。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { BRAND, CHIEF_REMOTE_TOOLS, MCP_TOOL_REGISTRY, type UserRecord } from '@pacman/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  chiefMessage,
  machine,
  message,
  project,
  schedule,
  step,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { verifyApiKey } from './api-keys.js';
import { cancelBuild, startBuilds } from './builds.js';
import type { ChiefToolDeps, TransitionActor } from './chief-tools.js';
import { confirmBuild, mergeBuild, transitionTodos } from './chief-tools.js';
import { isChiefConversation } from './machines.js';
import { createSchedule, deleteSchedule, listSchedules } from './schedules.js';
import { scanLocalSkills } from './skills.js';
import { createTodo, listTodos, updateTodo } from './todos.js';

/** key 属主调用上下文（r3 §5.2「MCP 调用以 key 属主身份执行」；单用户 seed
 * 02 §2.1 → user 恒 seed 行，teamId 随 key 行）。 */
export interface McpCallerCtx {
  teamId: string;
  user: UserRecord;
  /** 授出的 grant 标签集（MCP_TOOLS_READ/WRITE 原词）。 */
  grants: ReadonlySet<string>;
}

// —— 24 工具面（MCP_TOOL_REGISTRY 单源；input schema [推断] = chief 词表同族
// 参数投影，wire 原件未采，04 §3 不判负口径）———————————————————————————————

const s = z.string();
const sArr = z.array(z.string());

const TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  todos: { projectId: s.optional(), phase: s.optional() },
  projects: {},
  conversation: { conversationId: s },
  agents: {},
  schedules: {},
  attachment: { attachmentId: s },
  skills: {},
  machines: {},
  issues: { projectId: s.optional() },
  pull_requests: { projectId: s.optional() },
  workflow_runs: { projectId: s.optional() },
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

/** description 单源 = chief 词表同名工具（r5 §3.1 同构注记）。 */
const CHIEF_DESCRIPTIONS = new Map(CHIEF_REMOTE_TOOLS.map((t) => [t.name, t.description]));

function json(result: unknown): string {
  return JSON.stringify(result ?? null);
}

function requireProjectRow(db: Db, projectId: string) {
  const row = db.select().from(project).where(eq(project.id, projectId)).get();
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

/** build 归属校验（纵深防御，transitionTodos 同律）：build 表无 teamId 列，
 * 经 build → todo → teamId 联查；跨团队/不存在一律 404（不泄露存在性）。 */
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

/** 24 工具执行体（key 属主身份）。返回 JSON 串（content text 位）。 */
export async function executeMcpTool(
  deps: ChiefToolDeps,
  ctx: McpCallerCtx,
  name: string,
  args: Args,
): Promise<string> {
  const { db } = deps;
  // #452 写向：box/githubFetch 透传——MCP create_todo 与三条创建路径同律。
  const svc = {
    db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    box: deps.box,
    ...(deps.githubFetch !== undefined ? { githubFetch: deps.githubFetch } : {}),
  };
  // #902 过闸宣告行的 actor 位：MCP 面身份语义（本文件头注）= key 属主即
  // 用户，triggerSource 'user' 同律——宣告行记用户名，#900 的 agent 闸相位
  // 拒否不咬本面。
  const mcpActor: TransitionActor = { kind: 'user', name: deps.user.displayName };
  switch (name) {
    // —— 读 11 组（Read the workspace / Read the repo / Read progress）——
    case 'todos': {
      const projectId = optStr(args, 'projectId');
      const phase = optStr(args, 'phase');
      let records = listTodos(svc, projectId ? { projectId } : { teamId: ctx.teamId });
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
      // Read progress：最新构建完整对话含流式（02 §7.2 六能力组）；chief 会话
      // 同族可读（r5 §3.6 端点族）。
      const conversationId = str(args, 'conversationId');
      if (isChiefConversation(conversationId)) {
        const rows = db
          .select()
          .from(chiefMessage)
          .where(eq(chiefMessage.threadId, conversationId))
          .orderBy(asc(chiefMessage.createdAt))
          .all();
        return json(
          rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.createdAt })),
        );
      }
      const rows = db
        .select()
        .from(message)
        .where(eq(message.conversationId, conversationId))
        .all();
      return json(
        rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.createdAt })),
      );
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
      // #310 / r9 §3.1：同 chief-tools 路径（MCP 工具面 = 词表 + 执行同源，
      // 服务层复用避免双修）。
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
      // spec 13 #367：本地目录现扫（chief-tools 同源，id = frontmatter name
      // 回落目录名）。
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
      // GitHub-backed 才有（02 §3/A4，依赖 A4 GitHub 形态）；托管 repo 空集。
      return json({ items: [], note: 'GitHub-backed only' });

    // —— 写 13 项（Organize work / Run work / Manage lifecycle）——
    case 'create_todo': {
      const projectId = str(args, 'projectId');
      requireProjectRow(db, projectId);
      // key 属主身份：ownerId = 用户、createdBy 无 Agent 位（非 chief 派工，
      // 无 sourceBuildId 溯源——r3 §5.2 身份语义）。
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
      const started: unknown[] = [];
      for (const todoId of todoIds) {
        const row = requireTeamTodo(db, todoId, ctx.teamId);
        started.push(
          ...startBuilds(svc, {
            projectId: row.projectId,
            todoIds: [todoId],
            assignment,
            withPlan,
            triggerSource: 'user', // key 属主 = 用户身份（非 chief、非定时）
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
      for (const buildId of buildIds) {
        requireTeamBuild(db, buildId, ctx.teamId);
        await mergeBuild(deps, buildId);
      }
      return json({ mergeDelegated: buildIds }); // 202 delegated 语义族（r3 §3.6）
    }
    case 'cancel_builds': {
      const buildIds = strArrOf(args, 'buildIds');
      for (const buildId of buildIds) {
        requireTeamBuild(db, buildId, ctx.teamId);
        // #1219：与 chief cancel_builds 同漏斗（cancelBuild——pending stopped /
        // claimed stop 委托 / 僵尸释放；旧裸 UPDATE 的 todo-留-queued 僵尸不复存在）。
        cancelBuild(svc, buildId);
      }
      return json({ cancelled: buildIds });
    }
    // MCP 面身份语义（本文件头注）：key 属主 = 用户——transitionTodos 的
    // actor 记 user（#900 的 agent 闸相位拒否不咬本面；done 落地照落审计行）。
    case 'complete_todos':
      return json(transitionTodos(deps, ctx.teamId, strArrOf(args, 'todoIds'), 'done', mcpActor));
    case 'close_todos':
      return json(transitionTodos(deps, ctx.teamId, strArrOf(args, 'todoIds'), 'closed', mcpActor));
    case 'reopen_todos':
      return json(transitionTodos(deps, ctx.teamId, strArrOf(args, 'todoIds'), 'todo', mcpActor));
    case 'schedule_todo': {
      const todoId = str(args, 'todoId');
      const row = requireTeamTodo(db, todoId, ctx.teamId);
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

/** per-request McpServer 组装：只注册 key 授出的工具（limits every call）。 */
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

/** /api/mcp 请求处理（Hono raw Request 直通；stateless = 每请求独立
 * server+transport，enableJsonResponse——JSON-RPC 单响应，无 SSE 会话粘滞）。
 * 认证失败 = HTTP {error} 面（协议前拒绝，git 面 401 同族）。 */
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
    sessionIdGenerator: undefined, // stateless（02 §7.2 无会话语义要求）
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // stateless + JSON 单响应：本请求结束即回收（无挂起流 [设计]）。
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

/** 薄桥自检面（vocabulary 对拍用，非运行时路径）：授出集 → 工具名单投影。 */
export function grantedToolNames(grants: ReadonlySet<string>): string[] {
  return MCP_TOOL_REGISTRY.filter((t) => grants.has(t.grant)).map((t) => t.name);
}
