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
} from '@cairn/shared';
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

function scriptedBackend(scripts: StepEvent[][]): {
  backend: AgentBackend;
  counts: { autoRetries: number };
} {
  const counts = { autoRetries: 0 };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      const idx = counts.autoRetries === 0 ? 0 : 0;
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

function sessionOpenEcho(): StepEvent[] {
  return [
    { type: 'message_end', message: { role: 'system', content: 'you are a builder' } },
    { type: 'message_end', message: { role: 'user', content: '写一行探针' } },
  ];
}

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
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-quota-'));
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

describe('runner quota circuit breaker (#1261)', () => {
  test('Q1 quota storm: circuit breaks on the first error event — auto_retry never fires once, root cause still reported', async () => {
    const { client, lines, autoRetries } = await runQuotaCase(quotaCycles(10, QUOTA_402));
    expect(autoRetries).toBe(0);
    expect(lines.some((l) => l.includes('quota circuit breaker'))).toBe(true);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.quotaBlock?.kind).toBe('quota');
    expect(client.doneBodies[0]?.body.quotaBlock?.providerId).toBe('gw-quota');
  });

  test('Q2 signal complete: label / reason bit by bit (the server-side "which relay path" display surface)', async () => {
    const { client } = await runQuotaCase(quotaCycles(2, QUOTA_402), 'relay-186');
    const block = client.doneBodies[0]?.body.quotaBlock;
    expect(block?.providerId).toBe('relay-186');
    expect(block?.label).toBe('relay-quota-probe');
    expect(block?.reason).toContain('额度已用尽');
  });

  test('Q4 non-retry shape (error → done natural close): quotaBlock still present (zero-event main shape)', async () => {
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

  test('Q5 capacity + Retry-After: kind=capacity, retryAfterMs parsed to milliseconds', async () => {
    const { client } = await runQuotaCase(quotaCycles(2, CAPACITY_429));
    const block = client.doneBodies[0]?.body.quotaBlock;
    expect(block?.kind).toBe('capacity');
    expect(block?.retryAfterMs).toBe(30_000);
  });

  test('Q3 non-quota false report: plain 400 → no quotaBlock (zero regression on the old failed path)', async () => {
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

  test('Q6 quota hit after progress: still suspends (continue session semantics), not a plain failure', async () => {
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
