import {
  buildRecordSchema,
  buildStepActionBodySchema,
  conversationMessagesResponseSchema,
  createTodoBodySchema,
  mergeAcceptedResponseSchema,
  notificationsResponseSchema,
  projectRecordSchema,
  SLICE1_ACTIONS,
  startBuildsBodySchema,
  stepRecordSchema,
  teamMemberSchema,
  teamRecordSchema,
  todoRecordSchema,
  userRecordSchema,
  WEB_REST_ENDPOINTS,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { plan as planTable, step as stepTable } from '../src/db/schema.js';
import { completeStep } from '../src/services/builds.js';
import { coordinatorToolDefs } from '../src/services/coordinator-tool-defs.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, insertMachine, postProject, req, startLegacyBuild } from './helpers.js';

const INFERRED_ROUTES = [
  'GET /api/server/deploy/lease',
  'PUT /api/server/deploy/lease',
  'DELETE /api/server/deploy/lease',
  'GET /api/teams/{id}/claude-subscriptions',
  'DELETE /api/teams/{id}/claude-subscriptions/{cid}',
  'POST /api/teams/{id}/claude-subscriptions',
  'POST /api/teams/{id}/claude-subscriptions/quota',
  'POST /api/teams/{id}/claude-subscriptions/{cid}/verify',
  'PATCH /api/teams/{id}/claude-subscriptions/{cid}',
  'POST /api/teams/{id}/claude-subscriptions/{cid}/enable',
  'POST /api/teams/{id}/claude-subscriptions/{cid}/disable',
  'POST /api/teams/{id}/claude-subscriptions/{cid}/upstream-models',
  'POST /api/teams/{id}/claude-subscriptions/{cid}/test',
  'GET /api/teams/{id}/devin-subscriptions',
  'DELETE /api/teams/{id}/devin-subscriptions/{cid}',
  'POST /api/teams/{id}/devin-subscriptions',
  'POST /api/teams/{id}/devin-subscriptions/{cid}/verify',
  'PATCH /api/teams/{id}/devin-subscriptions/{cid}',
  'POST /api/teams/{id}/devin-subscriptions/{cid}/enable',
  'POST /api/teams/{id}/devin-subscriptions/{cid}/disable',
  'POST /api/teams/{id}/devin-subscriptions/{cid}/upstream-models',
  'GET /api/teams/{id}/antigravity-subscriptions',
  'DELETE /api/teams/{id}/antigravity-subscriptions/{cid}',
  'POST /api/teams/{id}/antigravity-subscriptions',
  'POST /api/teams/{id}/antigravity-subscriptions/{cid}/verify',
  'POST /api/teams/{id}/antigravity-subscriptions/{cid}/attach-oauth',
  'PATCH /api/teams/{id}/antigravity-subscriptions/{cid}',
  'POST /api/teams/{id}/antigravity-subscriptions/{cid}/enable',
  'POST /api/teams/{id}/antigravity-subscriptions/{cid}/disable',
  'GET /api/teams/{id}/antigravity-subscriptions/{cid}/steps',
  'POST /api/teams/{id}/antigravity-subscriptions/{cid}/upstream-models',
  'POST /api/teams/{id}/presence',
  'DELETE /api/teams/{id}/presence',
  'POST /api/projects',
  'PATCH /api/projects/{id}',
  'PATCH /api/user/me',
  'PATCH /api/teams/{id}',
  'PATCH /api/todos/{id}',
  'PATCH /api/schedules/{id}',
  'DELETE /api/todos/{id}',
  'DELETE /api/projects/{id}',
  'POST /api/actions/proposals/{id}/answer',
  'GET /api/actions/journal',
  'GET /api/actions/proposals',
  'POST /api/actions/journal/{id}/undo',
  'DELETE /api/schedules/{id}',
  'POST /api/schedules/{id}/run',
  'DELETE /api/teams/{id}/providers/{pid}',
  'POST /api/teams/{id}/providers/{pid}/test',
  'GET /api/teams/{id}/providers/{pid}/upstream-models',
  'GET /api/teams/{id}/im/connections',
  'POST /api/teams/{id}/im/telegram',
  'POST /api/teams/{id}/im/slack',
  'POST /api/teams/{id}/im/imessage',
  'POST /api/teams/{id}/im/wechat/login',
  'GET /api/teams/{id}/im/wechat/login/{loginId}',
  'DELETE /api/teams/{id}/im/connections/{connId}',
  'POST /api/teams/{id}/im/connections/{connId}/reconnect',
  'GET /api/teams/{id}/im/pairing-requests',
  'POST /api/teams/{id}/im/pairing-requests/{requestId}/approve',
  'POST /api/teams/{id}/im/pairing-requests/{requestId}/reject',
  'GET /api/teams/{id}/mail/accounts',
  'POST /api/teams/{id}/mail/accounts',
  'PATCH /api/teams/{id}/mail/accounts/{accountId}',
  'DELETE /api/teams/{id}/mail/accounts/{accountId}',
  'POST /api/teams/{id}/mail/accounts/{accountId}/rules',
  'DELETE /api/teams/{id}/mail/accounts/{accountId}/rules/{ruleId}',
  'POST /api/teams/{id}/mail/accounts/{accountId}/retry',
  'GET /api/teams/{id}/mcp-connectors',
  'POST /api/teams/{id}/mcp-connectors',
  'PATCH /api/teams/{id}/mcp-connectors/{cid}',
  'DELETE /api/teams/{id}/mcp-connectors/{cid}',
  'POST /api/teams/{id}/mcp-connectors/{cid}/check',
  'PUT /api/teams/{id}/mcp-connectors/composio/key',
  'DELETE /api/teams/{id}/mcp-connectors/composio/key',
  'GET /api/teams/{id}/mcp-connectors/composio',
  'POST /api/teams/{id}/mcp-connectors/composio/toolkits',
  'POST /api/teams/{id}/mcp-connectors/composio/{cid}/authorize',
  'POST /api/teams/{id}/mcp-connectors/composio/{cid}/poll',
  'POST /api/teams/{id}/mcp-connectors/composio/{cid}/reconnect',
  'POST /api/teams/{id}/mcp-connectors/composio/{cid}/revoke',
  'POST /api/teams/{id}/mcp-connectors/oauth/start',
  'GET /api/teams/{id}/mcp-connectors/github',
  'POST /api/teams/{id}/mcp-connectors/github/bind',
  'POST /api/teams/{id}/mcp-connectors/github/device',
  'POST /api/teams/{id}/mcp-connectors/github/device/{attempt}',
  'DELETE /api/teams/{id}/mcp-connectors/github/device/{attempt}',
  'POST /api/teams/{id}/mcp-connectors/{cid}/github/installations',
  'GET /api/teams/{id}/secrets',
  'POST /api/teams/{id}/secrets',
  'PATCH /api/teams/{id}/secrets/{sid}',
  'DELETE /api/teams/{id}/secrets/{sid}',
  'POST /api/teams/{id}/secret-requests',
  'GET /api/teams/{id}/browser-password-grants',
  'DELETE /api/teams/{id}/browser-password-grants/{grantId}',
  'GET /api/teams/{id}/api-keys',
  'POST /api/teams/{id}/api-keys',
  'DELETE /api/teams/{id}/api-keys/{keyId}',
  'GET /api/remote/descriptor',
  'GET /api/remote/tailscale',
  'POST /api/remote/tailscale',
  'POST /api/remote/tailnet',
  'GET /api/remote/routes',
  'GET /api/auth/session',
  'POST /api/auth/access',
  'POST /api/auth/stream-ticket',
  'GET /api/remote/pairing',
  'POST /api/remote/pairing',
  'DELETE /api/remote/pairing/{id}',
  'POST /api/remote/pair',
  'POST /api/remote/pair/request',
  'POST /api/remote/pair/claim',
  'GET /api/remote/pairing-requests',
  'POST /api/remote/pairing-requests/{id}/{decision}',
  'GET /api/remote/devices',
  'DELETE /api/remote/devices/{id}',
  'POST /api/teams/{id}/chief/threads',
  'POST /api/conversations/{id}/messages',
  'POST /api/teams/{id}/chief/threads/{tid}/rewind',
  'POST /api/teams/{id}/chief/threads/{tid}/retry-greeting/{stepId}',
  'POST /api/teams/{id}/chief/threads/{tid}/questions/{requestId}/answer',
  'POST /api/teams/{id}/chief/threads/{tid}/questions/{requestId}/cancel',
  'POST /api/teams/{id}/chief/retro-proposals/{pid}/{decision}',
  'DELETE /api/teams/{id}/chief/threads/{tid}/messages/{mid}',
  'POST /api/teams/{id}/chief/threads/{tid}/messages/{mid}/steer',
  'POST /api/teams/{id}/chief/threads/{tid}/stop',
  'POST /api/todos/{id}/orchestrate',
  'POST /api/todos/{id}/stop-and-done',
  'POST /api/todos/{id}/archive',
  'POST /api/todos/{id}/unarchive',
  'GET /api/needs-you',
  'DELETE /api/machines/{id}',
  'POST /api/machines/{id}/revoke',
  'GET /api/machines/{id}/own-computer/activity',
  'GET /api/machines/{id}/phones',
  'POST /api/machines/{id}/phones',
  'GET /api/machines/{id}/phones/activity',
  'POST /api/machines/{id}/phones/{phoneId}/pair',
  'DELETE /api/machines/{id}/phones/{phoneId}',
  'POST /api/machines/{id}/phones/{phoneId}/handback',
  'GET /api/phones/handoffs',
  'GET /api/teams/{id}/memories',
  'PATCH /api/teams/{id}/memories/{mid}',
  'DELETE /api/teams/{id}/memories/{mid}',
  'POST /api/teams/{id}/memory-edits',
  'GET /api/teams/{id}/memory-edits/current',
  'POST /api/teams/{id}/memory-edits/{eid}/stop',
  'GET /api/teams/{id}/memory-imports/candidates',
  'POST /api/teams/{id}/memory-imports',
  'GET /api/builds/{id}/plans',
  'GET /api/builds/{id}/merge-permission',
  'POST /api/builds/{id}/plans/{planId}/pause-auto-approve',
  'GET /api/builds/{id}/changes',
  'GET /api/builds/{id}/changes/file',
  'GET /api/builds/{id}/usage',
  'GET /api/prs',
  'POST /api/uploads/grant',
  'POST /api/uploads/upload',
  'GET /api/attachments/{id}',
  'GET /api/teams/{id}/drafts/{scope}',
  'PUT /api/teams/{id}/drafts/{scope}',
  'POST /api/builds/{id}/stop',
  'POST /api/builds/{id}/retry-now',
  'POST /api/builds/{id}/tasks/{taskId}/stop',
  'GET /api/teams/{id}/model-sources',
  'PUT /api/teams/{id}/provider-order',
  'PATCH /api/machines/{id}',
  'GET /api/github/repos',
  'POST /api/teams/{id}/github/oauth/authorize',
  'GET /api/teams/{id}/github/connection',
  'DELETE /api/teams/{id}/github/connection',
  'POST /api/teams/{id}/github/connection/device',
  'POST /api/teams/{id}/github/connection/device/{attempt}',
  'DELETE /api/teams/{id}/github/connection/device/{attempt}',
  'POST /api/teams/{id}/github/webhook',
  'DELETE /api/teams/{id}/github/webhook',
  'POST /api/fs/pick',
  'GET /api/fs/list',
  'POST /api/projects/{id}/github/issues/import',
  'GET /api/todos/{id}/github-issue',
  'POST /api/todos/{id}/github-issue/retry',
  'GET /api/projects/{id}/files',
  'POST /api/teams/{teamId}/engine-runs/{stepId}/screen',
  'POST /api/teams/{teamId}/engine-runs/{stepId}/takeover',
  'PATCH /api/teams/{teamId}/engine-runs/{stepId}/takeover',
  'DELETE /api/teams/{teamId}/engine-runs/{stepId}/takeover',
  'GET /api/teams/{teamId}/engine-runs/{stepId}/pty-log',
];

const CORE_ROUTES = [
  'GET /api/user/me',
  'GET /api/teams',
  'GET /api/teams/{id}/members',
  'GET /api/teams/{id}/notifications',
  'GET /api/teams/{id}/stream',
  'GET /api/projects',
  'GET /api/projects/{id}/todos',
  'GET /api/projects/{id}/builds',
  'GET /api/projects/{id}/branches',
  'GET /api/todos',
  'GET /api/todos/{id}',
  'GET /api/builds/{id}',
  'GET /api/builds/{id}/steps',
  'GET /api/conversations/{id}/messages',
  'GET /api/schedules',
  'POST /api/projects/{id}/todos',
  'POST /api/projects/{id}/builds',
  'POST /api/builds/{id}/merge',
  'POST /api/builds/{id}/steps',
  'POST /api/schedules',
];

const M2C_ROUTES = [
  'GET /api/search',
  'GET /api/teams/{id}/providers',
  'POST /api/teams/{id}/providers',
  'PATCH /api/teams/{id}/providers/{pid}',
  'DELETE /api/teams/{id}/providers/{pid}',
  'GET /api/teams/{id}/secrets',
  'POST /api/teams/{id}/secrets',
  'PATCH /api/teams/{id}/secrets/{sid}',
  'DELETE /api/teams/{id}/secrets/{sid}',
  'POST /api/teams/{id}/secret-requests',
  'GET /api/teams/{id}/browser-password-grants',
  'DELETE /api/teams/{id}/browser-password-grants/{grantId}',
  'GET /api/teams/{id}/api-keys',
  'POST /api/teams/{id}/api-keys',
  'DELETE /api/teams/{id}/api-keys/{keyId}',
];

const M5_ROUTES = [
  'GET /api/teams/{id}/machines',
  'GET /api/teams/{id}/models',
  'GET /api/teams/{id}/progress',
  'GET /api/teams/{id}/skills/{sid}',
  'GET /api/teams/{id}/skills/{sid}/file',
  'GET /api/skills',
  'GET /api/conversations/{id}/stream',
  'PUT /api/streams/{connectionId}/conversations',
  'GET /api/builds/{id}/plans',
  'GET /api/builds/{id}/changes',
  'GET /api/builds/{id}/changes/file',
  'GET /api/builds/{id}/usage',
];

function normalizePath(path: string): string {
  return path.replaceAll(/:([A-Za-z]+)/g, '{$1}');
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function first<T>(arr: readonly T[]): T {
  const v = arr[0];
  if (v === undefined) throw new Error('expected non-empty array');
  return v;
}

function last<T>(arr: readonly T[]): T {
  const v = arr[arr.length - 1];
  if (v === undefined) throw new Error('expected non-empty array');
  return v;
}

async function expectErrorShape(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = await json(res);
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error).toBe('string');
}

describe('the route surface = the 02 §6.1 vocabulary', () => {
  const { app } = bootServer();
  const have = new Set(
    app.routes
      .filter(
        (r) =>
          r.method !== 'ALL' && r.path.startsWith('/api') && !r.path.startsWith('/api/machine/'),
      )
      .map((r) => `${r.method} ${normalizePath(r.path)}`),
  );
  const canon = new Set([
    ...WEB_REST_ENDPOINTS.map((e) => `${e.method} ${e.path}`),
    ...INFERRED_ROUTES,
  ]);

  test('M2a the core surface is fully present', () => {
    for (const route of CORE_ROUTES) {
      expect(have.has(route), `missing ${route}`).toBe(true);
    }
  });

  test('M2c the secrets/search surface is fully present', () => {
    for (const route of M2C_ROUTES) {
      expect(have.has(route), `missing ${route}`).toBe(true);
    }
  });

  test('M5 the merged surface is fully present (vocabulary completed + conversation stream + detail reads)', () => {
    for (const route of M5_ROUTES) {
      expect(have.has(route), `missing ${route}`).toBe(true);
    }
  });

  test('no invented paths outside the vocabulary ([inferred] surfaces explicitly registered)', () => {
    for (const route of have) {
      expect(canon.has(route), `invented route ${route}`).toBe(true);
    }
  });

  test('every registry action has a generated face on its declared surfaces and none on mcp/cli', () => {
    const WEB_ACTION_ROUTES: Record<string, string> = {
      'project.archive': 'POST /api/projects/{id}/archive',
      'project.unarchive': 'POST /api/projects/{id}/unarchive',
      'project.delete': 'DELETE /api/projects/{id}',
    };
    const coordinatorDefs = coordinatorToolDefs();
    for (const entry of SLICE1_ACTIONS) {
      expect(entry.surfaces).not.toContain('mcp');
      expect(entry.surfaces).not.toContain('cli');
      if (entry.surfaces.includes('coordinator')) {
        const def = coordinatorDefs.find((tool) => tool.name === entry.toolName);
        expect(def?.description, `coordinator copy for ${entry.toolName}`).toBeTruthy();
        expect(
          (def?.parameters as { type?: string } | undefined)?.type,
          `coordinator parameters for ${entry.toolName}`,
        ).toBe('object');
      }
      if (entry.surfaces.includes('web')) {
        const route = WEB_ACTION_ROUTES[entry.id];
        expect(route, `web face for ${entry.id}`).toBeDefined();
        expect(have.has(route ?? ''), `live route for ${entry.id}`).toBe(true);
      }
    }
  });
});

describe('seed shape-keeping endpoints (02 §2)', () => {
  const s = bootServer();

  test('GET /api/user/me returns the seed user, shape kept', async () => {
    for (const path of ['/api/user/me']) {
      const res = await req(s.app, 'GET', path);
      expect(res.status).toBe(200);
      expect(userRecordSchema.safeParse(await res.json()).success).toBe(true);
      expect(res.headers.get('set-cookie')).toContain('cairn_session=');
      expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    }
  });

  test('GET /api/teams always returns the one seeded row', async () => {
    const res = await req(s.app, 'GET', '/api/teams');
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
    expect(teamRecordSchema.safeParse(body[0]).success).toBe(true);
  });

  test('GET /api/teams/{id}/members returns only oneself (the r2 cached sample shape)', async () => {
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/members`);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
    expect(teamMemberSchema.safeParse(body[0]).success).toBe(true);
    expect((body[0] as { memberType: string }).memberType).toBe('user');
  });

  test('an unknown team id is always 404 {error} (the team stays one row)', async () => {
    await expectErrorShape(await req(s.app, 'GET', '/api/teams/nope/members'), 404);
  });

  test('GET /api/teams/{id}/notifications → {unreadThreadIds}', async () => {
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/notifications`);
    expect(notificationsResponseSchema.safeParse(await res.json()).success).toBe(true);
  });
});

describe('todo CRUD (the demo surface: curl create/read/update/delete)', () => {
  async function setup() {
    const s = bootServer();
    const projectId = await postProject(s.app);
    return { ...s, projectId };
  }

  test('POST /api/projects [inferred] -> 201 ProjectRecord', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', '/api/projects', { name: 'demo' });
    expect(res.status).toBe(201);
    expect(projectRecordSchema.safeParse(await res.json()).success).toBe(true);
    const list = (await (
      await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)
    ).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  test('create: POST todos {title,spec} (the r3 §3.1 body verbatim) -> 201 TodoRecord', async () => {
    const s = await setup();
    const body: unknown = { title: '写贡献指南', spec: '> 原始诉求\n\n要求：README 末尾追加' };
    expect(createTodoBodySchema.safeParse(body).success).toBe(true);
    const res = await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, body);
    expect(res.status).toBe(201);
    const record = await res.json();
    expect(todoRecordSchema.safeParse(record).success).toBe(true);
    const doc = todoRecordSchema.parse(record);
    expect(doc.phase).toBe('todo');
    expect(doc.seqNum).toBe(1);
    expect(doc.v).toBe(1);
    expect(doc.ownerId).toBe(s.user.id);
  });

  test('read: the project/team list surfaces + a single read', async () => {
    const s = await setup();
    const created = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: 'a', spec: '' })
      ).json(),
    );
    await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: 'b', spec: '' });
    const byProject = (await (
      await req(s.app, 'GET', `/api/projects/${s.projectId}/todos`)
    ).json()) as unknown[];
    expect(byProject).toHaveLength(2);
    const byTeam = (await (
      await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}`)
    ).json()) as unknown[];
    expect(byTeam).toHaveLength(2);
    expect((byTeam[1] as { seqNum: number }).seqNum).toBe(2);
    const one = await req(s.app, 'GET', `/api/todos/${created.id}`);
    expect(todoRecordSchema.safeParse(await one.json()).success).toBe(true);
  });

  test('update: PATCH todos/{id} -> v increments; an illegal phase transition 409s', async () => {
    const s = await setup();
    const created = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: 'a', spec: 'x' })
      ).json(),
    );
    const patched = await req(s.app, 'PATCH', `/api/todos/${created.id}`, {
      title: 'a2',
      spec: 'y',
    });
    expect(patched.status).toBe(200);
    const doc = todoRecordSchema.parse(await patched.json());
    expect(doc.title).toBe('a2');
    expect(doc.v).toBe(created.v + 1);
    const closed = todoRecordSchema.parse(
      await (await req(s.app, 'PATCH', `/api/todos/${created.id}`, { phase: 'closed' })).json(),
    );
    expect(closed.phase).toBe('closed');
    await expectErrorShape(
      await req(s.app, 'PATCH', `/api/todos/${created.id}`, { phase: 'planning' }),
      409,
    );
    const reopened = todoRecordSchema.parse(
      await (await req(s.app, 'PATCH', `/api/todos/${created.id}`, { phase: 'todo' })).json(),
    );
    expect(reopened.phase).toBe('todo');
    const moved = todoRecordSchema.parse(
      await (await req(s.app, 'PATCH', `/api/todos/${created.id}`, { phase: 'done' })).json(),
    );
    expect(moved.phase).toBe('done');
    expect(moved.v).toBe(reopened.v + 1);
    await expectErrorShape(
      await req(s.app, 'PATCH', `/api/todos/${created.id}`, { phase: 'failed' }),
      409,
    );
    const reordered = todoRecordSchema.parse(
      await (await req(s.app, 'PATCH', `/api/todos/${created.id}`, { orderIndex: 5 })).json(),
    );
    expect(reordered.orderIndex).toBe(5);
  });

  test('delete: DELETE todos/{id} -> 204; read again 404; delete again 404', async () => {
    const s = await setup();
    const created = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: 'a', spec: '' })
      ).json(),
    );
    expect((await req(s.app, 'DELETE', `/api/todos/${created.id}`)).status).toBe(204);
    await expectErrorShape(await req(s.app, 'GET', `/api/todos/${created.id}`), 404);
    await expectErrorShape(await req(s.app, 'DELETE', `/api/todos/${created.id}`), 404);
  });

  test('error shapes: unknown id 404 / bad body 400 (the single {error} shape)', async () => {
    const s = await setup();
    await expectErrorShape(await req(s.app, 'GET', '/api/todos/nope'), 404);
    await expectErrorShape(await req(s.app, 'GET', '/api/no-such-route'), 404);
    await expectErrorShape(
      await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: 'only-title' }),
      400,
    );
    await expectErrorShape(
      await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, null),
      400,
    );
  });
});

describe('the build surface + the nine-value phase transitions (the server-side spine of the 02 §4.2 main timeline)', () => {
  async function withTodo() {
    const s = bootServer();
    insertMachine(s);
    const projectId = await postProject(s.app);
    const todoDoc = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'run', spec: '' })
      ).json(),
    );
    return { ...s, projectId, todoDoc };
  }

  test('POST builds with no registered machine is refused', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const todoDoc = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'run', spec: '' })
      ).json(),
    );
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoDoc.id],
    });
    expect(res.status).toBe(409);
    s.dispose();
  });

  test('POST builds body = startBuildsBodySchema (the r5 §3.4 captured shape)', async () => {
    const s = await withTodo();
    const body = { todoIds: [s.todoDoc.id] };
    expect(startBuildsBodySchema.safeParse(body).success).toBe(true);
    const res = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, body);
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { builds: unknown[] };
    expect(payload.builds).toHaveLength(1);
    const b = buildRecordSchema.parse(payload.builds[0]);
    expect(b.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b.prevPhase).toBe('todo');
    expect(b.triggerSource).toBe('user');
    expect(b.withPlan).toBe(false);
    const t = todoRecordSchema.parse(
      await (await req(s.app, 'GET', `/api/todos/${s.todoDoc.id}`)).json(),
    );
    expect(t.phase).toBe('queued');
    expect(t.latestBuildId).toBe(b.id);
    expect(t.lastRunAt).not.toBeNull();
    const steps = (await (
      await req(s.app, 'GET', `/api/builds/${b.id}/steps`)
    ).json()) as unknown[];
    expect(steps).toHaveLength(1);
    const st = stepRecordSchema.parse(steps[0]);
    expect(st.kind).toBe('session');
    expect(st.machineId).toBeNull();
    const projectBuilds = (await (
      await req(s.app, 'GET', `/api/projects/${s.projectId}/builds`)
    ).json()) as unknown[];
    expect(projectBuilds).toHaveLength(1);
  });

  test('the full main timeline: plan revision->building->done; explicit merge remains separate from delivery', async () => {
    const s = await withTodo();
    const legacyBuildId = startLegacyBuild(s, s.todoDoc.id, { withPlan: true });
    const b = buildRecordSchema.parse(
      await (await req(s.app, 'GET', `/api/builds/${legacyBuildId}`)).json(),
    );
    const stepsOf = async () =>
      ((await (await req(s.app, 'GET', `/api/builds/${b.id}/steps`)).json()) as unknown[]).map(
        (r) => stepRecordSchema.parse(r),
      );
    const phaseOf = async () =>
      todoRecordSchema.parse(await (await req(s.app, 'GET', `/api/todos/${s.todoDoc.id}`)).json())
        .phase;

    setTodoPhase(s.svc, s.todoDoc.id, 'planning');
    expect(await phaseOf()).toBe('planning');
    s.db
      .insert(planTable)
      .values({
        id: 'plan-wire-1',
        buildId: b.id,
        version: 1,
        content: '# 方案',
        createdAt: Date.now(),
      })
      .run();
    completeStep(s.svc, first(await stepsOf()).id);
    expect(await phaseOf()).toBe('confirm');
    await expectErrorShape(await req(s.app, 'POST', `/api/builds/${b.id}/merge`), 409);
    const revisionBody = {
      action: 'revision',
      side: 'plan',
      feedback: '标题去掉项目名后缀',
      clientMessageId: '3f9a0c2e-0000-4000-8000-000000000000',
    };
    expect(buildStepActionBodySchema.safeParse(revisionBody).success).toBe(true);
    const revision = await req(s.app, 'POST', `/api/builds/${b.id}/steps`, revisionBody);
    expect(revision.status).toBe(202);
    expect(await phaseOf()).toBe('planning');
    const msgs = await (await req(s.app, 'GET', `/api/conversations/${b.id}/messages`)).json();
    expect(conversationMessagesResponseSchema.safeParse(msgs).success).toBe(true);
    const envelope = conversationMessagesResponseSchema.parse(msgs);
    expect(envelope.messages).toHaveLength(1);
    expect(envelope.messages[0]).toMatchObject({ role: 'user', content: revisionBody.feedback });
    completeStep(s.svc, last(await stepsOf()).id);
    expect(await phaseOf()).toBe('confirm');
    const confirm = await req(s.app, 'POST', `/api/builds/${b.id}/steps`, { action: 'confirm' });
    expect(confirm.status).toBe(202);
    expect(await phaseOf()).toBe('building');
    const execution = last(await stepsOf());
    s.db
      .update(stepTable)
      .set({ checkpointCommit: 'ab'.repeat(20) })
      .where(eq(stepTable.id, execution.id))
      .run();
    completeStep(s.svc, execution.id);
    expect(await phaseOf()).toBe('done');
    expect(
      (await stepsOf()).some((step) => ['review', 'verify', 'merge'].includes(step.kind)),
    ).toBe(false);
    const merge = await req(s.app, 'POST', `/api/builds/${b.id}/merge`);
    expect(merge.status).toBe(202);
    expect(mergeAcceptedResponseSchema.safeParse(await merge.json()).success).toBe(true);
    const steps4 = await stepsOf();
    expect(last(steps4).kind).toBe('merge');
    completeStep(s.svc, last(steps4).id);
    expect(await phaseOf()).toBe('done');
    const rerun = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
    });
    expect(rerun.status).toBe(201);
    const rerunBuild = buildRecordSchema.parse(
      ((await rerun.json()) as { builds: unknown[] }).builds[0],
    );
    expect(rerunBuild.prevPhase).toBe('done');
    expect(await phaseOf()).toBe('queued');
  });

  test('the failed-rerun edge: failed->queued via POST builds (r3 §3.7)', async () => {
    const s = await withTodo();
    await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
    });
    setTodoPhase(s.svc, s.todoDoc.id, 'building');
    setTodoPhase(s.svc, s.todoDoc.id, 'failed');
    const rerun = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
    });
    expect(rerun.status).toBe(201);
    const t = todoRecordSchema.parse(
      await (await req(s.app, 'GET', `/api/todos/${s.todoDoc.id}`)).json(),
    );
    expect(t.phase).toBe('queued');
    expect(t.buildHistory.length).toBe(2);
  });

  test('an unknown build 404; a bad steps body 400', async () => {
    const s = await withTodo();
    await expectErrorShape(await req(s.app, 'GET', '/api/builds/nope'), 404);
    await expectErrorShape(await req(s.app, 'GET', '/api/builds/nope/steps'), 404);
    const started = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
    });
    const b = buildRecordSchema.parse(((await started.json()) as { builds: unknown[] }).builds[0]);
    await expectErrorShape(
      await req(s.app, 'POST', `/api/builds/${b.id}/steps`, { action: 'cancel' }),
      400,
    );
  });
});

describe('every response shape re-verified with zod (fields are the contract, 02/A9)', () => {
  test('every response body of the CRUD chain passes the shared schema', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const created = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'x', spec: '' })
    ).json()) as { id: string };
    expect(todoRecordSchema.safeParse(created).success).toBe(true);
    const list = await (await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}`)).json();
    expect(z.array(todoRecordSchema).safeParse(list).success).toBe(true);
    const one = await (await req(s.app, 'GET', `/api/todos/${created.id}`)).json();
    expect(todoRecordSchema.safeParse(one).success).toBe(true);
  });
});
