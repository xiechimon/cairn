// runner repo 形态接线（spec 12 G2-T2，#362）：local/github kind 进入
// worktree 契约 + local merge 步 push 后 ff-only 落回用户仓库。
// harness 同 runner-stop.test.ts（FakeClient + fake WorktreeOps 录制调用序）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. local merge 步：prepare 开 worktree（cloneUrl = 用户仓库路径）→
//      commitAll → mergeDefaultBranch → push（凭证 null）→
//      landLocalFastForward(用户仓库, conv 分支)，序在 push 之后；done success
//   2. landing 抛错（git 自拒）→ done failed，errorMessage 含 git 拒绝原文
//   3. github merge 步：prepare 开 worktree（https clone）→ push 消费 per-step
//      凭证 {x-access-token, token}；收尾探测同消费 per-step token（#966：
//      探测经 mock，真实网络面不进单测）；不触发 landing（v1 done = conv 分支已推上）
//   4. local build 步：push 照常，不触发 landing（落地仅 merge 步）
//   5. 无 repo 项目（repo null）：不开 worktree，裸任务目录退化形不变
//   6.（XMON-77 权限闸）merge 步 tools 携带但缺任一开关 → 会话/工作区之前
//      failStep（done failed，errorMessage 点名缺失开关；无 prepare/commit）
//   7.（XMON-77）merge 步双开关齐 → 失败方式 1 全流程不变
//   8.（XMON-77）build 步缺「推送分支」→ commitAll 照做、push/landing 不做、
//      done success（软拒：提交留本地工作分支）+ transcript 落 push-skip
//      system 行（用户合并前看得见为何没推上去）
//   9.（XMON-77）tools 缺省（老 server 版本墙）→ 两闸均不生效（fail-open）

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
} from '@pacman/shared';
import { PLAN_FILE_NAME } from '@pacman/shared';
import { describe, expect, test, vi } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

// #966 flake 根因：github 形态步成功收尾时 runStep 会调 probeGithubPr——真
// gh CLI + api.github.com 双梯，各带 10s 预算。本文件只有失败方式 3 命中它：
// 真实网络往返实测 ~2.1s（同文件其余用例 1–6ms），5s 默认超时只剩 ~2.9s
// 余量，高载 CI（168 workers）上被吃满——签名恒为「恰好跑满 5000ms」而非
// 断言红（shim `gh` sleep 6s 可稳定复现同款超时）。真实网络面不进单测：
// 探测梯行为钉在 github-probe.test.ts，本文件改钉「探测消费 per-step 凭证」
// 语义边界；mock 形态与 runner-delivery.test.ts（#704）同款。
const probeMock = vi.fn();
vi.mock('../src/github-probe.js', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/github-probe.js')>()) as {
    githubRepoRefOf: unknown;
  };
  return { ...real, probeGithubPr: (...args: unknown[]) => probeMock(...args) };
});

const USER_REPO = '/tmp/pacman-user-repo-probe';
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
      // XMON-77：tools 携带才判权限；缺省 = 老 server 形（fail-open 面）。
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
    // #920：默认空清单 = 零团队技能（selection=whitelist，既有断言零扰动）。
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

/** 录制型 fake worktree：全操作进 calls；landing 可注入失败。 */
function fakeWorkspace(opts: { landError?: string } = {}) {
  const calls: string[] = [];
  const pushes: { branch: string; cred: GitCredentials | null }[] = [];
  const ws: WorktreeOps = {
    async prepare(input) {
      calls.push(`prepare:${input.cloneUrl}`);
      return {
        cwd: join(input.workspacesRoot, input.conversationId),
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `pacman/conv-${input.conversationId}`,
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
    async landLocalFastForward(userRepoDir, branch) {
      calls.push(`landLocalFastForward:${userRepoDir}:${branch}`);
      if (opts.landError) throw new Error(opts.landError);
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

/** 自然完成 backend：text_delta + done（无工具行——git 真值面接管 hasChanges）。 */
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

async function setup(
  claimed: ClaimedStep,
  opts: { landError?: string; git?: GitCredentials | null } = {},
) {
  probeMock.mockReset();
  // 不存在的仓库（o/r）的真值：gh / REST 双梯 404 → null（面板 PR 槽留空）。
  probeMock.mockResolvedValue(null);
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-local-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  client.git = opts.git ?? null;
  const journal = new StepJournal(paths.outboxDir);
  const { ws, calls, pushes } = fakeWorkspace(
    opts.landError !== undefined ? { landError: opts.landError } : {},
  );
  const deps = {
    client,
    journal,
    backendFor: () => completingBackend(),
    logger,
    paths,
    workspace: ws,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'), // runner-stop 同款占位（步无 mcpServers slug = 不读）
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimed);
  return { client, calls, pushes, lines, paths };
}

describe('runner repo 形态接线（spec 12 G2-T2）', () => {
  test('失败方式 1：local merge 步 → worktree + push 回用户仓库 + ff-only 落地（序在 push 后）+ done success', async () => {
    const { client, calls } = await setup(
      claimedStep('merge', { kind: 'local', cloneUrl: USER_REPO }),
    );
    expect(calls).toContain(`prepare:${USER_REPO}`);
    expect(calls).toContain('mergeDefaultBranch');
    expect(calls).toContain('push:pacman/conv-conv-1');
    expect(calls).toContain(`landLocalFastForward:${USER_REPO}:pacman/conv-conv-1`);
    expect(calls.indexOf('push:pacman/conv-conv-1')).toBeLessThan(
      calls.indexOf(`landLocalFastForward:${USER_REPO}:pacman/conv-conv-1`),
    );
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('失败方式 2：landing git 自拒 → done failed，errorMessage 含拒绝原文', async () => {
    const refusal =
      'git merge --ff-only pacman/conv-conv-1 refused: fatal: Not possible to fast-forward, aborting.';
    const { client } = await setup(claimedStep('merge', { kind: 'local', cloneUrl: USER_REPO }), {
      landError: refusal,
    });
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('Not possible to fast-forward');
  });

  // #966 双保险：探测 mock 后本用例回到毫秒级，显式预算留给高载 CI 的调度
  // 噪音——「偶发慢」不再误报，「真挂」仍会在上限处失败。
  test('失败方式 3：github merge 步 → worktree（https clone）+ push 消费 per-step 凭证；不触发 landing', {
    timeout: 20_000,
  }, async () => {
    const { client, calls, pushes } = await setup(
      claimedStep('merge', { kind: 'github', cloneUrl: 'https://github.com/o/r.git' }),
      { git: GITHUB_TOKEN },
    );
    expect(calls).toContain('prepare:https://github.com/o/r.git');
    expect(pushes[0]!.cred).toEqual(GITHUB_TOKEN);
    // 探测面同消费 per-step 凭证：token 进 gh/REST 梯（#704 同款钉法）。
    expect(probeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'o',
        repo: 'r',
        branch: 'pacman/conv-conv-1',
        token: GITHUB_TOKEN.password,
      }),
    );
    expect(calls.some((c) => c.startsWith('landLocalFastForward'))).toBe(false);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('失败方式 4：local build 步 → push 照常、无 landing（落地仅 merge 步）', async () => {
    const { calls } = await setup(claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }));
    expect(calls).toContain(`prepare:${USER_REPO}`);
    expect(calls).toContain('push:pacman/conv-conv-1');
    expect(calls.some((c) => c.startsWith('landLocalFastForward'))).toBe(false);
    expect(calls).not.toContain('mergeDefaultBranch');
  });

  test('失败方式 5：repo null → 不开 worktree（裸任务目录退化形不变）', async () => {
    const { calls } = await setup(claimedStep('build', null));
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(calls.some((c) => c.startsWith('push'))).toBe(false);
  });
});

describe('runner 权限闸：合并分支/推送分支（XMON-77）', () => {
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

  test('失败方式 6：merge 步 tools 携带但缺任一开关 → 会话前 failStep，errorMessage 点名缺失档', async () => {
    const { client, calls } = await setup(
      claimedStep('merge', { kind: 'local', cloneUrl: USER_REPO }, { tools: ['合并分支'] }),
    );
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('推送分支');
    // 闸在会话/工作区之前：无 prepare、无 commit、无 push。
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(calls).not.toContain('commitAll');
    expect(calls.some((c) => c.startsWith('push'))).toBe(false);
  });

  test('失败方式 6b：merge 步全关（[]）→ 同拒，两开关齐点名', async () => {
    const { client } = await setup(
      claimedStep('merge', { kind: 'local', cloneUrl: USER_REPO }, { tools: [] }),
    );
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('合并分支');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('推送分支');
  });

  test('失败方式 7：merge 步双开关齐 → 失败方式 1 全流程不变', async () => {
    const { client, calls } = await setup(
      claimedStep(
        'merge',
        { kind: 'local', cloneUrl: USER_REPO },
        {
          tools: ['合并分支', '推送分支'],
        },
      ),
    );
    expect(calls).toContain('mergeDefaultBranch');
    expect(calls).toContain('push:pacman/conv-conv-1');
    expect(calls).toContain(`landLocalFastForward:${USER_REPO}:pacman/conv-conv-1`);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('失败方式 8：build 步缺「推送分支」→ 提交留本地，push/landing 不做，transcript 落 push-skip 行', async () => {
    const { client, calls, paths, lines } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }, { tools: ['合并分支'] }),
    );
    expect(calls).toContain('commitAll');
    expect(calls.some((c) => c.startsWith('push'))).toBe(false);
    expect(calls.some((c) => c.startsWith('landLocalFastForward'))).toBe(false);
    // 软拒：步本身成功（提交在本地工作分支），拒的是推送。
    expect(client.doneBodies[0]!.body.status).toBe('success');
    const skip = transcriptRows(paths).find((r) => r.id === 'push-skip-s1');
    expect(skip?.role).toBe('system');
    expect(String(skip?.content)).toContain('推送分支');
    expect(lines.some((l) => l.includes('推送分支'))).toBe(true);
  });

  test('失败方式 8b：build 步持「推送分支」→ push 照常', async () => {
    const { calls } = await setup(
      claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }, { tools: ['推送分支'] }),
    );
    expect(calls).toContain('push:pacman/conv-conv-1');
  });

  test('失败方式 9：tools 缺省（老 server 版本墙）→ 两闸 fail-open，push 照常', async () => {
    const { calls } = await setup(claimedStep('build', { kind: 'local', cloneUrl: USER_REPO }));
    expect(calls).toContain('push:pacman/conv-conv-1');
  });
});

describe('runner plan 步交接位置（#1203：plan.md 搬出 repo checkout）', () => {
  /** 真实 git 检出当 conv 工作区（local-repo 形态：工作区根 = repo checkout，
   *  正是 plan.md 撞仓库根的形态）。 */
  function gitCheckout(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-plan-checkout-'));
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
        'user.email=probe@pacman.test',
        'commit',
        '--allow-empty',
        '-m',
        'seed',
      ],
      { encoding: 'utf8' },
    );
    return dir;
  }

  /** 听话 agent：按投递注记行解析交接位置，把 plan.md 写到那里。 */
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

  test('local-repo plan 步：交接位置在 repo 检出外 → 检出 git status 零 plan.md（未跟踪也没有）+ plan 上传在案', async () => {
    probeMock.mockReset();
    probeMock.mockResolvedValue(null);
    const checkout = gitCheckout();
    const home = mkdtempSync(join(tmpdir(), 'pacman-runner-plan-local-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const client = new FakeClient();
    const journal = new StepJournal(paths.outboxDir);
    const ws: WorktreeOps = {
      async prepare(input) {
        return {
          cwd: checkout,
          baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
          branch: `pacman/conv-${input.conversationId}`,
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
      async landLocalFastForward() {},
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

    // 验收正面：checkout 里 plan.md 未跟踪也没有。
    expect(existsSync(join(checkout, PLAN_FILE_NAME))).toBe(false);
    const status = execFileSync('git', ['-C', checkout, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
    expect(status).toBe('');
    // 交接位置真在 repo 检出外（PACMAN_HOME 面）。
    expect(notePaths).toEqual([join(home, 'plans', 'conv-1', PLAN_FILE_NAME)]);
    expect(notePaths[0]?.startsWith(checkout)).toBe(false);
    // 方案仍被收集上传（「打开方案」读面的数据源）。
    expect(client.uploadNames).toEqual([['transcript.json', PLAN_FILE_NAME]]);
    const planPut = client.uploads.find((u) => u.url === 'http://server/up/1');
    expect(planPut?.body).toBe('# 方案\nContext: x\nChanges: y');
  });

  test('fresh-session 返工轮：残留在新交接位的上一轮 plan.md 随回退清掉（#113 闸语义保持）', async () => {
    probeMock.mockReset();
    probeMock.mockResolvedValue(null);
    const checkout = gitCheckout();
    const home = mkdtempSync(join(tmpdir(), 'pacman-runner-plan-rewind-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const client = new FakeClient();
    const journal = new StepJournal(paths.outboxDir);
    const ws: WorktreeOps = {
      async prepare(input) {
        return {
          cwd: checkout,
          baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
          branch: `pacman/conv-${input.conversationId}`,
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
      async landLocalFastForward() {},
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
    // 上一轮残留在新交接位的 plan.md（旧位残渣此前随 clean -fd 消失）。
    const stalePlan = join(home, 'plans', 'conv-1', PLAN_FILE_NAME);
    mkdirSync(join(home, 'plans', 'conv-1'), { recursive: true });
    writeFileSync(stalePlan, '# 上一轮旧方案');
    // lazy 轮：backend 全程不写任何文件（agent 无视交接指令的形状）。
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
    // 回退把残渣清掉：lazy 轮（agent 未写）收不到旧方案——#113 闸的
    // 「重试后仍空」判定不被旧残渣绕过。
    expect(existsSync(stalePlan)).toBe(false);
    expect(client.uploadNames).toEqual([['transcript.json']]);
  });
});
