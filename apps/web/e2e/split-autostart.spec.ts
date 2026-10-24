import { expect, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

interface Stage {
  teamId: string;
  machineToken: string;
  implementerId: string;
}

interface TodoWire {
  id: string;
  phase: string;
  sourceTodo: string | null;
  latestBuildId: string | null;
}

let server: LiveServer;

test.beforeAll(async () => {
  server = await bootLiveServer(null);
});

test.afterAll(async () => {
  await server?.dispose();
});

async function ok<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  expect(res.status, `${method} ${path} → ${text}`).toBeLessThan(300);
  return (text === '' ? null : JSON.parse(text)) as T;
}

let stage: Stage | undefined;

async function teamStage(): Promise<Stage> {
  if (stage !== undefined) return stage;
  const [team] = await ok<{ id: string }[]>('GET', '/api/teams');
  const teamId = team!.id;
  const key = await ok<{ plaintext: string }>('POST', `/api/teams/${teamId}/api-keys`, {
    name: 'split-autostart',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const enrolled = await ok<{ machineId: string; token: string }>(
    'POST',
    '/api/machine/enroll',
    { teamId, name: 'split-autostart-runner', cliVersion: '0.1.0' },
    key.plaintext,
  );
  await ok('POST', '/api/machine/presence', {}, enrolled.token);
  await ok('POST', `/api/teams/${teamId}/providers`, {
    providerId: 'split-gw',
    label: 'Split Gateway',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    models: [{ id: 'split-model', name: 'split-model' }],
  });
  const agentBody = (displayName: string) => ({
    displayName,
    provider: 'split-gw',
    modelId: 'split-model',
    machineId: enrolled.machineId,
  });
  const chiefAgent = await ok<{ id: string }>(
    'POST',
    `/api/teams/${teamId}/agents`,
    agentBody('split-chief'),
  );
  const implementer = await ok<{ id: string }>(
    'POST',
    `/api/teams/${teamId}/agents`,
    agentBody('split-implementer'),
  );
  await ok('PATCH', `/api/teams/${teamId}/chief`, { agent: { agentId: chiefAgent.id } });
  stage = { teamId, machineToken: enrolled.token, implementerId: implementer.id };
  return stage;
}

async function claimStep(token: string): Promise<{ id: string; kind: string; buildId: string }> {
  const body = await ok<{ step: { step: { id: string; kind: string; buildId: string } } | null }>(
    'POST',
    '/api/machine/tasks/claim',
    {},
    token,
  );
  if (body.step === null) throw new Error('claim returned no step');
  return body.step.step;
}

async function splitThroughChief(
  splitPolicy: 'human' | 'auto',
): Promise<{ parentId: string; childA: string; childB: string; parentBuildId: string }> {
  const { teamId, machineToken, implementerId } = await teamStage();
  const project = await ok<{ id: string }>('POST', '/api/projects', {
    name: `split-${splitPolicy}`,
  });
  if (splitPolicy !== 'human') await ok('PATCH', `/api/projects/${project.id}`, { splitPolicy });
  const parent = await ok<{ id: string }>('POST', `/api/projects/${project.id}/todos`, {
    title: `拆解探针 ${splitPolicy}`,
    spec: '拆成两张：先建表，再接接口',
  });
  await ok('POST', `/api/teams/${teamId}/chief/threads`, { content: `拆解 ${parent.id}` });
  const chiefStep = await claimStep(machineToken);
  expect(chiefStep.kind).toBe('chief');
  const relayed = await ok<{ text: string }>(
    'POST',
    `/api/machine/tool/${chiefStep.id}`,
    {
      name: 'split_todo',
      params: {
        todoId: parent.id,
        subtodos: [
          { title: '建表', spec: '在 apps/server/src/db 加一张表', agentId: implementerId },
          {
            title: '接接口',
            spec: '在 apps/server/src/routes-todos.ts 接读接口',
            agentId: implementerId,
            blockedBy: [1],
          },
        ],
      },
    },
    machineToken,
  );
  const result = JSON.parse(relayed.text) as {
    parentBuildId: string;
    children: { id: string }[];
  };
  await ok('POST', `/api/machine/done/${chiefStep.id}`, { status: 'success' }, machineToken);
  return {
    parentId: parent.id,
    childA: result.children[0]!.id,
    childB: result.children[1]!.id,
    parentBuildId: result.parentBuildId,
  };
}

const todoOf = (id: string) => ok<TodoWire>('GET', `/api/todos/${id}`);

test('auto 项目：拆解不经人确认即开跑，阻塞子卡等前置 done 后起跑', async ({ page }) => {
  const { machineToken } = await teamStage();
  const split = await splitThroughChief('auto');

  expect((await todoOf(split.parentId)).phase).toBe('building');
  expect((await todoOf(split.childA)).phase).toBe('queued');
  expect((await todoOf(split.childB)).phase).toBe('todo');

  const buildA = await claimStep(machineToken);
  expect(buildA.kind).toBe('build');
  expect((await todoOf(split.childA)).latestBuildId).toBe(buildA.buildId);
  await ok(
    'POST',
    `/api/machine/done/${buildA.id}`,
    { status: 'success', hasChanges: true },
    machineToken,
  );
  expect((await todoOf(split.childA)).phase).toBe('review');
  expect((await todoOf(split.childB)).phase).toBe('todo');

  await ok('PATCH', `/api/todos/${split.childA}`, { phase: 'done' });
  expect((await todoOf(split.childB)).phase).toBe('queued');
  const buildB = await claimStep(machineToken);
  expect(buildB.kind).toBe('build');
  expect((await todoOf(split.childB)).latestBuildId).toBe(buildB.buildId);

  await page.goto(`${server.base}/app/todo/${split.parentId}`);
  await expect(page.getByText('检查器结果：已自动开跑')).toBeVisible();
});

test('默认 human 项目：拆解照旧停在父卡确认关口，子卡不动', async ({ page }) => {
  const split = await splitThroughChief('human');

  expect((await todoOf(split.parentId)).phase).toBe('confirm');
  expect((await todoOf(split.childA)).phase).toBe('todo');
  expect((await todoOf(split.childB)).phase).toBe('todo');

  await page.goto(`${server.base}/app/todo/${split.parentId}`);
  await expect(page.getByText('检查器结果：回落人审 + 项目策略为 human')).toBeVisible();
});
