import { eq } from 'drizzle-orm';
// 测试引导：内存库 + migration + seed + app（wire 对拍面，04 §3）。

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { openMemoryDb } from '../src/db/client.js';
import { agent as agentTable, apiKey, machine as machineTable } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { newRecordId } from '../src/lib/ids.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { ConversationStreamHub, TeamStreamHub } from '../src/services/events.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';

export function bootServer(
  opts: {
    pingIntervalMs?: number;
    claimHoldMs?: number;
    reposDir?: string;
    attachmentsDir?: string;
    /** 技能根目录（spec 13 #367 现扫面）；缺省 = 自建隔离空目录（空集语义；
     * 要技能行的测试显式建目录传参）。 */
    skillsDir?: string;
    /** #1170 导入来源登记文件；缺省 = 自建隔离文件路径（同 skillsDir 纪律：
     * 测试间零串扰；跨「重启」持久用例显式传同一路径两次 boot）。 */
    skillSourcesPath?: string;
    /** #1170 URL 分支出站 mock（GitHub API + raw 面）。 */
    skillImportFetch?: AppContext['skillImportFetch'];
    /** #1170 单请求超时（钉 504 面用短超时）。 */
    skillImportTimeoutMs?: number;
    webDir?: string | null;
    /** GitHub 出站 mock（spec 12/#359 repo picker 代理面；#223 skills scan
     *  曾用同一位，随 spec 13 #367 退役）。 */
    githubFetch?: AppContext['githubFetch'];
    /** #231 OAuth 面：client 凭证对（默认 null = 未配置）+ 出站 mock。 */
    oauthClient?: AppContext['oauthClient'];
    oauthFetch?: AppContext['oauthFetch'];
    /** #251 可选 token 鉴权（缺省 = 关，全量既有测试零改动）。 */
    authToken?: string | null;
    /** spec 13（#368）：MCP 本地 config 读路径。缺省 = 唯一不存在路径
     *  （空列表语义，与旧「空 mcp_server 表」行为一致，既有测试零改动）。 */
    mcpConfigPath?: string;
  } = {},
) {
  const db = openMemoryDb();
  const { user, team } = seed(db);
  const hub = new TeamStreamHub();
  const machineHub = new MachineWakeHub();
  const convHub = new ConversationStreamHub();
  // 随机 key 驻内存（keyfile 落盘面 = test/secret-box.test.ts 专测）。
  const secretBox = createEphemeralSecretBox();
  // 自建隔离 reposDir（git 托管面实走用）；显式传入时由调用方管理生命周期。
  const ownReposDir = opts.reposDir === undefined;
  const reposDir = opts.reposDir ?? mkdtempSync(join(tmpdir(), 'pacman-server-repos-'));
  const ownAttDir = opts.attachmentsDir === undefined;
  const attachmentsDir = opts.attachmentsDir ?? mkdtempSync(join(tmpdir(), 'pacman-att-'));
  const ownSkillsDir = opts.skillsDir === undefined;
  const skillsDir = opts.skillsDir ?? mkdtempSync(join(tmpdir(), 'pacman-skills-'));
  // #1170：来源登记文件缺省 = 隔离目录内（目录级清理，文件自身不预建——
  // 首次导入时由 store 创建）。
  const ownSkillSourcesDir = opts.skillSourcesPath === undefined;
  const skillSourcesPath =
    opts.skillSourcesPath ??
    join(mkdtempSync(join(tmpdir(), 'pacman-skill-sources-')), 'skill-sources.json');
  const oauthStates: AppContext['oauthStates'] = new Map();
  const app = createApp({
    db,
    hub,
    machineHub,
    convHub,
    secretBox,
    user,
    team,
    // 默认拉长 ping 间隔，避免噪音；SSE 测试显式缩短。
    pingIntervalMs: opts.pingIntervalMs ?? 3_600_000,
    // claim 长轮询 hold 默认缩短，时序测试显式给值。
    claimHoldMs: opts.claimHoldMs ?? 250,
    uploads: new Map(),
    enrollments: new Map(),
    oauthStates,
    oauthClient: opts.oauthClient ?? null,
    ...(opts.oauthFetch !== undefined ? { oauthFetch: opts.oauthFetch } : {}),
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
    ...(opts.skillImportFetch !== undefined ? { skillImportFetch: opts.skillImportFetch } : {}),
    ...(opts.skillImportTimeoutMs !== undefined
      ? { skillImportTimeoutMs: opts.skillImportTimeoutMs }
      : {}),
    reposDir,
    attachmentsDir,
    skillsDir,
    skillSourcesPath,
    ...(opts.webDir !== undefined ? { webDir: opts.webDir } : {}),
    authToken: opts.authToken ?? null,
    mcpConfigPath: opts.mcpConfigPath ?? join(tmpdir(), `pacman-mcp-absent-${randomUUID()}.json`),
  });
  return {
    app,
    db,
    hub,
    machineHub,
    convHub,
    secretBox,
    user,
    team,
    reposDir,
    attachmentsDir,
    skillsDir,
    oauthStates,
    svc: { db, hub, machineHub, convHub, user, skillsDir },
    dispose(): void {
      if (ownReposDir) rmSync(reposDir, { recursive: true, force: true });
      if (ownAttDir) rmSync(attachmentsDir, { recursive: true, force: true });
      if (ownSkillsDir) rmSync(skillsDir, { recursive: true, force: true });
      if (ownSkillSourcesDir) rmSync(dirname(skillSourcesPath), { recursive: true, force: true });
    },
  };
}

/** 机器注册用 API key：走 M2c 发行端点（POST /api/teams/{id}/api-keys，
 * 一次性明文语义，02 §8/r3 §6）。 */
export async function issueApiKey(s: ReturnType<typeof bootServer>): Promise<string> {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/api-keys`, {
    name: 'machine-bootstrap',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`issueApiKey: ${res.status}`);
  }
  const body = (await res.json()) as { plaintext?: string; apiKey?: string; key?: string };
  const plain = body.plaintext ?? body.apiKey ?? body.key;
  if (!plain) throw new Error(`issueApiKey: no plaintext in ${JSON.stringify(body)}`);
  return plain;
}

export type TestServer = ReturnType<typeof bootServer>;

const jsonHeaders = { 'content-type': 'application/json' };

export function req(app: Hono, method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: body !== undefined ? jsonHeaders : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

export async function postProject(app: Hono, name = 'demo'): Promise<string> {
  const res = await req(app, 'POST', '/api/projects', { name });
  if (res.status !== 201) throw new Error(`postProject: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** 直插 gitAccess api_key 行（存哈希不存可逆值，02 §8；key 发行端点归 M2c，
 * git 面测试用本 helper 供凭证）。 */
export function insertGitApiKey(s: TestServer, secret: string): string {
  const id = newRecordId();
  s.db
    .insert(apiKey)
    .values({
      id,
      teamId: s.team.id,
      name: 'git-e2e',
      gitAccess: true,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
      keyHash: sha256Hex(secret),
      masked: `${secret.slice(0, 12)}…`,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

/** SSE 连接读取器：帧 = `data: <json>\n\n`（team stream 无 event 名，
 * 类型在载荷 type 字段，r3 §8.1/r5 §7.2 原样）。 */
export async function openStream(app: Hono, teamId: string) {
  return openSse(app, `/api/teams/${teamId}/stream`);
}

/** conversation stream 读取器（M5 live streaming 面；帧形同 team stream）。 */
export async function openConvStream(app: Hono, conversationId: string) {
  return openSse(app, `/api/conversations/${conversationId}/stream`);
}

async function openSse(app: Hono, path: string) {
  const ctrl = new AbortController();
  const res = await app.request(path, { signal: ctrl.signal });
  if (!res.body) throw new Error('stream response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const pending: unknown[] = [];

  async function pump(deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) pending.push(JSON.parse(line.slice(5).trim()));
        }
        idx = buf.indexOf('\n\n');
      }
      if (pending.length > 0) return;
    }
  }

  return {
    /** 读取直到 match 命中的事件（丢弃不匹配帧），超时抛错。 */
    async next(
      match: (ev: Record<string, unknown>) => boolean,
      timeoutMs = 3000,
    ): Promise<Record<string, unknown>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = pending.findIndex((ev) => match(ev as Record<string, unknown>));
        if (hit >= 0) return pending.splice(hit, 1)[0] as Record<string, unknown>;
        await pump(deadline);
        if (
          pending.findIndex((ev) => match(ev as Record<string, unknown>)) < 0 &&
          Date.now() >= deadline
        ) {
          throw new Error(`stream timeout waiting for event (buffered ${pending.length})`);
        }
      }
    },
    close(): void {
      ctrl.abort();
      void reader.cancel().catch(() => {});
    },
  };
}

/** #1259 归属机供给：创建 agent 的 API 契约要求 machineId（归属机必填）。
 *  直插 machine 行（默认双 runtime 全开 + 在线），返回机器 id。 */
export function insertMachine(
  s: TestServer,
  opts: {
    name?: string;
    enabledRuntimes?: string[];
    claudeCodeReport?: import('@pacman/shared').ClaudeCodeReport | null;
  } = {},
): string {
  const id = opts.name
    ? `machine-${opts.name}`
    : `machine-${Math.random().toString(36).slice(2, 10)}`;
  s.db
    .insert(machineTable)
    .values({
      id,
      teamId: s.team.id,
      name: opts.name ?? 'test-machine',
      online: true,
      enabledRuntimes: opts.enabledRuntimes ?? ['pi', 'claude-code'],
      claudeCodeReport: opts.claudeCodeReport ?? null,
    })
    .run();
  return id;
}

/** #1259 测试世界绑定器：把团队全部 agent 绑到指定机器（缺省 = 团队首台）。
 *  绑定模型下「可领」的缺省形态——世界工厂在 agent 插行后调用一次。 */
export function bindAllAgents(s: TestServer, machineId?: string): void {
  const mid =
    machineId ??
    s.db.select().from(machineTable).where(eq(machineTable.teamId, s.team.id)).get()?.id;
  if (mid === undefined) throw new Error('bindAllAgents: 世界里还没有机器（先 enroll/插入）');
  s.db.update(agentTable).set({ machineId: mid }).run();
}

/** #1260 单 agent 绑定器：chief 绑定 Agent 的归属机 = chief 步去处——chief
 *  语义测试在 enroll 认领机后调一次（bindAllAgents 的逐机变体）。 */
export function bindAgentHome(s: TestServer, agentId: string, machineId: string): void {
  s.db.update(agentTable).set({ machineId }).where(eq(agentTable.id, agentId)).run();
}

/** 按名字取本队机器 id（enroll 后读本队机器行）。 */
export function machineIdByName(s: TestServer, name: string): string {
  const row = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get();
  if (row === undefined) throw new Error(`machineIdByName: ${name} 不在库里`);
  return row.id;
}
