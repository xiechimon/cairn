import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ClaimedStep,
  claimedStepSchema,
  MCP_MIN_CLI_VERSION,
  mcpServerRecordSchema,
} from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openMemoryDb } from '../src/db/client.js';
import { agentMemory, mcpConnector } from '../src/db/schema.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { workerRemoteTools } from '../src/services/machine-claim.js';
import { listMcpServers, readClaudeMcpServers } from '../src/services/mcp-servers.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  seedSessionRoute,
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
    local: { command: 'npx', args: ['-y', 'mcp-browser'], env: { API_KEY: 'k3y!' } },
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
    expect(raw).not.toContain('k3y!');
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
    const rows = listMcpServers({ mcpConfigPath: p, db: openMemoryDb() }, 'team-1');
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
    expect(
      listMcpServers({ mcpConfigPath: p, db: openMemoryDb() }, 'team-other').map((r) => r.teamId),
    ).toEqual(['team-other', 'team-other']);
  });

  test('projection surface never shows secret values (even a future bug gets no chance to carry them on the wire)', () => {
    const raw = JSON.stringify(
      listMcpServers({ mcpConfigPath: configPath(MIXED), db: openMemoryDb() }, 'team-1'),
    );
    expect(raw).not.toContain('s3cret');
    expect(raw).not.toContain('k3y!');
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
    expect(raw).not.toContain('k3y!');
    s.dispose();
  });

  test('GET lists connectors after local entries with source and status, names only, URL without query', async () => {
    const s = bootServer({ mcpConfigPath: configPath(MIXED) });
    s.db
      .insert(mcpConnector)
      .values({
        id: 'conn-linear',
        teamId: s.team.id,
        slug: 'linear',
        label: 'Linear',
        catalogId: null,
        url: 'https://mcp.linear.example/mcp?token=q-s3cret',
        headerNames: ['Authorization'],
        valuesCipher: s.secretBox.seal(JSON.stringify({ Authorization: 'Bearer h-s3cret' })),
        authKind: 'static',
        oauthMeta: null,
        oauthCipher: null,
        status: 'needs_auth',
        statusReason: null,
        toolCount: null,
        checkedAt: null,
        authRevision: 1,
        tokenGeneration: 0,
        createdAt: 5,
        updatedAt: 6,
      })
      .run();
    const res = await call(s.app, 'GET', `/api/teams/${s.team.id}/mcp-servers`);
    const rows = mcpServerRecordSchema.array().parse(await res.json());
    expect(rows.map((r) => [r.slug, r.source, r.status])).toEqual([
      ['demo', 'local', null],
      ['local', 'local', null],
      ['linear', 'connector', 'needs_auth'],
    ]);
    expect(rows[2]).toMatchObject({
      id: 'conn-linear',
      transport: 'http',
      url: 'https://mcp.linear.example/mcp',
      hasCredential: true,
      credentialKeys: ['Authorization'],
    });
    expect(JSON.stringify(rows)).not.toContain('s3cret');
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

describe('work policies carry no MCP grant', () => {
  test('a PATCH that only names mcpServers is refused and no policy reports a grant', async () => {
    const s = bootServer();
    const patch = await call(s.app, 'PATCH', `/api/teams/${s.team.id}/work-policies/session`, {
      body: { mcpServers: ['ghost', 'demo'] },
    });
    expect(patch.status).toBe(400);
    await call(s.app, 'PATCH', `/api/teams/${s.team.id}/work-policies/session`, {
      body: { tools: [] },
    });
    const get = await call(s.app, 'GET', `/api/teams/${s.team.id}/routing-settings`);
    const settings = (await get.json()) as { policies: Record<string, unknown>[] };
    expect(settings.policies.length).toBeGreaterThan(0);
    for (const policy of settings.policies) expect(policy).not.toHaveProperty('mcpServers');
    s.dispose();
  });
});

describe('claim payload: mcpServers slug-ized (string[]) + version-wall bump (machine-wire contract break)', () => {
  async function world(cliVersion: string, opts: { slugs?: string[] } = {}) {
    const s = bootServer({ claimHoldMs: 250 });
    const plain = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: plain,
      body: readyMachine({
        teamId: s.team.id,
        name: 'm4b-mbp',
        cliVersion,
        capabilities: { mcpServers: opts.slugs ?? ['demo'], skills: [] },
      }),
    });
    const { token } = (await enroll.json()) as { token: string };
    seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });

    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: 't', spec: 's' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: { todoIds: [todoId] },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const body = (await claimRes.json()) as { step: ClaimedStep | null };
    return { s, step: body.step ? claimedStepSchema.parse(body.step) : null };
  }

  test('version gate met = carries the local servers the Runner reports (parsing stays with the daemon)', async () => {
    const { s, step } = await world(MCP_MIN_CLI_VERSION, { slugs: ['demo', 'ghost'] });
    expect(step).not.toBeNull();
    expect(step!.mcpServers).toEqual(['demo', 'ghost']);
    expect(step!.remoteTools?.map((t) => t.name)).toEqual(
      workerRemoteTools('session', false, true).map((t) => t.name),
    );
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
    expect(text).not.toContain('k3y!');
    s.dispose();
  });
});

describe('memory delete REST surface (02 section 4.4 "list/delete API shape-preserving"; DELETE same name [inferred])', () => {
  test('DELETE memories/{mid} -> 204; unknown memory = 404', async () => {
    const s: TestServer = bootServer();

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
    const base = `/api/teams/${s.team.id}/memories`;
    expect((await call(s.app, 'GET', base)).status).toBe(200);
    expect((await call(s.app, 'DELETE', `${base}/mem-x`)).status).toBe(404);
    expect((await call(s.app, 'DELETE', `/api/teams/other-team/memories/mem-1`)).status).toBe(404);
    expect((await call(s.app, 'DELETE', `${base}/mem-1`)).status).toBe(204);
    expect(s.db.select().from(agentMemory).all()).toHaveLength(0);
    s.dispose();
  });
});
