import { randomUUID } from 'node:crypto';
import type { ConfinementReport } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { build, chief, chiefThread, machine, step, todo } from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import * as shipGate from '../src/services/ship-gate.js';
import { bootServer, issueApiKey, postProject, seedRoute, seedSessionRoute } from './helpers.js';

async function world(osPlatform: string | null = 'linux', capabilities?: unknown) {
  const s = bootServer({ claimHoldMs: 1 });
  const key = await issueApiKey(s);
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'availability', capabilities }),
  });
  expect(enrolled.status).toBe(200);
  const { machineId, token } = (await enrolled.json()) as { machineId: string; token: string };
  const report: ConfinementReport = {
    state: 'checking',
    invocation: randomUUID(),
    generation: 1,
    revision: 1,
  };
  const presence = (confinement: unknown, platform = osPlatform) =>
    s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          mcpServers: [],
          skills: [],
          osPlatform: platform ?? undefined,
          confinement,
        },
      }),
    });
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  const claim = (identity: { generation: number; invocation: string } | null = report, hold = 1) =>
    claimStep(deps, machineId, s.team.id, hold, 'http://localhost', undefined, {
      confinement: identity ?? undefined,
    });
  const projectId = await postProject(s.app);
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub', machineId });
  s.db
    .insert(todo)
    .values({
      id: 'todo-availability',
      teamId: s.team.id,
      projectId,
      seqNum: 1,
      title: 'availability',
      phase: 'queued',
      phaseAt: 1,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build-availability',
      todoId: 'todo-availability',
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  const enqueue = () =>
    s.db
      .insert(step)
      .values({
        id: 'step-availability',
        buildId: 'build-availability',
        kind: 'build',
        status: 'pending',
        createdAt: 1,
      })
      .run();
  const read = () => s.db.select().from(machine).where(eq(machine.id, machineId)).get()!;
  return { s, report, presence, claim, enqueue, read, machineId, token, key };
}

test('old macOS daemon without platform or confinement report still claims', async () => {
  const w = await world(null);
  const response = await w.s.app.request('/api/machine/presence', {
    method: 'POST',
    headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ capabilities: { mcpServers: [], skills: [] } }),
  });
  expect(response.status).toBe(200);
  w.enqueue();
  expect((await w.claim(null))?.step.id).toBe('step-availability');
});

test('macOS not-applicable report still claims without a confinement identity', async () => {
  const w = await world('darwin');
  expect((await w.presence(w.report)).status).toBe(200);
  expect((await w.presence({ ...w.report, state: 'not-applicable', revision: 2 })).status).toBe(
    200,
  );
  w.enqueue();
  expect((await w.claim(null))?.step.id).toBe('step-availability');
});

test.each([undefined, { state: 'ready' }])(
  'Linux missing or malformed initial readiness refuses a claim: %j',
  async (report) => {
    const w = await world();
    expect((await w.presence(report)).status).toBe(200);
    w.enqueue();
    expect(await w.claim(null)).toBeNull();
    expect(w.s.db.select().from(step).get()?.status).toBe('pending');
    expect(w.read().capabilities).toMatchObject({ osPlatform: 'linux' });
  },
);

test('presence persists the handshake and rejects stale generations, revisions and competing invocations with 409', async () => {
  const w = await world();
  expect((await w.presence(w.report)).status).toBe(200);
  const ready = { ...w.report, state: 'ready', revision: 2 };
  expect((await w.presence(ready)).status).toBe(200);
  for (const stale of [
    w.report,
    ready,
    { ...ready, invocation: randomUUID(), revision: 3 },
    { ...ready, generation: 2 },
  ])
    expect((await w.presence(stale)).status).toBe(409);
  expect(w.read()).toMatchObject({
    online: true,
    enabledRuntimes: ['pi'],
    capabilities: { confinement: ready },
  });
  expect((await w.presence({ ...w.report, generation: 2, invocation: randomUUID() })).status).toBe(
    200,
  );
  expect((await w.presence({ ...ready, revision: 99 })).status).toBe(409);
});

test.each([undefined, { state: 'ready' }])(
  'missing or malformed report revokes readiness and keeps its generation fence: %j',
  async (bad) => {
    const w = await world();
    await w.presence(w.report);
    await w.presence({ ...w.report, state: 'ready', revision: 2 });
    await w.presence(bad);
    w.enqueue();
    expect(await w.claim()).toBeNull();
    expect(w.read().capabilities?.confinement).toMatchObject({ state: 'checking', generation: 1 });
  },
);

test('worker waits remain pending across recheck and refuse an older invocation after the wait', async () => {
  const w = await world();
  await w.presence(w.report);
  await w.presence({ ...w.report, state: 'ready', revision: 2 });
  const waiting = w.claim(w.report, 1000);
  await Promise.resolve();
  await w.presence({ ...w.report, invocation: randomUUID(), generation: 2 });
  w.enqueue();
  w.s.machineHub.wake(w.s.team.id);
  expect(await waiting).toBeNull();
  expect(w.s.db.select().from(step).get()?.status).toBe('pending');
});

test('worker rechecks readiness after asynchronous ship verification before any claim mutation', async () => {
  const w = await world();
  await w.presence(w.report);
  await w.presence({ ...w.report, state: 'ready', revision: 2 });
  w.enqueue();
  const spy = vi.spyOn(shipGate, 'reverifyShip').mockImplementationOnce(async () => {
    await w.presence({ ...w.report, state: 'unavailable', reason: 'startup-failed', revision: 3 });
    return null;
  });
  try {
    expect(await w.claim()).toBeNull();
    expect(spy).toHaveBeenCalled();
    expect(w.s.db.select().from(step).get()?.status).toBe('pending');
  } finally {
    spy.mockRestore();
  }
});

test.each([
  ['linux', 'ready'],
  ['darwin', 'not-applicable'],
] as const)('%s worker and chief dispatch with %s', async (platform, state) => {
  const w = await world(platform);
  await w.presence(w.report);
  w.enqueue();
  if (platform === 'linux') expect(await w.claim()).toBeNull();
  await w.presence({ ...w.report, state, revision: 2 });
  if (platform === 'linux') expect(await w.claim(null)).toBeNull();
  expect((await w.claim(w.report))?.step.id).toBe('step-availability');
  seedRoute(w.s, 'coordinator', { provider: 'stub-gw', modelId: 'stub', machineId: w.machineId });
  w.s.db
    .insert(chief)
    .values({
      id: 'chief-availability',
      userId: w.s.user.id,
      teamId: w.s.team.id,
      charter: '',
      createdAt: 2,
    })
    .run();
  w.s.db
    .insert(chiefThread)
    .values({
      id: 'thread-availability',
      chiefId: 'chief-availability',
      userId: w.s.user.id,
      teamId: w.s.team.id,
      title: 'availability',
      createdAt: 2,
      updatedAt: 2,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 2,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
  w.s.db
    .insert(step)
    .values({
      id: 'chief-step-availability',
      buildId: 'thread-availability',
      kind: 'chief',
      status: 'pending',
      createdAt: 2,
    })
    .run();
  await w.presence({ ...w.report, state: 'checking', revision: 3 });
  if (platform === 'linux') expect(await w.claim()).toBeNull();
  await w.presence({ ...w.report, state, revision: 4 });
  expect((await w.claim())?.step.id).toBe('chief-step-availability');
});

test.each([undefined, { state: 'ready' }])(
  'Linux readiness stays revoked when a later report also omits the platform: %j',
  async (bad) => {
    const w = await world();
    await w.presence(w.report);
    await w.presence({ ...w.report, state: 'ready', revision: 2 });
    expect((await w.presence(bad, null)).status).toBe(200);
    w.enqueue();
    expect(await w.claim()).toBeNull();
    expect(w.read().capabilities).toMatchObject({
      osPlatform: 'linux',
      confinement: { state: 'checking', generation: 1 },
    });
  },
);

test('non-enforcing ready fixture can enroll and claim without a Linux handshake', async () => {
  const w = await world(null, readyMachine({}).capabilities);
  w.enqueue();
  expect((await w.claim(null))?.step.id).toBe('step-availability');
});

test.each([undefined, 'darwin', 'other'] as const)(
  'non-enforcing %s report never prevents credential rotation on re-enrollment',
  async (osPlatform) => {
    const capabilities = readyMachine({
      capabilities: { mcpServers: [], skills: [], osPlatform },
    }).capabilities;
    const w = await world(osPlatform ?? null, capabilities);
    const response = await w.s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${w.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: w.s.team.id, name: 'availability', capabilities }),
    });
    expect(response.status).toBe(200);
    const rotated = (await response.json()) as { machineId: string; token: string };
    expect(rotated.machineId).toBe(w.machineId);
    expect(rotated.token).not.toBe(w.token);
    w.enqueue();
    expect((await w.claim(null))?.step.id).toBe('step-availability');
  },
);
