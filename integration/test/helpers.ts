// 集成引导：真 HTTP server（@hono/node-server，非 app.request 面）+ 世界 seed
// （provider 指向 stub LLM + agent + bootstrap apiKey）。三端互不依赖纪律
// 不破：本 harness 以相对路径消费 server/daemon 源码，独立成包。

import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectRepoKind, Scheduler } from '@cairn/shared';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../apps/server/src/app.js';
import { openDbWithHandle, openMemoryDb } from '../../apps/server/src/db/client.js';
import {
  agent as agentTable,
  provider as providerTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { createApiKey } from '../../apps/server/src/services/api-keys.js';
import { ConversationStreamHub, TeamStreamHub } from '../../apps/server/src/services/events.js';
import { MachineWakeHub } from '../../apps/server/src/services/machine-wake-hub.js';
import { createScheduler } from '../../apps/server/src/services/scheduler.js';

export const AGENT_ID = 'agent-it-1';

export interface RealServer {
  url: string;
  teamId: string;
  apiKey: string;
  db: ReturnType<typeof openMemoryDb>;
  /** 托管 bare repo 存储根（M3b git 面断言用）。 */
  reposDir: string;
  attachmentsDir: string;
  /** server 侧团队技能库根（spec 13 #367 现扫面 / #920 分发清单的来源目录）。
   *  隔离空目录——需要团队技能的用例显式往里写 `<dirName>/SKILL.md`（#919
   *  行为验收的远端分发面）。 */
  skillsDir: string;
  /** POST /api/machine/tasks/claim 请求计数（cadence 时序实测面）。 */
  claimCount: () => number;
  todoPhase(todoId: string): string;
  /** 定时调度器（opts.scheduler = true 时创建；tick() 手动驱动或 start()
   * 真实循环——M5 定时轮 E2E 面）。 */
  scheduler: Scheduler | null;
  close(): Promise<void>;
}

export async function bootRealServer(opts: {
  providerBaseUrl: string;
  claimHoldMs?: number;
  /** seed Agent 职责文本（systemPrompt 注入面；缺省 = M3a 无工具文案）。 */
  agentDescription?: string;
  /** SPA 静态同源托管根（M5 web E2E：vite build 产物目录，02/A1）。 */
  webDir?: string;
  /** 创建定时调度器（缺省不建——既有测试无定时面）。 */
  scheduler?: boolean;
  /** spec 13（#368）：MCP 本地 config 读路径；缺省 = 唯一不存在路径
   *  （空列表语义，既有测试零改动）。 */
  mcpConfigPath?: string;
  /** #1028 重启对拍：文件库路径（缺省 :memory:）。同路径二次 boot = 进程
   *  重启的持久化语义（机器 token / 步 / plan 行跨「重启」存活，uploads
   *  Map 等进程内存面归零）。 */
  dbPath?: string;
  /** 固定监听端口（缺省随机）；重启对拍传旧 server 的端口——同端口重绑 =
   *  daemon/预签名 URL 的 origin 不变。 */
  port?: number;
}): Promise<RealServer> {
  const db = opts.dbPath !== undefined ? openDbWithHandle(opts.dbPath).db : openMemoryDb();
  const { user, team } = seed(db);
  const hub = new TeamStreamHub();
  const machineHub = new MachineWakeHub();
  const convHub = new ConversationStreamHub();
  const secretBox = createEphemeralSecretBox();
  const reposDir = mkdtempSync(join(tmpdir(), 'cairn-it-repos-'));
  const attachmentsDir = mkdtempSync(join(tmpdir(), 'cairn-it-att-'));
  // 技能根（spec 13 #367 现扫面）：隔离的空目录 = 空集语义，集成用例
  // 需要技能行时显式往里建目录。
  const skillsDir = mkdtempSync(join(tmpdir(), 'cairn-it-skills-'));
  const app = createApp({
    db,
    hub,
    machineHub,
    convHub,
    secretBox,
    user,
    team,
    // 心跳与生产同值（TEAM_STREAM_PING_INTERVAL_MS=15s，config.ts 缺省同源）。
    // 曾设 1h 关心跳——与生产分叉且使 web 端静默看门狗（#462，20s 阈值以
    // 心跳为健康基准）在测试里失去心跳参照，故对齐。
    pingIntervalMs: 15_000,
    claimHoldMs: opts.claimHoldMs ?? 1_000,
    uploads: new Map(),
    enrollments: new Map(),
    // #231 OAuth 面:集成面无 OAuth 用例——state 册空挂、client 未配置
    // (authorize 走 400 提示路径,不碍其余面)。
    oauthStates: new Map(),
    oauthClient: null,
    reposDir,
    attachmentsDir,
    skillsDir,
    // #1170 导入来源登记：隔离目录内（与 skillsDir 同纪律；集成用例需要
    // 导入/refresh 时走 CAIRN_HOME 无关的隔离路径）。
    skillSourcesPath: join(
      mkdtempSync(join(tmpdir(), 'cairn-it-skill-sources-')),
      'skill-sources.json',
    ),
    webDir: opts.webDir ?? null,
    // #251 可选 token 鉴权：集成面全部走关态（默认行为零改动）。
    authToken: null,
    mcpConfigPath: opts.mcpConfigPath ?? join(tmpdir(), `cairn-it-mcp-${randomUUID()}.json`),
  });
  const scheduler = opts.scheduler
    ? createScheduler({ db, hub, user, convHub }, { tickMs: 60_000 })
    : null;
  // 机器注册 key 走 M2c 发行服务面（一次性明文，02 §8）。
  const issuedKey = createApiKey(
    { db },
    {
      teamId: team.id,
      name: 'machine-bootstrap',
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    },
  );

  let claims = 0;
  const fetchImpl: typeof app.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes('/api/machine/tasks/claim')) claims += 1;
    // #1259 归属机绑定的测试世界缺省：首台 enroll 的机器 = 未绑 agent 的
    // 归属机（bindAllAgents 同款语义——单机世界「可领」缺省形）。多机用例
    // 自行换绑；只绑 machineId IS NULL 的行，不覆盖已设归属。
    if (
      url.includes('/api/machine/enroll') &&
      ((init as RequestInit | undefined)?.method ?? 'POST') === 'POST'
    ) {
      const res = await app.fetch(input as never, init);
      if (res.status === 200) {
        const body = (await res
          .clone()
          .json()
          .catch(() => null)) as {
          machineId?: string;
        } | null;
        if (typeof body?.machineId === 'string') {
          db.update(agentTable)
            .set({ machineId: body.machineId })
            .where(and(eq(agentTable.teamId, team.id), isNull(agentTable.machineId)))
            .run();
        }
      }
      return res;
    }
    return app.fetch(input as never, init);
  };

  const server = serve({ fetch: fetchImpl, port: opts.port ?? 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  // 世界 seed：custom provider（指向 stub LLM，无 key 网关）+ agent。文件库
  // 二次 boot（#1028 重启对拍）= 幂等插入（seed 本身幂等，这两行加存在性闸）。
  if (db.select().from(providerTable).where(eq(providerTable.id, 'prov-it')).get() === undefined) {
    db.insert(providerTable)
      .values({
        id: 'prov-it',
        teamId: team.id,
        kind: 'custom',
        providerId: 'stub-gw',
        label: 'Stub Gateway',
        baseUrl: opts.providerBaseUrl,
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'stub-model', name: 'stub-model' }],
        createdBy: user.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }
  if (db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get() === undefined) {
    db.insert(agentTable)
      .values({
        id: AGENT_ID,
        teamId: team.id,
        displayName: 'it-builder',
        description:
          opts.agentDescription ?? '你是集成测试执行 Agent：直接简短回答，不使用任何工具。',
        provider: 'stub-gw',
        modelId: 'stub-model',
        // XMON-77 权限闸：lifecycle 类用例走 build push + merge 全链，两开关先授。
        tools: ['合并分支', '推送分支'],
      })
      .run();
  }

  return {
    url,
    teamId: team.id,
    apiKey: issuedKey.plaintext,
    db,
    reposDir,
    attachmentsDir,
    skillsDir,
    claimCount: () => claims,
    todoPhase(todoId: string) {
      return db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase ?? '';
    },
    scheduler,
    close: () =>
      new Promise<void>((resolve, reject) => {
        scheduler?.stop();
        // 长轮询/SSE 连接会挂住 close()——先掐全部活动连接（node:http 面）。
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
        rmSync(reposDir, { recursive: true, force: true });
        rmSync(skillsDir, { recursive: true, force: true });
      }),
  };
}

/** web 面 REST 调用（自动登录 cookie 面，测试不携凭证）。 */
export async function api(
  url: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

export interface WorldIds {
  projectId: string;
  todoId: string;
}

export async function seedWorld(
  url: string,
  teamId: string,
  todo: { title: string; spec: string },
  opts: {
    repoKind?: ProjectRepoKind;
    projectName?: string;
    /** local 形态：用户本机 git 工作树仓绝对路径（spec 12 G2-T2）。 */
    localPath?: string;
  } = {},
): Promise<WorldIds> {
  const name = opts.projectName ?? 'it-project';
  const project = await api(url, 'POST', '/api/projects', {
    name,
    teamId,
    ...(opts.repoKind !== undefined ? { repoKind: opts.repoKind } : {}),
    ...(opts.localPath !== undefined ? { localPath: opts.localPath } : {}),
  });
  const projectId = (project.body as { id: string }).id;
  const res = await api(url, 'POST', `/api/projects/${projectId}/todos`, todo);
  const todoId = (res.body as { id: string }).id;
  return { projectId, todoId };
}

/** 读 daemon.log 归一化行（#691）：剥掉落盘的 wall-clock 前缀，返回 canon 行面。
 * 集成层的同步（waitFor）与行内容断言都吃 canon 面——盘上的时间戳是取证面，
 * 要断言带时间戳的原始形时直接 readFileSync，不走本 helper。 */
export function daemonLogLines(daemonLog: string): string[] {
  try {
    return readFileSync(daemonLog, 'utf8')
      .split('\n')
      .map((l) => l.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /, ''));
  } catch {
    return [];
  }
}

/** 外部 MCP server（测试内起，client 面对拍端）：echo 工具 + note 资源
 * （#930 resources 能力立证面）+ 调用记录。m4b（桥全链）与 gate-e2e
 * （闸覆盖面探针）共用同一 fixture 形。 */
export async function startExternalMcp(): Promise<{
  url: string;
  calls: { name: string; args: Record<string, unknown> }[];
  close(): Promise<void>;
}> {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const http: Server = createServer((req, res) => {
    void (async () => {
      const server = new McpServer({ name: 'external-fixture', version: '0.0.1' });
      server.registerTool(
        'echo',
        { description: 'Echo text back.', inputSchema: { text: z.string() } },
        async (args) => {
          calls.push({ name: 'echo', args: args as Record<string, unknown> });
          return { content: [{ type: 'text', text: `external-echo:${args.text}` }] };
        },
      );
      server.resource(
        'note',
        'demo://note',
        { description: 'A demo note resource (#930).' },
        async () => ({ contents: [{ uri: 'demo://note', text: 'demo-note-content' }] }),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body =
        chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await transport.handleRequest(req, res, body);
    })();
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 60_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
