import { claimedStepSchema, PROJECT_INSTRUCTIONS_MAX } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { agent, chief as chiefTable, project } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import {
  bindAgentHome,
  bindAllAgents,
  bootServer,
  issueApiKey,
  machineIdByName,
  req,
  type TestServer,
} from './helpers.js';

const RULES = 'Repository content is English. Never force push.';

let s: TestServer;

async function createProject(name: string, body: Record<string, unknown> = {}): Promise<string> {
  const res = await req(s.app, 'POST', '/api/projects', { name, ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function enroll(name: string): Promise<string> {
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function claim(token: string) {
  const res = await s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: unknown };
  if (body.step === null) throw new Error('nothing claimed');
  return claimedStepSchema.parse(body.step);
}

beforeEach(() => {
  s = bootServer();
});

describe('project instructions are stored on the project (D74 P1)', () => {
  test('PATCH sets them, GET returns them, a blank value clears them', async () => {
    const id = await createProject('rules');
    const set = await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ instructions: RULES });
    expect(await (await req(s.app, 'GET', '/api/projects')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, instructions: RULES })]),
    );
    const renamed = await req(s.app, 'PATCH', `/api/projects/${id}`, { name: 'renamed' });
    expect(await renamed.json()).toMatchObject({ instructions: RULES });
    const cleared = await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: '   ' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).not.toHaveProperty('instructions');
    expect(s.db.select().from(project).where(eq(project.id, id)).get()?.instructions).toBeNull();
  });

  test('instructions longer than the limit are refused and nothing changes', async () => {
    const id = await createProject('rules');
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    const res = await req(s.app, 'PATCH', `/api/projects/${id}`, {
      instructions: 'x'.repeat(PROJECT_INSTRUCTIONS_MAX + 1),
    });
    expect(res.status).toBe(400);
    expect(s.db.select().from(project).where(eq(project.id, id)).get()?.instructions).toBe(RULES);
  });
});

describe('threads in the project receive the instructions (D74 P1)', () => {
  test('a claimed build carries its project instructions through the wire schema', async () => {
    const token = await enroll('rules-builder');
    s.db
      .insert(agent)
      .values({
        id: 'rules-agent',
        teamId: s.team.id,
        displayName: 'Builder',
        modelId: 'stub-model',
      })
      .run();
    bindAllAgents(s);
    const id = await createProject('rules', { kind: 'github', githubRepo: 'octo/demo' });
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    const task = (await (
      await req(s.app, 'POST', `/api/projects/${id}/todos`, { title: 'Build', spec: 'Build it' })
    ).json()) as { id: string };
    const started = await req(s.app, 'POST', `/api/projects/${id}/builds`, {
      todoIds: [task.id],
      withPlan: false,
      assignment: { plan: null, build: { agentId: 'rules-agent' } },
    });
    expect(started.status).toBe(201);
    expect((await claim(token)).project?.instructions).toBe(RULES);
  });
});

describe('Coordinator turns scoped to a project receive its instructions (D74 P1)', () => {
  const CHIEF_AGENT = 'agent-rules-chief';

  beforeEach(() => {
    s.db
      .insert(agent)
      .values({
        id: CHIEF_AGENT,
        teamId: s.team.id,
        displayName: CHIEF_AGENT,
        provider: 'stub-gw',
        modelId: 'stub-model',
      })
      .run();
    s.db
      .insert(chiefTable)
      .values({
        id: `chief-${s.user.id}-${s.team.id}`,
        userId: s.user.id,
        teamId: s.team.id,
        agentId: CHIEF_AGENT,
        charter: '',
        watches: [],
        wakes: [],
        createdAt: nowMs(),
      })
      .run();
  });

  async function chiefInstruction(content: string, projectId?: string): Promise<string> {
    const sent = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      content,
      ...(projectId === undefined ? {} : { projectId }),
    });
    expect(sent.status).toBe(201);
    const token = await enroll('rules-chief');
    bindAgentHome(s, CHIEF_AGENT, machineIdByName(s, 'rules-chief'));
    const claimed = await claim(token);
    expect(claimed.step.kind).toBe('chief');
    return (claimed as { instruction?: string }).instruction ?? '';
  }

  test('a turn scoped to the project carries its instructions after the message', async () => {
    const id = await createProject('cairn');
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    const instruction = await chiefInstruction('plan the release', id);
    expect(instruction).toContain('plan the release');
    expect(instruction).toContain(RULES);
    expect(instruction.indexOf('plan the release')).toBeLessThan(instruction.indexOf(RULES));
  });

  test('an unscoped turn carries no project instructions', async () => {
    const id = await createProject('cairn');
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    expect(await chiefInstruction('how is everything')).toBe('how is everything');
  });

  test('a turn scoped to a project without instructions carries none, not another project', async () => {
    const withRules = await createProject('cairn');
    await req(s.app, 'PATCH', `/api/projects/${withRules}`, { instructions: RULES });
    const plain = await createProject('site');
    expect(await chiefInstruction('fix the header', plain)).not.toContain(RULES);
  });
});
