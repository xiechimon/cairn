// MCP 本地 config 面（spec 13 / #368）：来源 = ~/.claude.json mcpServers 段。
// server 读本机供 UI 展示（投影永不含密钥值），daemon 读本机供执行（slug 解析
// 权下放）。失败方式清单（先固化场景，实现是让场景通过的手段）：
//   读取缝六态——文件不存在 / 坏 JSON / 无 mcpServers 键 / mcpServers 非对象 /
//     单条坏条目跳过 / http+stdio 混合正常；
//   投影面——env/headers 值永不出 server（只 hasCredential/credentialKeys 键名）、
//     slug = key 小写化（撞名 first-wins）、stdio url 槽 = command 预览、
//     时间戳 = 文件 mtime、record 过 mcpServerRecordSchema；
//   REST 面——GET 换源；POST/PATCH/DELETE 管理写面已删（404）；未知 team 404；
//   agent 授权面——mcpServers[] 未知键静默容忍（不再 400）；
//   claim 载荷——mcpServers slug 化（string[] 原样透传不过滤）；版本墙提升：
//     旧 daemon 版本线收不到该字段（machine-wire 断约，不混发形状）；
//   chief 工具——mcp_servers 读面换 config 源。
// 记忆删除 REST 面（02 §4.4）随本文件既有权衡保留在尾部。

import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ClaimedStep,
  claimedStepSchema,
  MCP_MIN_CLI_VERSION,
  mcpServerRecordSchema,
  WORKER_REMOTE_TOOLS,
} from '@pacman/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { agentMemory, agent as agentTable } from '../src/db/schema.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { listMcpServers, readClaudeMcpServers } from '../src/services/mcp-servers.js';
import {
  bindAllAgents,
  bootServer,
  insertMachine,
  issueApiKey,
  postProject,
  type TestServer,
} from './helpers.js';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

/** 写一份 config fixture，返回路径；不传 content = 不存在文件的路径。 */
function configPath(content?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pacman-mcp-cfg-'));
  const p = join(dir, 'claude.json');
  if (content !== undefined) {
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  }
  return p;
}

/** 混合正常 + 两条坏条目（形状坏 / 类型坏）——条目级失败不殃及池鱼的钉扎源。 */
const MIXED = {
  mcpServers: {
    demo: { url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer s3cret' } },
    local: { command: 'npx', args: ['-y', 'mcp-browser'], env: { API_KEY: 'k3y' } },
    broken: { nope: true },
    alsoBroken: { command: 42 },
  },
};

describe('readClaudeMcpServers — config 读取缝（spec 13：坏 = 空集不炸）', () => {
  test('文件不存在 = 空集（不抛）', () => {
    expect(readClaudeMcpServers(configPath()).records).toEqual([]);
  });

  test('坏 JSON = 空集（文件级解析失败不炸 server，premortem 护栏一）', () => {
    expect(readClaudeMcpServers(configPath('{ "mcpServers": oops')).records).toEqual([]);
  });

  test('无 mcpServers 键 = 空集', () => {
    expect(readClaudeMcpServers(configPath({ projects: {} })).records).toEqual([]);
  });

  test('mcpServers 非对象 = 空集', () => {
    expect(readClaudeMcpServers(configPath({ mcpServers: 'nope' })).records).toEqual([]);
    expect(readClaudeMcpServers(configPath({ mcpServers: [{ url: 'x' }] })).records).toEqual([]);
  });

  test('http+stdio 混合正常；单条坏条目跳过不殃及其余', () => {
    const { records } = readClaudeMcpServers(configPath(MIXED));
    expect(records.map((r) => r.slug)).toEqual(['demo', 'local']);
    expect(records[0]).toMatchObject({
      transport: 'http',
      url: 'https://example.invalid/mcp',
      hasCredential: true,
      credentialKeys: ['Authorization'],
    });
    // stdio：url 槽 = command 预览（spec 13「stdio 条目的 url 槽位填 command」）。
    expect(records[1]).toMatchObject({
      transport: 'stdio',
      url: 'npx',
      hasCredential: true,
      credentialKeys: ['API_KEY'],
    });
  });

  test('安全不变量：env/headers 密钥值永不出读取缝（spec 13 凭证面收窄）', () => {
    const raw = JSON.stringify(readClaudeMcpServers(configPath(MIXED)));
    expect(raw).not.toContain('s3cret');
    expect(raw).not.toContain('k3y');
  });

  test('slug = key 小写化；label = 原 key；小写撞名 first-wins', () => {
    const { records } = readClaudeMcpServers(
      configPath({ mcpServers: { Playwright: { command: 'pw' }, playwright: { command: 'pw2' } } }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ label: 'Playwright', slug: 'playwright', url: 'pw' });
  });

  test('空 env / 空 headers = hasCredential false、credentialKeys 空', () => {
    const { records } = readClaudeMcpServers(
      configPath({
        mcpServers: { a: { command: 'x', env: {} }, b: { url: 'https://u', headers: {} } },
      }),
    );
    expect(records.map((r) => r.hasCredential)).toEqual([false, false]);
    expect(records.map((r) => r.credentialKeys)).toEqual([[], []]);
  });
});

describe('listMcpServers — wire record 投影（形状保形 = web 零学习成本）', () => {
  test('record 过 mcpServerRecordSchema；teamId = 入参占位；时间戳 = 文件 mtime；id = slug', () => {
    const p = configPath(MIXED);
    const stamp = new Date('2026-09-01T00:00:00Z');
    utimesSync(p, stamp, stamp);
    const rows = listMcpServers({ mcpConfigPath: p }, 'team-1');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(mcpServerRecordSchema.parse(row).slug).toBe(row.slug);
    }
    expect(rows[0]).toMatchObject({
      teamId: 'team-1',
      id: 'demo',
      label: 'demo',
      createdAt: stamp.getTime(),
      updatedAt: stamp.getTime(),
    });
    // teamId 对 scoping 是 no-op（config 按机器不按团队）——保形槽位随入参。
    expect(listMcpServers({ mcpConfigPath: p }, 'team-other').map((r) => r.teamId)).toEqual([
      'team-other',
      'team-other',
    ]);
  });

  test('投影面永不出现密钥值（即便未来 bug 也不给 wire 携带的机会）', () => {
    const raw = JSON.stringify(listMcpServers({ mcpConfigPath: configPath(MIXED) }, 'team-1'));
    expect(raw).not.toContain('s3cret');
    expect(raw).not.toContain('k3y');
  });
});

describe('REST 面：GET 换源，管理写面删除（spec 13 删除面）', () => {
  test('GET /api/teams/{id}/mcp-servers = config 投影；响应永不含 env/headers 值', async () => {
    const s = bootServer({ mcpConfigPath: configPath(MIXED) });
    const res = await call(s.app, 'GET', `/api/teams/${s.team.id}/mcp-servers`);
    expect(res.status).toBe(200);
    const rows = mcpServerRecordSchema.array().parse(await res.json());
    expect(rows.map((r) => r.slug)).toEqual(['demo', 'local']);
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain('s3cret');
    expect(raw).not.toContain('k3y');
    s.dispose();
  });

  test('GET 未知 team = 404 {error}', async () => {
    const s = bootServer({ mcpConfigPath: configPath(MIXED) });
    const res = await call(s.app, 'GET', '/api/teams/nope/mcp-servers');
    expect(res.status).toBe(404);
    expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual(['error']);
    s.dispose();
  });

  test('POST / PATCH / DELETE 管理写面已删 = 404', async () => {
    const s = bootServer({ mcpConfigPath: configPath(MIXED) });
    const base = `/api/teams/${s.team.id}/mcp-servers`;
    const post = await call(s.app, 'POST', base, {
      body: { label: 'x', slug: 'x', transport: 'http', url: 'https://u' },
    });
    expect(post.status).toBe(404);
    expect((await call(s.app, 'PATCH', `${base}/demo`, { body: { label: 'y' } })).status).toBe(404);
    expect((await call(s.app, 'DELETE', `${base}/demo`)).status).toBe(404);
    s.dispose();
  });
});

describe('agent 授权面：mcpServers[] = config 键名，未知键静默容忍', () => {
  test('PATCH 未知键 = 200 原样存（DB 存在性校验已随管理面删除）', async () => {
    const s = bootServer();
    const agentRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      body: { displayName: 'worker-a', machineId: insertMachine(s) },
    });
    expect(agentRes.status).toBe(201);
    const { id: agentId } = (await agentRes.json()) as { id: string };

    const patch = await call(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${agentId}`, {
      body: { mcpServers: ['ghost', 'demo'] },
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { mcpServers: string[] }).mcpServers).toEqual([
      'ghost',
      'demo',
    ]);

    const get = await call(s.app, 'GET', `/api/teams/${s.team.id}/agents/${agentId}`);
    expect(get.status).toBe(200);
    expect(((await get.json()) as { mcpServers: string[] }).mcpServers).toEqual(['ghost', 'demo']);
    s.dispose();
  });

  test('POST agents 携带 mcpServers = 同律容忍', async () => {
    const s = bootServer();
    const res = await call(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      body: { displayName: 'w', machineId: insertMachine(s), mcpServers: ['ghost'] },
    });
    expect(res.status).toBe(201);
    s.dispose();
  });
});

describe('claim 载荷：mcpServers slug 化（string[]）+ 版本墙提升（machine-wire 断约）', () => {
  async function world(cliVersion: string, opts: { slugs?: string[] } = {}) {
    const s = bootServer({ claimHoldMs: 250 });
    const plain = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: plain,
      body: { teamId: s.team.id, name: 'm4b-mbp', cliVersion },
    });
    const { token } = (await enroll.json()) as { token: string };
    const agentId = 'agent-m4b';
    s.db
      .insert(agentTable)
      .values({
        id: agentId,
        teamId: s.team.id,
        displayName: 'w',
        provider: 'stub-gw',
        modelId: 'stub-model',
        mcpServers: opts.slugs ?? ['demo'],
      })
      .run();
    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: 't', spec: 's' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: { todoIds: [todoId], assignment: { plan: null, build: { agentId } }, withPlan: false },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const body = (await claimRes.json()) as { step: ClaimedStep | null };
    return { s, step: body.step ? claimedStepSchema.parse(body.step) : null };
  }

  test('版本门达标 = 携带勾选 slug 原样（不解析端点、不过滤——解析权在 daemon）', async () => {
    const { s, step } = await world(MCP_MIN_CLI_VERSION, { slugs: ['demo', 'ghost'] });
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toEqual(['demo', 'ghost']);
    // 记忆 + 附件工具不受版本墙门控（02 §4.4 无版本语义，原律保留）。
    expect(step!.remoteTools?.map((t) => t.name)).toEqual(WORKER_REMOTE_TOOLS.map((t) => t.name));
    s.dispose();
  });

  test('版本墙：旧 daemon 版本线（0.1.x）收不到 mcpServers（断约提升已落）', async () => {
    // 断约语义：MCP_MIN_CLI_VERSION 必须已越过全部旧 daemon 版本线（≤0.1.x），
    // 旧 daemon 视为无 MCP 运行，不存在混发两种形状的失败模式。
    expect(MCP_MIN_CLI_VERSION).not.toBe('0.1.0');
    const { s, step } = await world('0.1.1');
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toBeUndefined();
    s.dispose();
  });

  test('未授权（勾选空）= 不携带', async () => {
    const { s, step } = await world(MCP_MIN_CLI_VERSION, { slugs: [] });
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toBeUndefined();
    s.dispose();
  });
});

describe('chief mcp_servers 读工具：数据源 = 本机 config（spec 13 换源）', () => {
  test('返回 config 投影行 {id,label,slug,transport,url}；密钥值不出工具面', async () => {
    const p = configPath(MIXED);
    const s = bootServer({ mcpConfigPath: p });
    const ctx: ChiefToolCtx = {
      teamId: s.team.id,
      userId: s.user.id,
      chiefId: 'chief-1',
      threadId: 'thread-1',
      chiefAgentId: null,
      conversationId: 'chief-thread-1',
    };
    const text = await executeChiefTool(
      {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
        mcpConfigPath: p,
      },
      ctx,
      'mcp_servers',
      {},
    );
    const rows = JSON.parse(text) as {
      id: string;
      label: string;
      slug: string;
      transport: string;
      url: string;
    }[];
    expect(rows.map((r) => r.slug)).toEqual(['demo', 'local']);
    expect(rows[0]).toMatchObject({ transport: 'http', url: 'https://example.invalid/mcp' });
    expect(rows[1]).toMatchObject({ transport: 'stdio', url: 'npx' });
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('k3y');
    s.dispose();
  });
});

describe('记忆删除 REST 面（02 §4.4「列表/删除 API 保形」；DELETE 同名 [推断]）', () => {
  test('DELETE memories/{mid} → 204；未知/越权 agent = 404', async () => {
    const s: TestServer = bootServer();
    s.db.insert(agentTable).values({ id: 'a1', teamId: s.team.id, displayName: 'w' }).run();

    s.db
      .insert(agentMemory)
      .values({
        id: 'mem-1',
        agentId: 'a1',
        teamId: s.team.id,
        title: 't',
        content: 'c',
        projectId: null,
        sourceTodoId: null,
        sourceBuildId: null,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const base = `/api/teams/${s.team.id}/agents/a1/memories`;
    expect((await call(s.app, 'GET', base)).status).toBe(200);
    expect((await call(s.app, 'DELETE', `${base}/mem-x`)).status).toBe(404);
    expect(
      (await call(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/none/memories/mem-1`)).status,
    ).toBe(404);
    expect((await call(s.app, 'DELETE', `${base}/mem-1`)).status).toBe(204);
    expect(s.db.select().from(agentMemory).all()).toHaveLength(0);
    s.dispose();
  });
});
