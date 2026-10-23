// runner 三态受管 MCP 透传面（#1307）：claim 载荷 mcpServers 的三态
// （缺省 = 继承 runtime 配置；数组含 [] = 受管集合）必须原样传到
// SessionOpts.mcpServers，backend 才有判据给 SDK 上 strictMcpConfig 锁。
// 失败方式先于实现固化：
//   5. runner 二次塌缩：claim [] → `mcpEndpoints.length > 0` 条件把
//      SessionOpts 键省掉 → backend 无法区分受管空与继承（本票主修位之二，
//      runner.ts 的 SessionOpts 组装条件）→ [] 必须原样键在位透传
//   6. 继承态反向造集：claim 缺省 → `?? []` 塌成受管空 → 旧 server 形 /
//      版本墙机器被误锁 strict、失去应继承的 runtime 配置 → 键必须缺省
//   7. 未知 slug 降级反转：勾选 slug 全不在本机 config → endpoints 解析
//      为空 → 若按「endpoints 非空」判受管性会翻回继承（泄漏复活）→
//      受管性只由 claim 键在位决定，解析失败仍受管 + 降级行照打
//   8. 观测行缺失：受管空零 [mcp] 行 → 执行面形状不可见（spec 13
//      premortem 护栏二同族：多机各读各 config 的跑偏要一眼可见）

import { mkdtempSync, writeFileSync } from 'node:fs';
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
  WorktreeOps,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

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

function claimedStep(mcpServers?: string[]): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'mcp 三态探针', spec: '改一行' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    remoteTools: [],
    ...(mcpServers !== undefined ? { mcpServers } : {}),
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
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

/** 录制型 fake worktree（runner-local 同款最小形）。 */
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

/** SessionOpts 捕获 backend：createSession 入参录制后立即自然完成。 */
function capturingBackend(captured: SessionOpts[]): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts): Promise<AgentSessionHandle> {
      captured.push(opts);
      return {
        sessionId: 'cap-sess',
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

async function run(claimed: ClaimedStep, localConfig?: Record<string, unknown>) {
  const captured: SessionOpts[] = [];
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-mcp-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const mcpConfigPath = join(home, 'claude.json');
  if (localConfig !== undefined) {
    writeFileSync(mcpConfigPath, JSON.stringify(localConfig), 'utf8');
  }
  await runStep(
    {
      client,
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => capturingBackend(captured),
      logger,
      paths,
      workspace: fakeWorkspace(),
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath,
      heartbeatIntervalMs: 60_000,
    },
    claimed,
  );
  const opts = captured[0];
  if (opts === undefined) throw new Error('createSession was not called');
  return { opts, lines, client };
}

describe('runner 三态透传（#1307 失败方式 5/6）', () => {
  test('claim [] = 受管空：SessionOpts.mcpServers 键在位且为 []（不塌回缺省）', async () => {
    const { opts } = await run(claimedStep([]));
    expect('mcpServers' in opts).toBe(true);
    expect(opts.mcpServers).toEqual([]);
  });

  test('claim 缺省 = 继承：SessionOpts.mcpServers 键缺省（不反向造受管空）', async () => {
    const { opts } = await run(claimedStep(undefined));
    expect('mcpServers' in opts).toBe(false);
  });

  test('claim [slug] = 受管集：本机 config 解析端点入 SessionOpts', async () => {
    const { opts } = await run(claimedStep(['demo']), {
      mcpServers: { demo: { url: 'https://example.invalid/mcp' } },
    });
    expect(opts.mcpServers).toEqual([
      { slug: 'demo', transport: 'http', url: 'https://example.invalid/mcp' },
    ]);
  });
});

describe('runner 受管性不随解析结果翻转（#1307 失败方式 7/8）', () => {
  test('勾选 slug 全不在本机 config：仍受管（键在位 [] ）+ 降级行照打', async () => {
    const { opts, lines } = await run(claimedStep(['ghost']), { mcpServers: {} });
    expect('mcpServers' in opts).toBe(true);
    expect(opts.mcpServers).toEqual([]);
    expect(lines.some((l) => l.startsWith('[mcp]') && l.includes('ghost'))).toBe(true);
  });

  test('受管空落观测行（[mcp] 前缀，执行面形状可见）', async () => {
    const { lines } = await run(claimedStep([]));
    expect(lines.some((l) => l.startsWith('[mcp]') && l.includes('managed-empty'))).toBe(true);
  });
});
