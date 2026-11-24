import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
  WorktreeOps,
} from '@cairn/shared';
import { buildWorkBranchNote, conversationBranch } from '@cairn/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { testTempDir } from './test-temp-dir.js';

const probeMock = vi.fn();
vi.mock('../src/github-probe.js', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/github-probe.js')>()) as {
    githubRepoRefOf: unknown;
  };
  return { ...real, probeGithubPr: (...args: unknown[]) => probeMock(...args) };
});

const CONV_BRANCH = conversationBranch('conv-1');

function captureLogger(): { logger: DaemonLogger; lines: string[] } {
  const lines: string[] = [];
  const push = (prefix: string | undefined, msg: string) =>
    lines.push(prefix ? `[${prefix}] ${msg}` : msg);
  const logger: DaemonLogger = {
    raw: (msg) => push(undefined, msg),
    prefixed: (prefix, msg) => push(prefix, msg),
    supervisor: (msg) => push('supervisor', msg),
    machine: (msg) => push('machine', msg),
    step: (msg) => push('step', msg),
    workspace: (msg) => push('workspace', msg),
    recover: (msg) => push('recover', msg),
    wake: (msg) => push('wake', msg),
    mcp: (msg) => push('mcp', msg),
    skills: (msg) => push('skills', msg),
    gate: (msg) => push('gate', msg),
    trust: (msg) => push('trust', msg),
  };
  return { logger, lines };
}

function claimedGithubStep(kind: 'build' | 'review' = 'build'): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '分支偏离探针', spec: '改一行' },
    project: {
      id: 'p1',
      name: 'demo',
      repo: { kind: 'github', cloneUrl: 'https://github.com/octocat/Hello-World.git' },
    },
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

function claimedBareStep(): ClaimedStep {
  const c = claimedGithubStep();
  return { ...c, project: { id: 'p1', name: 'demo', repo: null } };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: (TranscriptUpload | string)[] = [];

  async enroll(): Promise<never> {
    throw new Error('unused');
  }
  async me(): Promise<never> {
    throw new Error('unused');
  }
  async presence() {
    return { ok: true as const };
  }
  async recover() {
    return { steps: [] };
  }
  async claim() {
    return null;
  }
  async heartbeat() {}
  async tool(_stepId: string, _call: ToolCallRecord) {}
  async transcriptDelta() {}
  async relayTool() {
    return '{}';
  }
  async token() {
    return {
      provider: {
        kind: 'http' as const,
        providerId: 'stub-gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions' as const,
        authHeader: true,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: {},
      git: null,
    };
  }
  async skillsManifest() {
    return { selection: 'whitelist' as const, skills: [] };
  }
  async skillFile(): Promise<Buffer> {
    throw new Error('unexpected skillFile call');
  }
  async uploadUrls(_stepId: string, files: { name: string }[]) {
    return {
      uploads: files.map((f, i) => ({
        name: f.name,
        url: `http://server/up/${i}`,
        method: 'PUT' as const,
        headers: {},
      })),
    };
  }
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    this.uploads.push(body);
  }
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

interface FakeOpts {
  headBranch?: string | null;
  ahead?: number;
  workBranches?: string[];
  withNewMethods?: boolean;
  headAfterStep?: string | null;
  landedOnDefault?: boolean;
  commitsSince?: boolean;
}

function fakeWorkspace(cwd: string, opts: FakeOpts) {
  const scanCalls: { base: string; sinceMs: number }[] = [];
  const mutCalls: string[] = [];
  let headReads = 0;
  const base: WorktreeOps = {
    async prepare() {
      mkdirSync(cwd, { recursive: true });
      return {
        cwd,
        baseRepoDir: join(cwd, '..', 'repo'),
        branch: CONV_BRANCH,
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      mutCalls.push('commitAll');
      return { committed: false, head: 'def456', setupDrift: [] };
    },
    async push() {
      mutCalls.push('push');
    },
    async mergeDefaultBranch() {
      mutCalls.push('mergeDefaultBranch');
      return { output: 'Already up to date' };
    },
    async headCommit() {
      headReads += 1;
      if (headReads > 1 && opts.headAfterStep !== undefined) return opts.headAfterStep;
      return 'abc123';
    },
    async countAhead() {
      return opts.ahead ?? 0;
    },
    async restoreCheckpoint() {},
    async cleanupOrphans() {
      return [];
    },
  };
  if (opts.withNewMethods !== false) {
    Object.assign(base, {
      async currentBranch() {
        return opts.headBranch ?? CONV_BRANCH;
      },
      async branchesWithNewCommits(_cwd: string, baseCommit: string, sinceMs: number) {
        scanCalls.push({ base: baseCommit, sinceMs });
        return opts.workBranches ?? [];
      },
      async fetchBranch() {
        return true;
      },
      async isAncestor() {
        return opts.landedOnDefault ?? false;
      },
      async hasCommitsSince() {
        return opts.commitsSince ?? false;
      },
    } satisfies Partial<WorktreeOps>);
  }
  return { ws: base, scanCalls, mutCalls };
}

function doneBackend(): AgentBackend {
  return {
    capabilities: {
      name: 'stub',
      thinkingLevels: [],
      oauthProviders: [],
      compaction: false,
      sessionResume: false,
    },
    async createSession() {
      const handle: AgentSessionHandle = {
        sessionId: 'pi-sess-1',
        events: (async function* () {
          yield { type: 'text_delta', text: '干活' } as StepEvent;
          yield { type: 'done', usage: [] } as StepEvent;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
      return handle;
    },
    async continueSession() {
      throw new Error('unused');
    },
  };
}

interface RunOpts {
  claimed?: ClaimedStep;
  fake: FakeOpts;
  probeByBranch?: Record<string, { number: number; url: string }>;
}

async function runOnce(opts: RunOpts): Promise<{
  body: MachineDoneBody;
  client: FakeClient;
  scanCalls: { base: string; sinceMs: number }[];
  mutCalls: string[];
  lines: string[];
}> {
  probeMock.mockReset();
  probeMock.mockImplementation(
    async (o: { branch: string }) => opts.probeByBranch?.[o.branch] ?? null,
  );
  const home = testTempDir('cairn-runner-drift-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const backend = doneBackend();
  const { ws, scanCalls, mutCalls } = fakeWorkspace(join(home, 'ws', 'conv-1'), opts.fake);
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger,
      paths,
      workspace: ws,
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    opts.claimed ?? claimedGithubStep(),
  );
  expect(client.doneBodies).toHaveLength(1);
  return { body: client.doneBodies[0]!.body, client, scanCalls, mutCalls, lines };
}

function transcriptOf(client: FakeClient): TranscriptUpload['messages'] {
  const up = client.uploads.find(
    (u): u is TranscriptUpload => typeof u !== 'string' && Array.isArray(u.messages),
  );
  return up?.messages ?? [];
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('observe-only closing on GitHub repos and passive branch/landing detection', () => {
  test('HEAD on an agent-chosen branch with commits → observe-only, hasChanges=true, no drift warning, PR probed on that branch', async () => {
    const { body, client, mutCalls } = await runOnce({
      fake: { headBranch: 'dogfood/tracer-1153', ahead: 1 },
      probeByBranch: {
        'dogfood/tracer-1153': {
          number: 9,
          url: 'https://github.com/octocat/Hello-World/pull/9',
        },
      },
    });
    expect(mutCalls).toEqual([]);
    expect(body.status).toBe('success');
    expect(body.hasChanges).toBe(true);
    expect(body.workBranchDrift).toBeUndefined();
    expect(body.prNumber).toBe(9);
    expect(transcriptOf(client).find((m) => m.id === 'branch-drift-s1')).toBeUndefined();
  });

  test('commits landed directly onto origin/main (e.g. via push-queue) → hasChanges=true and landed note recorded', async () => {
    const { body, client, mutCalls } = await runOnce({
      fake: {
        headBranch: CONV_BRANCH,
        ahead: 0,
        headAfterStep: 'landed7890abcdef1234567890abcdef12345678',
        landedOnDefault: true,
        commitsSince: true,
      },
    });
    expect(mutCalls).toEqual([]);
    expect(body.status).toBe('success');
    expect(body.hasChanges).toBe(true);
    expect(body.workBranchDrift).toBeUndefined();
    const landedRow = transcriptOf(client).find((m) => m.id === 'landed-s1');
    expect(landedRow?.content).toContain('landed7');
    expect(landedRow?.content).toContain('origin/main');
  });

  test('failure mode 2 (accident shape): HEAD switched back to the session branch, self-created branch keeps new commits → claimed by the union surface + PR backfilled to the candidate head', async () => {
    const { body, mutCalls } = await runOnce({
      fake: { headBranch: CONV_BRANCH, ahead: 0, workBranches: ['dogfood/tracer-1153'] },
      probeByBranch: {
        'dogfood/tracer-1153': {
          number: 5,
          url: 'https://github.com/octocat/Hello-World/pull/5',
        },
      },
    });
    expect(mutCalls).toEqual([]);
    expect(body.hasChanges).toBe(true);
    expect(body.workBranchDrift).toBeUndefined();
    expect(body.prUrl).toBe('https://github.com/octocat/Hello-World/pull/5');
    expect(body.prNumber).toBe(5);
    const heads = probeMock.mock.calls.map((c) => (c[0] as { branch: string }).branch);
    expect(heads[0]).toBe(CONV_BRANCH);
    expect(heads).toContain('dogfood/tracer-1153');
  });

  test('failure mode 3: HEAD on another branch with commits nowhere → hasChanges=false and no drift error', async () => {
    const { body, mutCalls } = await runOnce({
      fake: { headBranch: 'dogfood/empty', ahead: 0, workBranches: [] },
    });
    expect(mutCalls).toEqual([]);
    expect(body.hasChanges).toBe(false);
    expect(body.workBranchDrift).toBeUndefined();
  });

  test('failure mode 4: no drift and no commits → hasChanges=false and no drift field (current behavior pinned)', async () => {
    const { body } = await runOnce({ fake: { headBranch: CONV_BRANCH, ahead: 0 } });
    expect(body.hasChanges).toBe(false);
    expect(body.workBranchDrift).toBeUndefined();
  });

  test("failure mode 5: a neighboring session branch has new commits → not counted as this step's artifact (shared base repo not misattributed)", async () => {
    const { body } = await runOnce({
      fake: {
        headBranch: CONV_BRANCH,
        ahead: 0,
        workBranches: ['cairn/conv-0198f6c0-1111-7000-8000-111111111111'],
      },
    });
    expect(body.hasChanges).toBe(false);
    const heads = probeMock.mock.calls.map((c) => (c[0] as { branch: string }).branch);
    expect(heads).toEqual([CONV_BRANCH]);
  });

  test('failure mode 6: old-implementation stub (new optional method absent) → behavior identical to current (fail-open)', async () => {
    const { body } = await runOnce({
      fake: { ahead: 0, withNewMethods: false },
    });
    expect(body.status).toBe('success');
    expect(body.hasChanges).toBe(false);
    expect(body.workBranchDrift).toBeUndefined();
  });

  test('failure mode 7: currentBranch null (detached/query failed) → no drift, no crash', async () => {
    const { body } = await runOnce({ fake: { headBranch: null, ahead: 0 } });
    expect(body.status).toBe('success');
    expect(body.workBranchDrift).toBeUndefined();
  });

  test('failure mode 8: probing capped at 3 times (conv + drift + first candidate)', async () => {
    await runOnce({
      fake: { headBranch: 'd1', ahead: 0, workBranches: ['c1', 'c2'] },
    });
    expect(probeMock.mock.calls).toHaveLength(3);
    const heads = probeMock.mock.calls.map((c) => (c[0] as { branch: string }).branch);
    expect(heads).toEqual([CONV_BRANCH, 'd1', 'c1']);
  });

  test('failure mode 10: scan inputs = step-start checkpoint + step-window start wall clock', async () => {
    const before = Date.now();
    const { scanCalls } = await runOnce({ fake: { headBranch: CONV_BRANCH, ahead: 0 } });
    const after = Date.now();
    expect(scanCalls.length).toBeGreaterThan(0);
    expect(scanCalls[0]!.base).toBe('abc123');
    expect(scanCalls[0]!.sinceMs).toBeGreaterThanOrEqual(before - 60_000);
    expect(scanCalls[0]!.sinceMs).toBeLessThanOrEqual(after);
  });
});

describe('#1195 working-branch annotation delivery surface (prevention half)', () => {
  test('failure mode 9: repo-bound build step prompt last line = working-branch annotation (includes the contract branch name)', async () => {
    const { client } = await runOnce({ fake: { headBranch: CONV_BRANCH } });
    const promptRow = transcriptOf(client).find((m) => m.id === 'user-s1');
    expect(promptRow).toBeDefined();
    expect(String(promptRow?.content ?? '').endsWith(buildWorkBranchNote(CONV_BRANCH))).toBe(true);
  });

  test('review step carries no annotation (read-only step has no delivery contract)', async () => {
    const review = claimedGithubStep('review');
    const { client } = await runOnce({ claimed: review, fake: { headBranch: CONV_BRANCH } });
    const promptRow = transcriptOf(client).find((m) => m.id === 'user-s1');
    expect(promptRow?.content ?? '').not.toContain('工作分支注记');
  });

  test('no-repo step carries no annotation (bare task directory has no branch contract to speak of)', async () => {
    const { client } = await runOnce({ claimed: claimedBareStep(), fake: {} });
    const promptRow = transcriptOf(client).find((m) => m.id === 'user-s1');
    expect(promptRow).toBeDefined();
    expect(promptRow?.content).not.toContain('工作分支注记');
  });
});
