import { MCP_TOOL_REGISTRY, MERGE_HUMAN_ONLY_COPY } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { step, todo as todoTable } from '../src/db/schema.js';
import { PLATFORM_LOCKED_MESSAGE } from '../src/services/routing-rules.js';
import { bootServer, postProject, startLegacyBuild, type TestServer } from './helpers.js';

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

describe('/api/mcp tool whitelist preserves legacy tools and adds Thread entry', () => {
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

  test('full grant -> tools/list exactly 29 items = registry list (15 read + 14 write)', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, { read: ALL_READ, write: ALL_WRITE });
    const res = await rpc(s.app, key, 'tools/list', {});
    const body = res.body as JsonRpcResponse;
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(MCP_TOOL_REGISTRY.map((t) => t.name).sort());
    expect(names).toHaveLength(29);
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

  test('a grant only counts in the column of its tool kind: write tools in the read list and read tools in the write list register nothing', async () => {
    const s = bootServer();
    const key = await issueMcpKey(s, { read: ['Merge Builds', 'Create Todo'], write: ['Todos'] });
    const list = (await rpc(s.app, key, 'tools/list', {})).body as JsonRpcResponse;
    expect(list.result?.tools ?? []).toEqual([]);
    const denied = (await rpc(s.app, key, 'tools/call', {
      name: 'create_todo',
      arguments: { title: 'should not exist' },
    })) as { body: JsonRpcResponse };
    expect(denied.body.error !== undefined || denied.body.result?.isError === true).toBe(true);
    expect(s.db.select().from(todoTable).all()).toEqual([]);
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

describe('/api/mcp create_todo and update_todo carry the platform a task needs (#4596)', () => {
  test('tools/list advertises it, create sets it, any clears it, an unknown system and a started task are refused', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const key = await issueMcpKey(s, { read: [], write: ['Create Todo', 'Update Todo'] });
    const call = async (name: string, args: Record<string, unknown>) =>
      ((await rpc(s.app, key, 'tools/call', { name, arguments: args })).body as JsonRpcResponse)
        .result;
    const osOf = (id: string) =>
      s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()?.routeOverride
        ?.requiredCapabilities?.os ?? null;

    const listed = (await rpc(s.app, key, 'tools/list')).body as {
      result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] };
    };
    for (const name of ['create_todo', 'update_todo']) {
      const tool = listed.result.tools.find((t) => t.name === name);
      expect(tool?.inputSchema.properties).toHaveProperty('platform');
    }

    const created = await call('create_todo', {
      projectId,
      title: '打包 iOS 测试版',
      spec: 's',
      platform: 'macos',
    });
    expect(created?.isError ?? false).toBe(false);
    const record = JSON.parse(created?.content?.[0]?.text ?? '{}') as {
      id: string;
      routeOverride: { requiredCapabilities?: { os?: string } } | null;
    };
    expect(record.routeOverride?.requiredCapabilities?.os).toBe('macos');
    expect(osOf(record.id)).toBe('macos');

    const plain = JSON.parse(
      (await call('create_todo', { projectId, title: 'plain', spec: 's' }))?.content?.[0]?.text ??
        '{}',
    ) as { id: string };
    expect(osOf(plain.id)).toBeNull();

    const bad = await call('update_todo', { todoId: record.id, platform: 'beos' });
    expect(bad?.isError).toBe(true);
    expect(osOf(record.id)).toBe('macos');

    expect(
      (await call('update_todo', { todoId: record.id, platform: 'windows' }))?.isError ?? false,
    ).toBe(false);
    expect(osOf(record.id)).toBe('windows');
    expect(
      (await call('update_todo', { todoId: record.id, platform: 'any' }))?.isError ?? false,
    ).toBe(false);
    expect(osOf(record.id)).toBeNull();

    const buildId = startLegacyBuild(s, plain.id, { withPlan: false });
    s.db.update(step).set({ sessionId: 'sess-mcp' }).where(eq(step.buildId, buildId)).run();
    const locked = await call('update_todo', { todoId: plain.id, platform: 'macos' });
    expect(locked?.isError).toBe(true);
    expect(locked?.content?.[0]?.text).toContain(PLATFORM_LOCKED_MESSAGE);
    expect(osOf(plain.id)).toBeNull();
    s.dispose();
  });

  test('update_todo whose title is refused leaves the platform unchanged', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const key = await issueMcpKey(s, { read: [], write: ['Create Todo', 'Update Todo'] });
    const call = async (name: string, args: Record<string, unknown>) =>
      ((await rpc(s.app, key, 'tools/call', { name, arguments: args })).body as JsonRpcResponse)
        .result;
    const created = JSON.parse(
      (await call('create_todo', { projectId, title: 'cited', spec: 's', platform: 'macos' }))
        ?.content?.[0]?.text ?? '{}',
    ) as { id: string };
    s.db
      .update(todoTable)
      .set({
        request: {
          segments: [
            {
              source: { kind: 'edit', userId: s.user.id, at: 1, span: 'whole' },
              author: 'owner',
              sourceRef: null,
              text: 's',
            },
          ],
          siblings: [],
          difficulty: null,
          titleSource: 'owner',
          titleSourceRef: null,
        },
      })
      .where(eq(todoTable.id, created.id))
      .run();
    const refused = await call('update_todo', {
      todoId: created.id,
      title: 'renamed',
      platform: 'windows',
    });
    expect(refused?.isError).toBe(true);
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    expect(row?.routeOverride?.requiredCapabilities?.os).toBe('macos');
    expect(row?.title).toBe('cited');
    s.dispose();
  });
});

describe('/api/mcp unschedule_todo ends a snooze (#2242, #2354)', () => {
  test('the thread comes back unsnoozed and unread for the key owner', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const key = await issueMcpKey(s, {
      read: [],
      write: ['Create Todo', 'Schedule Todo', 'Unschedule Todo'],
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await rpc(s.app, key, 'tools/call', { name, arguments: args }))
        .body as JsonRpcResponse;
      expect(res.error).toBeUndefined();
      expect(res.result?.isError ?? false).toBe(false);
      return JSON.parse(res.result?.content?.[0]?.text ?? '{}') as { id?: string };
    };
    const unreadIds = async () => {
      const res = await s.app.request(`/api/teams/${s.team.id}/notifications`);
      return ((await res.json()) as { unreadThreadIds: string[] }).unreadThreadIds;
    };
    const created = await call('create_todo', { projectId, title: 'snoozed via mcp', spec: 's' });
    const todoId = created.id ?? '';
    await call('schedule_todo', { todoId, kind: 'daily', at: Date.now() + 3_600_000 });
    const snoozed = await s.app.request(`/api/todos/${todoId}/snooze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ until: 'needed' }),
    });
    expect(snoozed.status).toBe(200);
    expect(await unreadIds()).not.toContain(todoId);

    await call('unschedule_todo', { todoId });

    const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
    expect(row?.snoozeMode ?? null).toBeNull();
    expect(row?.snoozedUntil ?? null).toBeNull();
    expect(await unreadIds()).toContain(todoId);
    s.dispose();
  });
});
