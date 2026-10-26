import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { GET_SECRET_TOOL_NAME } from '../src/secret-channel.js';
import { statePaths } from '../src/state.js';

const SECRET_NAME = 'STRIPE_API_KEY';
const SECRET_VALUE = 'sk_live_stripe_per_step';

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

function claimedStep(kind: ClaimedStep['step']['kind']): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: '密钥探针', spec: '跑构建' },
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
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  secrets: Record<string, string> = {};

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
    this.calls.push('token');
    return {
      provider: {
        kind: 'http' as const,
        providerId: 'stub-gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions' as const,
        authHeader: true,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: this.secrets,
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
    this.calls.push(`done:${stepId}:${body.status}`);
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

interface Probe {
  sessionOpts: SessionOpts | null;
  taken: string | null;
  afterStep: string | null;
}

function probingBackend(probe: Probe): AgentBackend {
  const tool = () => probe.sessionOpts?.localTools?.[0] ?? null;
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      probe.sessionOpts = opts;
      const t = tool();
      probe.taken = t ? await t.execute({ name: SECRET_NAME }) : null;
      return {
        sessionId: 'pi-sess-secret',
        events: (async function* () {
          yield { type: 'text_delta', text: 'ok' } as never;
          yield { type: 'done', usage: [] } as never;
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
}

async function setup(kind: ClaimedStep['step']['kind'], secrets: Record<string, string>) {
  const home = makeTestTempDir('cairn-secret-channel-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  client.secrets = secrets;
  const probe: Probe = { sessionOpts: null, taken: null, afterStep: null };
  const deps = {
    client,
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => probingBackend(probe),
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimedStep(kind));
  const t = probe.sessionOpts?.localTools?.[0];
  probe.afterStep = t ? await t.execute({ name: SECRET_NAME }) : null;
  return { client, lines, probe };
}

describe('team secret access channel (02 §8 runtime layer)', () => {
  test('execution step: visible on the tool surface + correct value retrieved', async () => {
    const { probe, client } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    expect(probe.sessionOpts?.localTools?.[0]?.name).toBe(GET_SECRET_TOOL_NAME);
    expect(probe.taken).toBe(SECRET_VALUE);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('access leaves an audit line: step id + agent id + secret name + time, no value in the line', async () => {
    const { lines } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    const audits = lines.filter((l) => l.includes('secret taken'));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatch(
      new RegExp(
        `^\\[step\\] secret taken step=s1 agent=a1 name=${SECRET_NAME} at=\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z$`,
      ),
    );
    expect(lines.some((l) => l.includes(SECRET_VALUE))).toBe(false);
  });

  test('unauthorized name = explicit reason, and no audit line produced', async () => {
    const { probe, lines } = await setup('build', { OTHER_KEY: SECRET_VALUE });
    expect(probe.taken).toContain('not granted');
    expect(probe.taken).toContain(SECRET_NAME);
    expect(lines.some((l) => l.includes('secret taken'))).toBe(false);
  });

  test('no access after step close (credential lifetime follows the step, same path on failure/interrupt)', async () => {
    const { probe, lines } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    expect(probe.afterStep).not.toBe(SECRET_VALUE);
    expect(probe.afterStep).toContain('no team secret is available for this step');
    expect(lines.filter((l) => l.includes('secret taken'))).toHaveLength(1);
  });

  test('trimmed by kind: planning / review steps do not register the access tool', async () => {
    for (const kind of ['plan', 'review'] as const) {
      const { probe } = await setup(kind, { [SECRET_NAME]: SECRET_VALUE });
      expect(probe.sessionOpts?.localTools ?? []).toEqual([]);
      expect(probe.taken).toBeNull();
    }
  });

  test('plaintext is not spread into the process environment: no value on the session surface except the access tool', async () => {
    const { probe } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    const { localTools: _localTools, ...rest } = probe.sessionOpts ?? ({} as SessionOpts);
    expect(JSON.stringify(rest)).not.toContain(SECRET_VALUE);
  });
});
