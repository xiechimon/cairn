// Chief remoteTools 服务端执行面（02 §4.3「服务端定义并执行」；r5 §3.1 relay
// 位形 = POST /api/machine/tool/<stepId> {name, params} → {text}）。
// 51 词表（protocol/chief-tools.ts；raw 观测 49 − delete_skills（spec 13
// #367，本地目录投影无删除面）+ create_skill/update_skill（XMON-109 spec 13
// 回摆新增，CHIEF_TOOLS_ADDED 登记）+ set_remote_shell（XMON-115 回摆，
// XMON-77 除名解除——「远程 shell」本体 = XMON-108 双闸 + XMON-110 daemon
// 工具）+ models（#627 读侧候选清单，CHIEF_TOOLS_ADDED 登记））逐件映射到
// 既有服务/DB。
// 复刻口径（02 §4.3 尾注 / 04 §1 A4）：Chief = 挂团队工具的 pi 会话，工具
// 「语义」按 r1 docs 六能力组 + r3/r5 行为证据黑盒逼近；params/results 细形
// 未采到 wire 原件处一律 [推断]，不冒充实测。返回值 = JSON 串（bundle text()
// 形，daemon 侧回 pi）。
//
// 溯源纪律（r5 §3.2）：create_todo 的 createdBy = Chief 绑定 Agent id、
// sourceBuildId = chief 实例 id（`chief-<userId>-<teamId>`，r5 §3.2 实测样本
// `chief-6ItyfRe7Q7hru5xFmMu-u-…`）、ownerId = 用户。
// save_memory（r5 §6）：agentId = Chief 绑定 Agent（共用存储）、三级溯源
// （sourceBuildId = chief 回合 conv id，records/memory.ts「回合 id」注）、配额 100。

import type { SecretBox, UserRecord } from '@cairn/shared';
import {
  AGENT_TOOL_DEFAULTS,
  AGENT_TOOL_SHELL,
  createSkillBodySchema,
  DONE_ANNOUNCEMENT,
  filterAgentTools,
  IN_PROGRESS_PHASES,
  ISSUE_FENCE_OPEN,
  isChiefConversationId,
  MEMORY_QUOTA_PER_AGENT,
  MERGE_HUMAN_ONLY_COPY,
  MODEL_SOURCE_RUNTIME_LABELS,
  updateSkillToolParamsSchema,
} from '@cairn/shared';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  agentMemory,
  build,
  chief,
  chiefMessage,
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
import {
  advanceSplitWaves,
  applyBuildStepAction,
  cancelBuild,
  startBuilds,
  stopActiveStepsAfterExit,
} from './builds.js';
import { addChiefWatch, clearChiefWake, removeChiefWatches, setChiefWake } from './chief.js';
import { askUserQuestionsOfParams, createOrGetQuestion } from './chief-questions.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { isGithubRepoRef, readFile } from './git.js';
import { executeGithubReadTool } from './github-reads.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { defaultMcpConfigPath, listMcpServers } from './mcp-servers.js';
import { notifyChiefMessage } from './notifications.js';
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
  /** conversation stream 通道（#902 过闸宣告行落库后的 live 推送；缺省 =
   * 只落库不推流）。 */
  convHub?: ConversationStreamHub;
  /** 托管 bare repo 存储根（docs relay 读文件内容 = chief「探测仓库」面，r5 §3.1
   * 回合自带只读探索的宿主等价物；A4 黑盒逼近——官方走 worktree `git show`，
   * 复刻走 server 端裸库读，能力对齐、机制不同，标 [设计]）。 */
  reposDir: string;
  /** 附件存储根（#310，r9 §4）；chief attachment 工具读面。 */
  attachmentsDir: string;
  /** 技能根目录（spec 13 #367）；skills 读工具 = 本地现扫投影。 */
  skillsDir: string;
  /** 本机 MCP config 读路径（spec 13/#368 mcp_servers 工具换源）；缺省 =
   *  ~/.claude.json（config.ts 同默认；测试面显式注入 fixture 路径）。 */
  mcpConfigPath?: string;
  /** GitHub 出站注入位（#452 写向：create_todo 自建 issue 透传；
   * AppContext.githubFetch 同族，缺省 globalThis.fetch，测试注入 mock）。 */
  githubFetch?: FetchLike;
}

/** 单次 relay 调用的溯源上下文（step → chief thread 解析，services/machines.ts
 * 组装）。userId = seed 用户；chiefAgentId = 绑定 Agent（save_memory 溯源，
 * r5 §6）；chiefId = `chief-<userId>-<teamId>`（create_todo/save_memory 的
 * sourceBuildId，r5 §3.2 实测「sourceBuildId = chief id」样本
 * `chief-6ItyfRe7Q7hru5xFmMu-u-…`）；conversationId = `chief-<threadId>`（回合
 * conv，token_usage 记账键）。 */
export interface ChiefToolCtx {
  teamId: string;
  userId: string;
  chiefId: string;
  threadId: string;
  chiefAgentId: string | null;
  conversationId: string;
}

/** 技能写审计执行者（XMON-109）：绑定 Agent 在位 = agent（r5 §3.2 溯源
 * 同律，save_memory 共用绑定 Agent）；未绑定 = 发消息的 member。 */
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

function json(result: unknown): string {
  return JSON.stringify(result ?? null);
}

/** project 存在性 + 团队归属校验（#1466，requireTeamTodo 同口径：跨团队 id
 * 与不存在同 404，不泄露存在性）。 */
function requireProjectRow(db: Db, projectId: string, teamId: string) {
  const row = db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `project ${projectId}`);
  return row;
}
/** todo 存在性 + 团队归属校验（纵深防御：relay 以 chief 团队身份执行，跨团队
 * id 一律 404——单租户 self-host 下恒同队（02 §2），此guard 防未来多租越权）。 */
function requireTeamTodo(db: Db, todoId: string, teamId: string) {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  return row;
}
/** 分派槽的 agentId 校验。不校验的后果是静默的：模型把长随机 id 抄错一位，
 * 一个不存在的 agentId 照样落库，直到构建跑起来才炸（而那时用户已经看到
 * 「已派工」的回执）。抛错经 relay 回到模型眼前（daemon 把它折成工具结果文本
 * `run_builds rejected: …`），模型可以据此重挑。 */
/** 单次 docs 读的路径上限。批量读的收益来自「少几趟往返」，不是「一趟读完整
 * 个仓」——结果过大反而把上下文撑爆，后几趟更贵。超出的条数在应答里显式报出
 * （omitted），模型可再发一趟接着读。 */
const DOCS_MAX_PATHS = 24;

export const CHIEF_TODOS_MAX_OUTPUT_BYTES = 32 * 1024;
export const CHIEF_TODOS_TITLE_MAX_CHARS = 160;
export const CHIEF_TODOS_SUMMARY_MAX_CHARS = 240;

function requireTeamAgent(db: Db, agentId: string, teamId: string) {
  const row = db
    .select()
    .from(agent)
    .where(and(eq(agent.id, agentId), eq(agent.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `agent ${agentId}（不在本团队，或 id 抄错了）`);
  return row;
}
/** #1219 cancel_builds 归属校验（requireTeamAgent/Machine 同律，mcp-face
 * requireTeamBuild 同形）：build 表无 teamId 列，经 build → todo 联查；跨团队/
 * 不存在一律 404（不泄露存在性）。 */
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
/** 51 词表服务端执行。未识别工具名 = 400（词表外不执行，02 §7.2 白名单纪律
 * 同族）。返回 JSON 串。 */
export async function executeChiefTool(
  deps: ChiefToolDeps,
  ctx: ChiefToolCtx,
  name: string,
  params: Params,
): Promise<string> {
  const { db } = deps;
  // #452 写向：box/githubFetch 透传——chief create_todo 与三条创建路径同律
  // （已连接 github 项目的任务落库即自建 issue，关键路径之外）。
  const svc = {
    db,
    hub: deps.hub,
    machineHub: deps.machineHub,
    user: deps.user,
    box: deps.box,
    ...(deps.githubFetch !== undefined ? { githubFetch: deps.githubFetch } : {}),
  };
  // #902 过闸宣告行的 actor 位：chief 工具面动作主体 = Chief 绑定 Agent 的
  // displayName（未绑定回落 'Chief' 字面）——绝不记成用户名，审计要能区分
  // 「人按的闸」与「agent 按的闸」（#892 §6：没有 actor，闸被人按过只能是
  // 推断）。查询一次每回合复用（confirm_builds / merge_builds / *_todos）。
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
    // —— 读侧 16（#627 +models）——
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
      // 团队过滤恒在（#1466）：他队 projectId 与不存在的 id 同回 []。
      let records = listTodos(svc, { teamId: ctx.teamId, ...(projectId ? { projectId } : {}) });
      if (phase) records = records.filter((t) => t.phase === phase);
      const todos: { id: string; seqNum: number; title: string; phase: string; summary: string }[] =
        [];
      const response = { todos, total: records.length, nextOffset: null as number | null };
      for (const record of records.slice(offset)) {
        todos.push({
          id: record.id,
          seqNum: record.seqNum,
          title: record.title.slice(0, CHIEF_TODOS_TITLE_MAX_CHARS),
          phase: record.phase,
          summary: record.spec.slice(0, CHIEF_TODOS_SUMMARY_MAX_CHARS),
        });
        response.nextOffset = offset + todos.length < records.length ? offset + todos.length : null;
        if (Buffer.byteLength(json(response), 'utf8') > CHIEF_TODOS_MAX_OUTPUT_BYTES) {
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
          // 授权集投影（XMON-77）：分派面对权限态可见——合并派给未授权
          // Agent 会在 requestMerge 403，看得见才能挑对（REST PATCH 才是写面）。
          tools: a.tools,
          // #1169：defaultSkill（携带）/ skillsAllowlist（授权，null = 不限制）
          // 两槽同名投影，分派面同见。
          defaultSkill: a.defaultSkill,
          skillsAllowlist: a.skillsAllowlist,
          mcpServers: a.mcpServers,
        })),
      );
    }
    case 'models': {
      // #627 候选模型清单：行语义 = web toModelOptions 投影（#1288 起 pi/relay
      // 段重新进入候选，跨族按 model id 去重、活性取严）。本层独立实现
      // （不 import web 代码），数据面复用 model-sources 路由背后的 service
      // 函数；claude-code 段 = 各执行机 daemon 上报（#707，未上报的机器缺席，
      // 不报错）。存量 provider 绑定照旧由 agents 读面原值返回、执行面按原值
      // 解析，本工具只决定 chief 可新选什么。
      const keysvc = { db, box: deps.box };
      const rows: {
        provider: string;
        providerLabel: string;
        modelId: string;
        modelName: string;
      }[] = [];
      const seen = new Set<string>();
      const push = (row: (typeof rows)[number]) => {
        // #1288 跨族按 model id 去重（与 web toModelOptions 同律）。
        const key = row.provider === 'claude-code' ? `${row.provider}/${row.modelId}` : row.modelId;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(row);
      };
      for (const source of getModelSources(keysvc, ctx.teamId).sources) {
        // #1288：pi/relay 段进入候选（不再 continue 跳过）。
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
      // spec 13 #367：本地目录现扫（id = frontmatter name 回落目录名）。
      const scanned = scanLocalSkills(deps.skillsDir);
      return json(scanned.map((s) => ({ id: s.id, name: s.name, description: s.description })));
    }
    case 'secrets': {
      const keysvc = { db, box: deps.box };
      // 值只写不读（02 §8）：listSecrets 已剥值，仅名/描述。
      return json(listSecrets(keysvc, ctx.teamId));
    }
    case 'mcp_servers': {
      // 换源（spec 13/#368）：与 REST 读面同源同投影（listMcpServers 单源）——
      // 本机 ~/.claude.json；密钥值不上工具面（record 投影已剥值）。
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
      // 读仓库文件内容（chief「探测仓库」面 = r5 §3.1 回合自带只读探索 / spec
      // 三段「先探测仓库再写事实」的宿主等价物）：走 server 端裸库读
      // （services/git.readFile，02 §3 文件浏览面同源）——A4 黑盒逼近：官方走
      // daemon worktree `git show`，复刻走 server 裸库读，能力对齐、机制不同
      // [设计]。无 path → 回项目 repo 元信息（GitHub 形态无本地存储）。
      const projectId = str(params, 'projectId');
      const row = requireProjectRow(db, projectId, ctx.teamId);
      const paths = strArr(params, 'paths');
      if (paths.length === 0) {
        return json({ projectId, name: row.name, repoKind: row.repoKind, files: [] });
      }
      // 逐条读、逐条记错，不因单条失败整体回退：一次读多个文件时，模型不该
      // 因为其中一个路径猜错就丢掉另外几个——那会逼它再花一整趟往返重读。
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
      // token_usage 无 teamId 列（#1470）：记账键 buildId 是 build id 或 chief
      // thread id（chief 回合），各自经 build → todo / chief_thread 归到团队。
      // 只回本队行；buildId 给定则再按其过滤（他队 id 与不存在同回 []）。
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
      // #1406 P5a-2：读项目所连 GitHub 仓库的真数据（MCP 面同一份实现）。
      return json(await executeGithubReadTool(deps, ctx.teamId, name, params));
    case 'attachment': {
      // #310 / r9 §3.1：工具返回 {fileName, mimeType, sizeBytes, encoding,
      // content}；text/* → utf8；其他 → base64。attach 实体查 attachments 服
      // 务，团队归属同关。
      const attachmentId = str(params, 'attachmentId');
      const { readAttachmentMeta } = await import('./attachments.js');
      return json(readAttachmentMeta(deps, ctx.teamId, attachmentId));
    }
    case 'conversation': {
      const conversationId = str(params, 'conversationId');
      // chief 会话 → chief_message；build 会话 → message（同端点族，r5 §3.6）。
      if (isChiefConversationId(conversationId)) {
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

    // —— 组织侧 18（raw 19 − delete_skills，spec 13 #367 除名）——
    case 'create_todo': {
      // 措辞→spec 三段式（r5 §3.2）由 LLM 侧组织 spec 文本；本层落库 + 溯源。
      const projectId = str(params, 'projectId');
      requireProjectRow(db, projectId, ctx.teamId); // 存在性 + 团队归属校验（404 面）
      const record = createTodo(svc, {
        teamId: ctx.teamId,
        projectId,
        title: str(params, 'title'),
        spec: str(params, 'spec'),
        createdBy: ctx.chiefAgentId, // r5 §3.2：createdBy = Chief 绑定 Agent id
        ownerId: ctx.userId,
        // #640 / r14 §5.3：编排来源 = 本次 chief 会话（per-request 粒度，
        // 答「哪次请求拆的」）；GitHub 接入项目镜像槽位优先，裁决单源在
        // createTodo。
        orchestration: { threadId: ctx.threadId },
      });
      // sourceBuildId = chief id（r5 §3.2 实测：「sourceBuildId = chief id」，
      // 样本 `chief-<userId>-…` = chief 实例 id，非 thread/conv id）。
      db.update(todo).set({ sourceBuildId: ctx.chiefId }).where(eq(todo.id, record.id)).run();
      return json({ ...record, sourceBuildId: ctx.chiefId });
    }
    case 'split_todo': {
      // #1250（ADR 0018 层 2）：大票拆 N 子卡 + blocking 依赖边——落库半边
      // 在 services/todo-split.ts（子卡/父方案文档/父停 confirm）。工具参数
      // 的 subtodos[].blockedBy 是 1-based 兄弟序号，server 侧解析成子卡 id。
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
        return {
          title: str(item, 'title'),
          spec: str(item, 'spec'),
          agentId: str(item, 'agentId'),
          ...(blockedBy !== undefined ? { blockedBy } : {}),
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
      requireTeamTodo(db, todoId, ctx.teamId); // 团队归属校验（纵深防御）
      const record = updateTodo(svc, todoId, {
        ...(optStr(params, 'title') !== undefined ? { title: optStr(params, 'title') } : {}),
        ...(optStr(params, 'spec') !== undefined ? { spec: optStr(params, 'spec') } : {}),
        ...(params.tagIds !== undefined ? { tagIds: strArr(params, 'tagIds') } : {}),
      });
      if (!record) throw new HttpError(404, `todo ${todoId}`);
      return json(record);
    }
    case 'delete_todos': {
      const ids = strArr(params, 'todoIds');
      for (const id of ids) requireTeamTodo(db, id, ctx.teamId);
      // 复用 todos 服务的级联清理（build/step 手动清 + todo 删，deleteTodo 单源，
      // 避免与 REST DELETE 面漂移）。
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
      // 消息进 todo 最新 build 会话（steer/feedback 面，r5 §3.6）。
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
      // spec 15 #394：固定标签词表随项目播种（REST 面同调，ADR 0002 D4）。
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
          // 创建缺省同 REST POST（XMON-84 B4）：推送分支默认开——chief 建的
          // Agent 同样要能推工作分支交付；收权限走 update_agent/REST PATCH。
          tools: [...AGENT_TOOL_DEFAULTS],
          secrets: [],
          // #1169：技能两字段缺省 null——defaultSkill 不携带 + skillsAllowlist
          // 不限制（旧 skills:[] 的「出生即全拒」不再缺省）。
          defaultSkill: null,
          skillsAllowlist: null,
          mcpServers: [],
        })
        .run();
      return json({ id }); // r5 §1：POST agents → 201 {id}
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
    // delete_skills 已除名（spec 13 #367：技能 = 本地目录投影，删除 =
    // 从磁盘删目录；relay 此名走 default = 400 unknown chief tool）。
    // create_skill / update_skill（XMON-109 spec 13 回摆）：chief 自动制作/
    // 维护技能，免 agent 行开关（chief = 信任面，leader 拍板）；写路径与
    // REST/worker relay 同源 createLocalSkill/updateLocalSkill，审计 actor =
    // 绑定 Agent（未绑定时 member userId）。
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
    // set_remote_shell（XMON-115 回摆，XMON-77 除名解除）：chief 会话写某
    // agent 的「远程 shell」开关——写 agent.tools（开关词），与 REST PATCH
    // /agents/{aid} 同字段同过滤；执法面 = claim 双闸注册 + 步中每命令预检
    // （XMON-108），fail-closed。enabled 必填显式（缺省/非布尔 400，不沿用
    // #573 前缺省 true 的 fail-open 形）。返回体附 tools——XMON-74 证据探针
    // 按 payload.tools 复核写点结果（docs/verify/XMON-74/xmon74-probe.mjs）。
    case 'set_remote_shell': {
      const agentId = str(params, 'agentId');
      const row = requireTeamAgent(db, agentId, ctx.teamId);
      const enabledParam = params.enabled;
      if (typeof enabledParam !== 'boolean')
        throw new HttpError(400, 'invalid params.enabled: expected boolean');
      const tools = filterAgentTools(row.tools).filter((t) => t !== AGENT_TOOL_SHELL);
      if (enabledParam) tools.push(AGENT_TOOL_SHELL);
      db.update(agent).set({ tools }).where(eq(agent.id, agentId)).run();
      return json({ agentId, remoteShell: enabledParam, tools });
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

    // —— 执行侧 5 ——
    case 'run_builds': {
      // 单请求单 todo 直派；assignment 双槽（分派职责权重由 LLM 侧选 agentId，
      // 本层落库，r5 §3.3/§5）。
      // #903（ADR 0014）：withPlan = chief 的逐次派发判定（判定权归
      // chief，判据 = 系统提示词派发判定节的章程 prose，不进本层规则表）。
      // 缺省 = 先规划（fail-safe：判不准的方向是「多问一次」，不是静默跳过
      // confirm 闸）。dispatchReason 随响应回显——工具调用与响应都落
      // transcript，判定因此可审计、可被用户就地一句话推翻（只影响该次）。
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
      // #1250（ADR 0018 层 1）：assignment 四槽——plan/build 为主槽（#1104 A
      // 两槽全空 400 律不变：review/verify 是关口的回落/验证位，不能独立
      // 撑起一次 build）；review = 无 persona 时的单审核人回落位；verify 槽
      // 在位时 review 关口抵达即入队验证步（REST builds 面同一 assignment
      // 语义，chief 派发不得少一半槽）。
      const assignment = {
        plan: assignmentIn?.plan?.agentId ? { agentId: assignmentIn.plan.agentId } : null,
        build: assignmentIn?.build?.agentId ? { agentId: assignmentIn.build.agentId } : null,
        review: assignmentIn?.review?.agentId ? { agentId: assignmentIn.review.agentId } : null,
        verify: assignmentIn?.verify?.agentId ? { agentId: assignmentIn.verify.agentId } : null,
      };
      // #1104 A：两槽全空（含整参缺失）= 无主 build——步无人可领，只能静默
      // 卡死在 pending。400 打回（requireTeamAgent/machineId 同律：错当场折进
      // 工具结果 `run_builds rejected: …`，chief 下一轮自行补人重派；单槽
      // 非空放行，留给该步的 claim 面失败收尾兜底）。
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
      // 逐卡校验先于任何派工（#1466）：本队任务指向他队项目（旧 create_todo
      // 可造）在建 build 之前就 404，整批不动——不留「报错了、build 却在跑」。
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
        // 派工即自动 watch（r5 §3.5：run_builds → watches[0] reason canon）。
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
      // #1250（ADR 0018 层 1）：接通独立审核运行——与 REST review 动作同一
      // 面块（applyBuildStepAction review 分支；agentId 缺省 = fan-out 三视角
      // 路径：persona 三员各入队一条 review 步，无 persona 回落 assignment
      // .review 槽）。相位闸/材料组装/宣告行全走同一条缝，不另立第二实现。
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
        // #1219：走取消漏斗（pending→stopped 落账 / claimed→stop 委托 /
        // 无活动步→僵尸释放）——旧裸 UPDATE 只写 errorMessage + 步 failed，
        // todo 不离 queued，run_builds 随后 409 queued→queued 整队停摆。
        cancelBuild(deps, buildId);
      }
      return json({ cancelled: buildIds });
    }
    case 'merge_builds': {
      // #1256（ADR 0018「合并动作留人，不在名册内」）：合并只由人触发——
      // chief 不得代合。返回拒绝 JSON（不抛错）：拒绝文案作为工具结果回到
      // chief 眼前（留痕在会话），指认人工出口（web 界面 review 关口「完成」
      // 按钮）。与 MCP face merge_builds 同文案（shared MERGE_HUMAN_ONLY_COPY
      // 单源）。
      const buildIds = strArr(params, 'buildIds');
      return json({ rejected: true, buildIds, reason: MERGE_HUMAN_ONLY_COPY });
    }

    // —— Chief 私有侧 10 ——
    case 'ask_user': {
      // #1049：主通道走机器问答端点（POST /api/machine/ask，阻塞语义）；本
      // relay 路径只服务两处不阻塞的消费者——旧 daemon（relayTool 10s 超时
      // 载不动 hold）与 MCP face 探针：建卡（幂等 requestId = 自铸 id）后
      // 即回 pending，答案由答题端点落到卡上，模型下一轮自见。
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
      // r5 §6：agentId = Chief 绑定 Agent（共用存储）；三级溯源；配额 100。
      if (ctx.chiefAgentId === null)
        throw new HttpError(409, 'chief agent not bound — memory has no store');
      // 溯源 id 核团队（#1470）：他队与不存在同 404，不落库。
      const projectId = optStr(params, 'projectId') ?? null;
      const sourceTodoId = optStr(params, 'sourceTodoId') ?? null;
      if (projectId !== null) requireProjectRow(db, projectId, ctx.teamId);
      if (sourceTodoId !== null) requireTeamTodo(db, sourceTodoId, ctx.teamId);
      const row = saveMemoryEntry(db, {
        agentId: ctx.chiefAgentId,
        teamId: ctx.teamId,
        title: str(params, 'title'),
        content: str(params, 'content'),
        projectId,
        sourceTodoId,
        sourceBuildId: ctx.conversationId, // chief 来源 = chief 回合 id（r5 §6）
      });
      return json(row);
    }
    case 'delete_memory': {
      // 越权防御（#1497）：只删绑定 Agent 本团队条目；别人的与不存在的同 404，
      // 不回报一次没发生的删除。
      const memoryId = str(params, 'memoryId');
      const removed =
        ctx.chiefAgentId === null
          ? 0
          : db
              .delete(agentMemory)
              .where(
                and(
                  eq(agentMemory.id, memoryId),
                  eq(agentMemory.agentId, ctx.chiefAgentId),
                  eq(agentMemory.teamId, ctx.teamId),
                ),
              )
              .run().changes;
      if (removed === 0) throw new HttpError(404, `memory ${memoryId}`);
      return json({ deleted: memoryId });
    }
    case 'memories': {
      if (ctx.chiefAgentId === null) return json([]);
      const rows = db
        .select()
        .from(agentMemory)
        .where(and(eq(agentMemory.agentId, ctx.chiefAgentId), eq(agentMemory.teamId, ctx.teamId)))
        .orderBy(asc(agentMemory.createdAt))
        .all();
      return json(rows);
    }
    case 'watch_todos': {
      const todoIds = strArr(params, 'todoIds');
      const reason = optStr(params, 'reason');
      // 他队任务与不存在同样跳过（#1466 团队归属，requireTeamTodo 同口径）；项目
      // 归属先全部校验再 watch——本队任务指向他队项目即整批 404，不半截生效。
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

/** 过闸 done 落地的动作主体（#902/#900）：kind 决定闸相位拒否——agent
 * （chief 工具面）不得自过 confirm/review 闸；user（MCP key 属主 = 用户身份，
 * mcp-face.ts 头注同语义）放行但落审计行。name = 宣告行 actor 位。 */
export type TransitionActor = { kind: 'user' | 'agent'; name: string };

/** transitionTodos 实际用到的 deps 子集（#1406：issue 轮询器的关闭对账从
 * scheduler 的 BuildDeps 进来，没有 reposDir / skillsDir 等工具面位）。 */
export type TransitionDeps = Pick<ChiefToolDeps, 'db' | 'hub' | 'machineHub' | 'user' | 'convHub'>;

/** 批量 phase 流转（MCP server 面 complete/close/reopen 同吃，02 §7.2 六能力组
 * Manage lifecycle）。非法流转边跳过不中断 [设计]。
 * #900：agent 主体把闸相位（confirm/review）卡直推 done = 无 merge 步、无人
 * 到场的自过闸（#892 实证 #14：8 秒）——拒，拒因进回执 reasons[ id ]（chief
 * LLM 据此停在 review 并 notify_user 唤醒人）。
 * #902：done 落地成功即往 todo 最新 build 会话落 DONE_ANNOUNCEMENT 行（actor
 * = 主体 displayName）；无会话（latestBuildId null）静默跳过。 */
export function transitionTodos(
  deps: TransitionDeps,
  teamId: string,
  todoIds: string[],
  to: 'closed' | 'todo' | 'done',
  actor: TransitionActor,
): { transitioned: string[]; skipped: string[]; reasons?: Record<string, string> } {
  // machineHub 在位 → setTodoPhase 漏斗可触发 chief wake（done=settle 等）。
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
    // 团队归属校验（纵深防御）：跨团队 id 记 skipped，不中断批次。
    const owned = deps.db
      .select({ id: todo.id, phase: todo.phase, latestBuildId: todo.latestBuildId })
      .from(todo)
      .where(and(eq(todo.id, id), eq(todo.teamId, teamId)))
      .get();
    if (!owned) {
      skipped.push(id);
      continue;
    }
    // #900 闸相位 done 落地要人过闸（agent 主体拒；confirm→done 在漏斗本就
    // 非法，这里先于流转判定拒，让拒因是「闸」而不是笼统的非法边）。
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
        // #1445：关闭即停活动步——只写相位的话 pending 步仍会被机器领走。
        // #1451：complete_todos 把卡标完成、离开执行中（漏斗的 building→done
        // 边）同停——claimed 步零通知会继续跑。
        const doneFromInProgress =
          to === 'done' && (IN_PROGRESS_PHASES as readonly string[]).includes(owned.phase);
        if ((to === 'closed' && owned.phase !== 'closed') || doneFromInProgress)
          stopActiveStepsAfterExit(svc, id);
        // #902 done 落地审计行（不经合并步的 done 一律留痕，actor 答「谁」）。
        // 同相位重放（XMON-59 幂等语义：MCP 批量流转重入）不重复落行——
        // 审计记发生的流转，不记重放。
        if (to === 'done' && owned.phase !== 'done' && owned.latestBuildId !== null) {
          insertGateAnnouncement(deps, owned.latestBuildId, DONE_ANNOUNCEMENT, actor.name);
        }
        // #1250（ADR 0018 层 2）：done 落地即推进拆卡波次（completeStep 的
        // merge 半边同律——子卡 done 解锁后续波次自动派发）。
        if (to === 'done' && owned.phase !== 'done') {
          advanceSplitWaves(
            { db: deps.db, hub: deps.hub, machineHub: deps.machineHub, user: deps.user },
            id,
          );
        }
      } else skipped.push(id);
    } catch {
      skipped.push(id); // 非法流转边（phase.ts）→ 跳过，不中断批次 [设计]
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
    // box/githubFetch：#1217 守卫探测（requestMerge 409 闸）需要——token 阶梯
    // 与测试注入位与 BuildDeps 同源。
    box: deps.box,
    githubFetch: deps.githubFetch,
  };
}
export async function confirmBuild(
  deps: ChiefToolDeps,
  buildId: string,
  /** 宣告行 actor 位（#902）；缺省 = 用户（MCP key 属主语义）。 */
  actor?: string,
): Promise<void> {
  if (!deps.db.select().from(build).where(eq(build.id, buildId)).get()) {
    throw new HttpError(404, `build ${buildId}`);
  }
  await applyBuildStepAction(buildDeps(deps), buildId, { action: 'confirm' }, actor);
}

// —— memory 写路径共用面（02 §4.4/r5 §6，M4b）———————————————————————————————
// save_memory 单源：配额 100 + 三级溯源（agentId/teamId/projectId/sourceTodoId/
// sourceBuildId）。chief 回合与 worker 执行步中共用（「Chief 与绑定 Agent 共用
// 同一存储」r5 §2/§6 的写侧半；worker 侧 = 指令触发 + Agent 裁量，宿主不做
// 任务结束蒸馏——零自动写入语义由「无钩子调用点」结构性守住）。

/** 配额门 + 落库（r5 §6 形状原样）。超限 = 409（UI `记忆 · n/100` 同源常量）。 */
export function saveMemoryEntry(
  db: Db,
  input: {
    agentId: string;
    teamId: string;
    title: string;
    content: string;
    projectId: string | null;
    sourceTodoId: string | null;
    sourceBuildId: string | null;
  },
): typeof agentMemory.$inferSelect {
  // #1406（ADR 0021 D5）：记忆每轮进系统提示层，GitHub issue 原文围栏里是仓外
  // 作者写的数据，逐字搬进记忆就等于把它升进系统层。只认得出逐字搬运的围栏
  // 标记；改写过的转述认不出，那一半靠 chief 章程与围栏首行的禁令。
  if (input.title.includes(ISSUE_FENCE_OPEN) || input.content.includes(ISSUE_FENCE_OPEN)) {
    throw new HttpError(
      400,
      'invalid params.content: text quoted from a GitHub issue fence is third-party data and is not saved as memory',
    );
  }
  const count = db
    .select({ n: sql<number>`count(*)` })
    .from(agentMemory)
    .where(eq(agentMemory.agentId, input.agentId))
    .get();
  if ((count?.n ?? 0) >= MEMORY_QUOTA_PER_AGENT) {
    throw new HttpError(409, `memory quota exceeded (${MEMORY_QUOTA_PER_AGENT}/agent)`);
  }
  const id = newRecordId();
  const now = nowMs();
  db.insert(agentMemory)
    .values({ id, ...input, createdAt: now, updatedAt: now })
    .run();
  const row = db.select().from(agentMemory).where(eq(agentMemory.id, id)).get();
  if (!row) throw new HttpError(500, 'memory insert lost');
  return row;
}

/** worker 步记忆工具上下文（machines.ts 从 step → build → todo → assignment
 * 解析；执行 Agent = 该步类的 assignment 槽，02 §4.2）。 */
export interface WorkerMemoryCtx {
  teamId: string;
  agentId: string;
  todoId: string;
  /** 任务所属项目；与任务不同队时为 null（#1497）。 */
  projectId: string | null;
  /** buildId ≡ conversationId（CONTEXT.md）= sourceBuildId 溯源位（r5 §6）。 */
  buildId: string;
  /** 附件读取路径（#310/r9 §3.1 worker 面 attachment 工具执行需要）。 */
  attachmentsDir: string;
}

/** worker 步 relay 白名单 = 记忆三件套 + 附件读 + set_task_meta + 技能写词
 * （WORKER_REMOTE_TOOLS 单源；
 * 词表外 = 400）。chief 51 词表不外溢到 worker 步——组织/执行面是 Chief 专属
 * （例外：create_skill/update_skill 双侧都有，XMON-109 拍板 worker 也能写
 * 技能，worker 侧另有 agent 行开关执法）。
 * （r5 §3.1，技能写词 = XMON-109）。attachment：服务层单源 = attachments.readAttachmentMeta，团队
 * 归属同关，utf8/base64 编码同 chief 路径（chief-tools/mcp-face case 'attachment'
 * 三源同形）。 */
export async function executeWorkerMemoryTool(
  db: Db,
  ctx: WorkerMemoryCtx,
  name: string,
  params: Params,
): Promise<string> {
  switch (name) {
    case 'save_memory': {
      // 溯源缺省 = 运行中任务上下文（r5 §6 实测样本 sourceTodoId/sourceBuildId
      // = 当次 todo/build）；params 显式值优先（跨任务记录经验 [设计]），
      // 显式值核团队（#1470，chief save_memory 同律）。
      const projectId = optStr(params, 'projectId');
      const sourceTodoId = optStr(params, 'sourceTodoId');
      if (projectId !== undefined) requireProjectRow(db, projectId, ctx.teamId);
      if (sourceTodoId !== undefined) requireTeamTodo(db, sourceTodoId, ctx.teamId);
      const row = saveMemoryEntry(db, {
        agentId: ctx.agentId,
        teamId: ctx.teamId,
        title: str(params, 'title'),
        content: str(params, 'content'),
        projectId: projectId ?? ctx.projectId,
        sourceTodoId: sourceTodoId ?? ctx.todoId,
        sourceBuildId: ctx.buildId,
      });
      return json(row);
    }
    case 'delete_memory': {
      const memoryId = str(params, 'memoryId');
      // 越权防御：只删本 Agent 本团队条目；别人的与不存在的同 404（#1497，
      // chief delete_memory 同律）。
      const removed = db
        .delete(agentMemory)
        .where(
          and(
            eq(agentMemory.id, memoryId),
            eq(agentMemory.agentId, ctx.agentId),
            eq(agentMemory.teamId, ctx.teamId),
          ),
        )
        .run().changes;
      if (removed === 0) throw new HttpError(404, `memory ${memoryId}`);
      return json({ deleted: memoryId });
    }
    case 'memories': {
      const rows = db
        .select()
        .from(agentMemory)
        .where(and(eq(agentMemory.agentId, ctx.agentId), eq(agentMemory.teamId, ctx.teamId)))
        .orderBy(asc(agentMemory.createdAt))
        .all();
      return json(rows);
    }
    case 'attachment': {
      // #310 / r9 §3.1：worker 步读附件，与 chief-tools / mcp-face 同源。
      const { readAttachmentMeta } = await import('./attachments.js');
      const attachmentId = str(params, 'attachmentId');
      return json(
        readAttachmentMeta({ db, attachmentsDir: ctx.attachmentsDir }, ctx.teamId, attachmentId),
      );
    }
    default:
      throw new HttpError(400, `tool ${name} is not relayed for worker steps`);
  }
}
