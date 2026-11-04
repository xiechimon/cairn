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

class FakeClient implements MachineApi {
  doneBodies: MachineDoneBody[] = [];
  rateLimits: {
    machineId: string;
    status: string;
    rateLimitType?: string;
    utilization?: number;
    resetsAt?: number;
  }[] = [];

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
    return { provider: null, secrets: {}, git: null };
  }
  async skillsManifest() {
    return { selection: 'whitelist' as const, skills: [] };
  }
  async skillFile(): Promise<Buffer> {
    throw new Error('unexpected skillFile call');
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
  async done(_stepId: string, body: MachineDoneBody) {
    this.doneBodies.push(body);
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
  async shellResult() {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
  async reportClaudeRateLimit(body: {
    machineId: string;
    status: string;
    rateLimitType?: string;
    utilization?: number;
    resetsAt?: number;
  }) {
    this.rateLimits.push(body);
  }
}

async function run(notices: (opts: SessionOpts) => void) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-rate-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const client = new FakeClient();
  const push = () => {};
  const logger: DaemonLogger = {
    raw: push,
    prefixed: push,
    supervisor: push,
    machine: push,
    step: push,
    workspace: push,
    recover: push,
    wake: push,
    skills: push,
    gate: push,
    trust: push,
    mcp: push,
  };
  const claimed: ClaimedStep = {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: 'Rate limit probe', spec: 'Touch README.md' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'claude-builder',
      description: null,
      provider: 'claude-code',
      modelId: 'claude-sonnet',
      thinkingLevel: null,
    },
  };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      let stopped = false;
      return {
        sessionId: 'sess-rate',
        events: (async function* () {
          notices(opts);
          if (stopped) return;
          const done: StepEvent = { type: 'done', usage: [] };
          yield done;
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
  const deps = {
    client,
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => backend,
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
    claudeCodeAuthProbe: async () => ({
      state: 'logged-in' as const,
      method: 'oauth',
      provider: 'anthropic',
    }),
  };
  await runStep(deps, claimed, {});
  return client;
}

describe('runner claude rate limit (#1852)', () => {
  test('allowed_warning is forwarded and does not stop the step', async () => {
    const client = await run((opts) => {
      opts.onClaudeRateLimit?.({
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization: 0.8,
      });
    });
    expect(client.rateLimits).toEqual([
      {
        machineId: 'm1',
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization: 0.8,
      },
    ]);
    expect(client.doneBodies[0]?.status).toBe('success');
    expect(client.doneBodies[0]?.quotaBlock).toBeUndefined();
  });

  test('rejected is forwarded and the step ends with a claude-code quota block', async () => {
    const resetsAt = Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000);
    const client = await run((opts) => {
      opts.onClaudeRateLimit?.({
        status: 'rejected',
        rateLimitType: 'five_hour',
        utilization: 1,
        resetsAt,
      });
    });
    expect(client.rateLimits).toEqual([
      {
        machineId: 'm1',
        status: 'rejected',
        rateLimitType: 'five_hour',
        utilization: 1,
        resetsAt,
      },
    ]);
    expect(client.doneBodies[0]?.status).toBe('failed');
    expect(client.doneBodies[0]?.quotaBlock).toMatchObject({
      kind: 'quota',
      providerId: 'claude-code',
    });
    expect(client.doneBodies[0]?.quotaBlock?.reason).toContain('five_hour');
    expect(client.doneBodies[0]?.quotaBlock?.retryAfterMs).toBeGreaterThan(60 * 60 * 1000);
  });
});
