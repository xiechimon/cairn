import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  GitCredentials,
  MachineDoneBody,
  MachineStreamEvent,
  ToolCallRecord,
  TranscriptUpload,
  WorktreeOps,
} from '@cairn/shared';
import { LocalRepoUnreachableError, PLAN_FILE_NAME } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { WorkspaceManager } from '../src/workspace.js';

const probeMock = vi.fn();
vi.mock('../src/github-probe.js', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/github-probe.js')>()) as {
    githubRepoRefOf: unknown;
  };
  return { ...real, probeGithubPr: (...args: unknown[]) => probeMock(...args) };
});

const USER_REPO = '/tmp/cairn-user-repo-probe';
const GITHUB_TOKEN: GitCredentials = { username: 'x-access-token', password: 'ghp_steptoken' };

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
  kind: 'build' | 'merge' | 'plan',
  repo: NonNullable<ClaimedStep['project']>['repo'],
  opts: { tools?: string[] } = {},
): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'local 探针', spec: '改一行' },
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
  uploads: { url: string; body: TranscriptUpload | string }[] = [];
  uploadNames: string[][] = [];
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
    this.uploadNames.push(files.map((f) => f.name));
    return {
      uploads: files.map((f, i) => ({
        name: f.name,
        url: `http://server/up/${i}`,
        method: 'PUT' as const,
        headers: {},
      })),
    };
  }
  async putUpload(url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    this.uploads.push({ url, body });
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
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function fakeWorkspace(opts: { prepareError?: Error } = {}) {
  const calls: string[] = [];
  const pushes: { branch: string; cred: GitCredentials | null }[] = [];
  const ws: WorktreeOps = {
    async prepare(input) {
      calls.push(`prepare:${input.cloneUrl}`);
      if (opts.prepareError) throw opts.prepareError;
      return {
        cwd: join(input.workspacesRoot, input.conversationId),
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      calls.push('commitAll');
      return { committed: true, head: 'abc123' };
    },
    async push(_cwd, branch, cred) {
      calls.push(`push:${branch}`);
      pushes.push({ branch, cred });
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
        sessionId: 'pi-sess-local',
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

function probeWritingBackend(): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts): Promise<AgentSessionHandle> {
      writeFileSync(join(opts.cwd, 'probe.txt'), 'merge landing probe\n');
      return {
        sessionId: 'pi-sess-merge-real',
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

function seedUserRepo(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), '# user repo\n');
  git('add', '-A');
  execFileSync(
    'git',
    [
      '-C',
      dir,
      '-c',
      'user.name=probe',
      '-c',
      'user.email=probe@cairn.test',
      'commit',
      '--allow-empty',
      '-m',
      'seed',
    ],
    { encoding: 'utf8' },
  );
}

async function setup(
  claimed: ClaimedStep,
  opts: { git?: GitCredentials | null; machineName?: string; prepareError?: Error } = {},
) {
  probeMock.mockReset();
  probeMock.mockResolvedValue(null);
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-local-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  client.git = opts.git ?? null;
  const journal = new StepJournal(paths.outboxDir);
  const { ws, calls, pushes } = fakeWorkspace(
    opts.prepareError ? { prepareError: opts.prepareError } : {},
  );
  const deps = {
    client,
    journal,
    backendFor: () => completingBackend(),
    logger,
    paths,
    workspace: ws,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
    ...(opts.machineName !== undefined ? { machineName: opts.machineName } : {}),
  };
  await runStep(deps, claimed);
  return { client, calls, pushes, lines, paths };
}

describe('runner repo shape wiring (spec 12 G2-T2)', () => {
  test('failure mode 1: local merge step → worktree + push back to the user repo = the full landing chain (workspace operation sequence fully pinned, no fourth step) + done success', async () => {
    const { client, calls } = await setup(
      claimedStep('merge', { kind: 'local', cloneUrl: USER_REPO }),
    );
    expect(calls).toEqual([
      `prepare:${USER_REPO}`,
      'commitAll',
      'mergeDefaultBranch',
      'push:cairn/conv-conv-1',
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('failure mode 2 (#1211 truth surface): local merge step through the real git chain → user repo only gains the conv branch, HEAD/reflog/worktree unchanged', async () => {
    probeMock.mockReset();
    probeMock.mockResolvedValue(null);
    const userRepo = mkdtempSync(join(tmpdir(), 'cairn-user-main-'));
    seedUserRepo(userRepo);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', userRepo, ...args], { encoding: 'utf8' });
    const headBefore = git('rev-parse', 'HEAD').trim();
    const reflogBefore = git('reflog', 'main');

    const home = mkdtempSync(join(tmpdir(), 'cairn-runner-merge-real-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const client = new FakeClient();
    const journal = new StepJournal(paths.outboxDir);
    await runStep(
      {
        client,
        journal,
        backendFor: () => probeWritingBackend(),
        logger,
        paths,
        workspace: new WorkspaceManager({ logger }),
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
      },
      claimedStep('merge', { kind: 'local', cloneUrl: userRepo }),
    );

    expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore);
    expect(git('reflog', 'main')).toBe(reflogBefore);
    expect(existsSync(join(userRepo, 'probe.txt'))).toBe(false);
    expect(git('status', '--porcelain').trim()).toBe('');
    const branchSha = git('rev-parse', '--verify', 'refs/heads/cairn/conv-conv-1').trim();
    expect(branchSha).toMatch(/^[0-9a-f]{40}$/);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  }, 30_000);

  test('failure mode 3: github merge step → worktree (https clone) + push consumes per-step credentials', {
    timeout: 20_000,
  }, async () => {
    const { client, calls, pushes } = await setup(
      claimedStep('merge', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN },
    );
    expect(calls).toContain('prepare:https://github.com/o/r.git');
    expect(pushes[0]!.cred).toEqual({ ...GITHUB_TOKEN, url: 'https://github.com/o/r.git' });
    expect(probeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'o',
        repo: 'r',
        branch: 'cairn/conv-conv-1',
        token: GITHUB_TOKEN.password,
      }),
    );
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('failure mode 4: local build step → push as usual (conv branch pushed every step, user repo receives the branch)', async () => {
    const { calls } = await setup(claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }));
    expect(calls).toEqual([`prepare:${USER_REPO}`, 'commitAll', 'push:cairn/conv-conv-1']);
  });

  test('failure mode 5: repo null → no worktree opened (bare task directory degraded shape unchanged)', async () => {
    const { calls } = await setup(claimedStep('build', null));
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(calls.some((c) => c.startsWith('push'))).toBe(false);
  });
});

describe('runner permission gate: merge branch / push branch (XMON-77)', () => {
  function transcriptRows(paths: {
    outboxDir: string;
  }): { id: string; role: string; content: unknown }[] {
    return JSON.parse(readFileSync(join(paths.outboxDir, 'step-s1.transcript.json'), 'utf8')) as {
      id: string;
      role: string;
      content: unknown;
    }[];
  }

  test('failure mode 6: merge step carries tools but misses either switch → failStep before the session, errorMessage names the missing entry', async () => {
    const { client, calls } = await setup(
      claimedStep('merge', { kind: 'local', cloneUrl: USER_REPO }, { tools: ['合并分支'] }),
    );
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('推送分支');
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(calls).not.toContain('commitAll');
    expect(calls.some((c) => c.startsWith('push'))).toBe(false);
  });

  test('failure mode 6b: merge step with all switches off ([]) → same rejection, both switches named', async () => {
    const { client } = await setup(
      claimedStep('merge', { kind: 'local', cloneUrl: USER_REPO }, { tools: [] }),
    );
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('合并分支');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('推送分支');
  });

  test('failure mode 7: merge step with both switches on → failure mode 1 full flow unchanged', async () => {
    const { client, calls } = await setup(
      claimedStep(
        'merge',
        { kind: 'local', cloneUrl: USER_REPO },
        {
          tools: ['合并分支', '推送分支'],
        },
      ),
    );
    expect(calls).toEqual([
      `prepare:${USER_REPO}`,
      'commitAll',
      'mergeDefaultBranch',
      'push:cairn/conv-conv-1',
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('failure mode 8: build step missing "push branch" → commits stay local, no push, transcript lands a push-skip line', async () => {
    const { client, calls, paths, lines } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }, { tools: ['合并分支'] }),
    );
    expect(calls).toEqual([`prepare:${USER_REPO}`, 'commitAll']);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const skip = transcriptRows(paths).find((r) => r.id === 'push-skip-s1');
    expect(skip?.role).toBe('system');
    expect(String(skip?.content)).toContain('推送分支');
    expect(lines.some((l) => l.includes('推送分支'))).toBe(true);
  });

  test('failure mode 8b: build step with "push branch" → push as usual', async () => {
    const { calls } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }, { tools: ['推送分支'] }),
    );
    expect(calls).toContain('push:cairn/conv-conv-1');
  });

  test('failure mode 9: tools absent (old server version wall) → both gates fail-open, push as usual', async () => {
    const { calls } = await setup(claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }));
    expect(calls).toContain('push:cairn/conv-conv-1');
  });
});

describe('runner plan step handoff location (#1203: plan.md moved out of the repo checkout)', () => {
  function gitCheckout(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-plan-checkout-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-b', 'main');
    execFileSync(
      'git',
      [
        '-C',
        dir,
        '-c',
        'user.name=probe',
        '-c',
        'user.email=probe@cairn.test',
        'commit',
        '--allow-empty',
        '-m',
        'seed',
      ],
      { encoding: 'utf8' },
    );
    return dir;
  }

  function planWritingBackend(): {
    backend: AgentBackend;
    prompts: string[];
    notePaths: string[];
  } {
    const prompts: string[] = [];
    const notePaths: string[] = [];
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession(opts): Promise<AgentSessionHandle> {
        prompts.push(opts.prompt ?? '');
        const m = /plan\.md 交接位置：(.+?)。该位置在仓库检出之外/.exec(opts.prompt ?? '');
        if (m?.[1]) {
          notePaths.push(m[1]);
          writeFileSync(m[1], '# 方案\nContext: x\nChanges: y');
        }
        return {
          sessionId: 'pi-sess-plan',
          events: (async function* () {
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
    return { backend, prompts, notePaths };
  }

  test('local-repo plan step: handoff location outside the repo checkout → checkout git status shows no plan.md (not even untracked) + plan upload on record', async () => {
    probeMock.mockReset();
    probeMock.mockResolvedValue(null);
    const checkout = gitCheckout();
    const home = mkdtempSync(join(tmpdir(), 'cairn-runner-plan-local-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const client = new FakeClient();
    const journal = new StepJournal(paths.outboxDir);
    const ws: WorktreeOps = {
      async prepare(input) {
        return {
          cwd: checkout,
          baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
          branch: `cairn/conv-${input.conversationId}`,
          defaultBranch: 'main',
          reused: false,
        };
      },
      async commitAll() {
        return { committed: true, head: 'abc123' };
      },
      async push() {},
      async mergeDefaultBranch() {
        return { output: '' };
      },
      async headCommit() {
        return 'abc123';
      },
      async countAhead() {
        return 0;
      },
      async restoreCheckpoint() {},
      async cleanupOrphans() {
        return [];
      },
    };
    const { backend, notePaths } = planWritingBackend();
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
      claimedStep('plan', { kind: 'local', cloneUrl: checkout }),
    );

    expect(existsSync(join(checkout, PLAN_FILE_NAME))).toBe(false);
    const status = execFileSync('git', ['-C', checkout, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
    expect(status).toBe('');
    expect(notePaths).toEqual([join(home, 'plans', 'conv-1', PLAN_FILE_NAME)]);
    expect(notePaths[0]?.startsWith(checkout)).toBe(false);
    expect(client.uploadNames).toEqual([['transcript.json', PLAN_FILE_NAME]]);
    const planPut = client.uploads.find((u) => u.url === 'http://server/up/1');
    expect(planPut?.body).toBe('# 方案\nContext: x\nChanges: y');
  });

  test("fresh-session rework round: the previous round's plan.md left at the new handoff location is cleared on rollback (#113 gate semantics preserved)", async () => {
    probeMock.mockReset();
    probeMock.mockResolvedValue(null);
    const checkout = gitCheckout();
    const home = mkdtempSync(join(tmpdir(), 'cairn-runner-plan-rewind-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const client = new FakeClient();
    const journal = new StepJournal(paths.outboxDir);
    const ws: WorktreeOps = {
      async prepare(input) {
        return {
          cwd: checkout,
          baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
          branch: `cairn/conv-${input.conversationId}`,
          defaultBranch: 'main',
          reused: true,
        };
      },
      async commitAll() {
        return { committed: true, head: 'abc123' };
      },
      async push() {},
      async mergeDefaultBranch() {
        return { output: '' };
      },
      async headCommit() {
        return 'abc123';
      },
      async countAhead() {
        return 0;
      },
      async restoreCheckpoint() {},
      async cleanupOrphans() {
        return [];
      },
    };
    const stalePlan = join(home, 'plans', 'conv-1', PLAN_FILE_NAME);
    mkdirSync(join(home, 'plans', 'conv-1'), { recursive: true });
    writeFileSync(stalePlan, '# 上一轮旧方案');
    await runStep(
      {
        client,
        journal,
        backendFor: () => completingBackend(),
        logger,
        paths,
        workspace: ws,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
      },
      claimedStep('plan', { kind: 'local', cloneUrl: checkout }),
    );
    expect(existsSync(stalePlan)).toBe(false);
    expect(client.uploadNames).toEqual([['transcript.json']]);
  });
});

describe('runner local shape execution surface fail-loud (#1210 C fallback)', () => {
  test('failure mode 10: prepare throws LocalRepoUnreachableError → done failed, errorMessage names machine + path + remedy', async () => {
    const { client, calls } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: '/definitely/not/here/repo' }),
      {
        machineName: 'mea-probe',
        prepareError: new LocalRepoUnreachableError('/definitely/not/here/repo', 'not_found'),
      },
    );
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    const msg = client.doneBodies[0]!.body.errorMessage ?? '';
    expect(msg).toContain('mea-probe');
    expect(msg).toContain('/definitely/not/here/repo');
    expect(msg).toContain('路径不存在');
    expect(msg).toContain('GitHub 形态');
    expect(calls).not.toContain('commitAll');
    expect(calls.some((c) => c.startsWith('push'))).toBe(false);
  });

  test('failure mode 11: prepare throws a plain error → errorMessage passes the bare message through (regression)', async () => {
    const { client } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: '/definitely/not/here/repo' }),
      { machineName: 'mea-probe', prepareError: new Error('boom raw git noise') },
    );
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toBe('boom raw git noise');
  });
});
