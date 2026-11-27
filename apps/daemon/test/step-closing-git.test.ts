import type { ClaimedStep, CommitIdentity, PreparedWorkspace, WorktreeOps } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { commitAndPushStep } from '../src/step-closing-git.js';

const IDENTITY: CommitIdentity = { name: 'Tester', email: 'tester@example.com' };

function makeClaimed(repoKind: 'github' | 'local' | 'hosted' = 'github'): ClaimedStep {
  return {
    conversationId: 'conv-1',
    step: { id: 'step-1', buildId: 'conv-1', kind: 'session', machineId: 'm-1', createdAt: 1 },
    session: { action: 'new', sessionId: null },
    project: {
      id: 'proj-1',
      name: 'Repo',
      repo: { kind: repoKind, cloneUrl: 'https://github.com/org/repo.git', baseBranch: 'main' },
    },
    agent: {
      id: 'agent-1',
      displayName: 'Agent',
      description: null,
      provider: 'p',
      modelId: 'm',
      thinkingLevel: null,
      tools: ['git_push'],
    },
  };
}

function makeWs(overrides: Partial<PreparedWorkspace> = {}): PreparedWorkspace {
  return {
    cwd: '/tmp/wt',
    baseRepoDir: '/tmp/base',
    branch: 'agent/conv-1',
    defaultBranch: 'main',
    reused: true,
    ...overrides,
  };
}

function makeGit(overrides: Partial<WorktreeOps> = {}): WorktreeOps {
  return {
    prepare: vi.fn(),
    commitAll: vi.fn(async () => ({ committed: false, head: 'abc1234', setupDrift: [] })),
    push: vi.fn(async () => {}),
    mergeDefaultBranch: vi.fn(async () => ({ output: 'OK' })),
    headCommit: vi.fn(async () => 'head-2'),
    countAhead: vi.fn(async () => 1),
    currentBranch: vi.fn(async () => 'agent/conv-1'),
    branchesWithNewCommits: vi.fn(async () => []),
    fetchBranch: vi.fn(async () => true),
    isAncestor: vi.fn(async () => false),
    hasCommitsSince: vi.fn(async () => false),
    unpushedCommitCount: vi.fn(async () => 0),
    restoreCheckpoint: vi.fn(),
    cleanupOrphans: vi.fn(async () => []),
    ...overrides,
  };
}

describe('commitAndPushStep unpushedCommits reporting (Slice 2)', () => {
  test('reports 0 when landed on origin/defaultBranch', async () => {
    const git = makeGit({
      countAhead: vi.fn(async () => 0),
      isAncestor: vi.fn(async () => true),
      hasCommitsSince: vi.fn(async () => true),
      unpushedCommitCount: vi.fn(async () => 99),
    });
    const out = await commitAndPushStep({
      git,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(out.unpushedCommits).toBe(0);
  });

  test('counts unpushed commits on HEAD when headAhead > 0', async () => {
    const unpushedCommitCount = vi.fn(async () => 2);
    const git = makeGit({ countAhead: vi.fn(async () => 2), unpushedCommitCount });
    const out = await commitAndPushStep({
      git,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(out.unpushedCommits).toBe(2);
    expect(unpushedCommitCount).toHaveBeenCalledWith('/tmp/wt', 'HEAD');
  });

  test('counts unpushed commits on scanned branches when headAhead === 0', async () => {
    const unpushedCommitCount = vi.fn(async (_cwd: string, ref?: string) =>
      ref === 'feat/side' ? 3 : 0,
    );
    const git = makeGit({
      countAhead: vi.fn(async () => 0),
      branchesWithNewCommits: vi.fn(async () => ['feat/side']),
      unpushedCommitCount,
    });
    const out = await commitAndPushStep({
      git,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(out.unpushedCommits).toBe(3);
    expect(unpushedCommitCount).toHaveBeenCalledWith('/tmp/wt', 'feat/side');
  });

  test('checks both HEAD and another local branch with new commits when headAhead > 0', async () => {
    const unpushedCommitCount = vi.fn(async (_cwd: string, ref?: string) =>
      ref === 'feat/other' ? 2 : 0,
    );
    const git = makeGit({
      countAhead: vi.fn(async () => 1),
      branchesWithNewCommits: vi.fn(async () => ['feat/other']),
      unpushedCommitCount,
    });
    const out = await commitAndPushStep({
      git,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(out.unpushedCommits).toBe(2);
    expect(unpushedCommitCount).toHaveBeenCalledWith('/tmp/wt', 'HEAD');
    expect(unpushedCommitCount).toHaveBeenCalledWith('/tmp/wt', 'feat/other');
  });

  test('returns null (never 0) when unpushedCommitCount fails or fetch/scan fails on github repo', async () => {
    const gitWithoutProbe = makeGit({ unpushedCommitCount: undefined });
    const outMissing = await commitAndPushStep({
      git: gitWithoutProbe,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(outMissing.unpushedCommits).toBeNull();

    const gitThrows = makeGit({
      unpushedCommitCount: vi.fn(async () => {
        throw new Error('rev-list failed');
      }),
    });
    const outErr = await commitAndPushStep({
      git: gitThrows,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(outErr.unpushedCommits).toBeNull();

    const gitFetchFailed = makeGit({
      fetchBranch: vi.fn(async () => false),
      countAhead: vi.fn(async () => 0),
      unpushedCommitCount: vi.fn(async () => 0),
    });
    const outFetchFail = await commitAndPushStep({
      git: gitFetchFailed,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(outFetchFail.unpushedCommits).toBeNull();

    const gitScanFailed = makeGit({
      countAhead: vi.fn(async () => 0),
      branchesWithNewCommits: vi.fn(async () => {
        throw new Error('for-each-ref failed');
      }),
      unpushedCommitCount: vi.fn(async () => 0),
    });
    const outScanFail = await commitAndPushStep({
      git: gitScanFailed,
      ws: makeWs(),
      claimed: makeClaimed('github'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(outScanFail.unpushedCommits).toBeNull();
  });

  test('leaves unpushedCommits undefined for non-github repos', async () => {
    const out = await commitAndPushStep({
      git: makeGit({ countAhead: vi.fn(async () => 1) }),
      ws: makeWs(),
      claimed: makeClaimed('hosted'),
      stepId: 'step-1',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: 'head-1',
      stepStartMs: 100,
      push: async () => 'integration',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(out.unpushedCommits).toBeUndefined();
  });
});
