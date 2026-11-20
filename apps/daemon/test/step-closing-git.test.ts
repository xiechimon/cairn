import type { ClaimedStep, CommitIdentity, PreparedWorkspace, WorktreeOps } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { commitAndPushStep } from '../src/step-closing-git.js';

const IDENTITY: CommitIdentity = { name: 'it-agent', email: 'it@cairn.local' };
const CONV = '01a1f4b6-d715-75d1-9fc7-3649c2dd0df6';

function claimedStep(kind: ClaimedStep['step']['kind'], title: string): ClaimedStep {
  return {
    step: { id: `step-${kind}`, buildId: 'build-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: CONV,
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 5378, title, spec: '修 runner 的会话命名提交' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  } as ClaimedStep;
}

interface Captured {
  messages: string[];
}

function fakeGit(captured: Captured): WorktreeOps {
  return {
    async commitAll(_cwd: string, message: string) {
      captured.messages.push(message);
      return { committed: true, head: 'abc123', setupDrift: [], preexisting: [] };
    },
    async countAhead() {
      return 1;
    },
    async currentBranch() {
      return `cairn/conv-${CONV}`;
    },
    async headCommit() {
      return 'abc123';
    },
  } as unknown as WorktreeOps;
}

function workspace(): PreparedWorkspace {
  return {
    cwd: '/tmp/does-not-matter',
    baseRepoDir: '/tmp/does-not-matter/repo',
    branch: `cairn/conv-${CONV}`,
    defaultBranch: 'main',
    reused: false,
  } as PreparedWorkspace;
}

async function subjectFor(
  kind: ClaimedStep['step']['kind'],
  title = '修 runner 的会话命名提交',
): Promise<string> {
  const captured: Captured = { messages: [] };
  await commitAndPushStep({
    git: fakeGit(captured),
    ws: workspace(),
    claimed: claimedStep(kind, title),
    stepId: `step-${kind}`,
    identity: IDENTITY,
    mergeCredential: null,
    headAtStart: null,
    stepStartMs: 0,
    push: async () => 'machine',
    note: () => {},
    log: () => {},
    logRaw: () => {},
  });
  return captured.messages[0] ?? '';
}

describe('the closing commit subject is English and derived from the step, not the owner text', () => {
  test('a step over a Chinese task title commits an ASCII subject naming the task number', async () => {
    const subject = await subjectFor('build');

    expect(subject).toMatch(/^build: [\x20-\x7e]+$/);
    expect(subject).toBe('build: apply the task changes (task 5378)');
    expect(subject).not.toMatch(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/);
  }, 30_000);

  test('every step kind has its own English subject', async () => {
    const kinds = ['plan', 'build', 'session', 'merge', 'chief', 'review', 'verify'] as const;
    const subjects = await Promise.all(kinds.map((kind) => subjectFor(kind)));

    for (const [index, subject] of subjects.entries()) {
      expect(subject).toMatch(/^[a-z]+: [\x20-\x7e]+$/);
      expect(subject.startsWith(`${kinds[index]}: `)).toBe(true);
      expect(subject).toContain('(task 5378)');
    }
    expect(new Set(subjects).size).toBe(kinds.length);
  }, 30_000);

  test('a step with no task names its conversation instead of an empty title', async () => {
    const captured: Captured = { messages: [] };
    const claimed = { ...claimedStep('chief', 'ignored'), todo: undefined } as ClaimedStep;
    await commitAndPushStep({
      git: fakeGit(captured),
      ws: workspace(),
      claimed,
      stepId: 'step-chief',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: null,
      stepStartMs: 0,
      push: async () => 'machine',
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });

    expect(captured.messages[0]).toBe('chief: run a coordinator turn (conversation 01a1f4b6)');
  }, 30_000);
});
