import { existsSync, writeFileSync } from 'node:fs';
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
import * as tempEnvironment from '@cairn/shared/temp-environment';
import { describe, expect, test, vi } from 'vitest';
import { createPiBackend, PI_CAPABILITIES } from '../src/backend/pi.js';
import * as credentials from '../src/credentials.js';
import { StepJournal, type TranscriptBuffer } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { StepAppCredential } from '../src/step-app-credential.js';
import { StepStops } from '../src/step-stops.js';
import { testTempDir } from './test-temp-dir.js';

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

function scriptedBackend(
  script: StepEvent[],
  inspect?: (opts: SessionOpts) => void,
): { backend: AgentBackend; handle: null } {
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      inspect?.(sessionOpts);
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
    async continueSession(_id, sessionOpts): Promise<AgentSessionHandle> {
      return backend.createSession(sessionOpts);
    },
  };
  return { backend, handle: null };
}

async function runNoopCase(
  script: StepEvent[],
  temporary?: { inspect: (opts: SessionOpts) => void; root: string; continuing?: boolean },
) {
  const home = testTempDir('cairn-runner-noop-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const { backend } = scriptedBackend(script, temporary?.inspect);
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
  const claimed = claimedStep();
  if (temporary?.continuing) claimed.session = { action: 'continue', sessionId: 'prior' };
  await runStep(
    deps,
    claimed,
    temporary
      ? { env: { CAIRN_TEST_TEMP_ROOT: temporary.root, CAIRN_HEAVY_SLOTS_DIR: '/shared/slots' } }
      : {},
  );
  return { client, lines };
}

describe('runner silent no-op gate (#698 hole 1: a zero-event round must not close as success)', () => {
  test('failure mode 1: zero events + zero errors + no done → failed, wording names the zero-event round', async () => {
    const { client } = await runNoopCase([]);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toMatch(/no-op|zero-event|零事件/i);
  });

  test('failure mode 2: user-role echo events do not count as progress → failed by the same rule', async () => {
    const { client } = await runNoopCase([
      { type: 'message_end', message: { role: 'user', content: '任务文本回声' } },
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toMatch(/no-op|zero-event|零事件/i);
  });

  test('failure mode 3: a normal round with done → success unaffected by the gate', async () => {
    const { client } = await runNoopCase([
      { type: 'text_delta', text: '完成' },
      { type: 'done', usage: [] },
    ]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('failure mode 4: zero progress but done present (session self-reports completion) → gate not entered (done = natural close semantics)', async () => {
    const { client } = await runNoopCase([{ type: 'done', usage: [] }]);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });
});

describe('pi prompt() preflight rejection surfaces (#698 hole 2: swallowed error → watchdog false culprit)', () => {
  test('failure mode 6: credential-less preset provider → error event arrives and the stream ends (true-cause wording)', async () => {
    const home = testTempDir('cairn-pi-noop-');
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

for (const mode of ['new', 'continue', 'failed'] as const) {
  test(`step temp environment is private on disk and reclaimed after ${mode}`, async () => {
    const root = testTempDir('step-disk-');
    let allocated: string | undefined;
    const { client } = await runNoopCase(mode === 'failed' ? [] : [{ type: 'done', usage: [] }], {
      root,
      continuing: mode === 'continue',
      inspect(opts) {
        allocated = opts.env?.TMPDIR;
        expect(allocated?.startsWith(`${root}/ct-`)).toBe(true);
        expect(opts.env?.CAIRN_HEAVY_SLOTS_DIR).toBe('/shared/slots');
        expect(existsSync(allocated!)).toBe(true);
        writeFileSync(join(allocated!, 'step-file'), 'owned');
      },
    });
    expect(allocated).toBeDefined();
    expect(existsSync(allocated!)).toBe(false);
    expect(client.doneBodies[0]?.body.status).toBe(mode === 'failed' ? 'failed' : 'success');
  });
}

test('cleanup failures do not skip credentials, heartbeat, maps or stop settlement', async () => {
  const home = testTempDir('step-cleanup-failure-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger } = captureLogger();
  const client = new FakeClient();
  const stops = new StepStops();
  const sessionHandles = new Map<string, AgentSessionHandle>();
  const stepImageSupport = new Map<string, boolean | null>();
  const stepSteeringSupport = new Map<string, boolean>();
  const stepTranscripts = new Map<string, TranscriptBuffer>();
  const temporaryFailure = new Error('temporary cleanup EACCES');
  const credentialFailure = new Error('credential cleanup EACCES');
  const mapFailure = new Error('session cleanup failure');
  const createTemporary = tempEnvironment.createTempEnvironment;
  const pushCredential = credentials.pushCredential;
  const dispose = StepAppCredential.prototype.dispose;
  vi.spyOn(tempEnvironment, 'createTempEnvironment').mockImplementation((env) => {
    const temporary = createTemporary(env);
    return {
      ...temporary,
      cleanup() {
        temporary.cleanup();
        vi.spyOn(sessionHandles, 'delete').mockImplementation((key) => {
          Map.prototype.delete.call(sessionHandles, key);
          throw mapFailure;
        });
        throw temporaryFailure;
      },
    };
  });
  vi.spyOn(credentials, 'pushCredential').mockImplementation((...args) => ({
    ...pushCredential(...args),
    git: {
      kind: 'app',
      username: 'test',
      password: 'synthetic',
      url: 'https://example.invalid/repo',
    },
  }));
  const clear = vi.spyOn(credentials, 'clearCredentials');
  const disposal = vi.spyOn(StepAppCredential.prototype, 'dispose').mockImplementation(function (
    this: StepAppCredential,
  ) {
    dispose.call(this);
    throw credentialFailure;
  });
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const clearTimer = vi.spyOn(globalThis, 'clearInterval');
  try {
    const { backend } = scriptedBackend([{ type: 'done', usage: [] }]);
    const result = await runStep(
      {
        client,
        journal: new StepJournal(paths.outboxDir),
        backendFor: () => backend,
        logger,
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        stops,
        sessionHandles,
        stepImageSupport,
        stepSteeringSupport,
        stepTranscripts,
      },
      claimedStep(),
      { env: { CAIRN_TEST_TEMP_ROOT: home } },
    ).catch((error: unknown) => error);
    expect(disposal).toHaveBeenCalledOnce();
    expect(clear.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      disposal.mock.invocationCallOrder[0]!,
    );
    expect(clearTimer).toHaveBeenCalledWith(intervals.mock.results[0]!.value);
    for (const map of [sessionHandles, stepImageSupport, stepSteeringSupport, stepTranscripts])
      expect(map.has('step-noop1')).toBe(false);
    expect(stops.get('step-noop1')).toBeUndefined();
    expect(result).toBeInstanceOf(AggregateError);
    for (const error of [temporaryFailure, credentialFailure, mapFailure])
      expect((result as AggregateError).message).toContain(error.message);
    expect((result as AggregateError).errors).toEqual([
      temporaryFailure,
      credentialFailure,
      mapFailure,
    ]);
    expect(existsSync(join(paths.agentRuntimeDir, 'step-step-noop1-github'))).toBe(false);
  } finally {
    vi.restoreAllMocks();
  }
});
