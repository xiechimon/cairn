import { CONTINUE_PROMPTS, conversationBranch, DEFAULT_AUTONOMY_SETTINGS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { build, project, step, team, todo } from '../src/db/schema.js';
import { requestMerge } from '../src/services/build-merge-request.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { parseShipGateInstruction, reverifyShip } from '../src/services/ship-gate.js';
import { mergeGithubFake } from './fakes/github.js';
import { bootServer, pauseTeamForTest, req, seedSessionRoute } from './helpers.js';

const HEAD = 'a'.repeat(40);
const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

function world() {
  const fake = mergeGithubFake({ 7: { state: 'open', merged: false, headSha: HEAD } }, () =>
    conversationBranch('build'),
  );
  fake.setGreenRequiredChecks(HEAD);
  const s = bootServer({ githubFetch: fake.fetch });
  disposals.push(() => s.dispose());
  s.db
    .insert(project)
    .values({
      id: 'project',
      teamId: s.team.id,
      name: 'Custom delivery',
      repoKind: 'github',
      githubRepo: 'octo/demo',
      autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, shipRoute: 'custom' },
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 'todo',
      teamId: s.team.id,
      projectId: 'project',
      title: 'Delivered change',
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
      prNumber: 7,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'delivery',
      buildId: 'build',
      kind: 'session',
      status: 'done',
      checkpointCommit: HEAD,
      createdAt: Date.now(),
    })
    .run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub' });
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      login: 'octo',
      accessToken: 'test-token',
      scope: 'repo',
    },
  );
  const deps = { ...s.svc, box: s.secretBox, githubFetch: fake.fetch };
  const merges = () =>
    s.db
      .select()
      .from(step)
      .all()
      .filter((row) => row.kind === 'merge');
  return { s, fake, deps, merges };
}

test('explicit custom merge pins the completed delivery without a verdict or autonomy permission', async () => {
  const w = world();
  pauseTeamForTest(w.s.db, w.s.team.id);
  w.s.db.update(team).set({ maxAutonomousMergesPerDay: 0 }).run();
  await req(w.s.app, 'PUT', '/api/prompts/ship', { text: 'Squash and push to main.' });
  await requestMerge(w.deps, 'build');
  const [merge] = w.merges();
  expect(merge?.prompt?.startsWith('Squash and push to main.')).toBe(true);
  expect(merge?.prompt).toContain(`--match-head-commit ${HEAD}`);
  expect(parseShipGateInstruction(merge?.prompt ?? null)).toEqual({
    buildId: 'build',
    judgedHead: HEAD,
  });
  expect(await reverifyShip(w.deps, merge!)).toBeNull();
  expect(w.s.db.select().from(todo).get()?.phase).toBe('done');
  expect(w.fake.puts()).toEqual([]);
  await expect(requestMerge(w.deps, 'build')).rejects.toThrow('合并步');
  expect(w.merges()).toHaveLength(1);
});

test('a fresh custom route uses the existing Ship prompt', async () => {
  const w = world();
  await requestMerge(w.deps, 'build');
  expect(w.merges()[0]?.prompt?.startsWith(CONTINUE_PROMPTS.merge)).toBe(true);
});

test.each([
  'no-pr',
  'local',
  'foreign-branch',
  'fork',
  'head',
  'base',
  'closed',
  'checks',
] as const)('custom merge refuses %s before issuing a command', async (state) => {
  const w = world();
  if (state === 'no-pr') w.s.db.update(build).set({ prNumber: null }).run();
  if (state === 'local') w.s.db.update(project).set({ repoKind: 'local', githubRepo: null }).run();
  const pull = w.fake.pulls[7]!;
  if (state === 'foreign-branch') pull.headRef = 'someone/else';
  if (state === 'fork') pull.headRepoId = 999;
  if (state === 'head') pull.headSha = 'e'.repeat(40);
  if (state === 'base') pull.baseRef = 'release';
  if (state === 'closed') pull.state = 'closed';
  if (state === 'checks')
    w.fake.checkAnswers['/check-runs'] = {
      status: 200,
      body: { total_count: 0, check_runs: [] },
    };
  await expect(requestMerge(w.deps, 'build')).rejects.toMatchObject({ status: 409 });
  expect(w.merges()).toEqual([]);
  expect(w.fake.puts()).toEqual([]);
});

test.each(['archive', 'supersede', 'close'] as const)(
  'custom merge refuses a delivery changed by %s during its PR read',
  async (change) => {
    const w = world();
    w.fake.onGet = () => {
      w.s.db
        .update(todo)
        .set(
          change === 'archive'
            ? { archivedAt: 1 }
            : change === 'supersede'
              ? { latestBuildId: 'newer' }
              : { phase: 'closed' },
        )
        .run();
    };
    await expect(requestMerge(w.deps, 'build')).rejects.toMatchObject({ status: 409 });
    expect(w.merges()).toEqual([]);
  },
);

test.each(['head', 'checks', 'archive', 'supersede', 'no-pr'] as const)(
  'custom merge rechecks %s before the machine claims it',
  async (change) => {
    const w = world();
    await requestMerge(w.deps, 'build');
    if (change === 'head') w.fake.pulls[7]!.headSha = 'e'.repeat(40);
    if (change === 'checks')
      w.fake.checkAnswers['/check-runs'] = {
        status: 200,
        body: { total_count: 0, check_runs: [] },
      };
    if (change === 'archive') w.s.db.update(todo).set({ archivedAt: 1 }).run();
    if (change === 'supersede') w.s.db.update(todo).set({ latestBuildId: 'newer' }).run();
    if (change === 'no-pr') w.s.db.update(build).set({ prNumber: null }).run();
    expect(await reverifyShip(w.deps, w.merges()[0]!)).not.toBeNull();
  },
);

test('steps without a custom merge instruction are unchanged', async () => {
  const w = world();
  const row = w.s.db.select().from(step).where(eq(step.id, 'delivery')).get()!;
  expect(await reverifyShip(w.deps, row)).toBeNull();
});
