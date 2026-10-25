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

describe('protocolCompatFlip (signature match, pure function)', () => {
  test('failure mode 1: relay protocol 400 body → both knobs (max_tokens + no store)', () => {
    expect(protocolCompatFlip(RELAY_400)).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
  });

  test('failure mode 2a: OpenAI unsupported parameter names max_completion_tokens → only the field name is flipped', () => {
    expect(
      protocolCompatFlip('400 Unsupported parameter: max_completion_tokens is not supported'),
    ).toEqual({ maxTokensField: 'max_tokens' });
  });

  test('failure mode 2b: OpenAI unsupported parameter names store → only store is dropped', () => {
    expect(protocolCompatFlip('400 Unsupported parameter: store')).toEqual({
      supportsStore: false,
    });
  });

  test('failure mode 3: unrelated error → null, no flip', () => {
    expect(protocolCompatFlip('400: invalid model id')).toBeNull();
    expect(protocolCompatFlip('rate limit exceeded')).toBeNull();
  });
});

describe('adaptProviderCompat (fallback learning surface)', () => {
  test('failure mode 4: signature hit → returns the flipped config; flipping the same error again → null (single-shot budget)', () => {
    const gw = gateway('adapt-once');
    const amended = adaptProviderCompat(gw, RELAY_400);
    expect(amended?.compat).toEqual({ maxTokensField: 'max_tokens', supportsStore: false });
    expect(adaptProviderCompat(amended ?? gw, RELAY_400)).toBeNull();
  });

  test('failure mode 3: preset (no baseUrl) → null; non-signature error → null', () => {
    expect(adaptProviderCompat({ kind: 'api_key', providerId: 'anthropic' }, RELAY_400)).toBeNull();
    expect(adaptProviderCompat(gateway('adapt-nosig'), '500 internal')).toBeNull();
  });

  test('failure mode 5: explicit compat does not block error-driven fallback (the fallback round rewrites it; on the persistence surface explicit still beats learning — see the materialization cases)', () => {
    const explicit = gateway('adapt-explicit', { maxTokensField: 'max_completion_tokens' });
    const amended = adaptProviderCompat(explicit, RELAY_400);
    expect(amended?.compat).toEqual({ maxTokensField: 'max_tokens', supportsStore: false });
  });
});

describe('materializeProvider (compat materialized into models.json)', () => {
  function load(path: string): Record<string, Record<string, unknown>> {
    return (
      JSON.parse(readFileSync(path, 'utf8')) as {
        providers: Record<string, Record<string, unknown>>;
      }
    ).providers;
  }

  test('failure mode 6: no compat (neither explicit nor learned) → entry has no compat key (same shape as before)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-mat-'));
    const path = join(dir, 'models.json');
    materializeProvider(path, gateway('mat-bare'));
    const entry = load(path)['mat-bare'];
    expect(entry).toBeDefined();
    expect('compat' in (entry ?? {})).toBe(false);
    expect(entry).toMatchObject({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'per-step' });
  });

  test('wire compat materialized verbatim (maxTokensField / supportsStore / supportsDeveloperRole)', () => {
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

  test('failure modes 4/5: learning slot merged into materialization (later steps get the clean shape directly); explicit beats learning', () => {
    adaptProviderCompat(gateway('mat-learn'), RELAY_400);
    const dir = mkdtempSync(join(tmpdir(), 'cairn-mat-'));
    const path = join(dir, 'models.json');
    materializeProvider(path, gateway('mat-learn'));
    expect(load(path)['mat-learn']).toMatchObject({
      compat: { maxTokensField: 'max_tokens', supportsStore: false },
    });
    adaptProviderCompat(gateway('mat-mixed'), RELAY_400);
    materializeProvider(path, gateway('mat-mixed', { supportsStore: true }));
    expect(load(path)['mat-mixed']).toMatchObject({
      compat: { maxTokensField: 'max_tokens', supportsStore: true },
    });
  });
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

describe('runner protocol 400 in-step fallback (#654)', () => {
  test('failure modes 1+7: zero-progress signature error → knobs flipped and a new round starts, step success; second round provider carries the flipped compat', async () => {
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

  test('failure mode 3: non-signature error → no fallback, single round, step failed', async () => {
    const { client, providers } = await runFallbackCase(
      [[{ type: 'error', error: { message: '401 unauthorized', retryable: false } }]],
      { providerId: 'gw-fb-nosig' },
    );
    expect(providers).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('failure mode 3 (with progress): same error after a text_delta → no fallback (a replay would re-execute), step failed', async () => {
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

  test('failure mode 4: same error on the second occurrence → fallback round ends failed (pass>0 no longer enters the gate, no third round)', async () => {
    const { client, providers } = await runFallbackCase(
      [
        [{ type: 'error', error: { message: RELAY_400, retryable: false } }],
        [{ type: 'error', error: { message: RELAY_400, retryable: false } }],
      ],
      { providerId: 'gw-fb-twice' },
    );
    expect(providers).toHaveLength(2);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('backend without an adaptation surface (claude-code shape) → single round, step failed (zero regression)', async () => {
    const { client, providers } = await runFallbackCase(
      [[{ type: 'error', error: { message: RELAY_400, retryable: false } }]],
      { withAdapt: false, providerId: 'gw-fb-noadapt' },
    );
    expect(providers).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });
});
