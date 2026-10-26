import {
  buildRecordSchema,
  buildStepActionBodySchema,
  conversationMessagesResponseSchema,
  createTagBodySchema,
  createTodoBodySchema,
  FIXED_TAGS,
  mergeAcceptedResponseSchema,
  notificationsResponseSchema,
  projectRecordSchema,
  startBuildsBodySchema,
  stepRecordSchema,
  tagRecordSchema,
  teamMemberSchema,
  teamRecordSchema,
  todoRecordSchema,
  userRecordSchema,
  WEB_REST_ENDPOINTS,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { agent as agentTable, plan as planTable } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { completeStep } from '../src/services/builds.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

const INFERRED_ROUTES = [
  'POST /api/projects',
  'PATCH /api/projects/{id}',
  'PATCH /api/user/me',
  'PATCH /api/todos/{id}',
  'DELETE /api/todos/{id}',
  'GET /api/projects/{id}/autonomy',
  'PATCH /api/projects/{id}/autonomy',
  'GET /api/projects/{id}/merge-policy',
  'PATCH /api/projects/{id}/merge-policy',
  'DELETE /api/projects/{id}',
  'DELETE /api/schedules/{id}',
  'DELETE /api/teams/{id}/providers/{pid}',
  'GET /api/teams/{id}/secrets',
  'POST /api/teams/{id}/secrets',
  'PATCH /api/teams/{id}/secrets/{sid}',
  'DELETE /api/teams/{id}/secrets/{sid}',
  'GET /api/teams/{id}/api-keys',
  'POST /api/teams/{id}/api-keys',
  'POST /api/teams/{id}/chief/threads',
  'POST /api/conversations/{id}/messages',
  'POST /api/teams/{id}/chief/threads/{tid}/rewind',
  'POST /api/teams/{id}/chief/threads/{tid}/questions/{requestId}/answer',
  'POST /api/teams/{id}/chief/threads/{tid}/questions/{requestId}/cancel',
  'POST /api/todos/{id}/orchestrate',
  'POST /api/todos/{id}/stop-and-done',
  'POST /api/todos/{id}/reset',
  'GET /api/needs-you',
  'DELETE /api/machines/{id}',
  'POST /api/machines/{id}/evacuate',
  'DELETE /api/teams/{id}/agents/{aid}/memories/{mid}',
  'DELETE /api/teams/{id}/agents/{aid}',
  'GET /api/teams/{id}/agents/{aid}/machine-fit',
  'GET /api/projects/{id}/commits',
  'GET /api/projects/{id}/commits/{sha}',
  'GET /api/builds/{id}/plans',
  'GET /api/builds/{id}/changes',
  'GET /api/builds/{id}/changes/file',
  'GET /api/builds/{id}/usage',
  'GET /api/builds/{id}/gate',
  'POST /api/uploads/grant',
  'POST /api/uploads/upload',
  'GET /api/attachments/{id}',
  'POST /api/builds/{id}/stop',
  'POST /api/builds/{id}/branch-sync',
  'GET /api/builds/{id}/branch-sync',
  'GET /api/teams/{id}/model-sources',
  'PATCH /api/machines/{id}',
  'GET /api/github/repos',
  'POST /api/teams/{id}/github/oauth/authorize',
  'GET /api/teams/{id}/github/connection',
  'DELETE /api/teams/{id}/github/connection',
  'POST /api/fs/pick',
  'GET /api/fs/list',
  'GET /api/projects/{id}/github/issues',
  'POST /api/projects/{id}/github/issues/import',
  'GET /api/todos/{id}/github-issue',
  'POST /api/todos/{id}/github-issue/retry',
  'GET /api/projects/{id}/files',
];

const CORE_ROUTES = [
  'GET /api/auth/session',
  'GET /api/user/me',
  'GET /api/teams',
  'GET /api/teams/{id}/members',
  'GET /api/teams/{id}/notifications',
  'GET /api/teams/{id}/stream',
  'GET /api/projects',
  'GET /api/projects/{id}/todos',
  'GET /api/projects/{id}/builds',
  'GET /api/projects/{id}/tags',
  'GET /api/projects/{id}/branches',
  'GET /api/projects/{id}/tree',
  'GET /api/projects/{id}/file',
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
  'GET /api/teams/{id}/api-keys',
  'POST /api/teams/{id}/api-keys',
];

const M5_ROUTES = [
  'GET /api/teams/{id}/machines',
  'GET /api/teams/{id}/models',
  'GET /api/teams/{id}/progress',
  'GET /api/teams/{id}/skills/{sid}',
  'GET /api/teams/{id}/skills/{sid}/file',
  'GET /api/teams/{id}/agents/{aid}/tasks',
  'GET /api/skills',
  'POST /api/analytics/first-touch',
  'GET /api/conversations/{id}/stream',
  'GET /api/builds/{id}/plans',
  'GET /api/builds/{id}/changes',
  'GET /api/builds/{id}/changes/file',
  'GET /api/builds/{id}/usage',
  'GET /api/builds/{id}/gate',
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
    const all = new Set(
      app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`),
    );
    expect(all.has('POST /_mp/api/track'), 'missing POST /_mp/api/track').toBe(true);
  });

  test('no invented paths outside the vocabulary ([inferred] surfaces explicitly registered)', () => {
    for (const route of have) {
      expect(canon.has(route), `invented route ${route}`).toBe(true);
    }
  });
});

describe('seed shape-keeping endpoints (02 §2)', () => {
  const s = bootServer();

  test('GET /api/auth/session and /api/user/me return the seed user, shape kept', async () => {
    for (const path of ['/api/auth/session', '/api/user/me']) {
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

  test('update: PATCH todos/{id} assignment dual slots -- slot-level merge + the derived agent projection follows (#208)', async () => {
    const s = await setup();
    const created = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: 'a', spec: '' })
      ).json(),
    );
    expect(created.assignment).toBeNull();
    expect(created.agent).toBeNull();
    const planAgentId = newRecordId();
    const buildAgentId = newRecordId();
    for (const [id, displayName] of [
      [planAgentId, '规划小林'],
      [buildAgentId, '执行小林'],
    ] as const) {
      s.db
        .insert(agentTable)
        .values({
          id,
          teamId: s.team.id,
          displayName,
          description: null,
          status: 'active',
          avatarUrl: null,
          provider: null,
          modelId: null,
          thinkingLevel: null,
          tools: [],
          secrets: [],
          defaultSkill: null,
          skillsAllowlist: null,
          mcpServers: [],
        })
        .run();
    }
    const planOnly = todoRecordSchema.parse(
      await (
        await req(s.app, 'PATCH', `/api/todos/${created.id}`, {
          assignment: { plan: { agentId: planAgentId } },
        })
      ).json(),
    );
    expect(planOnly.assignment).toEqual({ plan: { agentId: planAgentId }, build: null });
    expect(planOnly.agent).toBeNull();
    expect(planOnly.v).toBe(created.v + 1);
    const both = todoRecordSchema.parse(
      await (
        await req(s.app, 'PATCH', `/api/todos/${created.id}`, {
          assignment: { build: { agentId: buildAgentId } },
        })
      ).json(),
    );
    expect(both.assignment).toEqual({
      plan: { agentId: planAgentId },
      build: { agentId: buildAgentId },
    });
    expect(both.agent).toEqual({ id: buildAgentId, displayName: '执行小林' });
    const got = todoRecordSchema.parse(
      await (await req(s.app, 'GET', `/api/todos/${created.id}`)).json(),
    );
    expect(got.assignment).toEqual(both.assignment);
    expect(got.agent).toEqual(both.agent);
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

describe('the tag surface (#309, the r9 §3.4 wire comparison)', () => {
  async function setup() {
    const s = bootServer();
    const projectId = await postProject(s.app);
    return { ...s, projectId };
  }

  test('POST /api/projects/{id}/tags {name,color} -> 201 TagRecord (the r9 §3.4 measured shape)', async () => {
    const s = await setup();
    const body: unknown = { name: 'r9probe', color: '#6366f1' };
    expect(createTagBodySchema.safeParse(body).success).toBe(true);
    const res = await req(s.app, 'POST', `/api/projects/${s.projectId}/tags`, body);
    expect(res.status).toBe(201);
    const record = await res.json();
    expect(tagRecordSchema.safeParse(record).success).toBe(true);
    const created = tagRecordSchema.parse(record);
    expect(created.projectId).toBe(s.projectId);
    expect(created.name).toBe('r9probe');
    expect(created.color).toBe('#6366f1');
    expect(created.v).toBe(1);
    expect(typeof created.createdAt).toBe('number');
    const list = (await (
      await req(s.app, 'GET', `/api/projects/${s.projectId}/tags`)
    ).json()) as unknown[];
    expect(list).toHaveLength(7);
    const found = list.find((r) => tagRecordSchema.parse(r).id === created.id);
    expect(tagRecordSchema.parse(found)).toEqual(created);
  });

  test('POST tags with a bad body -> 400; an unknown project -> 404 (the single {error} shape)', async () => {
    const s = await setup();
    await expectErrorShape(
      await req(s.app, 'POST', `/api/projects/${s.projectId}/tags`, { color: '#6366f1' }),
      400,
    );
    await expectErrorShape(
      await req(s.app, 'POST', `/api/projects/${s.projectId}/tags`, { name: '', color: '#6366f1' }),
      400,
    );
    await expectErrorShape(
      await req(s.app, 'POST', `/api/projects/${s.projectId}/tags`, null),
      400,
    );
    await expectErrorShape(
      await req(s.app, 'POST', '/api/projects/nope/tags', { name: 'x', color: '#6366f1' }),
      404,
    );
  });

  test('POST todos carrying tagIds -> record.tagIds round-trips (the r9 §3.4 carry slot; the join truth)', async () => {
    const s = await setup();
    const post = async (name: string) =>
      tagRecordSchema.parse(
        await (
          await req(s.app, 'POST', `/api/projects/${s.projectId}/tags`, {
            name,
            color: '#6366f1',
          })
        ).json(),
      );
    const a = await post('a');
    const b = await post('b');
    const body: unknown = { title: '带标签任务', spec: '', tagIds: [a.id, b.id] };
    expect(createTodoBodySchema.safeParse(body).success).toBe(true);
    const res = await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, body);
    expect(res.status).toBe(201);
    const created = todoRecordSchema.parse(await res.json());
    expect([...created.tagIds].sort()).toEqual([a.id, b.id].sort());
    const one = todoRecordSchema.parse(
      await (await req(s.app, 'GET', `/api/todos/${created.id}`)).json(),
    );
    expect([...one.tagIds].sort()).toEqual([a.id, b.id].sort());
    const plain = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, { title: 'p', spec: '' })
      ).json(),
    );
    expect(plain.tagIds).toEqual([]);
  });

  test('POST todos carrying a tag of another project / unknown -> 400 (project-boundary defense)', async () => {
    const s = bootServer();
    const projectA = await postProject(s.app, 'a');
    const projectB = await postProject(s.app, 'b');
    const foreign = tagRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectB}/tags`, { name: 'x', color: '#6366f1' })
      ).json(),
    );
    await expectErrorShape(
      await req(s.app, 'POST', `/api/projects/${projectA}/todos`, {
        title: 't',
        spec: '',
        tagIds: [foreign.id],
      }),
      400,
    );
    await expectErrorShape(
      await req(s.app, 'POST', `/api/projects/${projectA}/todos`, {
        title: 't',
        spec: '',
        tagIds: ['no-such-tag'],
      }),
      400,
    );
  });
});

describe('the build surface + the nine-value phase transitions (the server-side spine of the 02 §4.2 main timeline)', () => {
  async function withTodo() {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const todoDoc = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'run', spec: '' })
      ).json(),
    );
    return { ...s, projectId, todoDoc };
  }

  test('POST builds body = startBuildsBodySchema (the r5 §3.4 captured shape)', async () => {
    const s = await withTodo();
    const body = {
      todoIds: [s.todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: true,
    };
    expect(startBuildsBodySchema.safeParse(body).success).toBe(true);
    const res = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, body);
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { builds: unknown[] };
    expect(payload.builds).toHaveLength(1);
    const b = buildRecordSchema.parse(payload.builds[0]);
    expect(b.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b.prevPhase).toBe('todo');
    expect(b.triggerSource).toBe('user');
    expect(b.withPlan).toBe(true);
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
    expect(st.kind).toBe('plan');
    expect(st.machineId).toBeNull();
    const projectBuilds = (await (
      await req(s.app, 'GET', `/api/projects/${s.projectId}/builds`)
    ).json()) as unknown[];
    expect(projectBuilds).toHaveLength(1);
  });

  test('direct execution queues the execution step (the two branches of the 02 §4.2 start dialog)', async () => {
    const s = await withTodo();
    const res = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: false,
    });
    const b = buildRecordSchema.parse(((await res.json()) as { builds: unknown[] }).builds[0]);
    const steps = (await (
      await req(s.app, 'GET', `/api/builds/${b.id}/steps`)
    ).json()) as unknown[];
    expect(stepRecordSchema.parse(steps[0]).kind).toBe('build');
  });

  test('the full main timeline: queued->planning->confirm->(the reject v2 loop)->building->review->merge 202->done', async () => {
    const s = await withTodo();
    const started = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: true,
    });
    const b = buildRecordSchema.parse(((await started.json()) as { builds: unknown[] }).builds[0]);
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
    completeStep(s.svc, last(await stepsOf()).id);
    expect(await phaseOf()).toBe('review');
    const merge = await req(s.app, 'POST', `/api/builds/${b.id}/merge`);
    expect(merge.status).toBe(202);
    expect(mergeAcceptedResponseSchema.safeParse(await merge.json()).success).toBe(true);
    const steps4 = await stepsOf();
    expect(last(steps4).kind).toBe('merge');
    completeStep(s.svc, last(steps4).id);
    expect(await phaseOf()).toBe('done');
    const rerun = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: false,
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
      assignment: { plan: null, build: null },
      withPlan: false,
    });
    setTodoPhase(s.svc, s.todoDoc.id, 'building');
    setTodoPhase(s.svc, s.todoDoc.id, 'failed');
    const rerun = await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: false,
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
      assignment: { plan: null, build: null },
      withPlan: true,
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
    const tags = await (await req(s.app, 'GET', `/api/projects/${projectId}/tags`)).json();
    expect(z.array(tagRecordSchema).safeParse(tags).success).toBe(true);
    expect((tags as unknown[]).length).toBe(FIXED_TAGS.length);
    const one = await (await req(s.app, 'GET', `/api/todos/${created.id}`)).json();
    expect(todoRecordSchema.safeParse(one).success).toBe(true);
  });
});
