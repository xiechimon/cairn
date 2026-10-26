import { mkdirSync, readFileSync } from 'node:fs';

import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  GitCredentials,
  MachineDoneBody,
  MachineStreamEvent,
  ToolCallRecord,
  WorktreeOps,
} from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
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

const GITHUB_TOKEN: GitCredentials = { username: 'x-access-token', password: 'ghp_steptoken' };
const GITHUB_STEP_CRED = { ...GITHUB_TOKEN, url: 'https://github.com/o/r.git' };
const MEA_AUTH_FAILURE =
  'remote: Invalid username or token. Password authentication is not supported.\n' +
  "fatal: Authentication failed for 'https://github.com/xiechimon/cairn.git/'";

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
    skills: (msg) => push('skills', msg),
    gate: (msg) => push('gate', msg),
    trust: (msg) => push('trust', msg),
    mcp: (msg) => push('mcp', msg),
  };
  return { logger, lines };
}

function claimedStep(
  kind: 'build' | 'merge',
  repo: NonNullable<ClaimedStep['project']>['repo'],
  opts: { tools?: string[] } = {},
): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'cred fallback', spec: '改一行' },
    project: { id: 'p1', name: 'demo', repo },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
      ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
    },
  };
}

class FakeClient implements MachineApi {
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  git: GitCredentials | null = null;

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
    this.calls.push('token');
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
      git: this.git,
    };
  }
  async skillsManifest() {
    return { selection: 'whitelist' as const, skills: [] };
  }
  async skillFile(): Promise<Buffer> {
    throw new Error('unexpected skillFile call');
  }
  async attachment(): Promise<never> {
    throw new Error('unused');
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
  async putUpload() {}
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
    this.calls.push(`done:${stepId}:${body.status}`);
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult() {}
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function fakeWorkspace(opts: {
  pushWithToken?: () => Promise<void>;
  pushWithMachine?: () => Promise<void>;
  credentialSource?: 'integration' | 'machine';
}) {
  const calls: string[] = [];
  const pushes: { branch: string; cred: GitCredentials | null }[] = [];
  const ws: WorktreeOps = {
    async prepare(input) {
      calls.push(`prepare:${input.cloneUrl}`);
      return {
        cwd: join(input.workspacesRoot, input.conversationId),
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: false,
        ...(opts.credentialSource !== undefined ? { credentialSource: opts.credentialSource } : {}),
      };
    },
    async commitAll() {
      calls.push('commitAll');
      return { committed: true, head: 'abc123' };
    },
    async push(_cwd, branch, cred) {
      calls.push(`push:${branch}`);
      pushes.push({ branch, cred });
      const script = cred !== null ? opts.pushWithToken : opts.pushWithMachine;
      await script?.();
    },
    async mergeDefaultBranch() {
      calls.push('mergeDefaultBranch');
      return { output: 'Already up to date' };
    },
    async headCommit() {
      return 'abc123';
    },
    async countAhead() {
      return 1;
    },
    async restoreCheckpoint() {},
    async cleanupOrphans() {
      return [];
    },
  };
  return { ws, calls, pushes };
}

function completingBackend(): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(): Promise<AgentSessionHandle> {
      return {
        sessionId: 'pi-sess-cred',
        events: (async function* () {
          yield { type: 'text_delta', text: 'ok' } as never;
          yield { type: 'done', usage: [] } as never;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
    },
    async continueSession(): Promise<never> {
      throw new Error('unused');
    },
  };
}

async function setup(
  claimed: ClaimedStep,
  opts: {
    git?: GitCredentials | null;
    workspace: ReturnType<typeof fakeWorkspace>;
  },
) {
  probeMock.mockReset();
  probeMock.mockResolvedValue(null);
  const home = makeTestTempDir('cairn-runner-cred-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  client.git = opts.git ?? null;
  const journal = new StepJournal(paths.outboxDir);
  mkdirSync(join(home, 'workspaces'), { recursive: true });
  await runStep(
    {
      client,
      journal,
      backendFor: () => completingBackend(),
      logger,
      paths,
      workspace: opts.workspace.ws,
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimed,
  );
  return { client, lines, paths };
}

function transcriptRows(paths: {
  outboxDir: string;
}): { id: string; role: string; content: unknown }[] {
  return JSON.parse(readFileSync(join(paths.outboxDir, 'step-s1.transcript.json'), 'utf8')) as {
    id: string;
    role: string;
    content: unknown;
  }[];
}

describe('runner push credential fallback + provenance line (#1225)', () => {
  test('failure mode 1: github token auth failure → machine second attempt succeeds, provenance line machine (no token value), done success', async () => {
    const workspace = fakeWorkspace({
      pushWithToken: () => {
        throw new Error(MEA_AUTH_FAILURE);
      },
    });
    const { client, lines, paths } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN, workspace },
    );
    expect(workspace.pushes).toEqual([
      { branch: 'cairn/conv-conv-1', cred: GITHUB_STEP_CRED },
      { branch: 'cairn/conv-conv-1', cred: null },
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const row = transcriptRows(paths).find((r) => r.id === 'git-credential-s1');
    expect(row?.role).toBe('system');
    expect(String(row?.content)).toContain('machine');
    const allText = `${JSON.stringify(transcriptRows(paths))}\n${lines.join('\n')}`;
    expect(allText).not.toContain(GITHUB_TOKEN.password);
    expect(lines.some((l) => l.includes('machine credentials'))).toBe(true);
  }, 20_000);

  test('failure mode 2: github token valid → single push (cred = token), provenance line integration', async () => {
    const workspace = fakeWorkspace({});
    const { client, paths } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN, workspace },
    );
    expect(workspace.pushes).toEqual([{ branch: 'cairn/conv-conv-1', cred: GITHUB_STEP_CRED }]);
    const row = transcriptRows(paths).find((r) => r.id === 'git-credential-s1');
    expect(String(row?.content)).toContain('integration');
    expect(client.doneBodies[0]!.body.status).toBe('success');
  }, 20_000);

  test('failure mode 3: github auth fails on both paths → done failed, errorMessage names both paths', async () => {
    const workspace = fakeWorkspace({
      pushWithToken: () => {
        throw new Error(MEA_AUTH_FAILURE);
      },
      pushWithMachine: () => {
        throw new Error("fatal: could not read Username for 'https://github.com'");
      },
    });
    const { client, paths } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN, workspace },
    );
    expect(workspace.pushes).toHaveLength(2);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    const msg = String(client.doneBodies[0]!.body.errorMessage);
    expect(msg).toContain('per-step token');
    expect(msg).toContain('Invalid username or token');
    expect(msg).toContain('machine credentials');
    expect(msg).toContain('could not read Username');
    const row = transcriptRows(paths).find((r) => r.id === 'git-credential-s1');
    expect(String(row?.content)).toContain('integration');
    expect(`${msg}\n${JSON.stringify(transcriptRows(paths))}`).not.toContain(GITHUB_TOKEN.password);
  }, 20_000);

  test('failure mode 4: hosted auth failure → single push, no fallback, no provenance line (server per-step key untouched)', async () => {
    const workspace = fakeWorkspace({
      pushWithToken: () => {
        throw new Error(MEA_AUTH_FAILURE);
      },
    });
    const { client, paths } = await setup(
      claimedStep('build', { kind: 'hosted', cloneUrl: 'http://server/git/t/r' }),
      { git: { username: 'git', password: 'hosted_step_key' }, workspace },
    );
    expect(workspace.pushes).toHaveLength(1);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(String(client.doneBodies[0]!.body.errorMessage)).toContain('Authentication failed');
    expect(transcriptRows(paths).some((r) => r.id === 'git-credential-s1')).toBe(false);
  }, 20_000);

  test('failure mode 5: local push failure → single attempt, no fallback, no provenance line', async () => {
    const workspace = fakeWorkspace({
      pushWithMachine: () => {
        throw new Error('push failed (128): bad object');
      },
    });
    const { client, paths } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: '/tmp/user-repo' }),
      { git: null, workspace },
    );
    expect(workspace.pushes).toEqual([{ branch: 'cairn/conv-conv-1', cred: null }]);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(String(client.doneBodies[0]!.body.errorMessage)).toContain('bad object');
    expect(transcriptRows(paths).some((r) => r.id === 'git-credential-s1')).toBe(false);
  }, 20_000);

  test('failure mode 6: prepare already fell back (provenance machine) → provenance line surfaces with prepare (visible even on rounds where push never fired)', async () => {
    const workspace = fakeWorkspace({
      credentialSource: 'machine',
    });
    const claimed = claimedStep(
      'build',
      { kind: 'github', cloneUrl: 'https://github.com/o/r.git' },
      {
        tools: ['合并分支'],
      },
    );
    const { client, paths } = await setup(claimed, { git: GITHUB_TOKEN, workspace });
    expect(workspace.pushes).toHaveLength(0);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const row = transcriptRows(paths).find((r) => r.id === 'git-credential-s1');
    expect(String(row?.content)).toContain('machine');
  }, 20_000);
});
