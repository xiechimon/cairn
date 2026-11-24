import { type ClaimedStep, WORKER_REMOTE_TOOLS_GITHUB } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { workerRemoteTools } from '../src/services/machine-claim.js';
import { githubFake } from './fakes/github.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer, issueApiKey, postProject, seedSessionRoute } from './helpers.js';

const REPO = 'owner/repo';
afterEach(() => vi.restoreAllMocks());

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

async function world(repoKind: 'github' | 'local' = 'github') {
  const s = bootServer({
    claimHoldMs: 250,
    githubFetch: githubFake(REPO, { repositoryId: 4242 }).impl,
  });
  const plain = await issueApiKey(s);
  const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: plain,
    body: readyMachine({ teamId: s.team.id, name: 'duplicate', cliVersion: '0.1.0' }),
  });
  const { token } = (await enroll.json()) as { token: string };
  seedSessionRoute(s, { provider: 'p', modelId: 'm' });
  const projectId = await postProject(s.app);
  if (repoKind === 'github') {
    stubGithubApp(null);
    s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: REPO })
      .where(eq(projectTable.id, projectId))
      .run();
  }
  const original = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'Original task', spec: 'Do the work' },
  });
  const { id: originalId } = (await original.json()) as { id: string };
  const copy = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'Copy task', spec: 'Do the same work' },
  });
  const { id: copyId } = (await copy.json()) as { id: string };
  await call(s.app, 'POST', `/api/projects/${projectId}/builds`, { body: { todoIds: [copyId] } });
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
  if (!step) throw new Error('no step claimed');
  const todoOf = (id: string) => s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()!;
  return { s, token, step, originalId, copyId, todoOf };
}

function relay(app: Hono, token: string, stepId: string, params: Record<string, unknown>) {
  return call(app, 'POST', `/api/machine/tool/${stepId}`, {
    cred: token,
    body: { name: 'close_as_duplicate', params },
  });
}

describe('close_as_duplicate worker tool', () => {
  test('only session steps of a GitHub project are offered it', () => {
    expect(workerRemoteTools('session', true, true).map((t) => t.name)).toContain(
      'close_as_duplicate',
    );
    expect(workerRemoteTools('session', false, true).map((t) => t.name)).not.toContain(
      'close_as_duplicate',
    );
    for (const kind of ['plan', 'build', 'merge', 'review', 'verify'] as const) {
      expect(workerRemoteTools(kind, true, true).map((t) => t.name)).not.toContain(
        'close_as_duplicate',
      );
    }
    expect(WORKER_REMOTE_TOOLS_GITHUB.map((t) => t.name)).not.toContain('close_as_duplicate');
  });

  test('a duplicate of another task writes the line, closes the todo as superseded and stops the step', async () => {
    const { s, token, step, originalId, copyId, todoOf } = await world();
    const original = todoOf(originalId);
    const res = await relay(s.app, token, step.step.id, {
      source: 'task',
      number: original.seqNum,
    });
    expect(res.status).toBe(200);
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine,
    ).toBe(`与 #${original.seqNum} 重复，已停`);
    expect(todoOf(copyId)).toMatchObject({ phase: 'closed', supersededBy: originalId });
    expect(todoOf(originalId).phase).not.toBe('closed');
    s.dispose();
  });

  test('a duplicate of a GitHub item closes the todo with a line that names GitHub', async () => {
    const { s, token, step, copyId, todoOf } = await world();
    const res = await relay(s.app, token, step.step.id, { source: 'github', number: 4242 });
    expect(res.status).toBe(200);
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine,
    ).toBe('与 GitHub #4242 重复，已停');
    expect(todoOf(copyId)).toMatchObject({ phase: 'closed', supersededBy: null });
    s.dispose();
  });

  test('its own number, an unknown task, a bad number and a step that is no longer claimed change nothing', async () => {
    const { s, token, step, copyId, todoOf } = await world();
    const own = todoOf(copyId).seqNum;
    for (const params of [
      { source: 'task', number: own },
      { source: 'task', number: 99_999 },
      { source: 'task', number: 0 },
      { source: 'other', number: 1 },
    ]) {
      expect((await relay(s.app, token, step.step.id, params)).status).toBe(400);
    }
    expect(todoOf(copyId).phase).not.toBe('closed');
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, step.step.id)).run();
    expect((await relay(s.app, token, step.step.id, { source: 'github', number: 1 })).status).toBe(
      409,
    );
    expect(todoOf(copyId).phase).not.toBe('closed');
    s.dispose();
  });

  test('a project without GitHub access is refused by name even though the daemon never offers it', async () => {
    const { s, token, step, copyId, todoOf } = await world('local');
    expect((await relay(s.app, token, step.step.id, { source: 'github', number: 7 })).status).toBe(
      409,
    );
    expect(todoOf(copyId).phase).not.toBe('closed');
    s.dispose();
  });

  test("the task's own source issue and its own pull request are not duplicates", async () => {
    const { s, token, step, copyId, todoOf } = await world();
    s.db
      .update(todoTable)
      .set({ sourceRef: 'github:owner/repo#77' })
      .where(eq(todoTable.id, copyId))
      .run();
    s.db.update(buildTable).set({ prNumber: 88 }).where(eq(buildTable.id, step.step.buildId)).run();
    for (const number of [77, 88]) {
      expect((await relay(s.app, token, step.step.id, { source: 'github', number })).status).toBe(
        400,
      );
    }
    expect(todoOf(copyId).phase).not.toBe('closed');
    s.dispose();
  });

  test('an original that is already closed is not a duplicate target, so twins cannot close each other', async () => {
    const { s, token, step, originalId, copyId, todoOf } = await world();
    s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, originalId)).run();
    const res = await relay(s.app, token, step.step.id, {
      source: 'task',
      number: todoOf(originalId).seqNum,
    });
    expect(res.status).toBe(409);
    expect(todoOf(copyId).phase).not.toBe('closed');
    s.dispose();
  });

  test('a second call on an already closed todo changes neither the report line nor supersededBy', async () => {
    const { s, token, step, originalId, copyId, todoOf } = await world();
    const reportLine = () =>
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine;
    const first = await relay(s.app, token, step.step.id, {
      source: 'task',
      number: todoOf(originalId).seqNum,
    });
    expect(first.status).toBe(200);
    s.db.update(stepTable).set({ status: 'claimed' }).where(eq(stepTable.id, step.step.id)).run();
    const again = await relay(s.app, token, step.step.id, { source: 'github', number: 4242 });
    expect(again.status).toBe(409);
    expect(reportLine()).toBe(`与 #${todoOf(originalId).seqNum} 重复，已停`);
    expect(todoOf(copyId)).toMatchObject({ phase: 'closed', supersededBy: originalId });
    s.dispose();
  });

  test('a done todo keeps its report line and phase', async () => {
    const { s, token, step, copyId, todoOf } = await world();
    s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, copyId)).run();
    const before = s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, step.step.buildId))
      .get()!.reportLine;
    expect((await relay(s.app, token, step.step.id, { source: 'github', number: 5 })).status).toBe(
      409,
    );
    expect(todoOf(copyId).phase).toBe('done');
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine,
    ).toBe(before);
    s.dispose();
  });

  test('a task of another project is not a duplicate target', async () => {
    const { s, token, step, copyId, todoOf } = await world();
    const otherProject = await postProject(s.app, 'other');
    const foreign = await call(s.app, 'POST', `/api/projects/${otherProject}/todos`, {
      body: { title: 'Foreign', spec: 'Elsewhere' },
    });
    const { id: foreignId } = (await foreign.json()) as { id: string };
    const res = await relay(s.app, token, step.step.id, {
      source: 'task',
      number: todoOf(foreignId).seqNum,
    });
    expect(res.status).toBe(400);
    expect(todoOf(copyId)).toMatchObject({ supersededBy: null });
    expect(todoOf(copyId).phase).not.toBe('closed');
    s.dispose();
  });

  test('thread_report cannot overwrite the line once the task is closed as a duplicate', async () => {
    const { s, token, step, originalId, todoOf } = await world();
    const number = todoOf(originalId).seqNum;
    await relay(s.app, token, step.step.id, { source: 'task', number });
    s.db.update(stepTable).set({ status: 'claimed' }).where(eq(stepTable.id, step.step.id)).run();
    const res = await call(s.app, 'POST', `/api/machine/tool/${step.step.id}`, {
      cred: token,
      body: { name: 'thread_report', params: { line: 'all done' } },
    });
    expect(res.status).toBe(409);
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, step.step.buildId)).get()!.reportLine,
    ).toBe(`与 #${number} 重复，已停`);
    s.dispose();
  });
});
