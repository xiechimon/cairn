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

describe('runner runtime identity branch (spec 17 A3/A4)', () => {
  test('failure mode 1: runtime step + token provider null → executed by the claude backend + inert provider + canon line', async () => {
    const { client, lines, sessions, resolved } = await setup(
      claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
    );
    expect(resolved).toEqual(['claude-code']);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.provider).toEqual({ kind: 'api_key', providerId: 'claude-code' });
    expect(sessions[0]?.modelId).toBe('claude-sonnet-4-5');
    expect(lines).toContain('using model claude-code/claude-sonnet-4-5');
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('failure mode 2: runtime step + old-server pseudo provider → runtime branch authority short-circuits, executes as usual', async () => {
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

  test('failure mode 3: runtime step missing modelId → failStep, errorMessage contains the claude-code wording', async () => {
    const { client, sessions } = await setup(
      claimedStep({ provider: 'claude-code', modelId: null }),
    );
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toContain('claude-code');
    expect(sessions).toHaveLength(0);
  });

  test('failure mode 4: non-runtime custom id + token provider null → api_key fallback to the original semantics + canon line unchanged', async () => {
    const { client, lines, sessions, resolved } = await setup(
      claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }),
    );
    expect(resolved).toEqual(['stub-gw']);
    expect(sessions[0]?.provider).toEqual({ kind: 'api_key', providerId: 'stub-gw' });
    expect(lines).toContain('using model stub-gw/stub-model');
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('failure mode 5: non-runtime + no provider and no model → old failStep wording byte for byte', async () => {
    const { client, sessions } = await setup(claimedStep({ provider: null, modelId: null }));
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toBe('no agent/model on claimed step');
    expect(sessions).toHaveLength(0);
  });

  test("failure mode 6: backendFor receives agent.provider's original value (null step → null)", async () => {
    const { resolved } = await setup(claimedStep({ provider: null, modelId: 'stub-model' }), {
      tokenProvider: {
        kind: 'http',
        providerId: 'stub-gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        authHeader: true,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
    });
    expect(resolved).toEqual([null]);
  });
});

describe('runner runtime-step credential preflight (#867 T6 cross-machine credential preflight)', () => {
  test('failure mode 10: preflight logged out → fails before the step, wording names machine + credential kind + remedy', async () => {
    const { client, sessions, probeCalls } = await setup(
      claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      {
        machineName: 'daemon-mea',
        probe: async () => ({ state: 'not-logged-in', provider: 'firstParty' }),
      },
    );
    expect(probeCalls).toHaveLength(1);
    expect(sessions).toHaveLength(0);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    const msg = client.doneBodies[0]?.body.errorMessage ?? '';
    expect(msg).toContain('daemon-mea');
    expect(msg).toContain('ANTHROPIC_API_KEY');
    expect(msg).toContain('/login');
  });

  test('failure mode 11: preflight inconclusive (CLI missing/timeout) → does not block the step, lands a diagnostic line', async () => {
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

  test('failure mode 12: pi step → zero preflight calls (the zero-credential channel belongs to the runtime identity only)', async () => {
    const { client, probeCalls } = await setup(
      claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }),
    );
    expect(probeCalls).toHaveLength(0);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });
});

describe('runner runtime-step session continuation (spec 17 A7)', () => {
  test('session.action=continue → continueSession after backendFor resolution', async () => {
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
    expect(resumed).toEqual(['sdk-session-uuid']);
    expect(sessions[0]?.provider).toEqual({ kind: 'api_key', providerId: 'claude-code' });
  });
});

describe('runner runtime-step tool surface (spec 17 A10 / after #647 T4 wiring)', () => {
  const workerRemoteTools: RemoteToolDef[] = [
    { name: 'save_memory', description: '存记忆' },
    { name: 'search_memory', description: '搜记忆', replaySafe: true },
  ];

  test('failure mode 7: runtime worker step → all three surfaces enter sessionOpts as usual, no degradation line, step runs to completion', async () => {
    const claimed = {
      ...claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      remoteTools: workerRemoteTools,
      localTools: ['create_tag'],
    };
    const { client, lines, sessions } = await setup(claimed);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.remoteTools).toHaveLength(2);
    expect(typeof sessions[0]?.executeRemoteTool).toBe('function');
    expect((sessions[0]?.localTools ?? []).map((t) => t.name)).toContain('create_tag');
    expect((sessions[0]?.localTools ?? []).map((t) => t.name)).not.toContain('remote_shell');
    expect((sessions[0]?.localTools ?? []).length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => l.includes('T4'))).toBe(false);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('failure mode 8: runtime chief step → remoteTools + relay passthrough (chief vocabulary reaches the execution surface in full)', async () => {
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
    expect(sessions[0]?.remoteTools).toHaveLength(2);
    expect(typeof sessions[0]?.executeRemoteTool).toBe('function');
  });

  test('failure mode 9: pi worker step with the same payload → tool surface enters sessionOpts as usual (zero regression)', async () => {
    const claimed = {
      ...claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }),
      remoteTools: workerRemoteTools,
      localTools: ['create_tag'],
    };
    const { lines, sessions } = await setup(claimed);
    expect(sessions[0]?.remoteTools).toHaveLength(2);
    expect(typeof sessions[0]?.executeRemoteTool).toBe('function');
    expect((sessions[0]?.localTools ?? []).map((t) => t.name)).toContain('create_tag');
    expect((sessions[0]?.localTools ?? []).map((t) => t.name)).not.toContain('remote_shell');
    expect((sessions[0]?.localTools ?? []).length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => l.includes('T4'))).toBe(false);
  });
});
