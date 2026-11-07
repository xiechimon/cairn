import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { build as buildTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  req,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

function call(
  app: TestServer['app'],
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

interface World {
  s: TestServer;
  tokenA: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'unassigned-mbp', cliVersion: '0.1.0' },
  });
  expect(res.status).toBe(200);
  const token = ((await res.json()) as { token: string }).token;
  const projectId = await postProject(s.app, 'unassigned-proj');
  return { s, tokenA: token, projectId };
}

async function createTodo(w: World): Promise<string> {
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: '',
    spec: 'unassigned probe',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(w: World, todoId: string): Promise<string> {
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

async function claim(w: World): Promise<ClaimedStep | null> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
    cred: w.tokenA,
    body: {},
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

function stepRowOf(s: TestServer, buildId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
}

function expectFailedFunnel(s: TestServer, buildId: string, todoId: string, rootNeedle: string) {
  const stepRow = stepRowOf(s, buildId);
  expect(stepRow.status).toBe('failed');
  const buildRow = s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  expect(buildRow.errorMessage).toContain(rootNeedle);
  const todoRow = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  expect(todoRow.phase).toBe('failed');
}

describe('#1104 B: a step with no session routing rule ends failed at the claim surface', () => {
  test('failure mode 2: REST without a session routing rule -> 201 queued; ends failed after claim; a seeded rule unblocks the next step', async () => {
    const w = await setupWorld();
    const unroutedId = await createTodo(w);
    const buildId = await startBuild(w, unroutedId);

    expect(await claim(w)).toBeNull();
    expectFailedFunnel(w.s, buildId, unroutedId, 'no session routing rule');

    seedSessionRoute(w.s, { provider: 'stub-gw', modelId: 'stub-model' });
    const routedId = await createTodo(w);
    await startBuild(w, routedId);
    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('session');
  });

  test('failure mode 3: a scheduled trigger of an unrouted todo -> the same funnel', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w);
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });
    scheduler.start();
    try {
      const at = new Date('2026-10-01T00:00:00+08:00').getTime();
      const res = await req(w.s.app, 'POST', '/api/schedules', { todoId, kind: 'once', at });
      expect(res.status).toBe(201);
      scheduler.tick();
      const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).get()!;
      expect(buildRow.triggerSource).toBe('schedule');

      await claim(w);
      expectFailedFunnel(w.s, buildRow.id, todoId, 'no session routing rule');
    } finally {
      scheduler.stop();
    }
  });
});
