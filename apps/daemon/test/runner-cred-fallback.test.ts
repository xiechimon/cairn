// runner 凭据降级收尾单测（#1225 票面「clone/push 凭据序」的 push 半 + 凭据
// 来源行上浮）。harness 同 runner-local.test.ts（FakeClient + fake WorktreeOps
// 录制调用序；github-probe 走 mock——真实网络面不进单测）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. github + per-step token auth 失败 → push 以 machine（null cred）二发
//      成功；transcript 落 git-credential 行（来源 machine，不含 token 值）；
//      done success
//   2. github + token 有效 → 单发 push（cred = token）；来源行 = integration
//      （集成有效时行为不变）
//   3. github + 两路都 auth 失败 → done failed，errorMessage 点名两路
//      （per-step token + machine credentials，票失败方式 1）
//   4. hosted + auth 失败 → 单发 push（绝不 null 二发）+ 无 git-credential 行
//      （票失败方式 3：hosted 仍走 server per-step key，行为不动）
//   5. local + push 失败 → 单发，无降级无来源行（local 无凭据面）

import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
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
  WorktreeOps,
} from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

// 同 runner-local.test.ts 的 #966 防 Flake 钉法：github 步收尾探测走 mock。
const probeMock = vi.fn();
vi.mock('../src/github-probe.js', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/github-probe.js')>()) as {
    githubRepoRefOf: unknown;
  };
  return { ...real, probeGithubPr: (...args: unknown[]) => probeMock(...args) };
});

const GITHUB_TOKEN: GitCredentials = { username: 'x-access-token', password: 'ghp_steptoken' };
/** runner 交给 push 的凭证 = token 响应绑定 claim 的 cloneUrl（#1484）。 */
const GITHUB_STEP_CRED = { ...GITHUB_TOKEN, url: 'https://github.com/o/r.git' };
/** 票 #1225 现象段原文（mea 2026-10-11 实测 push 失败 stderr）。 */
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

/** fake worktree：push 行为可编程（按 cred 分派），prepare 可声明来源。 */
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

/** 自然完成 backend（无工具行——git 真值面接管 hasChanges）。 */
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
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-cred-'));
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

/** outbox transcript 行（TranscriptBuffer 落盘面，journal.ts）。 */
function transcriptRows(paths: {
  outboxDir: string;
}): { id: string; role: string; content: unknown }[] {
  return JSON.parse(readFileSync(join(paths.outboxDir, 'step-s1.transcript.json'), 'utf8')) as {
    id: string;
    role: string;
    content: unknown;
  }[];
}

describe('runner push 凭据降级 + 来源行（#1225）', () => {
  test('失败方式 1：github token auth 失败 → machine 二发成功，来源行 machine（不含 token 值），done success', async () => {
    const workspace = fakeWorkspace({
      pushWithToken: () => {
        throw new Error(MEA_AUTH_FAILURE);
      },
    });
    const { client, lines, paths } = await setup(
      claimedStep('build', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN, workspace },
    );
    // integration 一发（auth 失败）+ machine 二发（成功）。
    expect(workspace.pushes).toEqual([
      { branch: 'cairn/conv-conv-1', cred: GITHUB_STEP_CRED },
      { branch: 'cairn/conv-conv-1', cred: null },
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    // 来源行：machine；transcript 与日志都不携带 token 值（票失败方式 2）。
    const row = transcriptRows(paths).find((r) => r.id === 'git-credential-s1');
    expect(row?.role).toBe('system');
    expect(String(row?.content)).toContain('machine');
    const allText = `${JSON.stringify(transcriptRows(paths))}\n${lines.join('\n')}`;
    expect(allText).not.toContain(GITHUB_TOKEN.password);
    // 降级日志行在（原文回传）。
    expect(lines.some((l) => l.includes('machine credentials'))).toBe(true);
  }, 20_000);

  test('失败方式 2：github token 有效 → 单发 push（cred = token），来源行 integration', async () => {
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

  test('失败方式 3：github 两路都 auth 失败 → done failed，errorMessage 点名两路', async () => {
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
    // 步失败面上浮（done.errorMessage 点名两路）；来源行保留 prepare 报告的
    // 来源（fake prepare 走了 integration——行事实与 push 失败分属两个面）。
    const row = transcriptRows(paths).find((r) => r.id === 'git-credential-s1');
    expect(String(row?.content)).toContain('integration');
    // token 值不进任何面（票失败方式 2）。
    expect(`${msg}\n${JSON.stringify(transcriptRows(paths))}`).not.toContain(GITHUB_TOKEN.password);
  }, 20_000);

  test('失败方式 4：hosted auth 失败 → 单发 push、无降级、无来源行（server per-step key 不动）', async () => {
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

  test('失败方式 5：local push 失败 → 单发无降级、无来源行', async () => {
    const workspace = fakeWorkspace({
      pushWithMachine: () => {
        throw new Error('push failed (128): bad object');
      },
    });
    const { client, paths } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: '/tmp/user-repo' }),
      { git: null, workspace },
    );
    // local：cred null（现行为），失败原错误直抛——不套凭据序。
    expect(workspace.pushes).toEqual([{ branch: 'cairn/conv-conv-1', cred: null }]);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(String(client.doneBodies[0]!.body.errorMessage)).toContain('bad object');
    expect(transcriptRows(paths).some((r) => r.id === 'git-credential-s1')).toBe(false);
  }, 20_000);

  test('失败方式 6：prepare 已降级（来源 machine）→ 来源行随 prepare 上浮（push 未再触发的轮次也可见）', async () => {
    const workspace = fakeWorkspace({
      credentialSource: 'machine',
      // push 成功但持推送闸缺——不推，只留 prepare 的来源行。
    });
    const claimed = claimedStep(
      'build',
      { kind: 'github', cloneUrl: 'https://github.com/o/r.git' },
      {
        tools: ['合并分支'], // 缺「推送分支」→ push 软拒
      },
    );
    const { client, paths } = await setup(claimed, { git: GITHUB_TOKEN, workspace });
    expect(workspace.pushes).toHaveLength(0);
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const row = transcriptRows(paths).find((r) => r.id === 'git-credential-s1');
    expect(String(row?.content)).toContain('machine');
  }, 20_000);
});
