// 机器面问答与 relay 工具执行（#1134 自 machines.ts 纯提取，行为零变化）：
// ask_user 问答通道（hold 长轮询）+ remoteTools relay 分流（chief 步 51 词表
// → chief-tools.ts；worker 步记忆/技能写/set_task_meta）+ set_task_meta 溯源
// 回填簇（todo 标题/标签 + github 形态 issue 回写）。定位 = dispatch/provenance
// 薄层，架在 chief-tools.ts / chief-questions.ts / skills.ts / todos.ts 之上
// ——与 queue 管理（machines.ts claim 面）是两份工作。所有权校验复用
// machines.ts journal 内核（ownedStep）；路由面 = routes-machine.ts 的
// ask / tool 端点。

import type { MachineAskBody, MachineAskResponse } from '@pacman/shared';
import {
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  createSkillBodySchema,
  derivePlaceholderTitle,
  FIXED_TAGS,
  updateSkillToolParamsSchema,
} from '@pacman/shared';
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

/** 机器问答通道（#1049：POST /api/machine/ask/<stepId>）。与 relay 工具面分道
 * 的理由：ask_user 的等待语义（挂到人答为止）与 relayTool 的 10s 超时互斥——
 * 专用端点 + hold 长轮询（claim 同律：到期回 pending，daemon 原样重发同
 * requestId，幂等命中既有卡不叠不重通知）。步必须是被本机认领的 chief 步；
 * 非 chief 步（worker 词表无 ask_user）400。signal = 请求断连（#1065 僵尸
 * 认领同律：死请求不占线，hold 循环即刻退）。 */
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

/** remoteTools relay 执行（02 §4.3「服务端定义并执行」；r5 §3.1 bundle：POST
 * /api/machine/tool/<stepId> {name, params} → {text}）。机器所有权校验后按步类
 * 分流：chief 步 = 51 词表（溯源上下文 step → chief_thread → chief）；worker
 * 步 = 记忆三件套 + 附件读 + set_task_meta + 技能写词（02 §4.4/r5 §6 worker
 * 写路径 + XMON-109 技能写，溯源 step → build → todo → assignment 槽）。
 * 返回 JSON 串（daemon 侧包 {text} 回 pi）。 */
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

/** worker 步 relay = 记忆三件套 + set_task_meta + 技能写词 create_skill/
 * update_skill（白名单在 executeWorkerMemoryTool / 下方拦截；词表外 400；
 * 技能写词按 agent 行 tools 开关执法 403）。溯源上下文（r5 §6 实测
 * 样本 = 运行中 todo/build）：step → build → todo → assignment 槽 Agent
 * （02 §4.2 按步类取槽）。 */
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
  // spec 15 #394：任务元信息回填（ADR 0002 D3）。窄工具——todoId 从步钉死、
  // 不走 agent 槽闸（写面是 todo 不是 agent 资产），词表外 tag name 400。
  if (name === 'set_task_meta') return setTaskMeta(deps, todoRow, params);
  const slot = row.kind === 'plan' ? todoRow.assignment?.plan : todoRow.assignment?.build;
  const agentId = slot?.agentId;
  // XMON-109 S1：技能写词（词表恒列，授权执法在 agent 行 tools——403 同
  // requestMerge 形）。无 agent 步无执行者可审计 = 409（纵深防御位：agent
  // 空槽步不入 claim 候选，正常流走不到）。
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
      // 他队项目不进溯源缺省（#1497 projectOfTodo）。
      projectId: projectOfTodo(deps.db, todoRow)?.id ?? null,
      buildId: row.buildId,
      attachmentsDir: deps.attachmentsDir,
    },
    name,
    params,
  );
}

/** worker 技能写词执行（XMON-109 S1）：agent 行 tools 开关执法——「创建
 * 技能/更新技能」未开 = 403（requestMerge 同形：点名开关 + 指路 Agent
 * 详情页权限 tab；词表恒列与授权执法解耦，缺权调用在此拒）。通过后走
 * createLocalSkill/updateLocalSkill 单源写路径，审计 actor = 该步 Agent。 */
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

/** set_task_meta（spec 15 #394 + #446/ADR 0005 分叉律 + #452 写向）：校验按
 * 项目形态分支——local/hosted = FIXED_TAGS 白名单 + 单 tag + title 必填
 * （现行为逐字节不变，ADR 0002 D3/D4 收窄后的 local 适用域）；github =
 * 项目标签集（仓库 label 镜像）+ tags 多枚 + title 可选（导入任务标题已真
 * 值；自建 issue 任务回填并写回 issue，ADR 0006 D3）。
 * 两形态共用一条不变式：贴的标签必须在本项目标签集内。标题归一（首行
 * ≤50 字符，derivePlaceholderTitle 复用）同形。更新走 updateTodo 既有面
 * （v++ + SSE 广播，看板实时刷新）。async = github 形态的 issue 标题回写
 * 出站位（local 形态零出站，行为不变）。 */
async function setTaskMeta(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  params: Record<string, unknown>,
): Promise<string> {
  // 项目须与任务同队（#1497）：他队项目的标签集不进本队任务。
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

/** set_task_meta 标题归一（两形态共用单点）：derivePlaceholderTitle 首行
 * ≤50 字符；非串 / 归一后空白 → 400。 */
function normalizedMetaTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? derivePlaceholderTitle(raw) : '';
  if (title === '') throw new HttpError(400, 'invalid params.title: expected non-empty string');
  return title;
}

/** github 形态 set_task_meta（#446 + #452 写向）：title 可选（归一规则同
 * local——多行/超长传值归一到首行 ≤50）；**导入**任务（sourceKind =
 * 'github-issue'）的标题已是真值——带 title 的调用一律 400（AC「不被回填
 * 覆盖」的机械闸，提示词面不注入回填指令是第一道，本闸是第二道）；自建
 * issue 任务（'github-issue-self'，ADR 0006 D3）title 放行且落库后写进那
 * 枚 issue（回写失败吞——relay 恒 200，漂移交详情页只读回显提示面，B2）；
 * tags = name 数组，逐个按项目标签集现查解析，集合外 name = 400；title 与
 * tags 全缺 = 400（无意义调用）。混部容忍：旧形单 `tag` 字符串并入 tags
 * （server 校验按项目形态分支，不按工具面形状——旧 daemon 发旧参数不断
 * 约）。 */
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
  // #452 / ADR 0006 D3：自建 issue 任务的回填标题写进那枚 issue（await 出站
  // ——relay 面非建任务关键路径；lib 超时 15s 封顶）。失败吞（B2）：本地标题
  // 已生效不回滚，不一致由详情页只读回显给中性提示。未建成 → 静默跳过
  // （后建 issue 现读当前标题，自然一致）。
  if (title !== undefined && record.sourceKind === 'github-issue-self') {
    await writebackSelfIssueTitle(todoDeps, todoRow.id, record.title).catch(() => undefined);
  }
  return JSON.stringify({ todoId: record.id, title: record.title, tagIds: record.tagIds });
}
