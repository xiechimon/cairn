import { type ClaimedStep, claimedStepSchema, LOCAL_TOOL_CREATE_TAG } from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

const AGENT_ID = 'agent-local-tools-1';

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

async function claimWith(agentTools: string[]): Promise<ClaimedStep> {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'stub-local-tools-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
      tools: agentTools,
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'tools-mbp', cliVersion: '0.1.0' },
  });
  bindAllAgents(s);
  expect(enrollRes.status).toBe(200);
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'local tools probe', spec: 'claim once' },
  });
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const buildRes = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: false,
    },
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
  test('create_tag is offered when the agent holds the create-tag switch', async () => {
    const step = await claimWith(['创建标签']);
    expect(step.localTools).toEqual([LOCAL_TOOL_CREATE_TAG]);
  });

  test('a stored remote-shell switch is not a local tool', async () => {
    const step = await claimWith(['远程 shell', '创建标签', '推送分支']);
    expect(step.localTools).toEqual([LOCAL_TOOL_CREATE_TAG]);
    expect(step.localTools).not.toContain('remote_shell');
  });

  test('an agent with no local-tool switches claims an empty list', async () => {
    const step = await claimWith([]);
    expect(step.localTools).toEqual([]);
  });
});

describe('chief steps still omit local tools', () => {
  test('a chief claim has no localTools and the retired shell route is gone', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    const key = await issueApiKey(s);
    s.db
      .insert(agentTable)
      .values({
        id: 'chief-agent-1',
        teamId: s.team.id,
        displayName: 'chief-agent',
        modelId: 'stub-model',
        provider: 'stub-gw',
      })
      .run();
    const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'chief-mbp', cliVersion: '0.1.0' },
    });
    bindAllAgents(s);
    const { token } = (await enrollRes.json()) as { token: string };
    const patchRes = await call(s.app, 'PATCH', `/api/teams/${s.team.id}/chief`, {
      body: { agent: { agentId: 'chief-agent-1', thinkingLevel: null } },
    });
    expect(patchRes.status).toBe(200);
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
