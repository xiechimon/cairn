import { type ClaimedStep, claimedStepSchema, type MachineCapabilities } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { machine as machineTable, step as stepTable } from '../src/db/schema.js';
import { bootServer, issueApiKey, seedSessionRoute, startLegacyBuild } from './helpers.js';

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

async function runnerWorld(capabilities: MachineCapabilities) {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({
      teamId: s.team.id,
      name: 'skew-runner',
      cliVersion: '0.2.3',
      capabilities,
    }),
  });
  const { token } = (await enrolled.json()) as { token: string };
  const machineId = s.db.select({ id: machineTable.id }).from(machineTable).get()!.id;
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'm', machineId });
  const project = (await (
    await call(s.app, 'POST', '/api/projects', { body: { name: 'skew', repoKind: 'hosted' } })
  ).json()) as { id: string };
  const todo = (await (
    await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
      body: { title: 'skew', spec: 'protocol skew' },
    })
  ).json()) as { id: string };
  startLegacyBuild(s, todo.id, { withPlan: true });
  const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
    cred: token,
    body: { verifyAttachments: true },
  });
  const body = (await res.json()) as { step: ClaimedStep | null };
  if (body.step === null) throw new Error('claim returned no step');
  const claimed = claimedStepSchema.parse(body.step);
  const row = () => s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get();
  return { s, token, claimed, row };
}

describe('a runner older than the claim generation protocol', () => {
  test('runs a claimed step to completion against a newer server', async () => {
    const w = await runnerWorld({ mcpServers: [], skills: [] });
    const stepId = w.claimed.step.id;
    const heartbeat = await call(w.s.app, 'POST', `/api/machine/heartbeat/${stepId}`, {
      cred: w.token,
      body: {},
    });
    expect(heartbeat.status).toBe(200);
    const token = await call(w.s.app, 'GET', `/api/machine/token/${stepId}`, { cred: w.token });
    expect(token.status).toBe(200);
    const done = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'agent exited' },
    });
    expect(done.status).toBe(200);
    expect(w.row()?.status).toBe('failed');
  });

  test('a runner that speaks the protocol still has every unfenced call refused', async () => {
    const w = await runnerWorld({ mcpServers: [], skills: [], claimGeneration: true });
    const stepId = w.claimed.step.id;
    for (const [method, path, body] of [
      ['POST', `/api/machine/heartbeat/${stepId}`, {}],
      ['GET', `/api/machine/token/${stepId}`, undefined],
      ['POST', `/api/machine/done/${stepId}`, { status: 'failed', errorMessage: 'x' }],
    ] as const) {
      const res = await call(w.s.app, method, path, { cred: w.token, body });
      expect(res.status).toBe(409);
    }
    expect(w.row()?.status).toBe('claimed');
  });

  test('a runner rolled back to an older Cairn finishes the step it claimed before the rollback', async () => {
    const w = await runnerWorld({
      mcpServers: [],
      skills: [],
      claimGeneration: true,
      runnerProtocolVersion: 1,
    });
    const stepId = w.claimed.step.id;
    const presence = await call(w.s.app, 'POST', '/api/machine/presence', {
      cred: w.token,
      body: { cliVersion: '0.2.3', capabilities: { mcpServers: [], skills: [] } },
    });
    expect(presence.status).toBe(200);
    const done = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'agent exited' },
    });
    expect(done.status).toBe(200);
    expect(w.row()?.status).toBe('failed');
  });

  test('an older runner cannot report on a step that is no longer its own', async () => {
    const w = await runnerWorld({ mcpServers: [], skills: [] });
    const stepId = w.claimed.step.id;
    w.s.db
      .update(stepTable)
      .set({ status: 'pending', machineId: null })
      .where(eq(stepTable.id, stepId))
      .run();
    const done = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'late' },
    });
    expect(done.status).toBe(409);
    expect(w.row()?.status).toBe('pending');
  });
});
