import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { agent, step } from '../src/db/schema.js';
import { enqueueStep } from '../src/services/builds.js';
import {
  bindAgentHome,
  bindAllAgents,
  bootServer,
  issueApiKey,
  machineIdByName,
  req,
  type TestServer,
} from './helpers.js';

let s: TestServer;
let token: string;

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

async function claim(
  as: string = token,
): Promise<{ id: string; projectId: string | undefined } | null> {
  const res = await s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${as}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: unknown };
  if (body.step === null) return null;
  const parsed = claimedStepSchema.parse(body.step);
  return { id: parsed.step.id, projectId: parsed.project?.id };
}

async function createProject(name: string, maxConcurrent?: number | null): Promise<string> {
  const res = await req(s.app, 'POST', '/api/projects', { name });
  const { id } = (await res.json()) as { id: string };
  if (maxConcurrent !== undefined) {
    const patched = await req(s.app, 'PATCH', `/api/projects/${id}`, { maxConcurrent });
    expect(patched.status).toBe(200);
  }
  return id;
}

async function startBuild(projectId: string, title: string, agentId = 'cc-agent'): Promise<string> {
  const task = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title, spec: title })
  ).json()) as { id: string };
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [task.id],
    withPlan: false,
    assignment: { plan: null, build: { agentId } },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

beforeEach(async () => {
  s = bootServer();
  token = await enroll('cc-builder');
  s.db
    .insert(agent)
    .values({ id: 'cc-agent', teamId: s.team.id, displayName: 'Builder', modelId: 'stub-model' })
    .run();
  bindAllAgents(s);
});

describe('project concurrency (D74 P4)', () => {
  test('maxConcurrent is stored and returned, and null removes the limit', async () => {
    const id = await createProject('serial', 1);
    expect(await (await req(s.app, 'GET', '/api/projects')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, maxConcurrent: 1 })]),
    );
    const cleared = await req(s.app, 'PATCH', `/api/projects/${id}`, { maxConcurrent: null });
    expect(await cleared.json()).not.toHaveProperty('maxConcurrent');
    const bad = await req(s.app, 'PATCH', `/api/projects/${id}`, { maxConcurrent: 0 });
    expect(bad.status).toBe(400);
  });

  test('a serial project runs one thread at a time while other projects keep going', async () => {
    const serial = await createProject('serial', 1);
    const open = await createProject('open');
    await startBuild(serial, 'first');
    await startBuild(serial, 'second');
    await startBuild(open, 'elsewhere');
    const first = await claim();
    expect(first?.projectId).toBe(serial);
    const next = await claim();
    expect(next?.projectId).toBe(open);
    expect(await claim()).toBeNull();
  });

  test('a person message to a full project takes one reserved slot and goes first', async () => {
    const serial = await createProject('serial', 1);
    await startBuild(serial, 'first');
    const queuedBuild = await startBuild(serial, 'second');
    expect((await claim())?.projectId).toBe(serial);
    const humanStep = enqueueStep(
      { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user },
      queuedBuild,
      'build',
      s.team.id,
      'please also update the docs',
      false,
      true,
    );
    const reserved = await claim();
    expect(reserved?.id).toBe(humanStep.id);
    expect(await claim()).toBeNull();
    expect(s.db.select().from(step).where(eq(step.id, humanStep.id)).get()?.byPerson).toBe(true);
  });

  test('two machines claiming different steps of a serial project at once admit only one', async () => {
    const otherToken = await enroll('cc-builder-2');
    s.db
      .insert(agent)
      .values({
        id: 'cc-agent-2',
        teamId: s.team.id,
        displayName: 'Builder 2',
        modelId: 'stub-model',
      })
      .run();
    bindAgentHome(s, 'cc-agent', machineIdByName(s, 'cc-builder'));
    bindAgentHome(s, 'cc-agent-2', machineIdByName(s, 'cc-builder-2'));
    const serial = await createProject('serial', 1);
    await startBuild(serial, 'first', 'cc-agent');
    await startBuild(serial, 'second', 'cc-agent-2');
    const results = await Promise.all([claim(), claim(otherToken)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(
      s.db
        .select()
        .from(step)
        .all()
        .filter((row) => row.status === 'claimed' && row.kind === 'build'),
    ).toHaveLength(1);
  });
});
