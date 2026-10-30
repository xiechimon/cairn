import {
  conversationBranch,
  DEFAULT_AUTONOMY_SETTINGS,
  patchProjectMergeConfigSchema,
  patchTeamBodySchema,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import {
  autonomousMergeAdmission,
  build,
  message,
  project,
  step,
  team,
  todo,
} from '../src/db/schema.js';
import {
  autonomousMergePolicy,
  claimAutonomousMerge,
  recoverAutonomousMerges,
  settleAutonomousMerge,
} from '../src/services/autonomous-merge.js';
import {
  applyStoppedStep,
  failStepWithEvents,
  sweepAbandonedBuildSteps,
} from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { projectMergeConfigOf, updateProjectMergeConfig } from '../src/services/projects.js';
import { bootServer } from './helpers.js';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

function fixture() {
  const s = bootServer();
  s.db.update(team).set({ maxAutonomousMergesPerDay: 1 }).run();
  disposals.push(() => s.dispose());
  s.db
    .insert(project)
    .values({
      id: 'p',
      teamId: s.team.id,
      name: 'P',
      autonomy: DEFAULT_AUTONOMY_SETTINGS,
    })
    .run();
  for (const id of ['a', 'b']) {
    s.db
      .insert(todo)
      .values({
        id,
        teamId: s.team.id,
        projectId: 'p',
        title: id,
        seqNum: id === 'a' ? 1 : 2,
        phaseAt: 0,
      })
      .run();
    s.db
      .insert(build)
      .values({ id, todoId: id, withPlan: false, triggerSource: 'user', createdAt: 0 })
      .run();
  }
  const row = s.db.select().from(project).where(eq(project.id, 'p')).get();
  if (!row) throw new Error('missing project');
  return { s, config: projectMergeConfigOf(row) };
}

test('team cap schema rejects negative, fractional and infinite limits', () => {
  for (const value of [-1, 0.5, Infinity])
    expect(patchTeamBodySchema.safeParse({ maxAutonomousMergesPerDay: value }).success).toBe(false);
});

test('SQLite admission persists its claim and holds an unknown response across midnight', () => {
  const { s, config } = fixture();
  claimAutonomousMerge(s.db, 'a');
  expect(() => claimAutonomousMerge(s.db, 'b')).toThrow('daily-cap');
  expect(
    autonomousMergePolicy(s.db, s.team.id, config, Date.parse('2030-01-01T00:00:00Z'))
      .dailyCapReached,
  ).toBe(true);
  expect(() => claimAutonomousMerge(s.db, 'a')).toThrow('already admitted');
  expect(JSON.parse(String(s.db.select().from(message).get()?.content))).toMatchObject({
    state: 'pending',
    teamId: s.team.id,
  });
});

test('landed time rather than admission time determines the UTC day and refused requests release capacity', () => {
  const { s, config } = fixture();
  claimAutonomousMerge(s.db, 'a');
  settleAutonomousMerge(s.db, 'a', 'refused');
  claimAutonomousMerge(s.db, 'b');
  settleAutonomousMerge(s.db, 'b', 'merged', Date.parse('2030-01-01T23:59:59.999Z'));
  expect(
    autonomousMergePolicy(s.db, s.team.id, config, Date.parse('2030-01-01T23:59:59.999Z'))
      .dailyCapReached,
  ).toBe(true);
  expect(
    autonomousMergePolicy(s.db, s.team.id, config, Date.parse('2030-01-02T00:00:00Z'))
      .dailyCapReached,
  ).toBe(false);
});

test('human policy creates no autonomous record and does not spend capacity', () => {
  const { s, config } = fixture();
  s.db
    .update(project)
    .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'human' } })
    .run();
  s.db.update(team).set({ autonomyPaused: true }).run();
  claimAutonomousMerge(s.db, 'a');
  expect(s.db.select().from(message).all()).toHaveLength(0);
  expect(autonomousMergePolicy(s.db, s.team.id, { ...config, mergePolicy: 'human' })).toEqual({
    autonomyPaused: false,
    dailyCapReached: false,
  });
});

test('a completed admission and its legacy success message count once', () => {
  const { s, config } = fixture();
  claimAutonomousMerge(s.db, 'a');
  settleAutonomousMerge(s.db, 'a', 'merged');
  s.db
    .insert(message)
    .values({
      id: 'legacy',
      conversationId: 'a',
      role: 'system',
      content: 'PR #1 已由 cairn 经 GitHub 合并（squash）',
      createdAt: Date.now(),
    })
    .run();
  s.db.update(team).set({ maxAutonomousMergesPerDay: 2 }).run();
  expect(autonomousMergePolicy(s.db, s.team.id, config).dailyCapReached).toBe(false);
});

test('a queued local reservation is rechecked without counting its own slot twice', () => {
  const { s, config } = fixture();
  claimAutonomousMerge(s.db, 'a');
  expect(autonomousMergePolicy(s.db, s.team.id, config, Date.now(), 'a').dailyCapReached).toBe(
    false,
  );
  s.db.update(team).set({ autonomyPaused: true }).run();
  expect(autonomousMergePolicy(s.db, s.team.id, config, Date.now(), 'a').autonomyPaused).toBe(true);
});

test('admission transcript records use the existing JSON string envelope', () => {
  const { s } = fixture();
  claimAutonomousMerge(s.db, 'a');
  const row = s.db.select().from(message).get();
  expect(typeof row?.content).toBe('string');
});

test('merge configuration patches do not synthesize omitted defaulted fields', () => {
  expect(patchProjectMergeConfigSchema.parse({ mergePolicy: 'human' })).toEqual({
    mergePolicy: 'human',
  });
  expect(patchProjectMergeConfigSchema.safeParse({ maxAutonomousMergesPerDay: 0 }).success).toBe(
    false,
  );
});

test('updating checks preserves an existing human policy and zero cap', () => {
  const { s } = fixture();
  s.db
    .update(project)
    .set({
      autonomy: {
        ...DEFAULT_AUTONOMY_SETTINGS,
        mergePolicy: 'human',
        localChecks: ['old'],
      },
    })
    .run();
  const row = s.db.select().from(project).where(eq(project.id, 'p')).get();
  if (!row) throw new Error('missing project');
  expect(updateProjectMergeConfig(s.db, row, { localChecks: ['new'] })).toEqual({
    mergePolicy: 'human',
    localChecks: ['new'],
  });
});

test('team cap is stored and returned by the team settings API', async () => {
  const { s, config } = fixture();
  const response = await s.app.request(`/api/teams/${s.team.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ maxAutonomousMergesPerDay: 0 }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ maxAutonomousMergesPerDay: 0 });
  expect(autonomousMergePolicy(s.db, s.team.id, config).dailyCapReached).toBe(true);
});

for (const state of ['open', 'closed', 'merged', 'unreadable'] as const) {
  test(`stale unknown GitHub admission is reconciled from ${state} provider state`, async () => {
    const { s } = fixture();
    s.db.update(project).set({ repoKind: 'github', githubRepo: 'owner/repo' }).run();
    s.db.update(build).set({ prNumber: 1 }).where(eq(build.id, 'a')).run();
    claimAutonomousMerge(s.db, 'a');
    const githubFetch = vi.fn(async () => ({
      ok: state !== 'unreadable',
      status: state === 'unreadable' ? 503 : 200,
      headers: { get: () => null },
      text: async () => '',
      json: async () => ({
        state: state === 'open' ? 'open' : 'closed',
        merged: state === 'merged',
        merged_at: '2030-01-01T00:00:00Z',
      }),
    }));
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    await createCiPoller(deps, { githubFetch }).sweep(Date.now() + 60_001);
    expect(githubFetch).toHaveBeenCalled();
    if (state === 'open' || state === 'closed')
      expect(() => claimAutonomousMerge(s.db, 'a')).not.toThrow();
    else expect(() => claimAutonomousMerge(s.db, 'a')).toThrow('already admitted');
  });
}

for (const status of ['failed', 'stopped'] as const) {
  test(`stale local admission retains a ${status} command with unknown repository state`, async () => {
    const { s } = fixture();
    s.db.update(project).set({ repoKind: 'local' }).run();
    claimAutonomousMerge(s.db, 'a');
    s.db
      .insert(step)
      .values({ id: 'merge', buildId: 'a', kind: 'merge', status, createdAt: Date.now() })
      .run();
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    await createCiPoller(deps, { githubFetch: vi.fn() }).sweep(Date.now() + 60_001);
    expect(() => claimAutonomousMerge(s.db, 'a')).toThrow('already admitted');
  });
}

for (const action of ['failed', 'cancelled'] as const) {
  test(`issued local admission remains pending when command is ${action}`, () => {
    const { s } = fixture();
    claimAutonomousMerge(s.db, 'a');
    s.db
      .insert(step)
      .values({
        id: 'merge',
        buildId: 'a',
        kind: 'merge',
        status: 'claimed',
        createdAt: Date.now(),
        prompt: '{"kind":"local-merge"}',
      })
      .run();
    const row = s.db.select().from(step).get();
    if (!row) throw new Error('missing step');
    if (action === 'failed') failStepWithEvents(s.svc, row, 'daemon failed');
    else applyStoppedStep(s.svc, row.id);
    expect(() => claimAutonomousMerge(s.db, 'a')).toThrow('already admitted');
  });
}

test('legacy human-policy merge messages do not consume autonomous capacity', () => {
  const { s, config } = fixture();
  s.db
    .update(project)
    .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'human' } })
    .run();
  s.db
    .insert(message)
    .values({
      id: 'legacy',
      conversationId: 'a',
      role: 'system',
      content: 'PR #1 已由 cairn 经 GitHub 合并',
      createdAt: Date.now(),
    })
    .run();
  expect(autonomousMergePolicy(s.db, s.team.id, config).dailyCapReached).toBe(false);
});

test('evaluation SQL bounds transcript and step history with a large unrelated message table', () => {
  const { s, config } = fixture();
  for (let i = 0; i < 2000; i++)
    s.db
      .insert(message)
      .values({
        id: `noise-${i}`,
        conversationId: 'a',
        role: 'system',
        content: 'unrelated',
        createdAt: 0,
      })
      .run();
  const queries: string[] = [];
  const original = s.db.select.bind(s.db);
  const spy = vi
    .spyOn(s.db, 'select')
    .mockImplementation((...args: Parameters<typeof s.db.select>) => {
      const query = original(...args);
      const from = query.from.bind(query);
      vi.spyOn(query, 'from').mockImplementation((...tables: Parameters<typeof query.from>) => {
        const selected = from(...tables);
        const all = selected.all.bind(selected);
        vi.spyOn(selected, 'all').mockImplementation(() => {
          queries.push(selected.toSQL().sql);
          return all();
        });
        return selected;
      });
      return query;
    });
  autonomousMergePolicy(s.db, s.team.id, config);
  spy.mockRestore();
  expect(
    queries
      .filter((q) => q.includes('from "message"'))
      .every((q) => q.includes('"createdAt" >=') && q.includes('"createdAt" <')),
  ).toBe(true);
  expect(
    queries
      .filter((q) => q.includes('from "step"'))
      .every((q) => q.includes('"finishedAt" >=') && q.includes('"finishedAt" <')),
  ).toBe(true);
  expect(queries.some((q) => q.includes('from "build"'))).toBe(false);
  expect(s.db.get(sql`select count(*) as n from message`)).toEqual({ n: 2000 });
});

test('team settings reject negative and fractional caps without changing the stored limit', async () => {
  const { s } = fixture();
  for (const maxAutonomousMergesPerDay of [-1, 0.5]) {
    const response = await s.app.request(`/api/teams/${s.team.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxAutonomousMergesPerDay }),
    });
    expect(response.status).toBe(400);
  }
  expect(s.db.select().from(team).get()?.maxAutonomousMergesPerDay).toBe(1);
});

test('abandoned autonomous local commands retain their reservation without being reissued', () => {
  const { s } = fixture();
  claimAutonomousMerge(s.db, 'a');
  s.db
    .insert(step)
    .values({
      id: 'abandoned',
      buildId: 'a',
      kind: 'merge',
      status: 'claimed',
      prompt: '{"kind":"local-merge"}',
      createdAt: Date.now() - 200_000,
      claimedAt: Date.now() - 200_000,
    })
    .run();
  sweepAbandonedBuildSteps(s.svc, Date.now());
  expect(s.db.select().from(step).get()?.status).toBe('claimed');
  expect(() => claimAutonomousMerge(s.db, 'b')).toThrow('daily-cap');
});

test('a previous-day admission suppresses a delayed legacy success row on the next day', () => {
  const { s, config } = fixture();
  claimAutonomousMerge(s.db, 'a');
  settleAutonomousMerge(s.db, 'a', 'merged', Date.parse('2030-01-01T23:59:59Z'));
  s.db
    .insert(message)
    .values({
      id: 'delayed',
      conversationId: 'a',
      role: 'system',
      content: 'PR #1 已由 cairn 经 GitHub 合并',
      createdAt: Date.parse('2030-01-02T00:00:01Z'),
    })
    .run();
  expect(
    autonomousMergePolicy(s.db, s.team.id, config, Date.parse('2030-01-02T00:00:02Z'))
      .dailyCapReached,
  ).toBe(false);
});

test('late landing after refused settlement is counted exactly once', () => {
  const { s, config } = fixture();
  claimAutonomousMerge(s.db, 'a');
  settleAutonomousMerge(s.db, 'a', 'refused');
  settleAutonomousMerge(s.db, 'a', 'merged');
  settleAutonomousMerge(s.db, 'a', 'merged');
  expect(s.db.select().from(autonomousMergeAdmission).all()).toHaveLength(1);
  expect(autonomousMergePolicy(s.db, s.team.id, config).dailyCapReached).toBe(true);
});

test('recovery cannot release an admission inside the request timeout even with a shorter caller window', async () => {
  const { s } = fixture();
  s.db.update(project).set({ repoKind: 'github', githubRepo: 'owner/repo' }).run();
  s.db.update(build).set({ prNumber: 1 }).run();
  claimAutonomousMerge(s.db, 'a');
  const fetch = vi.fn();
  await recoverAutonomousMerges({ ...s.svc, box: s.secretBox }, fetch, Date.now() + 15_000, 1);
  expect(fetch).not.toHaveBeenCalled();
  expect(() => claimAutonomousMerge(s.db, 'b')).toThrow('daily-cap');
});

for (const rejection of [
  'foreign',
  'fork',
  'wrong-base',
  'missing-base',
  'phase-change',
  'diverged',
] as const) {
  test(`raw merged ${rejection} observation cannot settle a pending admission`, async () => {
    const { s } = fixture();
    s.db.update(project).set({ repoKind: 'github', githubRepo: 'owner/repo' }).run();
    s.db.update(build).set({ prNumber: 1 }).where(eq(build.id, 'a')).run();
    s.db.update(todo).set({ phase: 'review', latestBuildId: 'a' }).where(eq(todo.id, 'a')).run();
    s.db
      .insert(step)
      .values({
        id: 'checkpoint',
        buildId: 'a',
        kind: 'build',
        status: 'done',
        checkpointCommit: 'a'.repeat(40),
        createdAt: 0,
      })
      .run();
    claimAutonomousMerge(s.db, 'a');
    const githubFetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (rejection === 'phase-change')
        s.db.update(todo).set({ phase: 'closed' }).where(eq(todo.id, 'a')).run();
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '',
        json: async () =>
          url.includes('/compare/')
            ? { status: 'diverged' }
            : url.includes('/pulls?')
              ? []
              : {
                  state: 'closed',
                  merged: true,
                  merged_at: '2030-01-01T00:00:00Z',
                  head: {
                    ref: rejection === 'foreign' ? 'other' : conversationBranch('a'),
                    sha: rejection === 'diverged' ? 'b'.repeat(40) : 'a'.repeat(40),
                    repo: { id: rejection === 'fork' ? 2 : 1 },
                  },
                  base: {
                    ...(rejection === 'missing-base'
                      ? {}
                      : { ref: rejection === 'wrong-base' ? 'release' : 'main' }),
                    repo: { id: 1, default_branch: 'main' },
                  },
                },
      };
    });
    await createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch }).sweep(
      Date.now() + 60_001,
    );
    expect(s.db.select().from(autonomousMergeAdmission).get()?.state).toBe('pending');
    expect(
      s.db
        .select()
        .from(message)
        .all()
        .filter((row) => String(row.content).includes('"state":"merged"')),
    ).toHaveLength(0);
  });
}

test('reconcile accepts a late landing after refusal once with the provider timestamp', async () => {
  const { s } = fixture();
  s.db.update(project).set({ repoKind: 'github', githubRepo: 'owner/repo' }).run();
  s.db.update(build).set({ prNumber: 1 }).where(eq(build.id, 'a')).run();
  s.db.update(todo).set({ phase: 'review', latestBuildId: 'a' }).where(eq(todo.id, 'a')).run();
  claimAutonomousMerge(s.db, 'a');
  settleAutonomousMerge(s.db, 'a', 'refused');
  const githubFetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({
      state: 'closed',
      merged: true,
      merged_at: '2030-01-01T00:00:00Z',
      head: { ref: conversationBranch('a'), sha: 'a'.repeat(40), repo: { id: 1 } },
      base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
    }),
  }));
  const poller = createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch });
  await poller.sweep();
  await poller.sweep();
  expect(s.db.select().from(todo).where(eq(todo.id, 'a')).get()?.phase).toBe('done');
  expect(s.db.select().from(autonomousMergeAdmission).all()).toMatchObject([
    { buildId: 'a', state: 'merged', landedAt: Date.parse('2030-01-01T00:00:00Z') },
  ]);
});

test('stale completed local steps cannot independently record an accepted landing', async () => {
  const { s } = fixture();
  s.db.update(project).set({ repoKind: 'local' }).run();
  claimAutonomousMerge(s.db, 'a');
  s.db
    .insert(step)
    .values({
      id: 'merge',
      buildId: 'a',
      kind: 'merge',
      status: 'done',
      checkpointCommit: 'a'.repeat(40),
      createdAt: Date.now(),
      finishedAt: Date.now(),
    })
    .run();
  await recoverAutonomousMerges(
    { ...s.svc, box: s.secretBox },
    vi.fn(),
    Date.now() + 60_001,
    60_000,
  );
  expect(s.db.select().from(autonomousMergeAdmission).get()?.state).toBe('pending');
});
