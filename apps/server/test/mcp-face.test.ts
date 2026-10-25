import { MCP_TOOL_REGISTRY, MERGE_HUMAN_ONLY_COPY } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { todo as todoTable } from '../src/db/schema.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: {
    serverInfo?: { name: string };
    capabilities?: { tools?: unknown };
    tools?: { name: string }[];
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

async function issueMcpKey(
  s: TestServer,
  grants: { read: string[]; write: string[] },
  mcpAccess = true,
): Promise<string> {
  const res = await s.app.request(`/api/teams/${s.team.id}/api-keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'mcp-e2e', gitAccess: false, mcpAccess, toolGrants: grants }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { plaintext: string };
  return body.plaintext;
}

async function rpc(
  app: Hono,
  key: string | null,
  method: string,
  params?: unknown,
  id: number | null = 1,
): Promise<{ status: number; body: JsonRpcResponse | Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (key) headers.authorization = `Bearer ${key}`;
  const msg: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (id !== null) msg.id = id;
  if (params !== undefined) msg.params = params;
  const res = await app.request('/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(msg),
  });
  if (res.status === 202) return { status: 202, body: null };
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as JsonRpcResponse) };
}

const ALL_READ = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'read').map((t) => t.grant);
const ALL_WRITE = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'write').map((t) => t.grant);

describe('/api/mcp auth surface (02 section 7.2: Bearer <apiKey>; mcpAccess gate)', () => {
  test('no credential/bad credential = 401; mcpAccess=false = 403 (error shape {error})', async () => {
    const s = bootServer();
    for (const key of [null, 'cairn_deadbeef']) {
      const res = await s.app.request('/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      expect(res.status).toBe(401);
      expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual(['error']);
    }
    const noMcp = await issueMcpKey(s, { read: ALL_READ, write: ALL_WRITE }, false);
    const res = await rpc(s.app, noMcp, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(res.status).toBe(403);
    s.dispose();
  });
});

describe('/api/mcp 24-tool whitelist shape-preserving (02/A10; r3 section 6 matrix 1:1)', () => {
  test('initialize → serverInfo + capabilities.tools', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, { read: ALL_READ, write: ALL_WRITE });
    const res = await rpc(s.app, key, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0' },
    });
    expect(res.status).toBe(200);
    const body = res.body as JsonRpcResponse;
    expect(body.result?.serverInfo?.name).toBeTruthy();
    expect(body.result?.capabilities?.tools).toBeTruthy();
    s.dispose();
  });

  test('full grant -> tools/list exactly 24 items = registry list (11 read + 13 write)', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, { read: ALL_READ, write: ALL_WRITE });
    const res = await rpc(s.app, key, 'tools/list', {});
    const body = res.body as JsonRpcResponse;
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(MCP_TOOL_REGISTRY.map((t) => t.name).sort());
    expect(names).toHaveLength(24);
    s.dispose();
  });

  test('partial grant -> tools/list only granted items; ungranted tool call = JSON-RPC error (limits every call)', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, { read: ['Todos', 'Projects'], write: ['Create Todo'] });
    const list = (await rpc(s.app, key, 'tools/list', {})).body as JsonRpcResponse;
    expect((list.result?.tools ?? []).map((t) => t.name).sort()).toEqual([
      'create_todo',
      'projects',
      'todos',
    ]);
    const denied = (await rpc(s.app, key, 'tools/call', {
      name: 'machines',
      arguments: {},
    })) as { body: JsonRpcResponse };
    const b = denied.body;
    expect(b.error !== undefined || b.result?.isError === true).toBe(true);
    s.dispose();
  });

  test('zero grant = MCP disabled for this key (tools/list empty; "Removing every MCP tool disables MCP" canon)', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, { read: [], write: [] });
    const list = (await rpc(s.app, key, 'tools/list', {})).body as JsonRpcResponse;
    expect(list.result?.tools ?? []).toEqual([]);
    s.dispose();
  });
});

describe('/api/mcp tool execution = key owner identity (02 section 7.2)', () => {
  test('create_todo -> todo persisted (ownerId = user, no chief provenance); todos read back', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const key = await issueMcpKey(s, { read: ['Todos'], write: ['Create Todo'] });
    const res = (
      await rpc(s.app, key, 'tools/call', {
        name: 'create_todo',
        arguments: { projectId, title: 'MCP 建的任务', spec: '来自外部 MCP 客户端' },
      })
    ).body as JsonRpcResponse;
    expect(res.error).toBeUndefined();
    const text = res.result?.content?.[0]?.text ?? '';
    const created = JSON.parse(text) as { id: string; title: string; ownerId: string | null };
    expect(created.title).toBe('MCP 建的任务');
    const row = s.db.select().from(todoTable).all()[0]!;
    expect(row.ownerId).toBe(s.user.id);
    expect(row.createdBy).toBeNull();
    expect(row.sourceBuildId).toBeNull();

    const list = (await rpc(s.app, key, 'tools/call', { name: 'todos', arguments: {} }))
      .body as JsonRpcResponse;
    const todos = JSON.parse(list.result?.content?.[0]?.text ?? '[]') as { id: string }[];
    expect(todos.map((t) => t.id)).toContain(created.id);
    s.dispose();
  });

  test('run_builds (key owner) -> triggerSource user, no chief watch created', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const key = await issueMcpKey(s, { read: [], write: ['Create Todo', 'Run Builds'] });
    const created = JSON.parse(
      (
        (
          await rpc(s.app, key, 'tools/call', {
            name: 'create_todo',
            arguments: { projectId, title: 't', spec: 's' },
          })
        ).body as JsonRpcResponse
      ).result?.content?.[0]?.text ?? '{}',
    ) as { id: string };
    const res = (
      await rpc(s.app, key, 'tools/call', {
        name: 'run_builds',
        arguments: { todoIds: [created.id] },
      })
    ).body as JsonRpcResponse;
    expect(res.error).toBeUndefined();
    const { build: buildTable, chief: chiefTable } = await import('../src/db/schema.js');
    const builds = s.db.select().from(buildTable).all();
    expect(builds).toHaveLength(1);
    expect(builds[0]!.triggerSource).toBe('user');
    expect(
      s.db
        .select()
        .from(chiefTable)
        .all()
        .flatMap((r) => r.watches),
    ).toHaveLength(0);
    s.dispose();
  });

  test('build three operations cross-team refused (confirm/merge/cancel = 404 surface, defense-in-depth transitionTodos same law)', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, {
      read: [],
      write: ['Confirm Builds', 'Merge Builds', 'Cancel Builds'],
    });
    const { build, project, team } = await import('../src/db/schema.js');
    const now = Date.now();
    s.db.insert(team).values({ id: 'team-b', name: 'B', createdAt: now }).run();
    s.db
      .insert(project)
      .values({ id: 'proj-b', name: 'pb', teamId: 'team-b', repoKind: 'hosted', repoName: 'pb' })
      .run();
    s.db
      .insert(todoTable)
      .values({
        id: 'todo-b',
        teamId: 'team-b',
        projectId: 'proj-b',
        title: 'tb',
        phase: 'review',
        phaseAt: now,
        seqNum: 1,
      })
      .run();
    s.db
      .insert(build)
      .values({
        id: 'build-b',
        todoId: 'todo-b',
        withPlan: false,
        triggerSource: 'user',
        createdAt: now,
      })
      .run();
    for (const name of ['confirm_builds', 'merge_builds', 'cancel_builds']) {
      const res = (
        await rpc(s.app, key, 'tools/call', { name, arguments: { buildIds: ['build-b'] } })
      ).body as JsonRpcResponse;
      expect(res.result?.isError, name).toBe(true);
      expect(res.result?.content?.[0]?.text ?? '', name).toContain('build build-b');
    }
    const row = s.db.select().from(build).all()[0]!;
    expect(row.errorMessage).toBeNull();
    s.dispose();
  });

  test('merge_builds machine entry hard-refused (#1256): same-team legal build also refused, text names the human exit', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, { read: [], write: ['Merge Builds'] });
    const projectId = await postProject(s.app);
    const { build: buildTable, todo: todoT } = await import('../src/db/schema.js');
    const now = Date.now();
    s.db
      .insert(todoT)
      .values({
        id: 'todo-merge-mcp',
        teamId: s.team.id,
        projectId,
        title: 'tm',
        phase: 'review',
        phaseAt: now,
        seqNum: 1,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: 'build-merge-mcp',
        todoId: 'todo-merge-mcp',
        withPlan: false,
        triggerSource: 'user',
        createdAt: now,
      })
      .run();
    const res = (
      await rpc(s.app, key, 'tools/call', {
        name: 'merge_builds',
        arguments: { buildIds: ['build-merge-mcp'] },
      })
    ).body as JsonRpcResponse;
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content?.[0]?.text ?? '').toContain(MERGE_HUMAN_ONLY_COPY);
    const { step: stepTable } = await import('../src/db/schema.js');
    expect(
      s.db.select().from(stepTable).where(eq(stepTable.buildId, 'build-merge-mcp')).all(),
    ).toHaveLength(0);
    s.dispose();
  });

  test('GitHub read group (issues/pull_requests/workflow_runs) without projectId = error result, no outbound', async () => {
    const outbound: string[] = [];
    const s = bootServer({
      githubFetch: async (input) => {
        outbound.push(String(input));
        throw new Error('no outbound expected');
      },
    });
    const key = await issueMcpKey(s, {
      read: ['Issues', 'Pull Requests', 'Workflow Runs'],
      write: [],
    });
    for (const name of ['issues', 'pull_requests', 'workflow_runs']) {
      const res = (await rpc(s.app, key, 'tools/call', { name, arguments: {} }))
        .body as JsonRpcResponse;
      expect(res.error, name).toBeUndefined();
      expect(res.result?.isError, name).toBe(true);
      expect(res.result?.content?.[0]?.text ?? '', name).toContain('projectId');
    }
    expect(outbound).toEqual([]);
    s.dispose();
  });
});
