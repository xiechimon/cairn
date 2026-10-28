import { DEFAULT_AUTONOMY_SETTINGS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  gateState as gateStateTable,
  gateVerdict as gateVerdictTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { systemGitOps } from '../src/lib/git.js';
import { localGateFacts } from '../src/services/local-merge-facts.js';
import { computePatchDigest } from '../src/services/merge-gate/digest.js';
import { bootServer, type TestServer } from './helpers.js';

const BASE = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);

const COMPARE_FILES = [
  {
    status: 'modified' as const,
    filename: 'apps/web/src/local.ts',
    previousFilename: null,
    sha: 'd'.repeat(40),
    additions: 1,
    deletions: 0,
    patchSha: 'd'.repeat(64),
  },
];

const DIGEST = computePatchDigest(COMPARE_FILES).patchDigest ?? '';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

interface World {
  s: TestServer;
  deps: ReturnType<typeof depsOf>;
}

function depsOf(s: TestServer) {
  return {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    gitOps: { ...systemGitOps, localCompareFiles: async () => COMPARE_FILES },
  };
}

interface Seed {
  policy?: 'human' | 'shadow' | 'autonomous';
  localChecks?: string[];
  phase?: 'review' | 'building';
  latestBuild?: string;
  baseCheckpoint?: string | null;
  headCheckpoint?: string | null;
  verdicts?: {
    kind: 'review' | 'verify' | 'decision';
    perspective: string | null;
    outcome: 'pass' | 'block';
  }[];
  state?: { sha: string; digest: string } | null;
  sourceRef?: string;
}

function world(seed: Seed = {}): World {
  const s = bootServer();
  disposals.push(() => s.dispose());
  s.db
    .insert(projectTable)
    .values({
      id: 'project',
      teamId: s.team.id,
      name: 'Local',
      repoKind: 'local',
      localPath: '/repo',
      autonomy: {
        ...DEFAULT_AUTONOMY_SETTINGS,
        mergePolicy: seed.policy ?? 'autonomous',
        localChecks: seed.localChecks ?? ['true'],
      },
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
      tools: ['merge', 'push'],
      machineId: null,
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: 'todo',
      teamId: s.team.id,
      projectId: 'project',
      title: 'Deliver local change',
      spec: '',
      phase: seed.phase ?? 'review',
      phaseAt: Date.now(),
      seqNum: 1,
      latestBuildId: seed.latestBuild ?? 'build',
      sourceRef: seed.sourceRef ?? null,
      assignment: { plan: null, build: { agentId: 'agent' } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: 'build',
      todoId: 'todo',
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now(),
    })
    .run();
  const stepRow = (id: string, kind: 'plan' | 'build', commit: string | null) => {
    s.db
      .insert(stepTable)
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
  };
  stepRow('plan', 'plan', seed.baseCheckpoint === undefined ? BASE : seed.baseCheckpoint);
  stepRow('build', 'build', seed.headCheckpoint === undefined ? HEAD : seed.headCheckpoint);
  const verdicts = seed.verdicts ?? [
    { kind: 'verify' as const, perspective: null, outcome: 'pass' as const },
    { kind: 'review' as const, perspective: 'correctness', outcome: 'pass' as const },
  ];
  verdicts.forEach((v, k) => {
    s.db
      .insert(gateVerdictTable)
      .values({
        stepId: `verdict-${v.kind}-${v.perspective ?? 'none'}`,
        buildId: 'build',
        kind: v.kind,
        perspective: v.perspective,
        outcome: v.outcome,
        patchDigest: DIGEST,
        headSha: HEAD,
        expectedHeadSha: HEAD,
        createdAt: Date.now() + k,
      })
      .run();
  });
  if (seed.state !== null) {
    s.db
      .insert(gateStateTable)
      .values({
        buildId: 'build',
        ready: true,
        headSha: seed.state?.sha ?? HEAD,
        patchDigest: seed.state?.digest ?? DIGEST,
        policy: seed.policy ?? 'autonomous',
        blockers: [],
        evaluatedAt: Date.now(),
      })
      .run();
  }
  return { s, deps: depsOf(s) };
}

const codes = async (w: World) =>
  (await localGateFacts(w.deps, 'build', 'main'))?.readiness.blockers.map((b) => b.code) ?? [];

describe('localGateFacts: persisted rows become the gate inputs a local project is judged on', () => {
  test('the build boundary and the project configuration fill the policy, repo, checks and compare fields', async () => {
    const w = world();
    const facts = await localGateFacts(w.deps, 'build', 'main');
    expect(facts).not.toBeNull();
    expect(facts?.node).toBe('build');
    expect(facts?.judgedBase).toBe(BASE);
    expect(facts?.judgedHead).toBe(HEAD);
    expect(facts?.inputs).toMatchObject({
      pr: null,
      issueNumber: null,
      repo: { name: 'Local', defaultBranch: 'main' },
      policy: { mergePolicy: 'autonomous', autonomyPaused: false, dailyCapReached: false },
      build: {
        isGithubPr: false,
        repoKind: 'local',
        isCurrent: true,
        phase: 'review',
        stepsInFlight: 0,
      },
      checks: { headSha: HEAD, statusSha: HEAD, required: ['true'], complete: true },
      compare: { headSha: HEAD, totalCommits: 1, commits: [{ sha: HEAD, parents: [BASE] }] },
    });
  });

  test('the required checks are the project commands read at the judged head, so a mismatch is caught', async () => {
    const w = world({ localChecks: ['pnpm test', 'pnpm lint'] });
    const facts = await localGateFacts(w.deps, 'build', 'main');
    expect(facts?.inputs.checks?.runs).toEqual([
      { name: 'pnpm test', headSha: HEAD, status: 'completed', conclusion: 'success' },
      { name: 'pnpm lint', headSha: HEAD, status: 'completed', conclusion: 'success' },
      { name: 'pr-evidence', headSha: HEAD, status: 'completed', conclusion: 'success' },
    ]);
    expect(facts?.inputs.checks?.runs.map((r) => r.name)).toEqual([
      'pnpm test',
      'pnpm lint',
      'pr-evidence',
    ]);
    expect(facts?.ready).toBe(false);
    expect(facts?.readiness.blockers.map((b) => b.code)).not.toContain('required-check-failed');
    expect(facts?.readiness.blockers.map((b) => b.code)).not.toContain('required-check-missing');
  });

  test('a project with no configured command is not landed unchecked', async () => {
    expect(await codes(world({ localChecks: [] }))).toContain('required-checks-none');
  });

  test('an explicit human policy blocks through the shared policy blocker', async () => {
    expect(await codes(world({ policy: 'human' }))).toContain('policy-human');
  });

  test('a build that is no longer current, or no longer in review, is not ready', async () => {
    expect(await codes(world({ latestBuild: 'other-build' }))).toContain('not-current-build');
    expect(await codes(world({ phase: 'building' }))).toContain('phase-not-review');
  });

  test('a pending step in the build is work in flight and blocks the judgment', async () => {
    const w = world();
    w.s.db
      .insert(stepTable)
      .values({
        id: 'pending-review',
        buildId: 'build',
        kind: 'review',
        machineId: null,
        status: 'pending',
        prompt: null,
        createdAt: Date.now(),
      })
      .run();
    expect(await codes(w)).toContain('work-in-flight');
  });

  test('a declared boundary that disagrees with the build is unreadable, not green', async () => {
    const w = world();
    for (const [base, head] of [
      [BASE, BASE],
      [null, HEAD],
      [HEAD, null],
      [null, null],
    ] as const) {
      const facts = await localGateFacts(w.deps, 'build', 'main', undefined, { base, head });
      expect(facts?.ready).toBe(false);
      expect(facts?.inputs.compare).toBe('malformed');
      expect(facts?.judgedDigest).toBeNull();
    }
  });

  test('a missing build checkpoint fails closed instead of judging an empty patch', async () => {
    expect(
      (await localGateFacts(world({ headCheckpoint: null }).deps, 'build', 'main'))?.ready,
    ).toBe(false);
    expect(
      (await localGateFacts(world({ baseCheckpoint: null }).deps, 'build', 'main'))?.ready,
    ).toBe(false);
  });

  test('a build with no stored verdicts is not ready: the persisted rows are the gate evidence', async () => {
    const w = world({ verdicts: [] });
    const facts = await localGateFacts(w.deps, 'build', 'main');
    expect(facts?.verdicts).toEqual([]);
    expect(facts?.ready).toBe(false);
    expect(facts?.readiness.blockers.map((b) => b.code)).toContain('verify-missing');
    expect(facts?.readiness.blockers.map((b) => b.code)).toContain('no-reviewers');
    expect(facts?.readiness.blockers.map((b) => b.code)).toContain('decision-missing');
  });

  test('verdicts persisted for the judged patch are read back with their digest and outcome', async () => {
    const w = world({
      sourceRef: 'github:xiechimon/cairn#1625',
      verdicts: [
        { kind: 'verify', perspective: null, outcome: 'pass' },
        { kind: 'review', perspective: 'correctness', outcome: 'block' },
      ],
    });
    const facts = await localGateFacts(w.deps, 'build', 'main');
    expect(facts?.verdicts.map((v) => [v.kind, v.perspective, v.outcome, v.patchDigest])).toEqual([
      ['verify', null, 'pass', DIGEST],
      ['review', 'correctness', 'block', DIGEST],
    ]);
    expect(facts?.readiness.ready).toBe(false);
  });

  test('the stored gate state binds the judged digest only when it was computed at the same head', async () => {
    expect((await localGateFacts(world().deps, 'build', 'main'))?.judgedDigest).toBe(DIGEST);
    expect(
      (await localGateFacts(world({ state: null }).deps, 'build', 'main'))?.judgedDigest,
    ).toBeNull();
    expect(
      (
        await localGateFacts(
          world({ state: { sha: 'c'.repeat(40), digest: DIGEST } }).deps,
          'build',
          'main',
        )
      )?.judgedDigest,
    ).toBeNull();
  });

  test('the issue reference of the todo names the ticket the judgment is made under', async () => {
    const w = world({ sourceRef: 'github:xiechimon/cairn#1625' });
    const facts = await localGateFacts(w.deps, 'build', 'main');
    expect(facts?.inputs.issueNumber).toBe(1625);
    expect(facts?.inputs.ticketRef).toBe('1625');
    const noTicket = world();
    expect(
      (await localGateFacts(noTicket.deps, 'build', 'main'))?.readiness.blockers.map((b) => b.code),
    ).toContain('issue-ref-missing');
  });

  test('a hosted or github project is not judged by the local rules', async () => {
    const w = world();
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'hosted' })
      .where(eq(projectTable.id, 'project'))
      .run();
    expect(await localGateFacts(w.deps, 'build', 'main')).toBeNull();
  });
});
