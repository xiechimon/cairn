// runner 交付面上报（#704 / B-C16）：github 形态步收尾只读探测 PR + 非
// hosted 形态步收尾上报真 diff，均随 done 通道回传。失败方式枚举先于实现
// 固化（AGENTS.md 测试规则 3）：
//   1. github build 步 + 探测命中 → done 带 prUrl/prNumber + changesDiff
//      （B-C16：agent 用机器 gh 开的 PR 服务端可见）
//   2. 探测失败/无 PR（null）→ done 不带 PR 字段（面板分支名在、PR 槽空）
//   3. hosted 步 → 不探测、不上报（真值源 = server bare repo，双真值源不引入）
//   4. diff 超上限 → changesDiff 缺席（投影回落空集，不带半截假象）
//   5. review 步（github）→ 只读步不产交付面事实，不探测不上报
//   6. repo 缺席步（无 worktree）→ 不探测不上报

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
} from '@pacman/shared';
import { CHANGES_DIFF_MAX_BYTES } from '@pacman/shared';
import { describe, expect, test, vi } from 'vitest';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

// 探测 mock（真实网络面不进单测；probeGithubPr 的梯行为在 github-probe.test）。
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

/** repo 绑定的 build 步（github 形态 = B-C16 现场：手动 owner/repo 无
 * connection，机器 gh 是 agent 开 PR 的实际凭据）。 */
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
    // #920：默认空清单 = 零团队技能（selection=whitelist，既有断言零扰动）。
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

/** fake worktree：diffAgainstDefault 可注入返回值（#704 上报数据源）。 */
function fakeWorkspace(cwd: string, diff: string | null) {
  const calls: string[] = [];
  const ws: WorktreeOps = {
    async prepare() {
      calls.push('prepare');
      return {
        cwd,
        baseRepoDir: join(cwd, '..', 'repo'),
        branch: 'pacman/conv-conv-1',
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
}

async function runOnce(opts: RunOpts): Promise<MachineDoneBody> {
  probeMock.mockReset();
  if (opts.probe instanceof Error) probeMock.mockRejectedValue(opts.probe);
  else probeMock.mockResolvedValue(opts.probe);
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-delivery-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const backend = doneBackend();
  const { ws } = fakeWorkspace(join(home, 'ws', 'conv-1'), opts.diff);
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

describe('runner 交付面上报（#704）', () => {
  test('失败方式 1：github build 步 + 探测命中 → done 带 PR + changesDiff', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: { number: 606, url: 'https://github.com/octocat/Hello-World/pull/606' },
      diff: SAMPLE_DIFF,
    });
    expect(body.status).toBe('success');
    expect(body.prUrl).toBe('https://github.com/octocat/Hello-World/pull/606');
    expect(body.prNumber).toBe(606);
    expect(body.changesDiff).toBe(SAMPLE_DIFF);
    // 探测入参钉凭据阶梯面：owner/repo 来自 cloneUrl、branch = conv 分支。
    expect(probeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'octocat',
        repo: 'Hello-World',
        branch: 'pacman/conv-conv-1',
        token: null,
      }),
    );
  });

  test('失败方式 2：探测 null（无 PR/失败）→ done 不带 PR 字段', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: null,
      diff: SAMPLE_DIFF,
    });
    expect(body.prUrl).toBeUndefined();
    expect(body.prNumber).toBeUndefined();
    expect(body.changesDiff).toBe(SAMPLE_DIFF);
  });

  test('探测抛错 → 吞掉落日志，done 不带 PR 字段（不失败不重试）', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: new Error('gh missing'),
      diff: SAMPLE_DIFF,
    });
    expect(body.status).toBe('success');
    expect(body.prUrl).toBeUndefined();
  });

  test('失败方式 3：hosted 步 → 不探测不上报（真值源 = server bare repo）', async () => {
    const body = await runOnce({
      claimed: claimedHostedStep(),
      probe: { number: 1, url: 'u' },
      diff: SAMPLE_DIFF,
    });
    expect(probeMock).not.toHaveBeenCalled();
    expect(body.prUrl).toBeUndefined();
    expect(body.changesDiff).toBeUndefined();
  });

  test('失败方式 4：diff 超上限 → changesDiff 缺席', async () => {
    const body = await runOnce({
      claimed: claimedGithubStep(),
      probe: null,
      diff: `+${'x'.repeat(CHANGES_DIFF_MAX_BYTES + 1)}`,
    });
    expect(body.changesDiff).toBeUndefined();
  });

  test('失败方式 5：github review 步 → 只读步不产交付面事实', async () => {
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
