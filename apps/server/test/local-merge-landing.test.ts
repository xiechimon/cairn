import { DEFAULT_AUTONOMY_SETTINGS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import {
  agent as agentTable,
  autonomousMergeAdmission,
  build,
  gateState,
  gateVerdict,
  machine,
  message,
  notification,
  project,
  step,
  team,
  todo,
} from '../src/db/schema.js';
import { systemGitOps } from '../src/lib/git.js';
import { requestMerge, sweepAbandonedBuildSteps } from '../src/services/builds.js';
import { applyLocalMergeReport, enqueueLocalMerge } from '../src/services/local-merge.js';
import { localGateFacts } from '../src/services/local-merge-facts.js';
import { claimStep } from '../src/services/machine-claim.js';
import { bootServer } from './helpers.js';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});
const base = 'b'.repeat(40);
const head = 'a'.repeat(40);

const fakeGitOps = {
  ...systemGitOps,
  listBranches: async () => ({ defaultBranch: 'main', branches: [] }),
  localCompareFiles: async () => [
    {
      status: 'modified' as const,
      filename: 'apps/web/src/local.ts',
      previousFilename: null,
      sha: 'd'.repeat(40),
      additions: 1,
      deletions: 0,
      patchSha: 'd'.repeat(64),
    },
  ],
};

interface Fixture {
  s: ReturnType<typeof bootServer>;
  digest: string;
  deps: {
    db: ReturnType<typeof bootServer>['db'];
    hub: ReturnType<typeof bootServer>['svc']['hub'];
    machineHub: ReturnType<typeof bootServer>['svc']['machineHub'];
    user: ReturnType<typeof bootServer>['svc']['user'];
    box: ReturnType<typeof bootServer>['secretBox'];
    reposDir: string;
    attachmentsDir: string;
    skillsDir: string;
  };
}

async function fixture(
  policy: 'human' | 'shadow' | 'autonomous' = 'autonomous',
  seed: { steps?: boolean; verdicts?: boolean; state?: boolean } = {},
): Promise<Fixture> {
  const s = bootServer();
  disposals.push(() => s.dispose());
  s.db
    .insert(project)
    .values({
      id: 'project',
      teamId: s.team.id,
      name: 'Local',
      repoKind: 'local',
      localPath: '/repo',
      autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: policy, localChecks: ['true'] },
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: 'agent',
      teamId: s.team.id,
      displayName: 'Local agent',
      description: '',
      provider: 'anthropic',
      modelId: 'claude-x',
      tools: ['合并分支', '推送分支'],
      machineId: null,
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 'todo',
      teamId: s.team.id,
      projectId: 'project',
      title: 'Deliver local change',
      spec: '',
      phase: 'review',
      phaseAt: Date.now(),
      seqNum: 1,
      latestBuildId: 'build',
      sourceRef: 'github:xiechimon/cairn#1625',
      assignment: { plan: null, build: { agentId: 'agent' } },
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
  if (seed.steps !== false) {
    for (const [id, kind, commit] of [
      ['plan', 'plan', base],
      ['build', 'build', head],
    ] as const)
      s.db
        .insert(step)
        .values({
          id,
          buildId: 'build',
          kind,
          machineId: null,
          status: 'done',
          prompt: null,
          createdAt: Date.now() + (kind === 'plan' ? 0 : 1),
          checkpointCommit: commit,
        })
        .run();
  }
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    gitOps: fakeGitOps,
  };
  const digest = (await localGateFacts(deps, 'build', 'main'))?.readiness.patchDigest ?? '';
  if (seed.verdicts !== false)
    s.db
      .insert(gateVerdict)
      .values(
        (
          [
            { kind: 'verify' as const, perspective: null },
            { kind: 'review' as const, perspective: 'correctness' },
            { kind: 'decision' as const, perspective: null },
          ] as const
        ).map((v, k) => ({
          stepId: `verdict-${v.kind}`,
          buildId: 'build',
          kind: v.kind,
          perspective: v.perspective,
          outcome: 'pass' as const,
          patchDigest: digest,
          headSha: head,
          expectedHeadSha: head,
          createdAt: Date.now() + k,
        })),
      )
      .run();
  if (seed.state !== false)
    s.db
      .insert(gateState)
      .values({
        buildId: 'build',
        ready: true,
        headSha: head,
        patchDigest: digest,
        policy,
        blockers: [],
        evaluatedAt: Date.now(),
      })
      .run();
  return { s, deps, digest };
}

test('a ready local autonomous judgment enqueues exactly one bound merge', async () => {
  const f = await fixture();
  expect((await enqueueLocalMerge(f.deps, 'build', 'main')).enqueued).toBe(true);
  const rows = f.s.db
    .select()
    .from(step)
    .all()
    .filter((r) => r.kind === 'merge');
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]?.prompt ?? '{}')).toMatchObject({
    kind: 'local-merge',
    command: {
      judgedBase: base,
      judgedHead: head,
      judgedPatchDigest: f.digest,
      localChecks: ['true'],
      projectId: 'project',
      buildId: 'build',
      defaultBranch: 'main',
    },
  });
});

for (const policy of ['human', 'shadow'] as const) {
  test(`${policy} never enqueues autonomous landing`, async () => {
    const f = await fixture(policy);
    expect((await enqueueLocalMerge(f.deps, 'build', 'main')).enqueued).toBe(false);
    expect(
      f.s.db
        .select()
        .from(step)
        .all()
        .filter((r) => r.kind === 'merge'),
    ).toHaveLength(0);
  });
}

test('a build without stored verdicts cannot enqueue landing', async () => {
  const f = await fixture('autonomous', { verdicts: false });
  expect((await enqueueLocalMerge(f.deps, 'build', 'main')).enqueued).toBe(false);
  expect(
    f.s.db
      .select()
      .from(step)
      .all()
      .filter((r) => r.kind === 'merge'),
  ).toHaveLength(0);
});

test('a gate state that was computed at another head does not lend its judgment', async () => {
  const f = await fixture();
  f.s.db
    .update(gateState)
    .set({ headSha: 'c'.repeat(40) })
    .where(eq(gateState.buildId, 'build'))
    .run();
  expect((await enqueueLocalMerge(f.deps, 'build', 'main')).enqueued).toBe(false);
});

test('a hosted project is not handed to the local executor', async () => {
  const f = await fixture();
  f.s.db.update(project).set({ repoKind: 'hosted' }).where(eq(project.id, 'project')).run();
  await expect(enqueueLocalMerge(f.deps, 'build', 'main')).rejects.toThrow();
});

for (const outcome of ['merged', 'held', 'recheck', 'checks-failed'] as const) {
  test(`${outcome} records the outcome and only confirmed landing finishes the card`, async () => {
    const f = await fixture();
    await enqueueLocalMerge(f.deps, 'build', 'main');
    const row = f.s.db
      .select()
      .from(step)
      .all()
      .find((r) => r.kind === 'merge');
    if (row === undefined) throw new Error('no merge step');
    f.s.db
      .update(step)
      .set({ status: 'claimed', machineId: 'machine' })
      .where(eq(step.id, row.id))
      .run();
    const command = JSON.parse(row.prompt ?? '{}').command;
    const result =
      outcome === 'merged'
        ? { outcome, commit: 'f'.repeat(40) }
        : { outcome, reason: 'worktree-dirty' };
    expect(
      applyLocalMergeReport(
        f.deps,
        { ...row, status: 'claimed', machineId: 'machine' },
        { command, result },
      ),
    ).toBe(true);
    expect(f.s.db.select().from(todo).get()?.phase).toBe(outcome === 'merged' ? 'done' : 'review');
    expect(
      f.s.db
        .select()
        .from(step)
        .all()
        .find((r) => r.kind === 'merge')?.status,
    ).toBe('done');
    expect(f.s.db.select().from(notification).all()).toHaveLength(outcome === 'merged' ? 0 : 1);
    if (outcome !== 'merged')
      expect(f.s.db.select().from(notification).get()?.snippet).toContain('worktree-dirty');
  });
}

test('requestMerge is what turns a ready local judgment into a landing command, not a test', async () => {
  const f = await fixture();
  await requestMerge(f.deps, 'build');
  const merges = f.s.db
    .select()
    .from(step)
    .all()
    .filter((r) => r.kind === 'merge');
  expect(merges).toHaveLength(1);
  expect(JSON.parse(merges[0]?.prompt ?? '{}')).toMatchObject({
    kind: 'local-merge',
    command: { judgedBase: base, judgedHead: head, localChecks: ['true'] },
  });
});

for (const policy of ['human', 'shadow'] as const) {
  test(`a ${policy} project keeps its untouched branch-only merge when a person asks for it`, async () => {
    const f = await fixture(policy);
    await expect(requestMerge(f.deps, 'build')).resolves.toEqual({ delegated: true });
    const merges = f.s.db
      .select()
      .from(step)
      .all()
      .filter((r) => r.kind === 'merge');
    expect(merges).toHaveLength(1);
    expect(merges[0]?.prompt).toBeNull();
  });
}

test('an autonomous request that the gate still blocks is refused instead of landing', async () => {
  const f = await fixture('autonomous', { verdicts: false });
  await expect(requestMerge(f.deps, 'build')).rejects.toThrow(/无法落地/);
  expect(
    f.s.db
      .select()
      .from(step)
      .all()
      .filter((r) => r.kind === 'merge'),
  ).toHaveLength(0);
});

test('an autonomous request whose default branch cannot be discovered fails closed instead of the legacy merge', async () => {
  const f = await fixture('autonomous');
  const unreadable = {
    ...f.deps,
    gitOps: { ...fakeGitOps, listBranches: async () => ({ defaultBranch: null, branches: [] }) },
  };
  await expect(requestMerge(unreadable, 'build')).rejects.toThrow();
  const merges = f.s.db
    .select()
    .from(step)
    .all()
    .filter((r) => r.kind === 'merge');
  expect(merges).toHaveLength(0);
});

test('an autonomous request whose repository read fails fails closed instead of the legacy merge', async () => {
  const f = await fixture('autonomous');
  const failing = {
    ...f.deps,
    gitOps: {
      ...fakeGitOps,
      listBranches: async () => {
        throw new Error('no repo');
      },
    },
  };
  await expect(requestMerge(failing, 'build')).rejects.toThrow();
  const merges = f.s.db
    .select()
    .from(step)
    .all()
    .filter((r) => r.kind === 'merge');
  expect(merges).toHaveLength(0);
});

test('a local project without a stored path fails closed instead of the legacy merge', async () => {
  const f = await fixture('autonomous');
  f.s.db.update(project).set({ localPath: null }).where(eq(project.id, 'project')).run();
  await expect(requestMerge(f.deps, 'build')).rejects.toThrow();
  const merges = f.s.db
    .select()
    .from(step)
    .all()
    .filter((r) => r.kind === 'merge');
  expect(merges).toHaveLength(0);
});

test('#1405 paused local readiness blocks enqueue without task mutation', async () => {
  const f = await fixture();
  f.s.db.update(team).set({ autonomyPaused: true }).where(eq(team.id, f.s.team.id)).run();
  const before = f.s.db.select().from(todo).all();
  const facts = await localGateFacts(f.deps, 'build', 'main');
  expect(facts?.readiness.blockers.map((b) => b.code)).toContain('autonomy-paused');
  await expect(enqueueLocalMerge(f.deps, 'build', 'main')).rejects.toMatchObject({ status: 409 });
  expect(f.s.db.select().from(todo).all()).toEqual(before);
  expect(
    f.s.db
      .select()
      .from(step)
      .all()
      .filter((r) => r.kind === 'merge'),
  ).toHaveLength(0);
});

test('#1405 zero cap blocks local readiness and issuance', async () => {
  const f = await fixture();
  f.s.db.update(team).set({ maxAutonomousMergesPerDay: 0 }).run();
  f.s.db
    .update(project)
    .set({
      autonomy: {
        ...DEFAULT_AUTONOMY_SETTINGS,
        mergePolicy: 'autonomous',
        localChecks: ['true'],
      },
    })
    .run();
  expect(
    (await localGateFacts(f.deps, 'build', 'main'))?.readiness.blockers.map((b) => b.code),
  ).toContain('daily-cap');
  await expect(enqueueLocalMerge(f.deps, 'build', 'main')).rejects.toMatchObject({ status: 409 });
});

test('#1405 pause after local evaluation starts prevents issuance and announcements', async () => {
  const f = await fixture();
  const deps = {
    ...f.deps,
    gitOps: {
      ...fakeGitOps,
      localCompareFiles: async () => {
        f.s.db.update(team).set({ autonomyPaused: true }).where(eq(team.id, f.s.team.id)).run();
        return fakeGitOps.localCompareFiles();
      },
    },
  };
  await expect(requestMerge(deps, 'build')).rejects.toMatchObject({ status: 409 });
  expect(
    f.s.db
      .select()
      .from(step)
      .all()
      .filter((r) => r.kind === 'merge'),
  ).toHaveLength(0);
});

test.each(['pause', 'cap'] as const)(
  '#1405 local worker claim rechecks %s after enqueue without task mutation',
  async (brake) => {
    const f = await fixture();
    f.s.db
      .insert(machine)
      .values({
        id: 'worker',
        teamId: f.s.team.id,
        name: 'Worker',
        online: true,
        enabledRuntimes: ['pi'],
      })
      .run();
    f.s.db
      .update(agentTable)
      .set({ provider: 'stub-gw', modelId: 'stub', machineId: 'worker' })
      .run();
    await enqueueLocalMerge(f.deps, 'build', 'main');
    if (brake === 'pause') f.s.db.update(team).set({ autonomyPaused: true }).run();
    else f.s.db.update(team).set({ maxAutonomousMergesPerDay: 0 }).run();
    if (brake === 'cap')
      f.s.db
        .update(project)
        .set({
          autonomy: {
            ...DEFAULT_AUTONOMY_SETTINGS,
            mergePolicy: 'autonomous',
            localChecks: ['true'],
          },
        })
        .run();
    const before = f.s.db.select().from(step).all();
    const beforeTodo = f.s.db.select().from(todo).all();
    const beforeMessages = f.s.db.select().from(message).all();
    await expect(
      claimStep(f.deps, 'worker', f.s.team.id, 0, 'http://localhost'),
    ).resolves.toBeNull();
    expect(f.s.db.select().from(step).all()).toEqual(before);
    expect(f.s.db.select().from(todo).all()).toEqual(beforeTodo);
    expect(f.s.db.select().from(message).all()).toEqual(beforeMessages);
  },
);

test('#1405 a paused failed local card is not restored before rejecting the merge', async () => {
  const f = await fixture();
  f.s.db.update(todo).set({ phase: 'failed' }).run();
  f.s.db.update(team).set({ autonomyPaused: true }).run();
  const before = f.s.db.select().from(todo).all();
  await expect(requestMerge(f.deps, 'build')).rejects.toMatchObject({ status: 409 });
  expect(f.s.db.select().from(todo).all()).toEqual(before);
});

for (const brake of ['pause', 'cap'] as const) {
  test(`a local candidate blocked by ${brake} leaves the next worker candidate claimable`, async () => {
    const f = await fixture();
    f.s.db
      .insert(machine)
      .values({
        id: 'worker',
        teamId: f.s.team.id,
        name: 'Worker',
        online: true,
        enabledRuntimes: ['pi'],
      })
      .run();
    f.s.db
      .update(agentTable)
      .set({ provider: 'stub-gw', modelId: 'stub', machineId: 'worker' })
      .run();
    await enqueueLocalMerge(f.deps, 'build', 'main');
    if (brake === 'pause') f.s.db.update(team).set({ autonomyPaused: true }).run();
    else
      await f.s.app.request(`/api/teams/${f.s.team.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxAutonomousMergesPerDay: 0 }),
      });
    f.s.db
      .insert(todo)
      .values({
        id: 'next',
        teamId: f.s.team.id,
        projectId: 'project',
        title: 'Next',
        phase: 'queued',
        phaseAt: 0,
        seqNum: 2,
        latestBuildId: 'next',
        assignment: { plan: null, build: { agentId: 'agent' } },
      })
      .run();
    f.s.db
      .insert(build)
      .values({
        id: 'next',
        todoId: 'next',
        withPlan: false,
        triggerSource: 'user',
        createdAt: Date.now(),
      })
      .run();
    f.s.db
      .insert(step)
      .values({ id: 'next-step', buildId: 'next', kind: 'build', createdAt: Date.now() + 1000 })
      .run();
    expect((await claimStep(f.deps, 'worker', f.s.team.id, 0, 'http://localhost'))?.step.id).toBe(
      'next-step',
    );
    expect(
      f.s.db
        .select()
        .from(step)
        .all()
        .find((r) => r.kind === 'merge')?.status,
    ).toBe('pending');
  });
}

test('changed local authorization releases the reservation before skipping the command', async () => {
  const f = await fixture();
  await enqueueLocalMerge(f.deps, 'build', 'main');
  f.s.db
    .insert(machine)
    .values({
      id: 'worker',
      teamId: f.s.team.id,
      name: 'Worker',
      online: true,
      enabledRuntimes: ['pi'],
    })
    .run();
  f.s.db.update(project).set({ repoKind: 'hosted' }).run();
  await claimStep(f.deps, 'worker', f.s.team.id, 0, 'http://localhost');
  expect(
    f.s.db
      .select()
      .from(message)
      .all()
      .some((row) => row.id === 'autonomous-merge-build'),
  ).toBe(false);
});

for (const policy of ['autonomous', 'human'] as const) {
  test(`${policy} abandoned local command preserves its policy path`, async () => {
    const f = await fixture(policy);
    await enqueueLocalMerge(f.deps, 'build', 'main', true);
    const row = f.s.db
      .select()
      .from(step)
      .all()
      .find((r) => r.kind === 'merge');
    if (!row) throw new Error('missing merge');
    f.s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: Date.now() - 200_000 })
      .where(eq(step.id, row.id))
      .run();
    sweepAbandonedBuildSteps(f.deps);
    expect(f.s.db.select().from(step).where(eq(step.id, row.id)).get()?.status).toBe(
      policy === 'human' ? 'pending' : 'claimed',
    );
    if (policy === 'autonomous') {
      expect(f.s.db.select().from(autonomousMergeAdmission).get()?.state).toBe('pending');
      f.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, row.id)).run();
      applyLocalMergeReport(
        f.deps,
        { ...row, status: 'failed' },
        {
          command: JSON.parse(row.prompt ?? '{}').command,
          result: { outcome: 'merged', commit: 'f'.repeat(40) },
        },
      );
      expect(f.s.db.select().from(autonomousMergeAdmission).get()?.state).toBe('merged');
    }
  });
}

test('a late landing for a failed local command restores a refused admission exactly once', async () => {
  const f = await fixture();
  await enqueueLocalMerge(f.deps, 'build', 'main');
  const row = f.s.db
    .select()
    .from(step)
    .all()
    .find((r) => r.kind === 'merge');
  if (!row) throw new Error('missing merge');
  f.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, row.id)).run();
  f.s.db.delete(autonomousMergeAdmission).run();
  f.s.db.delete(message).where(eq(message.id, 'autonomous-merge-build')).run();
  const report = {
    command: JSON.parse(row.prompt ?? '{}').command,
    result: { outcome: 'merged' as const, commit: 'f'.repeat(40) },
  };
  applyLocalMergeReport(f.deps, { ...row, status: 'failed' }, report);
  applyLocalMergeReport(f.deps, { ...row, status: 'failed' }, report);
  expect(f.s.db.select().from(autonomousMergeAdmission).all()).toHaveLength(1);
  expect(f.s.db.select().from(autonomousMergeAdmission).get()?.state).toBe('merged');
  expect(f.s.db.select().from(step).where(eq(step.id, row.id)).get()?.status).toBe('failed');
});
