// runner create_tag 注册面（XMON-111 T1，验收 3）：注册条件 = claim
// `localTools` 含 create_tag（server 判定单源 claimLocalTools，daemon 不自判
// 权限——leader 裁定）。开关关 = 词缺席 = 工具不注册，agent 工具面不含该词
// （fail-closed；localTools 缺省 = 老 server 形，同不注册）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. localTools 含 create_tag + repo 绑定步 → sessionOpts.localTools 含该词
//   2. localTools = []（开关关）→ 工具缺席
//   3. localTools 缺省（老 server 版本墙）→ 工具缺席（fail-closed）
//   4. repo null 步（裸任务目录）词在 → 仍注册；execute 返回明确原因文本
//      （secret-channel 同律：拿不到能力时给明确原因，不是说不清的缺值）

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { LOCAL_TOOL_CREATE_TAG } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

// #966 同源暴露：github 形态步成功收尾时 runStep 调 probeGithubPr（真 gh CLI
// + api.github.com 双梯）——shim 实测本文件 3 次派真网络探测。本文件钉的是
// create_tag 注册面，不是探测；真实网络面不进单测（探测行为钉在
// github-probe.test.ts / runner-delivery.test.ts），mock 形态与二者同款。
const probeMock = vi.fn();
vi.mock('../src/github-probe.js', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/github-probe.js')>()) as {
    githubRepoRefOf: unknown;
  };
  return { ...real, probeGithubPr: (...args: unknown[]) => probeMock(...args) };
});

function captureLogger(): DaemonLogger {
  const push = () => {};
  return {
    raw: push,
    prefixed: push,
    supervisor: push,
    machine: push,
    step: push,
    workspace: push,
    recover: push,
    wake: push,
    skills: push,
    gate: push,
    trust: push,
    mcp: push,
  };
}

function claimedStep(opts: {
  repo: NonNullable<ClaimedStep['project']>['repo'];
  localTools?: string[];
}): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'tag 探针', spec: '打一个 tag' },
    project: { id: 'p1', name: 'demo', repo: opts.repo },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: ['创建标签'],
    },
    ...(opts.localTools !== undefined ? { localTools: opts.localTools } : {}),
  };
}

class FakeClient implements MachineApi {
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
    // #920：空清单 = 零团队技能，本测试的注册面断言不受技能物化影响。
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
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

/** 录制 SessionOpts 的 fake backend（注册面断言缝）。 */
function recordingBackend(): { backend: AgentBackend; sessions: SessionOpts[] } {
  const sessions: SessionOpts[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      sessions.push(opts);
      return {
        sessionId: 'pi-sess-tag',
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
  return { backend, sessions };
}

function fakeWorkspace(): WorktreeOps {
  return {
    async prepare(input) {
      return {
        cwd: join(input.workspacesRoot, input.conversationId),
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      return { committed: false, head: null };
    },
    async push() {},
    async mergeDefaultBranch() {
      return { output: 'Already up to date' };
    },
    async headCommit() {
      return null;
    },
    async countAhead() {
      return 0;
    },
    async restoreCheckpoint() {},
    async cleanupOrphans() {
      return [];
    },
  };
}

async function setup(claimed: ClaimedStep) {
  probeMock.mockReset();
  // 不存在的仓库（o/r）的真值：gh / REST 双梯 404 → null（面板 PR 槽留空）。
  probeMock.mockResolvedValue(null);
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-tag-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const { backend, sessions } = recordingBackend();
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger: captureLogger(),
    paths,
    workspace: fakeWorkspace(),
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimed);
  return { sessions };
}

const GITHUB_REPO = { kind: 'github', cloneUrl: 'https://github.com/o/r.git' } as const;

function localToolNames(opts: SessionOpts | undefined): string[] {
  return (opts?.localTools ?? []).map((t) => t.name);
}

describe('runner create_tag 注册面（XMON-111 T1，验收 3）', () => {
  test('失败方式 1：localTools 含 create_tag → 会话工具面含该词', async () => {
    const { sessions } = await setup(
      claimedStep({ repo: GITHUB_REPO, localTools: [LOCAL_TOOL_CREATE_TAG] }),
    );
    expect(localToolNames(sessions[0])).toContain('create_tag');
  });

  test('失败方式 2：localTools = []（开关关）→ 工具缺席', async () => {
    const { sessions } = await setup(claimedStep({ repo: GITHUB_REPO, localTools: [] }));
    expect(localToolNames(sessions[0])).not.toContain('create_tag');
  });

  test('失败方式 3：localTools 缺省（老 server）→ 工具缺席（fail-closed）', async () => {
    const { sessions } = await setup(claimedStep({ repo: GITHUB_REPO }));
    expect(localToolNames(sessions[0])).not.toContain('create_tag');
  });

  test('失败方式 4：repo null 步词在 → 仍注册；execute 返回明确原因文本', async () => {
    const { sessions } = await setup(
      claimedStep({ repo: null, localTools: [LOCAL_TOOL_CREATE_TAG] }),
    );
    const names = localToolNames(sessions[0]);
    expect(names).toContain('create_tag');
    const tool = (sessions[0]?.localTools ?? []).find((t) => t.name === 'create_tag');
    const out = await tool?.execute({ tag: 'v1.0.0' });
    expect(out).toContain('no repository');
  });
});
