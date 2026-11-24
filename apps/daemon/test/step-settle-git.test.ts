import type {
  BoundGitCredentials,
  ClaimedStep,
  PreparedWorkspace,
  WorktreeOps,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { settleStepGit } from '../src/step-settle-git.js';

const WORKFLOW_REJECTION = [
  'git push failed (exit 1): remote: error: refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission',
  'To https://github.com/o/r.git',
  ' ! [remote rejected] cairn/b1 -> cairn/b1 (refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission)',
  "error: failed to push some refs to 'https://github.com/o/r.git'",
].join('\n');

function claimedBuildStep(): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: 'probe', spec: 'spec' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

function workspace(): PreparedWorkspace {
  return {
    cwd: '/ws',
    baseRepoDir: '/repo',
    branch: 'cairn/b1',
    defaultBranch: 'main',
    reused: false,
  };
}

function gitOps(push: (calls: number) => Promise<void>) {
  const calls: string[] = [];
  const git: WorktreeOps = {
    prepare: async () => workspace(),
    commitAll: async () => ({ committed: true, head: 'abc123', setupDrift: [] }),
    push: async () => {
      calls.push('push');
      await push(calls.length);
    },
    mergeDefaultBranch: async () => ({ output: '' }),
    headCommit: async () => 'abc123',
    countAhead: async () => 1,
    commitsAhead: async () => ['abc123'],
    currentBranch: async () => 'cairn/b1',
    restoreCheckpoint: async () => {},
    cleanupOrphans: async () => [],
  };
  return { git, calls };
}

function input(git: WorktreeOps) {
  return {
    git,
    ws: workspace(),
    claimed: claimedBuildStep(),
    stepId: 's1',
    appIdentity: null,
    identity: { name: 'cairn[bot]', email: 'bot@test' },
    mergeCredential: null,
    headAtStart: 'base000',
    stepStartMs: 0,
    runGit: async (operation: (credential: BoundGitCredentials | null) => Promise<void>) => {
      await operation(null);
      return 'machine' as const;
    },
    headCommit: null,
    hasChanges: true,
    lastError: null,
    stopped: false,
    closes: true,
    note: () => {},
    log: () => {},
    logRaw: () => {},
  };
}

describe('settleStepGit failed-build preservation', () => {
  test('a permanent push rejection is not preserved again', async () => {
    const { git, calls } = gitOps(async () => {
      throw new Error(WORKFLOW_REJECTION);
    });
    const settled = await settleStepGit(input(git));
    expect(settled.preservedCommits).toEqual([]);
    expect(settled.lastError).toBe(
      'GitHub refused to push workflow changes: the runner credential lacks Workflows permission. Remove the workflow changes or ask a repository maintainer to push them separately before retrying.',
    );
    expect(calls).toEqual(['push']);
  });

  test('a workflow permission rejection during preservation also reports the refusal', async () => {
    const { git, calls } = gitOps(async () => {
      throw new Error(WORKFLOW_REJECTION);
    });
    const settled = await settleStepGit({
      ...input(git),
      closes: false,
      lastError: 'connection reset by peer',
    });
    expect(settled.preservedCommits).toEqual([]);
    expect(settled.lastError).toBe(
      'GitHub refused to push workflow changes: the runner credential lacks Workflows permission. Remove the workflow changes or ask a repository maintainer to push them separately before retrying.',
    );
    expect(calls).toEqual(['push']);
  });

  test('a runner error resembling a permanent Git rejection still preserves commits', async () => {
    const { git, calls } = gitOps(async () => {});
    const lastError = 'provider request failed: error: 404';
    const settled = await settleStepGit({ ...input(git), closes: false, lastError });
    expect(settled.preservedCommits).toEqual(['abc123']);
    expect(settled.lastError).toBe(lastError);
    expect(calls).toEqual(['push']);
  });

  test('a closing error before push does not suppress preservation', async () => {
    const { git, calls } = gitOps(async () => {});
    const message = 'pre-commit check failed: error: 404';
    git.commitAll = async () => {
      throw new Error(message);
    };
    const settled = await settleStepGit(input(git));
    expect(settled.preservedCommits).toEqual(['abc123']);
    expect(settled.lastError).toBe(message);
    expect(calls).toEqual(['push']);
  });

  test('a transient push failure still preserves the failed build once', async () => {
    const { git, calls } = gitOps(async (calls) => {
      if (calls === 1) throw new Error('fatal: the remote end hung up unexpectedly');
    });
    const settled = await settleStepGit(input(git));
    expect(settled.preservedCommits).toEqual(['abc123']);
    expect(calls).toEqual(['push', 'push']);
  });
});
