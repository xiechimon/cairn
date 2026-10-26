import { utimesSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import {
  type ClaimedStep,
  claimedStepSchema,
  MCP_MIN_CLI_VERSION,
  mcpServerRecordSchema,
  WORKER_REMOTE_TOOLS,
} from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
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

function configPath(content?: unknown): string {
  const dir = makeTestTempDir('cairn-mcp-cfg-');
  const p = join(dir, 'claude.json');
  if (content !== undefined) {
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  }
  return p;
}

const MIXED = {
  mcpServers: {
    demo: { url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer s3cret' } },
    local: { command: 'npx', args: ['-y', 'mcp-browser'], env: { API_KEY: 'k3y' } },
    broken: { nope: true },
    alsoBroken: { command: 42 },
  },
};

describe('readClaudeMcpServers -- config read seam (spec 13: bad = empty set, does not blow up)', () => {
  test('file missing = empty set (no throw)', () => {
    expect(readClaudeMcpServers(configPath()).records).toEqual([]);
  });

  test('bad JSON = empty set (file-level parse failure does not blow up the server, premortem guardrail one)', () => {
    expect(readClaudeMcpServers(configPath('{ "mcpServers": oops')).records).toEqual([]);
  });

  test('no mcpServers key = empty set', () => {
    expect(readClaudeMcpServers(configPath({ projects: {} })).records).toEqual([]);
  });

  test('mcpServers not an object = empty set', () => {
    expect(readClaudeMcpServers(configPath({ mcpServers: 'nope' })).records).toEqual([]);
    expect(readClaudeMcpServers(configPath({ mcpServers: [{ url: 'x' }] })).records).toEqual([]);
  });

  test('http+stdio mix normal; a single bad entry skipped without hurting the rest', () => {
    const { records } = readClaudeMcpServers(configPath(MIXED));
    expect(records.map((r) => r.slug)).toEqual(['demo', 'local']);
    expect(records[0]).toMatchObject({
      transport: 'http',
      url: 'https://example.invalid/mcp',
      hasCredential: true,
      credentialKeys: ['Authorization'],
    });
    expect(records[1]).toMatchObject({
      transport: 'stdio',
      url: 'npx',
      hasCredential: true,
      credentialKeys: ['API_KEY'],
    });
  });

  test('security invariant: env/headers secret values never leave the read seam (spec 13 credential surface narrowed)', () => {
    const raw = JSON.stringify(readClaudeMcpServers(configPath(MIXED)));
    expect(raw).not.toContain('s3cret');
    expect(raw).not.toContain('k3y');
  });

  test('slug = key lowercased; label = original key; lowercase name collision first-wins', () => {
    const { records } = readClaudeMcpServers(
      configPath({ mcpServers: { Playwright: { command: 'pw' }, playwright: { command: 'pw2' } } }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ label: 'Playwright', slug: 'playwright', url: 'pw' });
  });

  test('empty env / empty headers = hasCredential false, credentialKeys empty', () => {
    const { records } = readClaudeMcpServers(
      configPath({
        mcpServers: { a: { command: 'x', env: {} }, b: { url: 'https://u', headers: {} } },
      }),
    );
    expect(records.map((r) => r.hasCredential)).toEqual([false, false]);
    expect(records.map((r) => r.credentialKeys)).toEqual([[], []]);
  });
});

describe('listMcpServers -- wire record projection (shape-preserving = web zero learning cost)', () => {
  test('record passes mcpServerRecordSchema; teamId = input placeholder; timestamp = file mtime; id = slug', () => {
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
    expect(listMcpServers({ mcpConfigPath: p }, 'team-other').map((r) => r.teamId)).toEqual([
      'team-other',
      'team-other',
    ]);
  });

  test('projection surface never shows secret values (even a future bug gets no chance to carry them on the wire)', () => {
    const raw = JSON.stringify(listMcpServers({ mcpConfigPath: configPath(MIXED) }, 'team-1'));
    expect(raw).not.toContain('s3cret');
    expect(raw).not.toContain('k3y');
  });
});

describe('REST surface: GET re-sourced, management write surface deleted (spec 13 delete surface)', () => {
  test('GET /api/teams/{id}/mcp-servers = config projection; response never contains env/headers values', async () => {
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

  test('GET unknown team = 404 {error}', async () => {
    const s = bootServer({ mcpConfigPath: configPath(MIXED) });
    const res = await call(s.app, 'GET', '/api/teams/nope/mcp-servers');
    expect(res.status).toBe(404);
    expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual(['error']);
    s.dispose();
  });

  test('POST / PATCH / DELETE management write surface already deleted = 404', async () => {
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

describe('agent grant surface: mcpServers[] = config key names, unknown keys silently tolerated', () => {
  test('PATCH unknown key = 200 stored as-is (DB existence check already deleted with the management surface)', async () => {
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

  test('POST agents carrying mcpServers = tolerated same law', async () => {
    const s = bootServer();
    const res = await call(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      body: { displayName: 'w', machineId: insertMachine(s), mcpServers: ['ghost'] },
    });
    expect(res.status).toBe(201);
    s.dispose();
  });
});

describe('claim payload: mcpServers slug-ized (string[]) + version-wall bump (machine-wire contract break)', () => {
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
    bindAllAgents(s);

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

  test('version gate met = carries the checked slugs verbatim (no endpoint parse, no filter -- parsing is the daemon responsibility)', async () => {
    const { s, step } = await world(MCP_MIN_CLI_VERSION, { slugs: ['demo', 'ghost'] });
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toEqual(['demo', 'ghost']);
    expect(step!.remoteTools?.map((t) => t.name)).toEqual(WORKER_REMOTE_TOOLS.map((t) => t.name));
    s.dispose();
  });

  test('version wall: legacy daemon version line (0.1.x) receives no mcpServers (contract-break bump landed)', async () => {
    expect(MCP_MIN_CLI_VERSION).not.toBe('0.1.0');
    const { s, step } = await world('0.1.1');
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toBeUndefined();
    s.dispose();
  });

  test('managed empty (checked empty) = carries [] (strict semantics consumed downstream, no collapse back to default)', async () => {
    const { s, step } = await world(MCP_MIN_CLI_VERSION, { slugs: [] });
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toEqual([]);
    s.dispose();
  });

  test('version gate unmet = default not carried ([] also not sent -- legacy daemon has no three-state consumption surface)', async () => {
    const { s, step } = await world('0.1.1', { slugs: [] });
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toBeUndefined();
    s.dispose();
  });
});

describe('chief mcp_servers read tool: data source = local config (spec 13 re-source)', () => {
  test('returns config projection rows {id,label,slug,transport,url}; secret values stay out of the tool surface', async () => {
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

describe('memory delete REST surface (02 section 4.4 "list/delete API shape-preserving"; DELETE same name [inferred])', () => {
  test('DELETE memories/{mid} -> 204; unknown/out-of-scope agent = 404', async () => {
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
