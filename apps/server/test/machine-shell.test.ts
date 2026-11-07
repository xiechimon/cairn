import { type ClaimedStep, claimedStepSchema, LOCAL_TOOL_CREATE_TAG } from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { bootServer, issueApiKey, postProject, seedRoute, seedSessionRoute } from './helpers.js';

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

async function claimWith(tools: string[]): Promise<ClaimedStep> {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'tools-mbp', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  seedSessionRoute(s, {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: s.db.select().from(machineTable).get()!.id,
    tools,
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'local tools probe', spec: 'claim once' },
  });
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const buildRes = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId] },
  });
  expect(buildRes.status).toBe(201);
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
    cred: token,
    body: {},
  });
  const step = claimedStepSchema.parse(((await claimRes.json()) as { step: unknown }).step);
  const shell = await call(s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
    cred: token,
    body: { command: 'ls' },
  });
  expect(shell.status).toBe(404);
  s.dispose();
  return step;
}

describe('claim payload local tools after remote shell retirement (#1796)', () => {
  test('create_tag is offered when the session policy holds the create-tag switch', async () => {
    const step = await claimWith(['创建标签']);
    expect(step.localTools).toEqual([LOCAL_TOOL_CREATE_TAG]);
  });

  test('a stored remote-shell switch is not a local tool', async () => {
    const step = await claimWith(['远程 shell', '创建标签', '推送分支']);
    expect(step.localTools).toEqual([LOCAL_TOOL_CREATE_TAG]);
    expect(step.localTools).not.toContain('remote_shell');
  });

  test('a session policy with no local-tool switches claims an empty list', async () => {
    const step = await claimWith([]);
    expect(step.localTools).toEqual([]);
  });
});

describe('chief steps still omit local tools', () => {
  test('a chief claim has no localTools and the retired shell route is gone', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    const key = await issueApiKey(s);
    const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'chief-mbp', cliVersion: '0.1.0' },
    });
    seedRoute(s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: s.db.select().from(machineTable).get()!.id,
    });
    const { token } = (await enrollRes.json()) as { token: string };
    const msgRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      body: { content: 'Look at this repository.' },
    });
    expect(msgRes.status).toBe(201);
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const step = claimedStepSchema.parse(((await claimRes.json()) as { step: unknown }).step);
    expect(step.step.kind).toBe('chief');
    expect(step.localTools).toBeUndefined();
    const shell = await call(s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
      cred: token,
      body: { command: 'ls' },
    });
    expect(shell.status).toBe(404);
    s.dispose();
  });
});
