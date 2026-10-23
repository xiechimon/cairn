// #1195 工作分支偏离检测 + 产物并集面：agent 在步内自建分支交付（commit/push
// 都在自己的分支上）时，收尾只按会话分支 HEAD 计数——「构建零改动」把真交付
// 判成没干活（mea 事故：PR 已绿、build 落 failed、chief 白跑补救回合）。本票
// 收尾三面扩展：① 偏离检测（currentBranch ≠ 契约分支 → transcript 点名 +
// done 载荷 workBranchDrift，server 闸据此把失败原因从「零改动」换成点名
// 分支偏离）；② 产物并集面（HEAD 计数为 0 时扫描步窗口内有新提交的本地
// 分支，邻座会话分支除外——事件形「切回会话分支、自建分支留着」由此认领）；
// ③ PR 探测多 head（会话分支未命中 → 偏离分支/候选分支，封顶 3 次）。
// 预防半 = 投递 prompt 尾部的工作分支注记行（shared appendWorkBranchNote
// 单源，#1203/#1217 注记族）。失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. HEAD 在偏离分支且其上有提交 → hasChanges=true（真值面不因扩展回退）
//      + done 带 workBranchDrift + transcript 落偏离点名行
//   2. 事故形：HEAD 已切回会话分支、agent 自建分支留有步窗口内新提交 →
//      扫描命中 → hasChanges=true、无 drift 字段；PR 探测按候选分支 head
//      命中 → prUrl/prNumber 回填真实交付
//   3. HEAD 偏离且处处无提交 → hasChanges=false + workBranchDrift 携带
//      （server 闸点名偏离的入参面）
//   4. 无偏离无提交 → hasChanges=false 且不带 drift 字段（现状钉扎）
//   5. 邻座会话分支（cairn/conv-<他 build>）有新提交 → 不算本步产物
//      （共享基座仓的兄弟 conv 不误认——假阳即假过闸）
//   6. 测试桩缺新可选方法（老实现/版本墙）→ 收尾行为与现状逐字一致
//   7. currentBranch 返回 null（detached HEAD / 查询失败）→ 无 drift 不炸
//   8. 探测封顶：偏离 + 多候选 → gh 探测总次数 ≤ 3（conv + 偏离 + 首候选）
//   9. 注记投递面：repo 绑定的 build 步 prompt 尾行 = 工作分支注记（含契约
//      分支名）；review 步与无 repo 步不附
//  10. 扫描入参面：base = 步起点 checkpoint（headAtStart）、since = 步起点
//      墙钟——钉「步窗口内」语义的数据源

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
import { buildWorkBranchNote, conversationBranch } from '@cairn/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

// 探测 mock（真实网络面不进单测；梯行为在 github-probe.test）。
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

/** repo 绑定的 build 步（github 形态 = 事故现场同形）。 */
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

/** 无 repo 项目步（裸任务目录退化形：注记不附）。 */
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

/** 收尾真值面可注入的 fake worktree（新可选方法逐个可缺席 = 版本墙形）。 */
interface FakeOpts {
  /** HEAD 所在分支（null = detached / 查询失败）。 */
  headBranch?: string | null;
  /** conv 分支 HEAD 领先 origin/<default> 的提交数。 */
  ahead?: number;
  /** 步窗口内有新提交的本地分支（扫描原语返回值）。 */
  workBranches?: string[];
  /** 缺省 = 带全部新可选方法；false = 老实现形（可选方法整体缺席）。 */
  withNewMethods?: boolean;
}

function fakeWorkspace(cwd: string, opts: FakeOpts) {
  const scanCalls: { base: string; sinceMs: number }[] = [];
  const base: WorktreeOps = {
    async prepare() {
      return {
        cwd,
        baseRepoDir: join(cwd, '..', 'repo'),
        branch: CONV_BRANCH,
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      return { committed: false, head: 'def456' };
    },
    async push() {},
    async mergeDefaultBranch() {
      return { output: 'Already up to date' };
    },
    async headCommit() {
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
    } satisfies Partial<WorktreeOps>);
  }
  return { ws: base, scanCalls };
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
  /** 探测结果按 head 分支名分发；缺省全 null。 */
  probeByBranch?: Record<string, { number: number; url: string }>;
}

async function runOnce(opts: RunOpts): Promise<{
  body: MachineDoneBody;
  client: FakeClient;
  scanCalls: { base: string; sinceMs: number }[];
  lines: string[];
}> {
  probeMock.mockReset();
  probeMock.mockImplementation(
    async (o: { branch: string }) => opts.probeByBranch?.[o.branch] ?? null,
  );
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-drift-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const backend = doneBackend();
  const { ws, scanCalls } = fakeWorkspace(join(home, 'ws', 'conv-1'), opts.fake);
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
  return { body: client.doneBodies[0]!.body, client, scanCalls, lines };
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

describe('#1195 收尾偏离检测与产物并集面', () => {
  test('失败方式 1：HEAD 在偏离分支且其上有提交 → hasChanges=true + drift 携带 + transcript 点名', async () => {
    const { body, client } = await runOnce({
      fake: { headBranch: 'dogfood/tracer-1153', ahead: 1 },
    });
    expect(body.status).toBe('success');
    expect(body.hasChanges).toBe(true);
    expect(body.workBranchDrift).toEqual({ expected: CONV_BRANCH, actual: 'dogfood/tracer-1153' });
    const driftRow = transcriptOf(client).find((m) => m.id === 'branch-drift-s1');
    expect(driftRow).toBeDefined();
    expect(driftRow?.content).toContain('dogfood/tracer-1153');
    expect(driftRow?.content).toContain(CONV_BRANCH);
  });

  test('失败方式 2（事故形）：HEAD 切回会话分支、自建分支留新提交 → 并集面认领 + PR 按候选 head 回填', async () => {
    const { body } = await runOnce({
      fake: { headBranch: CONV_BRANCH, ahead: 0, workBranches: ['dogfood/tracer-1153'] },
      probeByBranch: {
        'dogfood/tracer-1153': {
          number: 5,
          url: 'https://github.com/octocat/Hello-World/pull/5',
        },
      },
    });
    expect(body.hasChanges).toBe(true);
    // HEAD 未偏离（切回了会话分支）：drift 字段缺席——偏离点名只报真偏离。
    expect(body.workBranchDrift).toBeUndefined();
    expect(body.prUrl).toBe('https://github.com/octocat/Hello-World/pull/5');
    expect(body.prNumber).toBe(5);
    // 探测序：会话分支 head 先行（现状语义不退化），候选分支补位。
    const heads = probeMock.mock.calls.map((c) => (c[0] as { branch: string }).branch);
    expect(heads[0]).toBe(CONV_BRANCH);
    expect(heads).toContain('dogfood/tracer-1153');
  });

  test('失败方式 3：HEAD 偏离且处处无提交 → hasChanges=false + drift 携带（闸点名入参面）', async () => {
    const { body } = await runOnce({
      fake: { headBranch: 'dogfood/empty', ahead: 0, workBranches: [] },
    });
    expect(body.hasChanges).toBe(false);
    expect(body.workBranchDrift).toEqual({ expected: CONV_BRANCH, actual: 'dogfood/empty' });
  });

  test('失败方式 4：无偏离无提交 → hasChanges=false 且无 drift 字段（现状钉扎）', async () => {
    const { body } = await runOnce({ fake: { headBranch: CONV_BRANCH, ahead: 0 } });
    expect(body.hasChanges).toBe(false);
    expect(body.workBranchDrift).toBeUndefined();
  });

  test('失败方式 5：邻座会话分支有新提交 → 不算本步产物（共享基座仓不误认）', async () => {
    const { body } = await runOnce({
      fake: {
        headBranch: CONV_BRANCH,
        ahead: 0,
        workBranches: ['cairn/conv-0198f6c0-1111-7000-8000-111111111111'],
      },
    });
    expect(body.hasChanges).toBe(false);
    // 邻座分支也不进探测 head（不给别人的 PR 回填到本 build）。
    const heads = probeMock.mock.calls.map((c) => (c[0] as { branch: string }).branch);
    expect(heads).toEqual([CONV_BRANCH]);
  });

  test('失败方式 6：老实现桩（新可选方法缺席）→ 行为与现状一致（fail-open）', async () => {
    const { body } = await runOnce({
      fake: { ahead: 0, withNewMethods: false },
    });
    expect(body.status).toBe('success');
    expect(body.hasChanges).toBe(false);
    expect(body.workBranchDrift).toBeUndefined();
  });

  test('失败方式 7：currentBranch null（detached/查询失败）→ 无 drift 不炸', async () => {
    const { body } = await runOnce({ fake: { headBranch: null, ahead: 0 } });
    expect(body.status).toBe('success');
    expect(body.workBranchDrift).toBeUndefined();
  });

  test('失败方式 8：探测封顶 3 次（conv + 偏离 + 首候选）', async () => {
    await runOnce({
      fake: { headBranch: 'd1', ahead: 0, workBranches: ['c1', 'c2'] },
    });
    expect(probeMock.mock.calls).toHaveLength(3);
    const heads = probeMock.mock.calls.map((c) => (c[0] as { branch: string }).branch);
    expect(heads).toEqual([CONV_BRANCH, 'd1', 'c1']);
  });

  test('失败方式 10：扫描入参 = 步起点 checkpoint + 步窗口起点墙钟', async () => {
    const before = Date.now();
    const { scanCalls } = await runOnce({ fake: { headBranch: CONV_BRANCH, ahead: 0 } });
    const after = Date.now();
    expect(scanCalls.length).toBeGreaterThan(0);
    expect(scanCalls[0]!.base).toBe('abc123');
    expect(scanCalls[0]!.sinceMs).toBeGreaterThanOrEqual(before - 60_000);
    expect(scanCalls[0]!.sinceMs).toBeLessThanOrEqual(after);
  });
});

describe('#1195 工作分支注记投递面（预防半）', () => {
  test('失败方式 9：repo 绑定 build 步 prompt 尾行 = 工作分支注记（含契约分支名）', async () => {
    const { client } = await runOnce({ fake: { headBranch: CONV_BRANCH } });
    const promptRow = transcriptOf(client).find((m) => m.id === 'user-s1');
    expect(promptRow).toBeDefined();
    expect(String(promptRow?.content ?? '').endsWith(buildWorkBranchNote(CONV_BRANCH))).toBe(true);
  });

  test('review 步不附注记（只读步无交付契约）', async () => {
    const review = claimedGithubStep('review');
    // review 步 instruction 缺席 = 空材料仍照常跑（harness 面）；只钉注记不附。
    const { client } = await runOnce({ claimed: review, fake: { headBranch: CONV_BRANCH } });
    const promptRow = transcriptOf(client).find((m) => m.id === 'user-s1');
    expect(promptRow?.content ?? '').not.toContain('工作分支注记');
  });

  test('无 repo 步不附注记（裸任务目录无分支契约可言）', async () => {
    const { client } = await runOnce({ claimed: claimedBareStep(), fake: {} });
    const promptRow = transcriptOf(client).find((m) => m.id === 'user-s1');
    expect(promptRow).toBeDefined();
    expect(promptRow?.content).not.toContain('工作分支注记');
  });
});
