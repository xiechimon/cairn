// #698 静默 no-op 双闸测试面。失败方式枚举先于实现固化（AGENTS.md 测试规则
// 3；票面 #698「一个被 claim 的步能一路走到 finished 而从不调模型且无任何
// 错误面」）：
//   1. 事件流零事件 + 零错误 + 无 done 自然耗尽（claude-code pump 生成器耗
//      尽形——终局事件缺席时直接 queue.end()）→ 步必须 failed 且文案点名
//      零事件轮（现状：success = 洞 1）
//   2. 事件流只有 user-role message_end 回声（输入侧投递，非模型产出）→
//      同律 failed（回声不算进展，防「事件面非空」绕过闸）
//   3. 正常轮（有 done）→ success 不受闸影响（防误伤）
//   4. 有进展事件（text_delta）+ done → success 不受闸影响
//   5. 停止钮中断（停止位）→ 仍 stopped 收尾（闸不覆盖停止）
//   6. pi prompt() 预检拒绝（真 PiBackend + preset provider 无凭据：auth 校验
//      在 agent run 之前 throw）→ 事件面快速收到 error 事件且流终结（现状：
//      吞掉后挂到流超时看门狗——测试形态 = 超时失败；修复后 = 真因文案）

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { createPiBackend, PI_CAPABILITIES } from '../src/backend/pi.js';
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
    mcp: (msg) => push('mcp', msg),
    skills: (msg) => push('skills', msg),
    gate: (msg) => push('gate', msg),
    trust: (msg) => push('trust', msg),
  };
  return { logger, lines };
}

function claimedStep(): ClaimedStep {
  return {
    step: { id: 'step-noop1', buildId: 'b1', kind: 'build', machineId: null, createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    instruction: null,
    todo: { id: 't1', seqNum: 1, title: '静默 no-op 探针', spec: '写一行探针' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: 'gw-noop',
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploadNames: string[][] = [];

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
        providerId: 'gw-noop',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions' as const,
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
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

/** 事件脚本 backend（pi-protocol-fallback.test.ts 同律）：脚本耗尽 = 事件流
 * 自然耗尽（零事件脚本 = 生成器不 yield 任何事件即 return——claude-code
 * pump 生成器耗尽的同形）。 */
function scriptedBackend(script: StepEvent[]): { backend: AgentBackend; handle: null } {
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(_sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      return {
        sessionId: 'pi-sess-noop',
        events: (async function* () {
          for (const ev of script) yield ev;
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
  return { backend, handle: null };
}

async function runNoopCase(script: StepEvent[]) {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-noop-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const { backend } = scriptedBackend(script);
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
  await runStep(deps, claimedStep());
  return { client, lines };
}

describe('runner 静默 no-op 闸（#698 洞 1：零事件轮不得按 success 收）', () => {
  test('失败方式 1：零事件 + 零错误 + 无 done → failed 且文案点名零事件轮', async () => {
    const { client } = await runNoopCase([]);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toMatch(/no-op|zero-event|零事件/i);
  });

  test('失败方式 2：user-role 回声事件不算进展 → 同律 failed', async () => {
    const { client } = await runNoopCase([
      { type: 'message_end', message: { role: 'user', content: '任务文本回声' } },
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toMatch(/no-op|zero-event|零事件/i);
  });

  test('失败方式 3：有 done 的正常轮 → success 不受闸影响', async () => {
    const { client } = await runNoopCase([
      { type: 'text_delta', text: '完成' },
      { type: 'done', usage: [] },
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('失败方式 4：零进展但有 done（会话自报完成）→ 不进闸（done = 自然收尾语义）', async () => {
    const { client } = await runNoopCase([{ type: 'done', usage: [] }]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });
});

describe('pi prompt() 预检拒绝上浮（#698 洞 2：吞错 → 看门狗假凶手）', () => {
  // 真 PiBackend + preset provider 无凭据：prompt() 的 auth 校验在 agent run
  // 之前 throw（无 API key）——原先被 .catch(void err) 吞掉，事件流永远不
  // 终结（挂到 300s 看门狗）。修复后：error 事件快速到达 + 流终结。
  test('失败方式 6：无凭据 preset provider → error 事件到达且流终结（真因文案）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-pi-noop-'));
    // 预检要走到「无凭据」分支：环境里的 ANTHROPIC_API_KEY / AUTH_TOKEN（本
    // 会话跑在 relay 上）会让 provider 视作已配置——走运行期 403 而非预检拒
    // 绝。清掉并在结束后恢复。
    const saved = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      authToken: process.env.ANTHROPIC_AUTH_TOKEN,
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      const backend = createPiBackend({
        agentDir: join(home, 'agent'),
        sessionDir: join(home, 'sessions'),
      });
      const handle = await backend.createSession({
        provider: { kind: 'api_key', providerId: 'anthropic' },
        modelId: 'claude-haiku-4-5',
        cwd: home,
        prompt: 'probe',
      });
      const events: StepEvent[] = [];
      const collect = (async () => {
        for await (const ev of handle.events) events.push(ev);
      })();
      // 现状（吞错）：流永不终结 → 这里 8s 超时炸（失败方式即本测试的失败
      // 形态）；修复后：毫秒级收到 error 事件并终结。
      await Promise.race([
        collect,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('stream never ended — prompt() rejection swallowed')),
            8_000,
          ),
        ),
      ]);
      expect(events.some((ev) => ev.type === 'error')).toBe(true);
      const err = events.find((ev) => ev.type === 'error') as {
        type: 'error';
        error: { message: string };
      };
      expect(err.error.message).toMatch(/prompt/i);
    } finally {
      if (saved.apiKey !== undefined) process.env.ANTHROPIC_API_KEY = saved.apiKey;
      if (saved.authToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.authToken;
    }
  }, 15_000);
});
