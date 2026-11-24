import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentBackend,
  ClaimedStep,
  CommitIdentity,
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
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { resumePendingUpload } from '../src/step-final-upload.js';
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
  uploads: (TranscriptUpload | string)[] = [];
  failDone = false;
  commitIdentity: CommitIdentity | undefined;
  antigravityToken: string | undefined;
  constructor(
    private readonly tokenProvider: ProviderConfig | null,
    private readonly subscriptionToken?: string,
  ) {}

  async enroll(): Promise<never> {
    throw new Error('unused');
  }
  async me(): Promise<never> {
    throw new Error('unused');
  }
  async presence() {
    return { ok: true as const };
  }
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
      provider: this.tokenProvider,
      secrets: {},
      git: null,
      commitIdentity: this.commitIdentity,
      claudeSubscriptionToken: this.subscriptionToken,
      antigravityToken: this.antigravityToken,
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
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    this.uploads.push(body);
  }
  async done(stepId: string, body: MachineDoneBody) {
    if (this.failDone) throw new Error('done endpoint unavailable');
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function recordingBackend(
  echo?: string,
  sessionFile?: string,
): {
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
        ...(sessionFile !== undefined ? { sessionFile } : {}),
        events: (async function* () {
          yield { type: 'text_delta', text: echo ?? 'ok' } as never;
          if (echo) yield { type: 'error', error: { message: echo, retryable: false } } as never;
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

const STEP_SUBSCRIPTION_TOKEN = 'step-subscription-token';

async function setup(
  claimed: ClaimedStep,
  opts: {
    tokenProvider?: ProviderConfig | null;
    subscriptionToken?: string;
    echoToken?: boolean;
    antigravityToken?: string;
    output?: string;
    sessionFile?: string;
    failDone?: boolean;
    withoutSubscription?: boolean;
    machineName?: string;
    runEnv?: Record<string, string>;
    commitIdentity?: CommitIdentity;
  } = {},
) {
  const home = testTempDir('cairn-runner-runtime-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient(
    opts.tokenProvider ?? null,
    opts.withoutSubscription === true
      ? undefined
      : (opts.subscriptionToken ?? STEP_SUBSCRIPTION_TOKEN),
  );
  client.failDone = opts.failDone ?? false;
  client.commitIdentity = opts.commitIdentity;
  client.antigravityToken = opts.antigravityToken;
  const journal = new StepJournal(paths.outboxDir);
  const { backend, sessions, resumed } = recordingBackend(
    opts.output ?? (opts.echoToken ? opts.subscriptionToken : undefined),
    opts.sessionFile,
  );
  const resolved: (string | null | undefined)[] = [];
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
  };
  await runStep(deps, claimed, opts.runEnv !== undefined ? { env: opts.runEnv } : {});
  return { client, lines, sessions, resumed, resolved, paths, journal, deps };
}

describe('runner runtime identity branch (spec 17 A3/A4)', () => {
  test.each([
    { provider: 'stub-gw', identity: undefined, expected: 'stub-builder <cairn@localhost>' },
    { provider: 'claude-code', identity: undefined, expected: 'stub-builder <cairn@localhost>' },
    {
      provider: 'stub-gw',
      identity: { name: 'Connected owner', email: 'owner@example.com' },
      expected: 'Connected owner <owner@example.com>',
    },
  ])(
    'a $provider session can commit with an empty HOME using $expected without writing global config',
    async ({ provider, identity, expected }) => {
      const { sessions } = await setup(claimedStep({ provider, modelId: 'stub-model' }), {
        commitIdentity: identity,
        runEnv: { GIT_AUTHOR_NAME: 'Inherited', GIT_AUTHOR_EMAIL: 'wrong@example.com' },
      });
      const dir = testTempDir('runner-commit-');
      const env = {
        PATH: process.env.PATH,
        HOME: dir,
        XDG_CONFIG_HOME: dir,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(dir, '.gitconfig'),
        ...sessions[0]?.env,
      };
      execFileSync('git', ['init', '-q'], { cwd: dir, env });
      execFileSync('git', ['commit', '--allow-empty', '-m', 'First task result'], {
        cwd: dir,
        env,
      });
      expect(
        execFileSync('git', ['show', '-s', '--format=%an <%ae>%n%cn <%ce>'], {
          cwd: dir,
          env,
          encoding: 'utf8',
        }),
      ).toBe(`${expected}\n${expected}\n`);
      expect(existsSync(join(dir, '.gitconfig'))).toBe(false);
      expect(
        execFileSync('git', ['config', '--local', '--list'], { cwd: dir, env, encoding: 'utf8' }),
      ).not.toMatch(/^user\./m);
    },
  );

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

describe('runner Claude Code subscription preflight', () => {
  test('a Claude Code step without a subscription token fails before the session starts', async () => {
    const { client, sessions } = await setup(
      claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      { withoutSubscription: true },
    );
    expect(sessions).toHaveLength(0);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    const msg = client.doneBodies[0]?.body.errorMessage ?? '';
    expect(msg).toContain('claude setup-token');
    expect(msg).toContain('设置 → 模型路由');
  });

  test('a pi step runs without a subscription token', async () => {
    const { client, sessions } = await setup(
      claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }),
      { withoutSubscription: true },
    );
    expect(sessions).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });
});

describe('runner runtime-step session continuation (spec 17 A7)', () => {
  test('a follow-up build step resumes the completed claude-code session with the new instruction', async () => {
    const initial = claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' });
    const first = await setup(initial);
    const sessionId = first.client.doneBodies[0]?.body.sessionId;
    expect(first.client.doneBodies[0]?.body.status).toBe('success');
    expect(sessionId).toBe('stub-sess-1');
    const next: ClaimedStep = {
      ...initial,
      step: { ...initial.step, id: 's2', createdAt: 2 },
      session: { action: 'continue', sessionId: sessionId ?? null },
      instruction: 'Add coverage for the completed task',
    };
    const continued = await setup(next);
    expect(continued.resolved).toEqual(['claude-code']);
    expect(continued.resumed).toEqual([sessionId]);
    expect(continued.sessions).toHaveLength(1);
    expect(continued.sessions[0]?.prompt).toContain(next.instruction);
    expect(continued.client.doneBodies[0]).toMatchObject({
      stepId: 's2',
      body: { status: 'success', sessionId },
    });
  });

  test('session.action=continue → continueSession after backendFor resolution', async () => {
    const claimed = {
      ...claimedStep({ provider: 'claude-code', modelId: 'claude-sonnet-4-5' }),
      session: { action: 'continue' as const, sessionId: 'sdk-session-uuid' },
    };
    const home = testTempDir('cairn-runner-runtime-');
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const client = new FakeClient(null, STEP_SUBSCRIPTION_TOKEN);
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

describe('subscription credential isolation', () => {
  test.each(['refreshToken', 'refresh_token'])(
    'Antigravity ACP output redacts bare OAuth bearer and %s before upload',
    async (refreshField) => {
      const bearer = 'ya29.fake-step-bearer';
      const refreshToken = 'fake-step-refresh-token';
      const credential = JSON.stringify({
        kind: 'oauth-personal',
        token: bearer,
        [refreshField]: refreshToken,
        expiresAt: Date.now() + 600_000,
      });
      const result = await setup(
        claimedStep({ provider: 'antigravity', modelId: 'gemini-flash' }),
        {
          antigravityToken: credential,
          output: `ACP output ${bearer} ${refreshToken}`,
        },
      );
      expect(result.sessions).toHaveLength(1);
      const output = JSON.stringify([
        result.lines,
        result.client.doneBodies,
        result.client.uploads,
      ]);
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain(bearer);
      expect(output).not.toContain(refreshToken);
      expect(result.sessions[0]?.secrets?.()).toEqual(
        expect.arrayContaining([credential, bearer, refreshToken]),
      );
      for (const entry of readdirSync(result.paths.outboxDir, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        const content = readFileSync(join(entry.parentPath, entry.name), 'utf8');
        expect(content).not.toContain(bearer);
        expect(content).not.toContain(refreshToken);
      }
    },
  );
  const token = 'private-subscription-token-for-step';
  test('Claude Code receives the per-step token; pi does not receive it', async () => {
    const claude = await setup(claimedStep({ provider: 'claude-code', modelId: 'sonnet' }), {
      subscriptionToken: token,
    });
    expect(claude.sessions[0]?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect(claude.sessions[0]?.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
    const pi = await setup(claimedStep({ provider: 'stub-gw', modelId: 'stub-model' }), {
      subscriptionToken: token,
    });
    expect(pi.sessions[0]?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(pi.sessions[0]?.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).not.toBe(token);
    expect([...claude.lines, ...pi.lines].join('')).not.toContain(token);
  });
  test('an Orb step gets the token without the subprocess scrub, which cannot run under nspawn', async () => {
    const orb = await setup(claimedStep({ provider: 'claude-code', modelId: 'sonnet' }), {
      subscriptionToken: token,
      runEnv: { CAIRN_ORB: '1' },
    });
    expect(orb.sessions[0]?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect(orb.sessions[0]?.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();
  });
  test('backend output and failures cannot put the token into step logs or uploaded results', async () => {
    const result = await setup(claimedStep({ provider: 'claude-code', modelId: 'sonnet' }), {
      subscriptionToken: token,
      echoToken: true,
    });
    expect(result.lines.join('')).not.toContain(token);
    expect(JSON.stringify(result.client.doneBodies)).not.toContain(token);
    for (const entry of readdirSync(result.paths.outboxDir, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isFile())
        expect(readFileSync(join(entry.parentPath, entry.name), 'utf8')).not.toContain(token);
    }
  });
});

test('subscription session uploads stay redacted when a failed final report is replayed after restart', async () => {
  const token = 'private-recovery-subscription-token';
  const directory = testTempDir('cairn-subscription-session-');
  const sessionFile = join(directory, 'session.jsonl');
  writeFileSync(sessionFile, `${JSON.stringify({ text: token })}\n`);
  const result = await setup(claimedStep({ provider: 'claude-code', modelId: 'sonnet' }), {
    subscriptionToken: token,
    sessionFile,
    failDone: true,
  });
  const entry = result.journal.get('s1');
  expect(entry?.state).toBe('awaiting-upload');
  result.client.failDone = false;
  if (!entry) throw new Error('Expected a pending upload');
  await resumePendingUpload(result.deps, entry);
  expect(JSON.stringify(result.client.uploads)).not.toContain(token);
});
