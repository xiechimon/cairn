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
} from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { adaptProviderCompat, PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { combineTimeoutWithRootCause, RETRY_STORM_MAX, runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const RELAY_400 = '400: {"message":"Model does not support this protocol.","type":"server_error"}';
const TRANSIENT_503 = '503: service unavailable';

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
    todo: { id: 't1', seqNum: 3, title: '生命周期探针', spec: '写一行探针' },
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

function scriptedStormBackend(scripts: StepEvent[][]): {
  backend: AgentBackend;
  providers: (ProviderConfig | null | undefined)[];
  counts: { autoRetries: number };
} {
  const providers: (ProviderConfig | null | undefined)[] = [];
  const counts = { autoRetries: 0 };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      const idx = providers.length;
      providers[idx] = sessionOpts.provider;
      const script = scripts[idx] ?? [{ type: 'done', usage: [] }];
      let stopped = false;
      return {
        sessionId: `pi-sess-lc-${idx}`,
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
    async continueSession(_sessionId, opts) {
      return backend.createSession(opts);
    },
    adaptProviderCompat: (provider: ProviderConfig, errorMessage: string) =>
      adaptProviderCompat(provider, errorMessage),
  };
  return { backend, providers, counts };
}

function sessionOpenEcho(): StepEvent[] {
  return [
    { type: 'message_end', message: { role: 'system', content: 'you are a builder' } },
    { type: 'message_end', message: { role: 'user', content: '写一行探针' } },
  ];
}

function errorCycles(
  n: number,
  message: string,
  opts?: { retryable?: boolean; progress?: string; attempts?: number[] },
): StepEvent[] {
  const out: StepEvent[] = sessionOpenEcho();
  for (let i = 0; i < n; i++) {
    out.push({
      type: 'message_end',
      message: { role: 'assistant', content: '', stopReason: 'error' },
    });
    out.push({ type: 'error', error: { message, retryable: opts?.retryable ?? true } });
    out.push({
      type: 'auto_retry_start',
      attempt: opts?.attempts?.[i] ?? 1,
    });
    if (opts?.progress !== undefined) {
      out.push({ type: 'text_delta', text: opts.progress });
    }
  }
  return out;
}

async function runLifecycleCase(
  scripts: StepEvent[][],
  opts?: { providerId?: string; retryStormMax?: number },
) {
  const providerId = opts?.providerId ?? 'gw-lc';
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-lc-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient(providerId);
  const journal = new StepJournal(paths.outboxDir);
  const { backend, providers, counts } = scriptedStormBackend(scripts);
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const pending = runStep(deps, claimedBuildStep(), {
      ...(opts?.retryStormMax !== undefined ? { retryStormMax: opts.retryStormMax } : {}),
    });
    await vi.runAllTimersAsync();
    await pending;
  } finally {
    vi.useRealTimers();
  }
  return { client, lines, providers, autoRetries: counts.autoRetries };
}

describe('combineTimeoutWithRootCause (timeout cleanup + root-cause composition)', () => {
  test('both present → composed into one message (ticket example "stream timeout; root cause: 400 …"), root cause not lost', () => {
    const out = combineTimeoutWithRootCause(
      'stream timeout (first=300000ms idle=480000ms)',
      RELAY_400,
    );
    expect(out).toBe(`stream timeout (first=300000ms idle=480000ms)；根因: ${RELAY_400}`);
  });

  test('no root cause → pure timeout wording (zero regression: old shape of timeout without an underlying error)', () => {
    expect(combineTimeoutWithRootCause('stream timeout (first=1ms idle=2ms)', null)).toBe(
      'stream timeout (first=1ms idle=2ms)',
    );
  });
});

describe('runner auto_retry lifecycle (#708)', () => {
  test('storm: non-signature retryable errors → stopped once consecutive zero-progress exceeds budget, send count = 1+max, root cause reported directly', async () => {
    const { client, lines, providers, autoRetries } = await runLifecycleCase(
      [errorCycles(10, TRANSIENT_503)],
      { providerId: 'gw-lc-storm' },
    );
    expect(providers).toHaveLength(1);
    expect(autoRetries).toBe(RETRY_STORM_MAX + 1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toBe(TRANSIENT_503);
    expect(lines.some((l) => l.includes('retry storm'))).toBe(true);
  });

  test('storm: signature error → fallback round flips knobs, second storm → failed with root cause (two sessions, each round 1+max sends)', async () => {
    const { client, providers, autoRetries } = await runLifecycleCase(
      [errorCycles(10, RELAY_400), errorCycles(10, RELAY_400)],
      { providerId: 'gw-lc-sig' },
    );
    expect(providers).toHaveLength(2);
    expect(providers[1]?.compat).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    expect(autoRetries).toBe((RETRY_STORM_MAX + 1) * 2);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toBe(RELAY_400);
  });

  test("storm boundary: pi's own budget exits after 3 tries (run8 connection-error shape) → storm not triggered, daemon resumes successfully", async () => {
    const script: StepEvent[] = [
      ...errorCycles(3, 'connection error', { attempts: [1, 2, 3] }),
      { type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error' } },
      { type: 'error', error: { message: 'connection error', retryable: true } },
      { type: 'done', usage: [] },
    ];
    const { client, lines, providers, autoRetries } = await runLifecycleCase([script], {
      providerId: 'gw-lc-budget',
    });
    expect(autoRetries).toBe(3);
    expect(lines.some((l) => l.includes('retry storm'))).toBe(false);
    expect(providers).toHaveLength(2);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(client.doneBodies[0]?.body.errorMessage).toBeUndefined();
  });

  test('progress resets the count: errors alternating with progress → storm not triggered, step success', async () => {
    const script: StepEvent[] = [
      ...errorCycles(6, TRANSIENT_503, { progress: '写了一行' }),
      { type: 'done', usage: [] },
    ];
    const { client, lines } = await runLifecycleCase([script], {
      providerId: 'gw-lc-progress',
    });
    expect(lines.some((l) => l.includes('retry storm'))).toBe(false);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('budget injectable: retryStormMax=1 → stopped at the 2nd send (send count = 1+1)', async () => {
    const { client, autoRetries } = await runLifecycleCase([errorCycles(10, TRANSIENT_503)], {
      providerId: 'gw-lc-tight',
      retryStormMax: 1,
    });
    expect(autoRetries).toBe(2);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toBe(TRANSIENT_503);
  });
});

describe('real pi event shape: message_end(stopReason=error) + error + done', () => {
  test('run9 shape (non-retry 400 with body): fallback gate open — message_end(error) does not count as progress, done does not latch', async () => {
    const script: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error' } },
      { type: 'error', error: { message: RELAY_400, retryable: false } },
      { type: 'done', usage: [] },
    ];
    const pass2: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'text_delta', text: 'ok' },
      { type: 'done', usage: [] },
    ];
    const { client, providers } = await runLifecycleCase([script, pass2], {
      providerId: 'gw-lc-realshape',
    });
    expect(providers).toHaveLength(2);
    expect(providers[1]?.compat).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });
});

describe('runner per-message usage trace line (#927)', () => {
  test('message_end carrying usage → [step] message usage line (including cost); done body keeps the cost field', async () => {
    const usage = {
      input: 0,
      output: 980,
      cacheRead: 100,
      cacheWrite: 0,
      cost: { input: 0, output: 1960, cacheRead: 50, cacheWrite: 0, total: 2010 },
    };
    const events: StepEvent[] = [
      ...sessionOpenEcho(),
      {
        type: 'message_end',
        message: { role: 'assistant', content: '', stopReason: 'stop', usage },
      },
      {
        type: 'done',
        usage: [{ model: 'gw-lc-usage/stub-model', ...usage }],
      },
    ];
    const { client, lines } = await runLifecycleCase([events], { providerId: 'gw-lc-usage' });
    const usageLines = lines.filter((l) => l.includes('message usage:'));
    expect(usageLines).toHaveLength(1);
    expect(usageLines[0]).toContain('gw-lc-usage/stub-model');
    expect(usageLines[0]).toContain('input=0');
    expect(usageLines[0]).toContain('output=980');
    expect(usageLines[0]).toContain('cacheRead=100');
    expect(usageLines[0]).toContain('cacheWrite=0');
    expect(usageLines[0]).toContain('cost=2010');
    expect(client.doneBodies[0]?.body.usage?.[0]?.cost?.total).toBe(2010);
  });

  test('messages without usage (claude-code surface / old projection) → zero usage lines (silent zero regression)', async () => {
    const events: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'message_end', message: { role: 'assistant', content: 'ok', stopReason: 'stop' } },
      { type: 'done', usage: [] },
    ];
    const { lines } = await runLifecycleCase([events], { providerId: 'gw-lc-nousage' });
    expect(lines.filter((l) => l.includes('message usage:'))).toHaveLength(0);
  });
});

describe('runner done.errorMessage ANSI stripping (#1262)', () => {
  const ESC = '\x1b';
  const ANSI_FAILURE = `git commit failed (1): ${ESC}[0mapps/web/src/fixtures/fixtures.ts${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m1667${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m53${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m${ESC}]8;;https://biomejs.dev/linter/rules/use-template${ESC}\\lint/style/useTemplate${ESC}]8;;${ESC}\\`;
  const CLEAN_FAILURE =
    'git commit failed (1): apps/web/src/fixtures/fixtures.ts:1667:53 lint/style/useTemplate';

  test('error event payload with SGR + OSC8 → doneBody.errorMessage plain text', async () => {
    const script: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error' } },
      { type: 'error', error: { message: ANSI_FAILURE, retryable: false } },
      { type: 'done', usage: [] },
    ];
    const { client } = await runLifecycleCase([script], { providerId: 'gw-lc-ansi' });
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toBe(CLEAN_FAILURE);
  });

  test('clean error wording passes through verbatim (zero regression, consistent with the existing root-cause passthrough rule)', async () => {
    const script: StepEvent[] = [
      ...sessionOpenEcho(),
      { type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error' } },
      { type: 'error', error: { message: TRANSIENT_503, retryable: false } },
      { type: 'done', usage: [] },
    ];
    const { client } = await runLifecycleCase([script], { providerId: 'gw-lc-ansi-clean' });
    expect(client.doneBodies[0]?.body.errorMessage).toBe(TRANSIENT_503);
  });
});

describe('runner noOutput signal (#1493)', () => {
  test('success but zero assistant output → done carries noOutput', async () => {
    const { client } = await runLifecycleCase(
      [[...sessionOpenEcho(), { type: 'done', usage: [] }]],
      { providerId: 'gw-lc-no-output' },
    );
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(client.doneBodies[0]?.body.noOutput).toBe(true);
  });

  test('assistant output present → not carried (negative control)', async () => {
    const { client } = await runLifecycleCase(
      [
        [
          ...sessionOpenEcho(),
          { type: 'message_end', message: { role: 'assistant', content: '写好了' } },
          { type: 'done', usage: [] },
        ],
      ],
      { providerId: 'gw-lc-has-output' },
    );
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(client.doneBodies[0]?.body.noOutput).toBeUndefined();
  });
});
