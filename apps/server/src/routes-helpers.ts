// #1125 拆域：routes.ts 各资源域模块的跨域共享件——守卫（requireTeam/
// requireProject/requireAgentRow）、行投影（toTagRecord/agentRecordOf/
// toMemoryRecord）、局部 body schema、jsonBody/requestOrigin、git Basic 凭证
// 校验、svc 束与 github-issue 读面 deps 装配。本模块不注册任何路由；词表
// 单源与对拍契约（shared WEB_REST_ENDPOINTS + test/wire.test.ts）不变。

import { timingSafeEqual } from 'node:crypto';
import {
  type AgentRecord,
  apiKeyRecordSchema,
  assignmentSlotSchema,
  BRAND,
  githubIssueStateSchema,
  type MemoryRecord,
  phaseSchema,
  type TagRecord,
} from '@pacman/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { agent, type agentMemory, apiKey, project, type tag } from './db/schema.js';
import { sha256Hex } from './lib/crypto.js';
import { notFound } from './lib/errors.js';
import type { GithubIssueFaceDeps } from './services/github-issues.js';

/** 会话 cookie 名 [设计]（01 §4.2：httpOnly cookie 自设；品牌槽已随 D3 切换，#109，
 * 单源 = shared BRAND.sessionCookieName）。 */
export const SESSION_COOKIE = BRAND.sessionCookieName;

/** git http 认证域 [设计]（Basic realm；品牌槽归 #44）。 */
export const GIT_AUTH_REALM = 'pacman-git';

export function requireTeam(ctx: AppContext, id: string): void {
  // team 恒 seed 一行（02 §2.2）；其余 id 一律 404。
  if (id !== ctx.team.id) throw notFound(`team ${id}`);
}

export function requireProject(ctx: AppContext, id: string): typeof project.$inferSelect {
  const row = ctx.db.select().from(project).where(eq(project.id, id)).get();
  if (!row) throw notFound(`project ${id}`);
  return row;
}

/** GET projects/{id}/github/issues query 闸（#446）：state 值域 = shared
 * githubIssueStateSchema 单源（缺省 open）；page  coercion 正整数（非法 →
 * 400，不出站）。 */
export const githubIssuesQuerySchema = z.object({
  state: githubIssueStateSchema,
  page: z.coerce.number().int().min(1),
});

/** tag 行 → record 全形（r9 §3.4 实测 wire 六位；显式投影防列面扩张外溢）。 */
export function toTagRecord(row: typeof tag.$inferSelect): TagRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
    v: row.v,
  };
}

/** PATCH /api/todos/{id} body——update_todo 面 [推断]（02 §6.1 PATCH 面未
 * 抓取；字段 = todo record 可写子集，wire 补采后收紧，04 附录 A）。 */
export const patchTodoBodySchema = z.object({
  title: z.string().optional(),
  spec: z.string().optional(),
  phase: phaseSchema.optional(),
  tagIds: z.array(z.string()).optional(),
  orderIndex: z.number().optional(),
  // 指派双槽（#208「编辑分配」）：槽位词表复用 shared assignmentSlotSchema
  // （02 §6.2）；槽级 optional = 槽级 merge，未提供的槽保持现状。
  assignment: z
    .object({
      plan: assignmentSlotSchema.optional(),
      build: assignmentSlotSchema.optional(),
    })
    .optional(),
});

/** PATCH /api/teams/{id}/secrets/{sid} body [推断]（覆盖面 =「保存后只能
 * 覆盖或删除」r2 §6.3；POST body = shared setSecretBodySchema 单源）。 */
export const patchSecretBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  value: z.string().optional(),
});

/** POST /api/teams/{id}/api-keys body = shared apiKeyRecordSchema（02 §6.2
 * 形状原样）+ name 放宽可选（表单「密钥名称（可选）」r3 §6）。 */
export const createApiKeyBodySchema = apiKeyRecordSchema.extend({ name: z.string().nullish() });

export function requireAgentRow(ctx: AppContext, teamId: string, agentId: string) {
  const row = ctx.db
    .select()
    .from(agent)
    .where(and(eq(agent.id, agentId), eq(agent.teamId, teamId)))
    .get();
  if (!row) throw notFound(`agent ${agentId}`);
  return row;
}

// agent.mcpServers[] = 本机 config 键名（spec 13/#368）：写入不做存在性校验
// ——未知键静默容忍（勾选与 ~/.claude.json 漂移、多机各读各 config 的竞态），
// 执行 daemon 解析时跳过并落降级行。

export function agentRecordOf(row: typeof agent.$inferSelect): AgentRecord {
  return {
    id: row.id,
    displayName: row.displayName,
    description: row.description,
    status: 'active', // 观测值仅 "active"（records/agent.ts，词表不收窄外值）
    avatarUrl: row.avatarUrl,
    provider: row.provider,
    modelId: row.modelId,
    thinkingLevel: row.thinkingLevel,
    tools: row.tools,
    secrets: row.secrets,
    // #1169：旧 skills 一列两义（携带+授权）拆成两字段，此处投影同名两槽。
    defaultSkill: row.defaultSkill,
    skillsAllowlist: row.skillsAllowlist,
    mcpServers: row.mcpServers,
    // #1138：agent 并发上限（null = 不限），恒随行（optional 形只留给老
    // server 响应的解析兼容，见 records/agent.ts 加法契约注释）。
    maxConcurrentTasks: row.maxConcurrentTasks,
    // #1259 归属机（null = 未设，不可领步，UI 可补）。
    machineId: row.machineId,
    // #1250：persona 角色位（null = 普通 agent），恒随行（同律——optional
    // 形只留给老 server 响应的解析兼容）。
    persona: row.persona,
    // #1251：能力要求声明（null = 无要求），恒随行（persona 同律）。
    requiredCapabilities: row.requiredCapabilities,
    // #1493：降级链（null = 不降级），恒随行。
    fallbackModels: row.fallbackModels,
  };
}

export function toMemoryRecord(row: typeof agentMemory.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    teamId: row.teamId,
    title: row.title,
    content: row.content,
    projectId: row.projectId,
    sourceTodoId: row.sourceTodoId,
    sourceBuildId: row.sourceBuildId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null);
}

/** 请求源（托管 cloneUrl 的本地主机代位段，02 §5.8 gitHostDomain 槽）。 */
export function requestOrigin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

/** git Basic auth → api_key 行 id。凭证 = key 明文（用户名位忽略，PAT 同款
 * [设计]）；校验 = sha256 哈希比对（存哈希不存可逆值，02 §8）+ gitAccess 白名单
 * （02 §6.2）。key 发行端点归 M2c；未命中 = undefined（401 面，02 §3 凭证纪律
 * 「手动 fetch 无凭证失败」）。 */
export function verifyGitBasicAuth(ctx: AppContext, header: string): string | undefined {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return undefined;
  const decoded = Buffer.from(match[1] ?? '', 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return undefined;
  const secret = decoded.slice(sep + 1);
  if (secret === '') return undefined;
  const hash = Buffer.from(sha256Hex(secret));
  const rows = ctx.db.select().from(apiKey).where(eq(apiKey.gitAccess, true)).all();
  return rows.find(
    (r) => r.keyHash.length === hash.byteLength && timingSafeEqual(Buffer.from(r.keyHash), hash), // 定长比较（哈希面卫生）
  )?.id;
}

/** svc 共享束（#1125 拆域后各域 register 函数自建；字段与原 registerRoutes
 *  内联字面量逐字同形）。box/githubFetch（#452 写向）：createTodo 收口的
 *  自建 issue 出站 deps——三条创建路径（web 路由 / chief 工具 / MCP face）
 *  同律透传。 */
export function svcOf(ctx: AppContext) {
  return {
    db: ctx.db,
    hub: ctx.hub,
    machineHub: ctx.machineHub,
    user: ctx.user,
    convHub: ctx.convHub,
    // #511 审核关口材料：变更面计算位（与人的变更面同源）
    reposDir: ctx.reposDir,
    box: ctx.secretBox,
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
  };
}

/** issue 读面 deps 装配（oauthDeps 同式）：githubFetch 注入位收窄到
 *  服务面，两端点共用（todos 域的来源 issue 回显/重试 + projects 域的
 *  issue 读/导面共用此装配）。 */
export function githubIssueDepsOf(ctx: AppContext): GithubIssueFaceDeps {
  return {
    db: ctx.db,
    box: ctx.secretBox,
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
  };
}
