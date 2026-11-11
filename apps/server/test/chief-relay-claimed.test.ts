import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import { bootServer, issueApiKey, seedRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_ID = 'agent-relay-claimed';

async function enroll(s: TestServer, name: string) {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await issueApiKey(s)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(readyMachine({ teamId: s.team.id, name, cliVersion: '99.0.0' })),
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const id = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get()!.id;
  return { id, token };
}

async function setup() {
  const s = bootServer({ claimHoldMs: 10 });
  disposables.push(() => s.dispose());
  const owner = await enroll(s, 'relay-owner');
  const other = await enroll(s, 'relay-other');
  seedRoute(s, 'coordinator', {
    id: AGENT_ID,
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: owner.id,
  });
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      charter: '',
      createdAt: 1,
    })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: 'chief-relay-thread',
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'relay',
      createdAt: 1,
      updatedAt: 1,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 1,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: null,
      archivedAt: 1,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: 'step-relay',
      buildId: 'chief-relay-thread',
      kind: 'chief',
      machineId: null,
      status: 'pending',
      prompt: 'status?',
      createdAt: 2,
    })
    .run();
  const claimed = await claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    owner.id,
    s.team.id,
    10,
    'http://localhost',
  );
  expect(claimed?.step.id).toBe('step-relay');
  return { s, owner, other };
}

function relay(s: TestServer, token: string) {
  return s.app.request('/api/machine/tool/step-relay', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'projects', params: {} }),
  });
}

function setStep(s: TestServer, values: Partial<typeof stepTable.$inferInsert>) {
  s.db.update(stepTable).set(values).where(eq(stepTable.id, 'step-relay')).run();
}

describe('Coordinator tool relay runs only for the machine holding a claimed turn', () => {
  test('the claiming machine can call a Coordinator tool', async () => {
    const { s, owner } = await setup();
    expect((await relay(s, owner.token)).status).toBe(200);
  });

  test('a finished turn no longer runs Coordinator tools', async () => {
    const { s, owner } = await setup();
    setStep(s, { status: 'done', finishedAt: 3 });
    expect((await relay(s, owner.token)).status).toBe(409);
  });

  test('a failed turn no longer runs Coordinator tools', async () => {
    const { s, owner } = await setup();
    setStep(s, { status: 'failed', finishedAt: 3 });
    expect((await relay(s, owner.token)).status).toBe(409);
  });

  test('a released turn cannot be used by the machine that held it', async () => {
    const { s, owner } = await setup();
    setStep(s, { status: 'pending', machineId: null });
    expect((await relay(s, owner.token)).status).toBe(404);
  });

  test('another machine cannot use a turn it does not hold', async () => {
    const { s, other } = await setup();
    expect((await relay(s, other.token)).status).toBe(404);
  });
});
