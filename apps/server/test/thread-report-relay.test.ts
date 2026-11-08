import { type ClaimedStep, WORKER_REMOTE_TOOLS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { build as buildTable, step as stepTable } from '../src/db/schema.js';
import { workerRemoteTools } from '../src/services/machine-claim.js';
import { bootServer, issueApiKey, postProject, seedSessionRoute } from './helpers.js';

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

async function world() {
  const s = bootServer({ claimHoldMs: 250 });
  const plain = await issueApiKey(s);
  const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: plain,
    body: { teamId: s.team.id, name: 'report-line', cliVersion: '0.1.0' },
  });
  const { token } = (await enroll.json()) as { token: string };
  seedSessionRoute(s, { provider: 'p', modelId: 'm' });
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'Report line task', spec: 'Do the work' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId] },
  });
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
  if (!step) throw new Error('no step claimed');
  return { s, token, step };
}

function relay(app: Hono, token: string, stepId: string, params: Record<string, unknown>) {
  return call(app, 'POST', `/api/machine/tool/${stepId}`, {
    cred: token,
    body: { name: 'thread_report', params },
  });
}

describe('thread_report relay tool', () => {
  test('only session steps carry the tool, for both repo types', () => {
    for (const github of [false, true]) {
      expect(workerRemoteTools('session', github, true).map((t) => t.name)).toContain(
        'thread_report',
      );
      for (const kind of ['plan', 'build', 'merge', 'review', 'verify'] as const) {
        expect(workerRemoteTools(kind, github, true).map((t) => t.name)).not.toContain(
          'thread_report',
        );
      }
    }
    expect(WORKER_REMOTE_TOOLS.map((t) => t.name)).not.toContain('thread_report');
  });

  test('a claimed session step lists thread_report and the relay stores the line on the build', async () => {
    const { s, token, step } = await world();
    expect(step.step.kind).toBe('session');
    expect(step.remoteTools?.map((t) => t.name)).toContain('thread_report');
    const res = await relay(s.app, token, step.step.id, { line: 'Export added;\n tests pass.' });
    expect(res.status).toBe(200);
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine,
    ).toBe('Export added; tests pass.');
    s.dispose();
  });

  test('an over-long or blank line is a 400 and stores nothing', async () => {
    const { s, token, step } = await world();
    expect((await relay(s.app, token, step.step.id, { line: 'x'.repeat(201) })).status).toBe(400);
    expect((await relay(s.app, token, step.step.id, { line: ' ' })).status).toBe(400);
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine,
    ).toBeNull();
    s.dispose();
  });

  test('a call on a step that is no longer claimed is a 409 and stores nothing', async () => {
    const { s, token, step } = await world();
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, step.step.id)).run();
    const res = await relay(s.app, token, step.step.id, { line: 'late word' });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('thread_report requires a currently claimed step');
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine,
    ).toBeNull();
    s.dispose();
  });
});
