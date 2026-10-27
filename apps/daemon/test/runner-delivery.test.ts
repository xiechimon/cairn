import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { CHANGES_DIFF_MAX_BYTES } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { GitPushHookError } from '../src/git.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const probeMock = vi.fn();
vi.mock('../src/github-probe.js', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/github-probe.js')>()) as {
    githubRepoRefOf: unknown;
  };
  return { ...real, probeGithubPr: (...args: unknown[]) => probeMock(...args) };
});

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
    todo: { id: 't1', seqNum: 3, title: '交付面探针', spec: '改一行' },
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

function claimedHostedStep(): ClaimedStep {
  return {
    ...claimedGithubStep(),
    project: {
      id: 'p1',
      name: 'demo',
      repo: { kind: 'hosted', cloneUrl: 'http://server/git/t1/demo' },
    },
  };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];

  async enroll(): Promise<never> {
    throw new Error('unused');
  }
  async me(): Promise<never> {
    throw new Error('unused');
  }
  async presence() {}
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
  async putUpload(
    _url: string,
    _headers: Record<string, string>,
    _body: TranscriptUpload | string,
  ) {}
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function fakeWorkspace(cwd: string, diff: string | null) {
  const calls: string[] = [];
  const ws: WorktreeOps = {
    async prepare() {
      calls.push('prepare');
      return {
        cwd,
        baseRepoDir: join(cwd, '..', 'repo'),
        branch: 'cairn/conv-conv-1',
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      calls.push('commitAll');
      return { committed: true, head: 'def456' };
    },
    async push() {
      calls.push('push');
    },
    async mergeDefaultBranch() {
      calls.push('mergeDefaultBranch');
      return { output: 'Already up to date' };
    },
    async headCommit() {
      calls.push('headCommit');
      return 'abc123';
    },
    async countAhead() {
      return 1;
    },
    ...(diff !== null
      ? {
          async diffAgainstDefault(_cwd: string, defaultBranch: string) {
            calls.push(`diffAgainstDefault:${defaultBranch}`);
            return diff;
          },
        }
      : {}),
    async restoreCheckpoint(_cwd: string, commit: string) {
      calls.push(`restoreCheckpoint:${commit}`);
    },
    async cleanupOrphans() {
      return [];
    },
  };
  return { ws, calls };
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
  kind?: 'build' | 'review';
  claimed: ClaimedStep;
  probe: { number: number; url: string } | null | Error;
  diff: string | null;
  pushError?: Error;
}

async function runOnce(opts: RunOpts): Promise<MachineDoneBody> {
  probeMock.mockReset();
  if (opts.probe instanceof Error) probeMock.mockRejectedValue(opts.probe);
  else probeMock.mockResolvedValue(opts.probe);
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-delivery-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const backend = doneBackend();
  const { ws } = fakeWorkspace(join(home, 'ws', 'conv-1'), opts.diff);
  if (opts.pushError)
    ws.push = async () => {
      throw opts.pushError;
    };
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
    opts.claimed,
  );
  expect(client.doneBodies).toHaveLength(1);
  return client.doneBodies[0]!.body;
}

const SAMPLE_DIFF = 'diff --git a/README.md b/README.md\n@@ -1 +1,2 @@\n hello\n+probe\n';

describe('runner delivery surface reporting (#704)', () => {
  test('failure mode 1: github build step + probe hit → done carries PR + changesDiff', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: { number: 606, url: 'https://github.com/octocat/Hello-World/pull/606' },
      diff: SAMPLE_DIFF,
    });
    expect(body.status).toBe('success');
    expect(body.prUrl).toBe('https://github.com/octocat/Hello-World/pull/606');
    expect(body.prNumber).toBe(606);
    expect(body.changesDiff).toBe(SAMPLE_DIFF);
    expect(probeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'octocat',
        repo: 'Hello-World',
        branch: 'cairn/conv-conv-1',
        token: null,
      }),
    );
  });

  test('failure mode 2: probe null (no PR/failure) → done carries no PR field', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: null,
      diff: SAMPLE_DIFF,
    });
    expect(body.prUrl).toBeUndefined();
    expect(body.prNumber).toBeUndefined();
    expect(body.changesDiff).toBe(SAMPLE_DIFF);
  });

  test('probe throws → swallowed with a log line, done carries no PR field (no failure, no retry)', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: new Error('gh missing'),
      diff: SAMPLE_DIFF,
    });
    expect(body.status).toBe('success');
    expect(body.prUrl).toBeUndefined();
  });

  test('failure mode 3: hosted step → no probing, no reporting (truth source = server bare repo)', async () => {
    const body = await runOnce({
      claimed: claimedHostedStep(),
      probe: { number: 1, url: 'u' },
      diff: SAMPLE_DIFF,
    });
    expect(probeMock).not.toHaveBeenCalled();
    expect(body.prUrl).toBeUndefined();
    expect(body.changesDiff).toBeUndefined();
  });

  test('failure mode 4: diff over the cap → changesDiff absent', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: null,
      diff: `+${'x'.repeat(CHANGES_DIFF_MAX_BYTES + 1)}`,
    });
    expect(body.changesDiff).toBeUndefined();
  });

  test('failure mode 5: github review step → read-only step produces no delivery-surface facts', async () => {
    const body = await runOnce({
      kind: 'review',
      claimed: claimedGithubStep('review'),
      probe: { number: 606, url: 'u' },
      diff: SAMPLE_DIFF,
    });
    expect(probeMock).not.toHaveBeenCalled();
    expect(body.changesDiff).toBeUndefined();
  });
});

describe('#1829 closing push report', () => {
  test('a local hook rejection reports recovery input and still discovers the agent-opened PR', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: { number: 1829, url: 'https://github.com/octocat/Hello-World/pull/1829' },
      diff: SAMPLE_DIFF,
      pushError: new GitPushHookError('lint stdout\nlint stderr'),
    });
    expect(body).toMatchObject({
      status: 'success',
      pushHookOutput: 'lint stdout\nlint stderr',
      prNumber: 1829,
      hasChanges: true,
    });
    expect(body.errorMessage).toBeUndefined();
  });

  test('an ordinary push error still fails the step', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: null,
      diff: SAMPLE_DIFF,
      pushError: new Error('Connection refused'),
    });
    expect(body).toMatchObject({ status: 'failed', errorMessage: 'Connection refused' });
    expect(body.pushHookOutput).toBeUndefined();
  });
});
