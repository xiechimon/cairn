import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  WorkspaceHookNoteData,
  WorktreeOps,
} from '@cairn/shared';
import { GIT_CREDENTIAL_ROW_KIND, systemRowOf } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { gitPrim } from '../src/git.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
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
  refreshError: MachineApiError | undefined;
  tokenExtras: Record<string, unknown> = {};

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
  async token(_stepId: string, _generation: number | undefined, opts?: { refresh?: boolean }) {
    this.calls.push('token');
    if (opts?.refresh && this.refreshError !== undefined) throw this.refreshError;
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
      ...this.tokenExtras,
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
  hooks?: WorkspaceHookNoteData[];
}) {
  const calls: string[] = [];
  const pushes: { branch: string; cred: GitCredentials | null }[] = [];
  const ws: WorktreeOps = {
    async prepare(input) {
      calls.push(`prepare:${input.cloneUrl}`);
      const cwd = join(input.workspacesRoot, input.conversationId);
      mkdirSync(cwd, { recursive: true });
      return {
        cwd,
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: false,
        ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
        ...(opts.credentialSource !== undefined ? { credentialSource: opts.credentialSource } : {}),
      };
    },
    async commitAll() {
      calls.push('commitAll');
      return { committed: true, head: 'abc123', setupDrift: [] };
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
    refreshError?: MachineApiError;
    hookNotes?: WorkspaceHookNoteData[];
    now?: () => number;
    tokenExtras?: Record<string, unknown>;
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
  client.refreshError = opts.refreshError;
  client.tokenExtras = opts.tokenExtras ?? {};
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
    { hookNotes: opts.hookNotes },
  );
  return { client, lines, paths };
}

function transcriptRows(client: FakeClient): TranscriptUpload['messages'] {
  return client.transcripts.at(-1)?.messages ?? [];
}

describe('runner push credentials: hosted keeps daemon credentials, external uses host git/gh', () => {
  test('github repo uses machine credentials directly without per-step token override', async () => {
    const workspace = fakeWorkspace({});
    const { client } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN, workspace },
    );
    expect(workspace.pushes).toEqual([{ branch: 'cairn/conv-conv-1', cred: null }]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const row = transcriptRows(client).find((r) => r.id === 'git-credential-s1');
    expect(row?.role).toBe('system');
    expect(systemRowOf(row?.content)).toEqual({ kind: GIT_CREDENTIAL_ROW_KIND, source: 'machine' });
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

  test('hosted auth failure fails in a single push with no machine fallback and no provenance line', async () => {
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

  test('local push failure fails in a single attempt with no fallback and no provenance line', async () => {
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

  test('a local repo push that succeeds writes no git credential row', async () => {
    const workspace = fakeWorkspace({});
    const { client } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: '/tmp/user-repo' }),
      { git: null, workspace },
    );
    expect(workspace.pushes).toEqual([{ branch: 'cairn/conv-conv-1', cred: null }]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    expect(transcriptRows(client).some((r) => r.id === 'git-credential-s1')).toBe(false);
  }, 20_000);

  test('prepare provenance machine surfaces even on rounds where push never fired', async () => {
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
    expect(systemRowOf(row?.content)).toEqual({ kind: GIT_CREDENTIAL_ROW_KIND, source: 'machine' });
  }, 20_000);
});

test.each(['github', 'hosted'] as const)(
  'hosted repo injects scoped git credentials while external github leaves host git/gh untouched: %s',
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
            kind === 'hosted'
              ? opts.env?.GH_TOKEN === undefined &&
                opts.env?.CAIRN_GIT_CRED_PASSWORD === GITHUB_TOKEN.password
              : opts.env?.GH_TOKEN === undefined &&
                opts.env?.GITHUB_TOKEN === undefined &&
                opts.env?.CAIRN_GIT_CRED_PASSWORD === undefined &&
                opts.env?.GH_CONFIG_DIR === undefined;
        },
      },
    );
    expect(applied).toBe(true);
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

test('hosted step shell credentials are erased when backend session creation fails', async () => {
  let held: SessionOpts['env'];
  const { client } = await setup(
    claimedStep('build', { kind: 'hosted', cloneUrl: 'http://server/git/t/r' }),
    {
      git: GITHUB_TOKEN,
      workspace: fakeWorkspace({}),
      onSession: (opts) => {
        held = opts.env;
        throw new Error('backend unavailable');
      },
    },
  );
  expect(client.doneBodies[0]?.body.status).toBe('failed');
  expect(held?.CAIRN_GIT_CRED_PASSWORD === undefined).toBe(true);
});

test.each(
  ['workspace', 'orb'].flatMap((source) =>
    (['quote', 'backslash', 'tab'] as const).map((caseName) => [source, caseName] as const),
  ),
)('hook credentials are redacted before serialization: %s / %s', async (source, caseName) => {
  const delimiter = { quote: 34, backslash: 92, tab: 9 }[caseName];
  const password = `fixture-${String.fromCharCode(delimiter)}-credential-value`;
  const output = `before ${password} after\n`;
  const hook: WorkspaceHookNoteData = {
    name: 'setup',
    status: 'ok',
    exitCode: 0,
    ms: 50,
    output,
    totalChars: output.length + 17,
  };
  let persisted: TranscriptUpload['messages'] = [];
  const { client } = await setup(
    claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
    {
      git: { ...GITHUB_TOKEN, password },
      workspace: fakeWorkspace(source === 'workspace' ? { hooks: [hook] } : {}),
      ...(source === 'orb' ? { hookNotes: [hook] } : {}),
      onSession: (session) => {
        persisted = JSON.parse(
          readFileSync(join(session.cwd, '..', '..', 'outbox', 'step-s1.transcript.json'), 'utf8'),
        ) as TranscriptUpload['messages'];
      },
    },
  );
  expect(client.doneBodies[0]?.body.status).toBe('success');
  for (const messages of [persisted, transcriptRows(client)]) {
    const hooks = messages
      .map((row) => systemRowOf(row.content))
      .filter((row) => row?.kind === 'workspace-hook');
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.name).toBe('setup');
    expect.soft(hooks[0]?.output === 'before [REDACTED] after').toBe(true);
    expect(hooks[0]?.omittedChars).toBe(17);
  }
});

test('a granted connector reaches the session and its credential never reaches the transcript', async () => {
  const linear = {
    slug: 'linear',
    transport: 'http' as const,
    url: 'https://mcp.linear.app/mcp',
    headers: {
      Authorization: 'Bearer lin-access-123',
      'X-MCP-Readonly': 'true',
      'X-Api-Version': '2',
    },
  };
  let mounted: SessionOpts['mcpServers'];
  const { client, lines } = await setup(
    { ...claimedStep('build', { kind: 'local', cloneUrl: '/tmp/repo' }), mcpServers: ['linear'] },
    {
      workspace: fakeWorkspace({}),
      tokenExtras: {
        mcpConnectors: [
          linear,
          { slug: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/' },
        ],
      },
      onSession: (opts) => {
        mounted = opts.mcpServers;
      },
      echo: 'saw lin-access-123 and readonly true on api 2',
    },
  );
  expect(mounted).toEqual([linear]);
  const text = JSON.stringify(transcriptRows(client));
  expect(text).not.toContain('lin-access-123');
  expect(text).toContain('[REDACTED]');
  expect(text).toContain('readonly true on api 2');
  expect(client.doneBodies.map((d) => d.body.status)).toEqual(['success']);
  expect(lines.join('\n')).not.toContain('lin-access-123');
  expect(lines.filter((l) => l.startsWith('[mcp] loaded from'))).toEqual([
    expect.stringMatching(/: \(none\); from connectors: linear$/),
  ]);
});
