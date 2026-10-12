// runner 配额熔断（#1261）：quota/capacity 错误即停会话（不打满 pi 预算的
// 同形重试风暴）+ done 携带结构化 quotaBlock（哪一路 relay / Retry-After），
// server 侧据此挂起「等额度」而非判死。失败方式枚举先于实现固化（AGENTS.md
// 测试规则 3；#708 有界生命周期是本面的兜底，quota 熔断是它的前哨）：
//   Q1 风暴未熔断：quota 错误若只靠 #708 预算收尾 → 烧满 1+RETRY_STORM_MAX
//      发才停（用户实测 attempt=4 打破 max 3）。熔断后发数 = 0（首个 error
//      事件即停，auto_retry_start 一发不达）。
//   Q2 信号丢失：quotaBlock 缺席 → server 按普通失败判死 todo（旧路径），
//      板面零「等额度」态。断言 providerId/reason/retryAfterMs 逐位。
//   Q3 非配额误报：普通 400/网络错带 quotaBlock = 板面假「等额度」（错误
//      挂起语义）。断言 400 路径 done body 无 quotaBlock。
//   Q4 非重试形（pi 不 retry 的 402）：error → done 自然收尾也要带 quotaBlock
//      （zero-event round 的主形态——pi 对 402 不自动重试，会话静默耗尽）。
//   Q5 Retry-After 透传：诊断行里的 retry-after 解析成毫秒进 quotaBlock；
//      无头 = 缺席（不造数值）。
//   Q6 进度后配额：会话有真实进展后遇 quota → 仍挂起（continue session
//      语义可用），不是普通 failed。

import { mkdtempSync } from 'node:fs';
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
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const QUOTA_402 = '402: {"message":"当前分组额度已用尽，请充值后重试","type":"quota_error"}';
const CAPACITY_429 =
  '429: Too Many Requests\nprovider response: POST http://relay/v1/messages -> 429 application/json (not an SSE stream); retry-after: 30; first bytes: "rate limited"';
const RELAY_400 = '400: {"message":"Model does not support this protocol.","type":"server_error"}';

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

function claimedBuildStep(): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '配额探针', spec: '写一行探针' },
    project: { id: 'p1', name: 'demo', repo: null },
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
      provider: {
        kind: 'http' as const,
        providerId: this.providerId,
        label: 'relay-quota-probe',
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
  async syncResult() {}
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

/** 会话脚本（StepEvent 序列；stop() 立即终止生成器 = 真 handle.stop() 中断
 * 事件流语义同形）。counts.autoRetries = 实际送达 runner 的 auto_retry_start
 * 事件数（Q1 的发数对账面）。 */
function scriptedBackend(scripts: StepEvent[][]): {
  backend: AgentBackend;
  counts: { autoRetries: number };
} {
  const counts = { autoRetries: 0 };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      const idx = counts.autoRetries === 0 ? 0 : 0; // 单会话面（无回落轮）
      void sessionOpts;
      void idx;
      const script = scripts[0] ?? [{ type: 'done', usage: [] }];
      let stopped = false;
      return {
        sessionId: 'pi-sess-quota',
        events: (async function* () {
          for (const ev of script) {
            if (stopped) return;
            if (ev.type === 'auto_retry_start') counts.autoRetries += 1;
            yield ev;
          }
        })(),
        async steer() {},
        async stop() {
          stopped = true;
        },
        usage: () => [],
      };
    },
    async continueSession() {
      throw new Error('unused');
    },
  };
  return { backend, counts };
}

/** 真形态开面前缀（#708 verify 栈实测事件序）。 */
function sessionOpenEcho(): StepEvent[] {
  return [
    { type: 'message_end', message: { role: 'system', content: 'you are a builder' } },
    { type: 'message_end', message: { role: 'user', content: '写一行探针' } },
  ];
}

/** quota 风暴脚本：开面回声 + n × [message_end(error) + error + auto_retry]。 */
function quotaCycles(n: number, message: string): StepEvent[] {
  const out: StepEvent[] = sessionOpenEcho();
  for (let i = 0; i < n; i++) {
    out.push({
      type: 'message_end',
      message: { role: 'assistant', content: '', stopReason: 'error' },
    });
    out.push({ type: 'error', error: { message, retryable: true } });
    out.push({ type: 'auto_retry_start', attempt: i + 1 });
  }
  return out;
}

async function runQuotaCase(script: StepEvent[], providerId = 'gw-quota') {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-quota-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient(providerId);
  const journal = new StepJournal(paths.outboxDir);
  const { backend, counts } = scriptedBackend([script]);
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
  await runStep(deps, claimedBuildStep(), {});
  return { client, lines, autoRetries: counts.autoRetries };
}

describe('runner 配额熔断（#1261）', () => {
  test('Q1 quota 风暴：首个 error 事件即熔断——auto_retry 一发不达，根因仍报', async () => {
    const { client, lines, autoRetries } = await runQuotaCase(quotaCycles(10, QUOTA_402));
    expect(autoRetries).toBe(0); // 熔断先于 pi 预算：不发满 1+max
    expect(lines.some((l) => l.includes('quota circuit breaker'))).toBe(true);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.quotaBlock?.kind).toBe('quota');
    expect(client.doneBodies[0]?.body.quotaBlock?.providerId).toBe('gw-quota');
  });

  test('Q2 信号完整：label / reason 逐位（server 侧「哪一路 relay」显示面）', async () => {
    const { client } = await runQuotaCase(quotaCycles(2, QUOTA_402), 'relay-186');
    const block = client.doneBodies[0]?.body.quotaBlock;
    expect(block?.providerId).toBe('relay-186');
    expect(block?.label).toBe('relay-quota-probe');
    expect(block?.reason).toContain('额度已用尽');
  });

  test('Q4 非重试形（error → done 自然收尾）：quotaBlock 仍在（zero-event 主形态）', async () => {
    const script: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error' } },
      { type: 'error', error: { message: QUOTA_402, retryable: false } },
      { type: 'done', usage: [] },
    ];
    const { client, autoRetries } = await runQuotaCase(script);
    expect(autoRetries).toBe(0);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.quotaBlock?.kind).toBe('quota');
  });

  test('Q5 capacity + Retry-After：kind=capacity，retryAfterMs 解析毫秒', async () => {
    const { client } = await runQuotaCase(quotaCycles(2, CAPACITY_429));
    const block = client.doneBodies[0]?.body.quotaBlock;
    expect(block?.kind).toBe('capacity');
    expect(block?.retryAfterMs).toBe(30_000);
  });

  test('Q3 非配额误报：普通 400 → 无 quotaBlock（旧 failed 路径零回归）', async () => {
    const script: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error' } },
      { type: 'error', error: { message: RELAY_400, retryable: false } },
      { type: 'done', usage: [] },
    ];
    const { client, lines } = await runQuotaCase(script);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.quotaBlock).toBeUndefined();
    expect(lines.some((l) => l.includes('quota circuit breaker'))).toBe(false);
  });

  test('Q6 有进展后遇 quota：仍挂起（continue session 语义），非普通失败', async () => {
    const script: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'text_delta', text: '写了一行' },
      {
        type: 'message_end',
        message: { role: 'assistant', content: '写了一行', stopReason: 'stop' },
      },
      { type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error' } },
      { type: 'error', error: { message: QUOTA_402, retryable: false } },
      { type: 'done', usage: [] },
    ];
    const { client } = await runQuotaCase(script);
    expect(client.doneBodies[0]?.body.quotaBlock?.kind).toBe('quota');
  });
});
