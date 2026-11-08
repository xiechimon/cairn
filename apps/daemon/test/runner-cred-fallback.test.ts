import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  GitCredentials,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
  WorktreeOps,
} from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { gitPrim } from '../src/git.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { WorkspaceManager } from '../src/workspace.js';
import { testTempDir } from './test-temp-dir.js';

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
  transcripts: TranscriptUpload[] = [];
  sessionUploads: string[] = [];
  git: GitCredentials | null = null;
  replacement: GitCredentials | null = null;

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
      git:
        this.calls.filter((call) => call === 'token').length > 1
          ? (this.replacement ?? this.git)
          : this.git,
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
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    if (typeof body !== 'string') this.transcripts.push(body);
    else this.sessionUploads.push(body);
  }
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
  currentBranch?: string | null;
  commitsAhead?: string[];
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
    async currentBranch() {
      return opts.currentBranch ?? null;
    },
    async commitsAhead() {
      return opts.commitsAhead ?? [];
    },
    async restoreCheckpoint() {},
    async cleanupOrphans() {
      return [];
    },
  };
  return { ws, calls, pushes };
}

function completingBackend(
  onSession?: (opts: SessionOpts) => void | Promise<void>,
  echo?: string,
  sessionFile?: string,
): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts): Promise<AgentSessionHandle> {
      await onSession?.(opts);
      return {
        sessionId: 'pi-sess-cred',
        ...(sessionFile ? { sessionFile } : {}),
        events: (async function* () {
          if (echo) {
            yield { type: 'text_delta', text: echo.slice(0, 5) } as never;
            yield { type: 'text_delta', text: echo.slice(5) } as never;
          } else yield { type: 'text_delta', text: 'ok' } as never;
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
    onSession?: (opts: SessionOpts) => void | Promise<void>;
    echo?: string;
    sessionText?: string;
    replacement?: GitCredentials;
    now?: () => number;
  },
) {
  probeMock.mockReset();
  probeMock.mockResolvedValue(null);
  const home = testTempDir('cairn-runner-cred-');
  const sessionFile = join(home, 'session.jsonl');
  if (opts.sessionText) writeFileSync(sessionFile, opts.sessionText);
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  client.git = opts.git ?? null;
  client.replacement = opts.replacement ?? null;
  const journal = new StepJournal(paths.outboxDir);
  mkdirSync(join(home, 'workspaces'), { recursive: true });
  await runStep(
    {
      ...(opts.now ? { now: opts.now } : {}),
      client,
      journal,
      backendFor: () =>
        completingBackend(opts.onSession, opts.echo, opts.sessionText ? sessionFile : undefined),
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

function transcriptRows(client: FakeClient): TranscriptUpload['messages'] {
  return client.transcripts.at(-1)?.messages ?? [];
}

describe('runner push credential fallback + provenance line (#1225)', () => {
  test('failure mode 1: github token auth failure → machine second attempt succeeds, provenance line machine (no token value), done success', async () => {
    const workspace = fakeWorkspace({
      pushWithToken: () => {
        throw new Error(MEA_AUTH_FAILURE);
      },
    });
    const { client, lines } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN, workspace },
    );
    expect(workspace.pushes).toEqual([
      { branch: 'cairn/conv-conv-1', cred: GITHUB_STEP_CRED },
      { branch: 'cairn/conv-conv-1', cred: null },
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const row = transcriptRows(client).find((r) => r.id === 'git-credential-s1');
    expect(row?.role).toBe('system');
    expect(String(row?.content)).toContain('machine');
    const allText = `${JSON.stringify(transcriptRows(client))}\n${lines.join('\n')}`;
    expect(allText).not.toContain(GITHUB_TOKEN.password);
    expect(lines.some((l) => l.includes('machine credentials'))).toBe(true);
  }, 20_000);

  test('a push that fails twice with connection reset and then succeeds does not fail the build', async () => {
    vi.useFakeTimers();
    try {
      let pushAttempts = 0;
      vi.spyOn(gitPrim, 'push').mockImplementation(async () => {
        pushAttempts += 1;
        if (pushAttempts < 3) throw new Error('Recv failure: Connection reset by peer');
      });
      const workspace = fakeWorkspace({});
      const manager = new WorkspaceManager({ logger: captureLogger().logger });
      workspace.ws.push = (cwd, branch, cred) =>
        manager.push(cwd, branch, cred, {
          base: null,
          identity: null,
          coAuthor: null,
        });
      const pending = setup(
        claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
        { git: GITHUB_TOKEN, workspace },
      );
      await vi.runAllTimersAsync();
      const { client } = await pending;
      expect(pushAttempts).toBe(3);
      expect(client.doneBodies[0]!.body.status).toBe('success');
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  }, 20_000);

  test('failure mode 2: github token valid → single push (cred = token), provenance line integration', async () => {
    const workspace = fakeWorkspace({});
    const { client } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN, workspace },
    );
    expect(workspace.pushes).toEqual([{ branch: 'cairn/conv-conv-1', cred: GITHUB_STEP_CRED }]);
    const row = transcriptRows(client).find((r) => r.id === 'git-credential-s1');
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
    const { client } = await setup(
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
    const row = transcriptRows(client).find((r) => r.id === 'git-credential-s1');
    expect(String(row?.content)).toContain('integration');
    expect(`${msg}\n${JSON.stringify(transcriptRows(client))}`).not.toContain(
      GITHUB_TOKEN.password,
    );
  }, 20_000);

  test('failure mode 4: hosted auth failure → single push, no fallback, no provenance line (server per-step key untouched)', async () => {
    const workspace = fakeWorkspace({
      pushWithToken: () => {
        throw new Error(MEA_AUTH_FAILURE);
      },
    });
    const { client } = await setup(
      claimedStep('build', { kind: 'hosted', cloneUrl: 'http://server/git/t/r' }),
      { git: { username: 'git', password: 'hosted_step_key' }, workspace },
    );
    expect(workspace.pushes).toHaveLength(1);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(String(client.doneBodies[0]!.body.errorMessage)).toContain('Authentication failed');
    expect(transcriptRows(client).some((r) => r.id === 'git-credential-s1')).toBe(false);
  }, 20_000);

  test('failure mode 5: local push failure → single attempt, no fallback, no provenance line', async () => {
    const workspace = fakeWorkspace({
      pushWithMachine: () => {
        throw new Error('push failed (128): bad object');
      },
    });
    const { client } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: '/tmp/user-repo' }),
      { git: null, workspace },
    );
    expect(workspace.pushes).toEqual([{ branch: 'cairn/conv-conv-1', cred: null }]);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(String(client.doneBodies[0]!.body.errorMessage)).toContain('bad object');
    expect(transcriptRows(client).some((r) => r.id === 'git-credential-s1')).toBe(false);
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
    const { client } = await setup(claimed, { git: GITHUB_TOKEN, workspace });
    expect(workspace.pushes).toHaveLength(0);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const row = transcriptRows(client).find((r) => r.id === 'git-credential-s1');
    expect(String(row?.content)).toContain('machine');
  }, 20_000);
});

test.each(['github', 'hosted'] as const)(
  'step shell GitHub credentials are scoped and erased for %s',
  async (kind) => {
    let held: SessionOpts['env'];
    let applied = false;
    const previous = process.env.GH_TOKEN;
    const { client, lines, paths } = await setup(
      claimedStep('build', {
        kind,
        cloneUrl: kind === 'github' ? 'https://github.com/o/r.git' : 'http://server/git/t/r',
      }),
      {
        git: GITHUB_TOKEN,
        workspace: fakeWorkspace({}),
        echo: GITHUB_TOKEN.password,
        onSession: (opts) => {
          held = opts.env;
          applied =
            kind === 'github'
              ? opts.env?.GH_TOKEN === GITHUB_TOKEN.password &&
                opts.env.GITHUB_TOKEN === GITHUB_TOKEN.password &&
                opts.env.CAIRN_GIT_CRED_PASSWORD === GITHUB_TOKEN.password
              : opts.env?.GH_TOKEN === undefined && opts.env?.CAIRN_GIT_CRED_PASSWORD === undefined;
        },
      },
    );
    expect(applied).toBe(true);
    expect(held?.GH_TOKEN === undefined).toBe(true);
    expect(held?.CAIRN_GIT_CRED_PASSWORD === undefined).toBe(true);
    expect(process.env.GH_TOKEN === previous).toBe(true);
    expect(JSON.stringify(transcriptRows(client)).includes(GITHUB_TOKEN.password)).toBe(false);
    expect(lines.join('\n').includes(GITHUB_TOKEN.password)).toBe(false);
    for (const file of readdirSync(paths.outboxDir)) {
      expect(
        readFileSync(join(paths.outboxDir, file), 'utf8').includes(GITHUB_TOKEN.password),
      ).toBe(false);
    }
  },
);

test('App git authentication failure never retries with machine user credentials', async () => {
  const workspace = fakeWorkspace({
    pushWithToken: async () => {
      throw new Error(MEA_AUTH_FAILURE);
    },
  });
  const { client } = await setup(
    claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
    { git: { ...GITHUB_TOKEN, kind: 'app' }, workspace },
  );
  expect(workspace.pushes).toHaveLength(2);
  expect(workspace.pushes.every((push) => push.cred?.kind === 'app')).toBe(true);
  expect(client.calls.filter((call) => call === 'token')).toHaveLength(2);
  expect(client.doneBodies[0]?.body.status).toBe('failed');
});

test.each([undefined, 'app'] as const)(
  'step shell credentials are erased when backend session creation fails: %s',
  async (kind) => {
    let held: SessionOpts['env'];
    let file: string | undefined;
    const { client } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      {
        git: { ...GITHUB_TOKEN, kind },
        workspace: fakeWorkspace({}),
        onSession: (opts) => {
          held = opts.env;
          file = opts.env?.CAIRN_GIT_CRED_FILE;
          throw new Error('backend unavailable');
        },
      },
    );
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(held?.GH_TOKEN === undefined).toBe(true);
    expect(held?.GITHUB_TOKEN === undefined).toBe(true);
    expect(held?.CAIRN_GIT_CRED_PASSWORD === undefined).toBe(true);
    if (kind === 'app') expect(file !== undefined && !existsSync(file)).toBe(true);
  },
);

test.each(['auth', 'age', 'twice'] as const)(
  'refreshes a long-step App credential once: %s',
  async (scenario) => {
    let clock = 1000;
    let attempts = 0;
    const replacement = {
      ...GITHUB_TOKEN,
      kind: 'app' as const,
      password: 'refreshed-fixture-value',
    };
    const workspace = fakeWorkspace({
      pushWithToken: async () => {
        attempts++;
        if (scenario === 'twice' || (scenario === 'auth' && attempts === 1))
          throw new Error(`Authentication failed ${replacement.password}`);
      },
    });
    const { client, lines, paths } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      {
        git: { ...GITHUB_TOKEN, kind: 'app' },
        replacement,
        sessionText: `${JSON.stringify({ text: `${GITHUB_TOKEN.password} ${replacement.password}` })}\n`,
        workspace,
        now: () => clock,
        onSession: () => {
          if (scenario === 'age') clock += 51 * 60000;
        },
      },
    );
    expect(client.calls.filter((call) => call === 'token')).toHaveLength(2);
    for (const file of readdirSync(paths.outboxDir)) {
      const content = readFileSync(join(paths.outboxDir, file), 'utf8');
      expect(
        content.includes(GITHUB_TOKEN.password) || content.includes(replacement.password),
      ).toBe(false);
    }
    expect(client.sessionUploads.length).toBeGreaterThan(0);
    expect(client.sessionUploads.join('').includes(GITHUB_TOKEN.password)).toBe(false);
    expect(workspace.pushes).toHaveLength(scenario === 'age' ? 1 : 2);
    expect(workspace.pushes.every((push) => push.cred?.kind === 'app')).toBe(true);
    expect(client.doneBodies[0]?.body.status).toBe(scenario === 'twice' ? 'failed' : 'success');
    expect(
      JSON.stringify([
        client.doneBodies,
        client.transcripts,
        client.sessionUploads,
        lines,
      ]).includes(replacement.password),
    ).toBe(false);
  },
);

test('App agent environment uses the step private credential files and cleanup erases them', async () => {
  let files: string[] = [];
  let privateEnv = false;
  const { client } = await setup(
    claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
    {
      git: { ...GITHUB_TOKEN, kind: 'app', expiresAt: Date.now() + 3600000 },
      workspace: fakeWorkspace({}),
      onSession: (opts) => {
        files = [
          opts.env?.CAIRN_GIT_CRED_FILE ?? '',
          join(opts.env?.GH_CONFIG_DIR ?? '', 'hosts.yml'),
        ];
        privateEnv =
          opts.env?.GH_TOKEN === undefined &&
          opts.env?.GITHUB_TOKEN === undefined &&
          opts.env?.CAIRN_GIT_CRED_PASSWORD === undefined &&
          files.every((file) => existsSync(file));
      },
    },
  );
  expect(privateEnv).toBe(true);
  expect(files.every((file) => !existsSync(file))).toBe(true);
  expect(client.doneBodies[0]?.body.status).toBe('success');
});

test('running App step refreshes the shell files and redacts both generations', async () => {
  vi.useFakeTimers();
  try {
    const replacement = {
      ...GITHUB_TOKEN,
      kind: 'app' as const,
      password: 'fixture-rotated-app',
      expiresAt: Date.now() + 120 * 60000,
    };
    let replaced = false;
    const { client, lines } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      {
        git: { ...GITHUB_TOKEN, kind: 'app', expiresAt: Date.now() + 3600000 },
        replacement,
        workspace: fakeWorkspace({}),
        echo: `${GITHUB_TOKEN.password} ${replacement.password}`,
        onSession: async (opts) => {
          const file = opts.env?.CAIRN_GIT_CRED_FILE ?? '';
          await vi.advanceTimersByTimeAsync(46 * 60000);
          replaced = existsSync(file) && readFileSync(file, 'utf8') === replacement.password;
        },
      },
    );
    expect(replaced).toBe(true);
    expect(client.calls.filter((call) => call === 'token')).toHaveLength(2);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    const output = JSON.stringify([client.transcripts, client.doneBodies, lines]);
    expect(output.includes(GITHUB_TOKEN.password) || output.includes(replacement.password)).toBe(
      false,
    );
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
