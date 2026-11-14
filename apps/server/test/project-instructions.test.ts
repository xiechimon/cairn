import { BRIEF_MARKER_END, claimedStepSchema, PROJECT_INSTRUCTIONS_MAX } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { chief as chiefTable, coordinatorInput, project, step } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { saveMemoryEntry } from '../src/services/memory.js';
import {
  bootServer,
  issueApiKey,
  machineIdByName,
  req,
  seedRoute,
  seedSessionRoute,
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
    body: JSON.stringify(readyMachine({ teamId: s.team.id, name, cliVersion: '0.1.0' })),
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

describe('instructions cannot break the worker brief (D74 P1)', () => {
  test('instructions containing a runtime marker are refused and nothing changes', async () => {
    const id = await createProject('rules');
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    const res = await req(s.app, 'PATCH', `/api/projects/${id}`, {
      instructions: `copied from CLAUDE.md\n${BRIEF_MARKER_END}`,
    });
    expect(res.status).toBe(400);
    expect(s.db.select().from(project).where(eq(project.id, id)).get()?.instructions).toBe(RULES);
  });
});

describe('threads in the project receive the instructions (D74 P1)', () => {
  test('a claimed build carries its project instructions through the wire schema', async () => {
    const token = await enroll('rules-builder');
    seedSessionRoute(s, { provider: 'pi', modelId: 'stub-model' });
    const id = await createProject('rules', { kind: 'github', githubRepo: 'octo/demo' });
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    const task = (await (
      await req(s.app, 'POST', `/api/projects/${id}/todos`, { title: 'Build', spec: 'Build it' })
    ).json()) as { id: string };
    const started = await req(s.app, 'POST', `/api/projects/${id}/builds`, {
      todoIds: [task.id],
      withPlan: false,
    });
    expect(started.status).toBe(201);
    expect((await claim(token)).project?.instructions).toBe(RULES);
  });

  test.each([
    ['Ask before adding a dependency.', { charter: 'Ask before adding a dependency.' }],
    ['', undefined],
  ])('a claimed build carries the team charter %j only when it is set', async (charter, team) => {
    s.db
      .insert(chiefTable)
      .values({
        id: `chief-${s.user.id}-${s.team.id}`,
        userId: s.user.id,
        teamId: s.team.id,
        charter,
        watches: [],
        wakes: [],
        createdAt: nowMs(),
      })
      .run();
    const token = await enroll('charter-builder');
    seedSessionRoute(s, { provider: 'pi', modelId: 'stub-model' });
    const id = await createProject('charter', { kind: 'github', githubRepo: 'octo/demo' });
    const task = (await (
      await req(s.app, 'POST', `/api/projects/${id}/todos`, { title: 'Build', spec: 'Build it' })
    ).json()) as { id: string };
    await req(s.app, 'POST', `/api/projects/${id}/builds`, { todoIds: [task.id], withPlan: false });
    expect((await claim(token)).team).toEqual(team);
  });
});

describe('Coordinator turns scoped to a project receive its instructions (D74 P1)', () => {
  const CHIEF_AGENT = 'agent-rules-chief';

  beforeEach(() => {
    seedRoute(s, 'coordinator', { id: CHIEF_AGENT, provider: 'stub-gw', modelId: 'stub-model' });
    s.db
      .insert(chiefTable)
      .values({
        id: `chief-${s.user.id}-${s.team.id}`,
        userId: s.user.id,
        teamId: s.team.id,
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
    seedRoute(s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: machineIdByName(s, 'rules-chief'),
    });
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

  test('a turn scoped to the project carries that project memories, not another project', async () => {
    const id = await createProject('cairn');
    const other = await createProject('site');
    saveMemoryEntry(s.db, {
      agentId: CHIEF_AGENT,
      teamId: s.team.id,
      title: 'deploy target',
      content: 'the Mac',
      projectId: id,
      sourceTodoId: null,
      sourceBuildId: null,
    });
    saveMemoryEntry(s.db, {
      agentId: CHIEF_AGENT,
      teamId: s.team.id,
      title: 'site font',
      content: 'serif',
      projectId: other,
      sourceTodoId: null,
      sourceBuildId: null,
    });
    const instruction = await chiefInstruction('plan the release', id);
    expect(instruction).toContain('deploy target：the Mac');
    expect(instruction).not.toContain('site font');
  });

  test('the claim payload agent memories are team-wide only, never another project', async () => {
    const id = await createProject('cairn');
    for (const [title, content, projectId] of [
      ['team rule', 'commits are English', null],
      ['cairn rule', 'deploys go to the Mac', id],
    ] as const) {
      saveMemoryEntry(s.db, {
        agentId: CHIEF_AGENT,
        teamId: s.team.id,
        title,
        content,
        projectId,
        sourceTodoId: null,
        sourceBuildId: null,
      });
    }
    const sent = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      content: 'plan the release',
      projectId: id,
    });
    expect(sent.status).toBe(201);
    const token = await enroll('rules-chief');
    seedRoute(s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: machineIdByName(s, 'rules-chief'),
    });
    const claimed = await claim(token);
    expect(claimed.agent?.memories).toEqual([
      { title: 'MEMORY.md', content: '- team rule：commits are English' },
      { title: '记忆文件', content: '0 个；用 memories 按需读取。' },
    ]);
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

  async function sendToCoordinator(content: string, projectId?: string): Promise<string> {
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/coordinator/messages`, {
      content,
      ...(projectId === undefined ? {} : { projectId }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { message: { id: string } }).message.id;
  }

  test('a scoped message steered into a running unscoped turn carries its project instructions', async () => {
    const id = await createProject('cairn');
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    const runningId = await sendToCoordinator('how is everything');
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, runningId))
      .run();
    await sendToCoordinator('plan the release', id);
    const pending = s.db.select().from(coordinatorInput).get();
    expect(pending?.stepId).toBe(runningId);
    expect(pending?.content).toContain('plan the release');
    expect(pending?.content).toContain(RULES);
  });

  test('a message steered into a turn already scoped to the same project does not repeat the instructions', async () => {
    const id = await createProject('cairn');
    await req(s.app, 'PATCH', `/api/projects/${id}`, { instructions: RULES });
    const runningId = await sendToCoordinator('plan the release', id);
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, runningId))
      .run();
    await sendToCoordinator('and the changelog', id);
    const pending = s.db.select().from(coordinatorInput).get();
    expect(pending?.content).toContain('and the changelog');
    expect(pending?.content).not.toContain(RULES);
  });
});
