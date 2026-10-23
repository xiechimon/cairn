// runner runtime 身份分支（spec 17 A3/A4，#622 失败方式 3/4 的 daemon 侧）：
// per-step 后端解析（唯一分叉点 backendFor(agent.provider)）+ claude-code
// 零凭据通道（provider=null 合法，不再 fabricate api_key 后在 pi 后端炸
// model not found）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. runtime 步 + token provider null → 不 failStep；backendFor 收到
//      'claude-code'；会话创建；done success；canon `using model
//      claude-code/<modelId>`；sessionOpts.provider = inert 占位
//   2. runtime 步 + 老版本 server 伪 provider（api_key claude-code）→
//      runtime 分支权威短路（不透传伪配置语义），照常执行（mixed-version）
//   3. runtime 步 + modelId null → failStep，errorMessage 含 claude-code 字样
//   4. 非 runtime custom id + token provider null → daemon api_key 回退原语义
//      （sessionOpts.provider = {kind:'api_key', providerId}）+ canon 行不变
//   5. 非 runtime + 无 provider 无 model → 旧 failStep 文案逐字节（零回归面）
//   6. backendFor 收到 agent.provider 原值（null 步 → null）
//   7. runtime worker 步带 remoteTools/localTools（claim 恒携辅助面）→
//      三面照常进 sessionOpts（#647/T4 接线后 runtimeDrop 退役，无降级行），
//      步照常跑完
//   8. runtime chief 步 → remoteTools + relay 透传（#647 后后端把工具面包成
//      in-process MCP server，chief 词表全量到达执行面）
//   9. pi worker 步同载荷 → remoteTools/executeRemoteTool/localTools 照常
//      进 sessionOpts（与 runtime 步同形，两后端工具面无分叉）
//  10. runtime 步 + 预检「未登录」→ 工作区/会话之前失败，errorMessage 点名
//      机器 + 凭据类 + 补法（#867 T6）
//  11. runtime 步 + 预检「说不清」（CLI 缺失/超时）→ 不拦步，落诊断行照跑
//  12. pi 步 → 预检一次都不发（零凭据通道只属 runtime 身份）

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  ProviderConfig,
  RemoteToolDef,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import type { ClaudeCodeAuthProbe } from '../src/claude-code-auth.js';
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

function claimedStep(opts: { provider: string | null; modelId: string | null }): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'runtime 探针', spec: '跑一步' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: opts.provider,
      modelId: opts.modelId,
      thinkingLevel: null,
    },
  };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  constructor(private readonly tokenProvider: ProviderConfig | null) {}

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
    return { provider: this.tokenProvider, secrets: {}, git: null };
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

/** 录制 SessionOpts 的 fake backend（解析面断言缝）。 */
function recordingBackend(): {
  backend: AgentBackend;
  sessions: SessionOpts[];
  resumed: string[];
} {
  const sessions: SessionOpts[] = [];
  const resumed: string[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      sessions.push(opts);
      return {
        sessionId: 'stub-sess-1',
        events: (async function* () {
          yield { type: 'text_delta', text: 'ok' } as never;
          yield { type: 'done', usage: [] } as never;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
    },
    async continueSession(id, opts) {
      resumed.push(id);
      sessions.push(opts);
      return {
        sessionId: id,
        events: (async function* () {
          yield { type: 'done', usage: [] } as never;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
    },
  };
  return { backend, sessions, resumed };
}

/** 预检默认桩：已登录（#867 T6 起 runtime 步先过机器本地凭据预检；不注入
 * 就会发真 CLI，CI 上必然探成「未登录」）。 */
const LOGGED_IN_PROBE = async (): Promise<ClaudeCodeAuthProbe> => ({
  state: 'logged-in',
  method: 'oauth_token',
  provider: 'firstParty',
});

async function setup(
  claimed: ClaimedStep,
  opts: {
    tokenProvider?: ProviderConfig | null;
    probe?: () => Promise<ClaudeCodeAuthProbe>;
    machineName?: string;
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-runtime-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient(opts.tokenProvider ?? null);
  const journal = new StepJournal(paths.outboxDir);
  const { backend, sessions } = recordingBackend();
  const resolved: (string | null | undefined)[] = [];
  const probeCalls: number[] = [];
  const probe = opts.probe ?? LOGGED_IN_PROBE;
  const deps = {
    client,
    journal,
    backendFor: (agentProviderId: string | null | undefined) => {
      resolved.push(agentProviderId);
      return backend;
    },
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
    machineName: opts.machineName ?? 'daemon-test',
    claudeCodeAuthProbe: () => {
      probeCalls.push(1);
      return probe();
    },
  };
  await runStep(deps, claimed);
  return { client, lines, sessions, resolved, paths, probeCalls };
}

describe('runner runtime 身份分支（spec 17 A3/A4）', () => {
  test('失败方式 1：runtime 步 + token provider null → claude 后端执行 + inert provider + canon 行', async () => {
    const { client, lines, sessions, resolved } = await setup(
      claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
    );
    expect(resolved).toEqual(['claude-code']);
    expect(sessions).toHaveLength(1);
    // A4：零凭据步 provider 形状 = inert 占位（claude-code 后端不消费）。
    expect(sessions[0]?.provider).toEqual({ kind: 'api_key', providerId: 'claude-code' });
    expect(sessions[0]?.modelId).toBe('claude-sonnet-4-5');
    expect(lines).toContain('using model claude-code/claude-sonnet-4-5');
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 2：runtime 步 + 老版本 server 伪 provider → runtime 分支权威短路，照常执行', async () => {
    // mixed-version 窗口：未升级 server 仍 fabricate api_key claude-code——
    // daemon 侧 runtime 分支不看 creds.provider，一律 inert 占位照跑。
    const { client, sessions } = await setup(
      claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      {
        tokenProvider: {
          kind: 'api_key',
          providerId: 'claude-code',
        },
      },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.provider).toEqual({ kind: 'api_key', providerId: 'claude-code' });
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 3：runtime 步 modelId 缺 → failStep，errorMessage 含 claude-code 字样', async () => {
    const { client, sessions } = await setup(
      claimedStep({ provider: 'claude-code', modelId: null }),
    );
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toContain('claude-code');
    expect(sessions).toHaveLength(0); // 闸在会话之前
  });

  test('失败方式 4：非 runtime custom id + token provider null → api_key 回退原语义 + canon 行不变', async () => {
    const { client, lines, sessions, resolved } = await setup(
      claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }),
    );
    expect(resolved).toEqual(['stub-gw']);
    // daemon 侧回退（runner.ts:261 原行为）逐字节保持。
    expect(sessions[0]?.provider).toEqual({ kind: 'api_key', providerId: 'stub-gw' });
    expect(lines).toContain('using model stub-gw/stub-model');
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 5：非 runtime + 无 provider 无 model → 旧 failStep 文案逐字节', async () => {
    const { client, sessions } = await setup(claimedStep({ provider: null, modelId: null }));
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toBe('no agent/model on claimed step');
    expect(sessions).toHaveLength(0);
  });

  test('失败方式 6：backendFor 收到 agent.provider 原值（null 步 → null）', async () => {
    const { resolved } = await setup(
      claimedStep({ provider: null, modelId: 'stub-model' }),
      // token 给足 provider，步能跑完（此处只钉解析入参）。
      {
        tokenProvider: {
          kind: 'http',
          providerId: 'stub-gw',
          baseUrl: 'http://127.0.0.1:9/v1',
          api: 'openai-completions',
          authHeader: true,
          models: [{ id: 'stub-model', name: 'stub-model' }],
        },
      },
    );
    expect(resolved).toEqual([null]);
  });
});

describe('runner runtime 步凭据预检（#867 T6 跨机凭据预检）', () => {
  test('失败方式 10：预检未登录 → 步前失败，文案点名机器 + 凭据类 + 补法', async () => {
    const { client, sessions, probeCalls } = await setup(
      claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      {
        machineName: 'daemon-mea',
        probe: async () => ({ state: 'not-logged-in', provider: 'firstParty' }),
      },
    );
    expect(probeCalls).toHaveLength(1); // 预检真的发了，不是绕过
    expect(sessions).toHaveLength(0); // 会话未开（拦在开工作区之前）
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    const msg = client.doneBodies[0]?.body.errorMessage ?? '';
    expect(msg).toContain('daemon-mea');
    expect(msg).toContain('ANTHROPIC_API_KEY');
    expect(msg).toContain('/login');
  });

  test('失败方式 11：预检说不清（CLI 缺失/超时）→ 不拦步，落诊断行', async () => {
    const { client, lines, sessions, probeCalls } = await setup(
      claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      { probe: async () => ({ state: 'unknown', reason: 'spawn claude ENOENT' }) },
    );
    expect(probeCalls).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('auth probe inconclusive') && l.includes('ENOENT'))).toBe(
      true,
    );
  });

  test('失败方式 12：pi 步 → 预检零调用（零凭据通道只属 runtime 身份）', async () => {
    const { client, probeCalls } = await setup(
      claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }),
    );
    expect(probeCalls).toHaveLength(0);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });
});

describe('runner runtime 步续会话（spec 17 A7）', () => {
  test('session.action=continue → backendFor 解析后走 continueSession', async () => {
    const claimed = {
      ...claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      session: { action: 'continue' as const, sessionId: 'sdk-session-uuid' },
    };
    const home = mkdtempSync(join(tmpdir(), 'cairn-runner-runtime-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const client = new FakeClient(null);
    const journal = new StepJournal(paths.outboxDir);
    const { backend, sessions, resumed } = recordingBackend();
    await runStep(
      {
        client,
        journal,
        backendFor: () => backend,
        logger,
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
        claudeCodeAuthProbe: LOGGED_IN_PROBE,
      },
      claimed,
    );
    expect(resumed).toEqual(['sdk-session-uuid']); // SDK resume 通道（A7）
    expect(sessions[0]?.provider).toEqual({ kind: 'api_key', providerId: 'claude-code' });
  });
});

describe('runner runtime 步工具面（spec 17 A10 / #647 T4 接线后）', () => {
  /** worker 步 claim 恒携的辅助 remoteTools（machines.ts WORKER_REMOTE_TOOLS
   * 记忆三件套形状——两件够钉语义）。 */
  const workerRemoteTools: RemoteToolDef[] = [
    { name: 'save_memory', description: '存记忆' },
    { name: 'search_memory', description: '搜记忆', replaySafe: true },
  ];

  test('失败方式 7：runtime worker 步 → 三面照常进 sessionOpts，无降级行，步照常跑完', async () => {
    const claimed = {
      ...claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      remoteTools: workerRemoteTools,
      localTools: ['remote_shell'],
    };
    const { client, lines, sessions } = await setup(claimed);
    expect(sessions).toHaveLength(1);
    // 三面全到（#647：runtimeDrop 退役）——后端把 host 工具面包成 in-process
    // MCP server（remoteTools relay / localTools 本地执行）。
    expect(sessions[0]?.remoteTools).toHaveLength(2);
    expect(typeof sessions[0]?.executeRemoteTool).toBe('function');
    // build 步 secret 工具 + remote_shell 都注册（与 pi 步同形）。
    expect((sessions[0]?.localTools ?? []).map((t) => t.name)).toContain('remote_shell');
    expect((sessions[0]?.localTools ?? []).length).toBeGreaterThanOrEqual(2);
    // 降级行退役：无任何 (T4) 字样。
    expect(lines.some((l) => l.includes('T4'))).toBe(false);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 8：runtime chief 步 → remoteTools + relay 透传（chief 词表全量到达执行面）', async () => {
    const claimed: ClaimedStep = {
      ...claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      step: { id: 's1', buildId: 'chief-t1', kind: 'chief', machineId: 'm1', createdAt: 1 },
      conversationId: 'chief-t1',
      instruction: '探索团队资源现状',
      chief: { threadId: 't1', systemPrompt: '总管 charter', trigger: 'user' },
      remoteTools: [
        { name: 'create_todo', description: '建待办' },
        { name: 'create_agent', description: '建 agent' },
      ],
    };
    const { sessions } = await setup(claimed);
    // chief 词表是职责本体：透传给后端 → in-process MCP server 承载
    // （#647 后 open() 不再 fail-closed）。
    expect(sessions[0]?.remoteTools).toHaveLength(2);
    expect(typeof sessions[0]?.executeRemoteTool).toBe('function');
  });

  test('失败方式 9：pi worker 步同载荷 → 工具面照常进 sessionOpts（零回归）', async () => {
    const claimed = {
      ...claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }),
      remoteTools: workerRemoteTools,
      localTools: ['remote_shell'],
    };
    const { lines, sessions } = await setup(claimed);
    expect(sessions[0]?.remoteTools).toHaveLength(2);
    expect(typeof sessions[0]?.executeRemoteTool).toBe('function');
    // build 步 secret 工具 + remote_shell 都注册（现行为逐字节）。
    expect((sessions[0]?.localTools ?? []).map((t) => t.name)).toContain('remote_shell');
    expect((sessions[0]?.localTools ?? []).length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => l.includes('T4'))).toBe(false);
  });
});
