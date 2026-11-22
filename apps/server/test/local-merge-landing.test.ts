import { parseLocalMergeInstruction } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  autonomousMergeAdmission,
  build,
  machine,
  message,
  project,
  step,
  stopPending,
  team,
  todo,
} from '../src/db/schema.js';
import { systemGitOps } from '../src/lib/git.js';
import { sweepAbandonedBuildSteps } from '../src/services/build-abandoned-sweep.js';
import { requestMerge } from '../src/services/build-merge-request.js';
import { applyLocalMergeReport } from '../src/services/local-merge.js';
import { claimStep } from '../src/services/machine-claim.js';
import { bootServer, pauseTeamForTest, seedSessionRoute } from './helpers.js';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});
const base = 'b'.repeat(40);
const head = 'a'.repeat(40);
const tools = ['合并分支', '推送分支'];

function fixture(localChecks = ['true']) {
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
      autonomy: { localChecks },
    })
    .run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub', tools });
  s.db
    .insert(todo)
    .values({
      id: 'todo',
      teamId: s.team.id,
      projectId: 'project',
      title: 'Delivered local change',
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
      id: 'delivery',
      buildId: 'build',
      kind: 'session',
      status: 'done',
      createdAt: Date.now(),
      checkpointCommit: head,
    })
    .run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    gitOps: {
      ...systemGitOps,
      listBranches: async () => ({ defaultBranch: 'main', branches: [] }),
      resolveCommit: async () => base,
      localCompareFiles: async () => [
        {
          status: 'modified' as const,
          filename: 'src/local.ts',
          previousFilename: null,
          sha: 'd'.repeat(40),
          additions: 1,
          deletions: 0,
          patchSha: 'd'.repeat(64),
        },
      ],
    },
  };
  const merge = () =>
    s.db
      .select()
      .from(step)
      .all()
      .find((row) => row.kind === 'merge')!;
  return { s, deps, merge };
}

test('explicit local merge ignores retired policy, verdicts, pause and cap; pins the delivery', async () => {
  const f = fixture();
  pauseTeamForTest(f.s.db, f.s.team.id);
  f.s.db.update(team).set({ maxAutonomousMergesPerDay: 0 }).run();
  expect(await requestMerge(f.deps, 'build')).toMatchObject({ state: 'requested' });
  const command = parseLocalMergeInstruction(f.merge().prompt);
  expect(command).toMatchObject({
    projectId: 'project',
    buildId: 'build',
    defaultBranch: 'main',
    judgedBase: base,
    judgedHead: head,
    localChecks: ['true'],
    identity: { name: f.s.user.displayName, email: 'cairn@localhost' },
  });
  expect(command?.judgedPatchDigest).toMatch(/^pd2:[a-f0-9]{64}$/);
  expect(f.s.db.select().from(todo).get()?.phase).toBe('done');
  await expect(requestMerge(f.deps, 'build')).rejects.toThrow('合并步');
  expect(
    f.s.db
      .select()
      .from(step)
      .all()
      .filter((row) => row.kind === 'merge'),
  ).toHaveLength(1);
});

test('a fresh local project needs no mandatory check list or second model', async () => {
  const f = fixture([]);
  const bot = { name: 'cairn-bot', email: 'bot@example.invalid' };
  await requestMerge({ ...f.deps, githubAppIdentity: bot }, 'build');
  expect(parseLocalMergeInstruction(f.merge().prompt)).toMatchObject({
    localChecks: [],
    identity: bot,
  });
});

test.each([
  'archived',
  'closed',
  'superseded',
  'undelivered',
  'missing-path',
  'missing-base',
] as const)('local merge refuses %s without issuing a command', async (state) => {
  const f = fixture();
  if (state === 'archived') f.s.db.update(todo).set({ archivedAt: 1 }).run();
  if (state === 'closed') f.s.db.update(todo).set({ phase: 'closed' }).run();
  if (state === 'superseded') f.s.db.update(todo).set({ latestBuildId: 'newer' }).run();
  if (state === 'undelivered') f.s.db.update(step).set({ status: 'failed' }).run();
  if (state === 'missing-path') f.s.db.update(project).set({ localPath: null }).run();
  const deps =
    state === 'missing-base'
      ? { ...f.deps, gitOps: { ...f.deps.gitOps, resolveCommit: async () => null } }
      : f.deps;
  await expect(requestMerge(deps, 'build')).rejects.toThrow();
  expect(f.merge()).toBeUndefined();
});

test.each(['delivery', 'archive', 'base', 'path', 'checks'] as const)(
  'changed %s during repository reads cannot issue a merge',
  async (changed) => {
    const f = fixture();
    const deps = {
      ...f.deps,
      gitOps: {
        ...f.deps.gitOps,
        localCompareFiles: async () => {
          if (changed === 'delivery') f.s.db.update(todo).set({ latestBuildId: 'newer' }).run();
          if (changed === 'archive') f.s.db.update(todo).set({ archivedAt: 1 }).run();
          if (changed === 'base') f.s.db.update(project).set({ baseBranch: 'other' }).run();
          if (changed === 'path') f.s.db.update(project).set({ localPath: '/other' }).run();
          if (changed === 'checks')
            f.s.db
              .update(project)
              .set({ autonomy: { localChecks: ['false'] } })
              .run();
          return f.deps.gitOps.localCompareFiles();
        },
      },
    };
    await expect(requestMerge(deps, 'build')).rejects.toThrow('changed while preparing');
    expect(f.merge()).toBeUndefined();
  },
);

test('completed delivery merge remains claimable despite old autonomy controls', async () => {
  const f = fixture();
  f.s.db
    .insert(machine)
    .values(
      readyMachine({
        id: 'worker',
        teamId: f.s.team.id,
        name: 'Worker',
        online: true,
      }),
    )
    .run();
  seedSessionRoute(f.s, { provider: 'stub-gw', modelId: 'stub', machineId: 'worker', tools });
  await requestMerge(f.deps, 'build');
  pauseTeamForTest(f.s.db, f.s.team.id);
  f.s.db.update(team).set({ maxAutonomousMergesPerDay: 0 }).run();
  expect((await claimStep(f.deps, 'worker', f.s.team.id, 0, 'http://localhost'))?.step.id).toBe(
    f.merge().id,
  );
  expect(f.s.db.select().from(todo).get()?.phase).toBe('done');
});

test.each(['base', 'checks', 'project', 'delivery'] as const)(
  'changed %s authorization is refused at claim and releases its reservation',
  async (changed) => {
    const f = fixture();
    await requestMerge(f.deps, 'build');
    f.s.db
      .insert(machine)
      .values(
        readyMachine({
          id: 'worker',
          teamId: f.s.team.id,
          name: 'Worker',
          online: true,
        }),
      )
      .run();
    if (changed === 'base') f.s.db.update(project).set({ baseBranch: 'other' }).run();
    if (changed === 'checks')
      f.s.db
        .update(project)
        .set({
          autonomy: {
            localChecks: ['false'],
          },
        })
        .run();
    if (changed === 'project') f.s.db.update(project).set({ repoKind: 'hosted' }).run();
    if (changed === 'delivery') f.s.db.update(todo).set({ latestBuildId: 'newer' }).run();
    expect(await claimStep(f.deps, 'worker', f.s.team.id, 0, 'http://localhost')).toBeNull();
    expect(f.merge().status).toBe('failed');
    expect(f.s.db.select().from(autonomousMergeAdmission).all()).toEqual([]);
  },
);

test.each(['merged', 'held', 'recheck', 'checks-failed'] as const)(
  'local %s report records the outcome and clears stop state without reopening the task',
  async (outcome) => {
    const f = fixture();
    await requestMerge(f.deps, 'build');
    const row = f.merge();
    const command = parseLocalMergeInstruction(row.prompt)!;
    f.s.db
      .update(step)
      .set({ status: 'claimed', archiveStop: 'requested' })
      .where(eq(step.id, row.id))
      .run();
    f.s.db
      .insert(stopPending)
      .values({
        conversationId: 'build',
        stepId: row.id,
        discard: false,
        createdAt: Date.now(),
      })
      .run();
    const result =
      outcome === 'merged'
        ? { outcome, commit: 'f'.repeat(40) }
        : { outcome, reason: 'worktree-dirty' };
    applyLocalMergeReport(f.deps, { ...row, status: 'claimed' }, { command, result });
    expect(f.merge()).toMatchObject({ status: 'done', archiveStop: null });
    expect(f.s.db.select().from(stopPending).all()).toEqual([]);
    expect(f.s.db.select().from(todo).get()?.phase).toBe('done');
    expect(
      f.s.db
        .select()
        .from(message)
        .all()
        .some((m) => m.id === `local-merge-${row.id}`),
    ).toBe(true);
    expect(f.s.db.select().from(autonomousMergeAdmission).get()?.state ?? null).toBe(
      outcome === 'merged' ? 'merged' : null,
    );
  },
);

test('abandoned completed-task merge keeps its pinned command claimed without replay; superseded work stops', async () => {
  const f = fixture();
  await requestMerge(f.deps, 'build');
  const row = f.merge();
  f.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now() - 200_000 })
    .where(eq(step.id, row.id))
    .run();
  sweepAbandonedBuildSteps(f.deps);
  expect(f.merge()).toMatchObject({ status: 'claimed', prompt: row.prompt, claimCount: 0 });
  f.s.db.update(todo).set({ latestBuildId: 'newer' }).run();
  sweepAbandonedBuildSteps(f.deps);
  expect(f.merge().status).toBe('stopped');
});

test('a late actual landing is recorded once without reviving the failed command', async () => {
  const f = fixture();
  await requestMerge(f.deps, 'build');
  const row = f.merge();
  f.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, row.id)).run();
  const report = {
    command: parseLocalMergeInstruction(row.prompt)!,
    result: { outcome: 'merged' as const, commit: 'f'.repeat(40) },
  };
  applyLocalMergeReport(f.deps, { ...row, status: 'failed' }, report);
  applyLocalMergeReport(f.deps, { ...row, status: 'failed' }, report);
  expect(f.s.db.select().from(autonomousMergeAdmission).all()).toHaveLength(1);
  expect(f.s.db.select().from(autonomousMergeAdmission).get()?.state).toBe('merged');
  expect(f.merge().status).toBe('failed');
});
