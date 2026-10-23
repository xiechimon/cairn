// #654 协议 400 自适配测试面：pi 侧三件（签名匹配 / 回落学习 / models.json
// 物化）+ runner 步内回落闸。失败方式枚举先于实现固化（AGENTS.md 测试规则
// 3，票面 #654「先列失败方式」节）：
//   1. relay 协议 400 签名 → 双旋钮翻到旧式形（max_tokens + 无 store）
//   2. OpenAI 形 unsupported parameter 只翻被点名字段
//   3. 无关错误 / preset 端点 → 不翻（防误伤与死循环）
//   4. 学习态：翻过一次后同错不再翻（单次预算，防循环）；后续物化直接带旋钮
//   5. 显式 record compat 压过学习位
//   6. 物化零漂移：无 compat 的 provider 条目与旧行为同形（无 compat 键）
//   7. runner：零进展 + 签名命中 → 第二轮会话以翻过旋钮的 provider 重开，
//      步 success；非签名错 / 有进展 / 二起失败 / 后端无适配面 → 按现状收尾

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  ProviderConfig,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  adaptProviderCompat,
  materializeProvider,
  PI_CAPABILITIES,
  protocolCompatFlip,
} from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const RELAY_400 = '400: {"message":"Model does not support this protocol.","type":"server_error"}';

function gateway(providerId: string, compat?: ProviderConfig['compat']): ProviderConfig {
  return {
    kind: 'http',
    providerId,
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    ...(compat !== undefined ? { compat } : {}),
  };
}

describe('protocolCompatFlip（签名匹配，纯函数）', () => {
  test('失败方式 1：relay 协议 400 原文 → 双旋钮（max_tokens + 无 store）', () => {
    expect(protocolCompatFlip(RELAY_400)).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
  });

  test('失败方式 2a：OpenAI unsupported parameter 点名 max_completion_tokens → 只翻字段名', () => {
    expect(
      protocolCompatFlip('400 Unsupported parameter: max_completion_tokens is not supported'),
    ).toEqual({ maxTokensField: 'max_tokens' });
  });

  test('失败方式 2b：OpenAI unsupported parameter 点名 store → 只摘 store', () => {
    expect(protocolCompatFlip('400 Unsupported parameter: store')).toEqual({
      supportsStore: false,
    });
  });

  test('失败方式 3：无关错误 → null 不翻', () => {
    expect(protocolCompatFlip('400: invalid model id')).toBeNull();
    expect(protocolCompatFlip('rate limit exceeded')).toBeNull();
  });
});

describe('adaptProviderCompat（回落学习面）', () => {
  // 学习面是模块级 Map：每个用例用独立 providerId 隔离（无跨用例污染）。

  test('失败方式 4：签名命中 → 返回翻过的配置；同错再翻 → null（单次预算）', () => {
    const gw = gateway('adapt-once');
    const amended = adaptProviderCompat(gw, RELAY_400);
    expect(amended?.compat).toEqual({ maxTokensField: 'max_tokens', supportsStore: false });
    // 第二次同错：已在目标态 → null（不再翻、runner 不再重试）。
    expect(adaptProviderCompat(amended ?? gw, RELAY_400)).toBeNull();
  });

  test('失败方式 3：preset（无 baseUrl）→ null；非签名错 → null', () => {
    expect(adaptProviderCompat({ kind: 'api_key', providerId: 'anthropic' }, RELAY_400)).toBeNull();
    expect(adaptProviderCompat(gateway('adapt-nosig'), '500 internal')).toBeNull();
  });

  test('失败方式 5：显式 compat 不挡错误驱动回落（回落轮改写它；持久化面仍是显式压学习——见物化用例）', () => {
    const explicit = gateway('adapt-explicit', { maxTokensField: 'max_completion_tokens' });
    const amended = adaptProviderCompat(explicit, RELAY_400);
    // 用户钉了 mct 但 upstream 明拒：回落轮按 Multica 协商同律改写到旧式形
    //（配错的显式位 = 每步付一次回落学费；持久化不覆盖显式位，钉在物化用例）。
    expect(amended?.compat).toEqual({ maxTokensField: 'max_tokens', supportsStore: false });
  });
});

describe('materializeProvider（compat 物化进 models.json）', () => {
  function load(path: string): Record<string, Record<string, unknown>> {
    return (
      JSON.parse(readFileSync(path, 'utf8')) as {
        providers: Record<string, Record<string, unknown>>;
      }
    ).providers;
  }

  test('失败方式 6：无 compat（显式与学习皆无）→ 条目无 compat 键（旧行为同形）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-mat-'));
    const path = join(dir, 'models.json');
    materializeProvider(path, gateway('mat-bare'));
    const entry = load(path)['mat-bare'];
    expect(entry).toBeDefined();
    expect('compat' in (entry ?? {})).toBe(false);
    expect(entry).toMatchObject({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'per-step' });
  });

  test('wire compat 原样物化（maxTokensField / supportsStore / supportsDeveloperRole）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-mat-'));
    const path = join(dir, 'models.json');
    materializeProvider(
      path,
      gateway('mat-wire', {
        maxTokensField: 'max_tokens',
        supportsStore: false,
        supportsDeveloperRole: false,
      }),
    );
    expect(load(path)['mat-wire']).toMatchObject({
      compat: {
        maxTokensField: 'max_tokens',
        supportsStore: false,
        supportsDeveloperRole: false,
      },
    });
  });

  test('失败方式 4/5：学习位并入物化（后续步直接干净形态）；显式位压过学习', () => {
    // 学习：翻 mat-learn 的旋钮。
    adaptProviderCompat(gateway('mat-learn'), RELAY_400);
    const dir = mkdtempSync(join(tmpdir(), 'cairn-mat-'));
    const path = join(dir, 'models.json');
    materializeProvider(path, gateway('mat-learn'));
    expect(load(path)['mat-learn']).toMatchObject({
      compat: { maxTokensField: 'max_tokens', supportsStore: false },
    });
    // 显式位压过学习：wire 钉 supportsStore:true → 学习不得覆盖。
    adaptProviderCompat(gateway('mat-mixed'), RELAY_400);
    materializeProvider(path, gateway('mat-mixed', { supportsStore: true }));
    expect(load(path)['mat-mixed']).toMatchObject({
      compat: { maxTokensField: 'max_tokens', supportsStore: true },
    });
  });
});

// —— runner 步内回落闸（fake backend 走真 adaptProviderCompat）——————————

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

function claimedStep(providerId: string): ClaimedStep {
  return {
    step: { id: 'step-fb1', buildId: 'b1', kind: 'build', machineId: null, createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    instruction: null,
    todo: {
      id: 't1',
      seqNum: 1,
      title: '协议回落探针',
      spec: '写一行探针',
    },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: providerId,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploadNames: string[][] = [];

  constructor(private readonly providerId: string) {}

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
      provider: gateway(this.providerId),
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

type ScriptedEvents = (
  | { type: 'text_delta'; text: string }
  | { type: 'error'; error: { message: string; retryable: boolean } }
  | { type: 'done'; usage: [] }
)[];

/** 事件脚本 backend：createSession 依序消费脚本；记录每轮收到的 provider。
 * adaptProviderCompat 走真实现（pi 模块函数）——runner 面与物化面同源。 */
function scriptedBackend(
  scripts: ScriptedEvents[],
  opts?: { withAdapt?: boolean },
): {
  backend: AgentBackend;
  providers: (ProviderConfig | null | undefined)[];
  sessions: number;
} {
  const providers: (ProviderConfig | null | undefined)[] = [];
  const state = { sessions: 0 };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      const idx = state.sessions++;
      providers[idx] = sessionOpts.provider;
      const script = scripts[idx] ?? [{ type: 'done', usage: [] }];
      return {
        sessionId: `pi-sess-fb-${idx}`,
        events: (async function* () {
          for (const ev of script) yield ev as never;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
    },
    async continueSession(): Promise<never> {
      throw new Error('unused');
    },
    ...(opts?.withAdapt === false
      ? {}
      : {
          adaptProviderCompat: (provider: ProviderConfig, errorMessage: string) =>
            adaptProviderCompat(provider, errorMessage),
        }),
  };
  return { backend, providers, sessions: state.sessions };
}

async function runFallbackCase(
  scripts: ScriptedEvents[],
  opts?: { withAdapt?: boolean; providerId?: string },
) {
  const providerId = opts?.providerId ?? 'gw-fb';
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-fb-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient(providerId);
  const journal = new StepJournal(paths.outboxDir);
  const { backend, providers } = scriptedBackend(scripts, opts);
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimedStep(providerId));
  return { client, lines, providers };
}

describe('runner 协议 400 步内回落（#654）', () => {
  // 学习面是模块级 Map：每个用例独立 providerId 隔离（同 adapt describe 律）。

  test('失败方式 1+7：零进展签名错 → 翻旋钮重开一轮，步 success；第二轮 provider 带翻过的 compat', async () => {
    const { client, lines, providers } = await runFallbackCase(
      [
        [{ type: 'error', error: { message: RELAY_400, retryable: false } }],
        [
          { type: 'text_delta', text: 'ok' },
          { type: 'done', usage: [] },
        ],
      ],
      { providerId: 'gw-fb-ok' },
    );
    expect(providers).toHaveLength(2);
    expect(providers[1]?.compat).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    expect(lines.some((l) => l.includes('protocol fallback'))).toBe(true);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 3：非签名错误 → 不回落单轮收尾，步 failed', async () => {
    const { client, providers } = await runFallbackCase(
      [[{ type: 'error', error: { message: '401 unauthorized', retryable: false } }]],
      { providerId: 'gw-fb-nosig' },
    );
    expect(providers).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('失败方式 3（有进展）：text_delta 后同错 → 不回落（重放会重复执行），步 failed', async () => {
    const { client, providers } = await runFallbackCase(
      [
        [
          { type: 'text_delta', text: '写了一半' },
          { type: 'error', error: { message: RELAY_400, retryable: false } },
        ],
      ],
      { providerId: 'gw-fb-progress' },
    );
    expect(providers).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('失败方式 4：二起同错 → 回落轮收尾 failed（pass>0 不再进闸，无第三轮）', async () => {
    const { client, providers } = await runFallbackCase(
      [
        [{ type: 'error', error: { message: RELAY_400, retryable: false } }],
        [{ type: 'error', error: { message: RELAY_400, retryable: false } }],
      ],
      { providerId: 'gw-fb-twice' },
    );
    // 第二轮有开（第一轮翻过旋钮给了重试），第二轮失败后不再第三轮。
    expect(providers).toHaveLength(2);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('后端无适配面（claude-code 形）→ 单轮收尾，步 failed（零回归）', async () => {
    const { client, providers } = await runFallbackCase(
      [[{ type: 'error', error: { message: RELAY_400, retryable: false } }]],
      { withAdapt: false, providerId: 'gw-fb-noadapt' },
    );
    expect(providers).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });
});
