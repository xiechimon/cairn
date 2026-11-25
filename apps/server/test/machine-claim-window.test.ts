import type { MachineCapabilities } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { machine as machineTable, step as stepTable } from '../src/db/schema.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { bootServer, issueApiKey, seedSessionRoute, startLegacyBuild } from './helpers.js';

vi.mock('@cairn/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cairn/shared')>()),
  MIN_SUPPORTED_RUNNER_PROTOCOL: 1,
}));

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'x-cairn-raw-send': '1' };
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const OUTDATED: MachineCapabilities = { mcpServers: [], skills: [] };

async function windowWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enroll = async (name: string, capabilities: MachineCapabilities) => {
    const res = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.2.3', capabilities }),
    });
    const { token } = (await res.json()) as { token: string };
    await call(s.app, 'POST', '/api/machine/presence', {
      cred: token,
      body: { cliVersion: '0.2.3', capabilities },
    });
    const id = s.db
      .select({ id: machineTable.id })
      .from(machineTable)
      .where(eq(machineTable.name, name))
      .get()!.id;
    return { token, id };
  };
  const outdated = await enroll('outdated-runner', {
    ...OUTDATED,
    runnerProtocolVersion: -1,
  } as unknown as MachineCapabilities);
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'm', machineId: outdated.id });
  const project = (await (
    await call(s.app, 'POST', '/api/projects', { body: { name: 'window', repoKind: 'hosted' } })
  ).json()) as { id: string };
  const todo = (await (
    await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
      body: { title: 'window', spec: 'runner below the floor' },
    })
  ).json()) as { id: string };
  startLegacyBuild(s, todo.id, { withPlan: true });
  const stepRow = () => s.db.select().from(stepTable).get()!;
  return { s, enroll, outdated, stepRow };
}

describe('a runner below the supported protocol', () => {
  test('is refused before claiming, and the step waits saying the runner needs a Cairn update', async () => {
    const w = await windowWorld();
    const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.outdated.token,
      body: { verifyAttachments: true },
    });
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ code: 'runner-out-of-window' });
    const row = w.stepRow();
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    const queue = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: row.id,
      createdAt: row.createdAt,
      homeMachineId: w.outdated.id,
    });
    expect(queue?.blocked?.kind).toBe('runner-outdated');
    const machine = w.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, w.outdated.id))
      .get();
    expect(machine?.online).toBe(true);
  });

  test('still finishes a step it already holds', async () => {
    const w = await windowWorld();
    const stepId = w.stepRow().id;
    w.s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId: w.outdated.id, claimedAt: Date.now() })
      .where(eq(stepTable.id, stepId))
      .run();
    const heartbeat = await call(w.s.app, 'POST', `/api/machine/heartbeat/${stepId}`, {
      cred: w.outdated.token,
      body: {},
    });
    expect(heartbeat.status).toBe(200);
    const done = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.outdated.token,
      body: { status: 'failed', errorMessage: 'agent exited' },
    });
    expect(done.status).toBe(200);
    expect(w.stepRow().status).toBe('failed');
  });
});
