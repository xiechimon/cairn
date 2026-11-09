import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { machine, step } from '../src/db/schema.js';
import { claimStep } from '../src/services/machine-claim.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
  startLegacyBuild,
} from './helpers.js';

const path = '/api/server/deploy/lease';
const lease = { owner: '00000000-0000-4000-8000-000000000001', ttlMs: 60_000 };

test('lease persists across app recreation and only its owner can release it', async () => {
  const s = bootServer();
  expect((await req(s.app, 'PUT', path, lease)).status).toBe(200);
  const restarted = bootServer({ db: s.db });
  expect(await (await req(restarted.app, 'GET', path)).json()).toMatchObject({
    owner: lease.owner,
    status: 'draining',
  });
  expect(
    (
      await req(restarted.app, 'PUT', path, {
        ...lease,
        owner: '00000000-0000-4000-8000-000000000002',
      })
    ).status,
  ).toBe(409);
  expect(
    (await req(restarted.app, 'DELETE', path, { owner: '00000000-0000-4000-8000-000000000002' }))
      .status,
  ).toBe(409);
  expect((await req(restarted.app, 'DELETE', path, { owner: lease.owner })).status).toBe(200);
  expect(await (await req(restarted.app, 'GET', path)).json()).toMatchObject({
    status: 'accepting',
  });
});

test('expired leases resume claims and can be replaced without releasing the replacement', async () => {
  const s = bootServer();
  expect((await req(s.app, 'PUT', path, { ...lease, ttlMs: 1 })).status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(await (await req(s.app, 'GET', path)).json()).toMatchObject({ status: 'accepting' });
  expect(
    (await req(s.app, 'PUT', path, { ...lease, owner: '00000000-0000-4000-8000-000000000003' }))
      .status,
  ).toBe(200);
  expect((await req(s.app, 'DELETE', path, { owner: lease.owner })).status).toBe(409);
});

test('lease management requires owner authentication and validates bounds', async () => {
  const s = bootServer({ authToken: 'fixture-owner' });
  expect((await req(s.app, 'PUT', path, lease)).status).toBe(401);
  const invalid = await s.app.request(path, {
    method: 'PUT',
    headers: { authorization: 'Bearer fixture-owner', 'content-type': 'application/json' },
    body: JSON.stringify({ owner: '', ttlMs: 0 }),
  });
  expect(invalid.status).toBe(400);
});

async function claimWorld() {
  const s = bootServer();
  const machineId = insertMachine(s);
  seedSessionRoute(s, { machineId, provider: 'stub-gw', modelId: 'stub-model' });
  const projectId = await postProject(s.app, 'drain-probe');
  const enqueue = async () => {
    const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Drain probe',
      spec: 'Keep queued work pending while deployment drains.',
    });
    expect(response.status).toBe(201);
    const todo = (await response.json()) as { id: string };
    return startLegacyBuild(s, todo.id, { withPlan: true });
  };
  const claim = (holdMs = 0) =>
    claimStep(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      machineId,
      s.team.id,
      holdMs,
      'http://localhost',
    );
  return { s, machineId, enqueue, claim };
}

test('new claims pause while existing work finishes, then resume without changing runtime configuration', async () => {
  const { s, machineId, enqueue, claim } = await claimWorld();
  await enqueue();
  const first = await claim();
  expect(first).not.toBeNull();
  const before = s.db.select().from(machine).where(eq(machine.id, machineId)).get()!;
  await req(s.app, 'PUT', path, lease);
  await enqueue();
  s.db.update(step).set({ status: 'done' }).where(eq(step.id, first!.step.id)).run();
  expect(await claim()).toBeNull();
  await req(s.app, 'DELETE', path, { owner: lease.owner });
  expect(await claim()).not.toBeNull();
  expect(
    s.db.select().from(machine).where(eq(machine.id, machineId)).get()?.enabledRuntimes,
  ).toEqual(before.enabledRuntimes);
});

test('a pending long poll rechecks the drain lease after waking', async () => {
  const { s, enqueue, claim } = await claimWorld();
  const pending = claim(1000);
  await req(s.app, 'PUT', path, lease);
  await enqueue();
  s.machineHub.wake(s.team.id);
  expect(await pending).toBeNull();
  await req(s.app, 'DELETE', path, { owner: lease.owner });
  expect(await claim()).not.toBeNull();
});
