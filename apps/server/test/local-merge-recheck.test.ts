import type { LocalMergeCommand } from '@cairn/shared';
import { machineEnrollResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { build, project, step, todo } from '../src/db/schema.js';
import { bootServer, issueApiKey } from './helpers.js';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred !== undefined) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

const command: LocalMergeCommand = {
  projectId: 'project',
  buildId: 'build',
  defaultBranch: 'main',
  workBranch: 'cairn/conv-build',
  judgedBase: 'b'.repeat(40),
  judgedHead: 'a'.repeat(40),
  judgedPatchDigest: `pd2:${'c'.repeat(64)}`,
  localChecks: ['true'],
  message: 'Merge',
  identity: { name: 'Cairn', email: 'cairn@localhost' },
};

interface World {
  s: ReturnType<typeof bootServer>;
  token: string;
  machineId: string;
  otherToken: string;
  recheck(body?: unknown, cred?: string): Promise<Response>;
}

async function world(): Promise<World> {
  const s = bootServer();
  async function enroll(name: string): Promise<{ token: string; machineId: string }> {
    const res = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: await issueApiKey(s),
      body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
    });
    expect(res.status).toBe(200);
    const row = machineEnrollResponseSchema.parse(await res.json());
    return { token: row.token, machineId: row.machineId };
  }
  const runner = await enroll('runner');
  const other = await enroll('other');
  s.db
    .insert(project)
    .values({
      id: 'project',
      teamId: s.team.id,
      name: 'local',
      repoKind: 'local',
      autonomy: { localChecks: ['true'] },
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 'todo',
      teamId: s.team.id,
      projectId: 'project',
      title: 'Task',
      phase: 'done',
      phaseAt: Date.now(),
      seqNum: 1,
      latestBuildId: 'build',
      hasChanges: true,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build',
      todoId: 'todo',
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now(),
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'merge',
      buildId: 'build',
      kind: 'merge',
      machineId: runner.machineId,
      status: 'claimed',
      claimedAt: Date.now(),
      createdAt: Date.now(),
      prompt: JSON.stringify({ kind: 'local-merge', command }),
    })
    .run();
  return {
    s,
    token: runner.token,
    machineId: runner.machineId,
    otherToken: other.token,
    recheck(body = { command }, cred = runner.token) {
      return call(s.app, 'POST', '/api/machine/local-merge-recheck/merge', { cred, body });
    },
  };
}

describe('the local merge landing re-check', () => {
  test('an unchanged world authorizes the landing', async () => {
    const w = await world();
    const res = await w.recheck();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: true });
  });

  test.each<[string, (w: World) => void, string]>([
    [
      'the task was archived',
      (w) => {
        w.s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, 'todo')).run();
      },
      'task-archived',
    ],
    [
      'a newer build superseded the judged one',
      (w) => {
        w.s.db.update(todo).set({ latestBuildId: 'newer' }).where(eq(todo.id, 'todo')).run();
      },
      'build-superseded',
    ],
    [
      'the task moved to another project',
      (w) => {
        w.s.db
          .insert(project)
          .values({ id: 'elsewhere', teamId: w.s.team.id, name: 'other', repoKind: 'local' })
          .run();
        w.s.db.update(todo).set({ projectId: 'elsewhere' }).where(eq(todo.id, 'todo')).run();
      },
      'task-moved',
    ],
    [
      'the task left review',
      (w) => {
        w.s.db.update(todo).set({ phase: 'closed' }).where(eq(todo.id, 'todo')).run();
      },
      'task-phase',
    ],
    [
      'the project stopped being a local repository',
      (w) => {
        w.s.db.update(project).set({ repoKind: 'hosted' }).where(eq(project.id, 'project')).run();
      },
      'project-target',
    ],
    [
      'the local checks changed',
      (w) => {
        w.s.db
          .update(project)
          .set({ autonomy: { localChecks: ['false'] } })
          .where(eq(project.id, 'project'))
          .run();
      },
      'checks-changed',
    ],
    [
      'the base branch changed',
      (w) => {
        w.s.db.update(project).set({ baseBranch: 'next' }).where(eq(project.id, 'project')).run();
      },
      'branch-changed',
    ],
  ])('%s refuses the landing', async (_name, mutate, reason) => {
    const w = await world();
    mutate(w);
    const res = await w.recheck();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: false, reason });
  });

  test('a released step refuses the landing', async () => {
    const w = await world();
    w.s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'merge')).run();
    const res = await w.recheck();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('not claimed') });
  });

  test('a command that differs from the claimed instruction refuses', async () => {
    const w = await world();
    const res = await w.recheck({ command: { ...command, judgedHead: 'd'.repeat(40) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: false, reason: 'command-mismatch' });
  });

  test('a step without a local-merge instruction refuses', async () => {
    const w = await world();
    w.s.db.update(step).set({ prompt: 'plain instruction' }).where(eq(step.id, 'merge')).run();
    const res = await w.recheck();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: false, reason: 'not-local-merge' });
  });

  test("another machine's step is not found", async () => {
    const w = await world();
    const res = await w.recheck(undefined, w.otherToken);
    expect(res.status).toBe(404);
  });

  test('a missing step is not found', async () => {
    const w = await world();
    const res = await call(w.s.app, 'POST', '/api/machine/local-merge-recheck/absent', {
      cred: w.token,
      body: { command },
    });
    expect(res.status).toBe(404);
  });
});
