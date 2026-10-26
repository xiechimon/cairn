import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
  WorktreeOps,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { StepStops } from '../src/step-stops.js';

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

function claimedBuildStep(kind: 'plan' | 'build' = 'build'): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '停止探针', spec: '写一行探针' },
    project: {
      id: 'p1',
      name: 'demo',
      repo: { kind: 'hosted', cloneUrl: 'http://server/git/t1/demo.git' },
    },
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
  uploads: { url: string; body: TranscriptUpload | string }[] = [];
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
  async putUpload(url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    this.uploads.push({ url, body });
  }
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

function fakeWorkspace(cwd: string) {
  const calls: string[] = [];
  const ws: WorktreeOps = {
    async prepare() {
      calls.push('prepare');
      return {
        cwd,
        baseRepoDir: join(cwd, '..', 'repo'),
        branch: 'cairn/conv-conv-1',
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      calls.push('commitAll');
      return { committed: true, head: 'def456' };
    },
    async push() {
      calls.push('push');
    },
    async mergeDefaultBranch() {
      calls.push('mergeDefaultBranch');
      return { output: 'Already up to date' };
    },
    async headCommit() {
      calls.push('headCommit');
      return 'abc123';
    },
    async countAhead() {
      return 0;
    },
    async restoreCheckpoint(_cwd: string, commit: string) {
      calls.push(`restoreCheckpoint:${commit}`);
    },
    async cleanupOrphans() {
      return [];
    },
  };
  return { ws, calls };
}

function stoppableBackend(handles: AgentSessionHandle[]) {
  let releaseStop: (() => void) | null = null;
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession() {
      let stopped = false;
      const gate = new Promise<void>((r) => {
        releaseStop = r;
      });
      const handle: AgentSessionHandle = {
        sessionId: 'pi-sess-stop',
        events: (async function* () {
          yield { type: 'text_delta', text: '跑着' } as StepEvent;
          await gate;
          if (!stopped) yield { type: 'done', usage: [] } as StepEvent;
        })(),
        async steer() {},
        async stop() {
          stopped = true;
          releaseStop?.();
        },
        usage: () => [{ model: 'stub-model', input: 12, output: 8, cacheRead: 0, cacheWrite: 0 }],
      };
      handles.push(handle);
      return handle;
    },
    async continueSession() {
      throw new Error('unused in stop tests');
    },
  };
  return { backend };
}

async function waitFor(fn: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout');
}

async function setup(opts: { kind?: 'plan' | 'build'; discard: boolean; recovered?: boolean }) {
  const home = makeTestTempDir('cairn-runner-stop-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const handles: AgentSessionHandle[] = [];
  const { backend } = stoppableBackend(handles);
  const cwd = join(home, 'ws', 'conv-1');
  const { ws, calls } = fakeWorkspace(cwd);
  const sessionHandles = new Map<string, AgentSessionHandle>();
  const stops = new StepStops();
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger,
    paths,
    workspace: ws,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    sessionHandles,
    stops,
    heartbeatIntervalMs: 60_000,
  };
  const claimed = claimedBuildStep(opts.kind ?? 'build');
  if (opts.recovered) {
    await runStep(deps, claimed, { stopRequest: { discard: opts.discard } });
  } else {
    const running = runStep(deps, claimed);
    await waitFor(() => handles.length === 1);
    await stops.get('s1')?.deliver({ discard: opts.discard });
    await running;
  }
  return { client, journal, calls, lines, sessionHandles, stops, cwd, handles };
}

describe('runner stop close-out (M7 #308)', () => {
  test('failure mode 1: discard=true → rewound to step start + done(stopped) + no commit/push', async () => {
    const { client, calls, cwd } = await setup({ discard: true });
    expect(calls).toContain(`restoreCheckpoint:abc123`);
    expect(calls).not.toContain('commitAll');
    expect(calls).not.toContain('push');
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]!.body.status).toBe('stopped');
    expect(client.doneBodies[0]!.body.commit).toBeUndefined();
    expect(client.doneBodies[0]!.body.usage).toEqual([
      { model: 'stub-model', input: 12, output: 8, cacheRead: 0, cacheWrite: 0 },
    ]);
    void cwd;
  });

  test("failure mode 2: discard=false → no rewind (this round's changes kept) + done(stopped)", async () => {
    const { client, calls } = await setup({ discard: false });
    expect(calls.some((c) => c.startsWith('restoreCheckpoint'))).toBe(false);
    expect(calls).not.toContain('commitAll');
    expect(client.doneBodies[0]!.body.status).toBe('stopped');
  });

  test('failure mode 3: plan step stopped → plan.md not uploaded, transcript.json still uploaded', async () => {
    const { client } = await setup({ kind: 'plan', discard: true });
    expect(client.uploadNames).toEqual([['transcript.json']]);
    expect(client.uploads.length).toBe(1);
  });

  test('failure mode 4: journal settled and registry deregistered after stop', async () => {
    const { journal, sessionHandles, stops } = await setup({ discard: true });
    expect(journal.pending()).toEqual([]);
    expect(sessionHandles.has('s1')).toBe(false);
    expect(stops.get('s1')).toBeUndefined();
  });

  test('failure mode 5: recover carries in a discard stop → no session opened, rewound to step start + done(stopped)', async () => {
    const { client, calls, handles } = await setup({ discard: true, recovered: true });
    expect(handles).toHaveLength(0);
    expect(calls).toContain(`restoreCheckpoint:abc123`);
    expect(calls).not.toContain('commitAll');
    expect(client.doneBodies[0]!.body.status).toBe('stopped');
  });
});

describe('runner heartbeat answers 410 = this step no longer exists on the server → stop (#1488)', () => {
  async function heartbeatSetup(fail: () => Error) {
    const home = makeTestTempDir('cairn-runner-hb-');
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger, lines } = captureLogger();
    let beats = 0;
    const client = new (class extends FakeClient {
      override async heartbeat() {
        beats++;
        throw fail();
      }
    })();
    const handles: AgentSessionHandle[] = [];
    const { backend } = stoppableBackend(handles);
    const { ws, calls } = fakeWorkspace(join(home, 'ws', 'conv-1'));
    const stops = new StepStops();
    const running = runStep(
      {
        client,
        journal: new StepJournal(paths.outboxDir),
        backendFor: () => backend,
        logger,
        paths,
        workspace: ws,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        sessionHandles: new Map<string, AgentSessionHandle>(),
        stops,
        heartbeatIntervalMs: 20,
      },
      claimedBuildStep(),
    );
    await waitFor(() => handles.length === 1);
    return { client, calls, lines, stops, running, beats: () => beats };
  }

  test('failure mode 6: heartbeat 410 → session interrupted, done(stopped), no commit/push', async () => {
    const { client, calls, lines, running } = await heartbeatSetup(
      () => new MachineApiError(410, '{"error":"step s1 no longer exists"}'),
    );
    await running;
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]!.body.status).toBe('stopped');
    expect(calls).not.toContain('commitAll');
    expect(calls).not.toContain('push');
    expect(lines.some((l) => l.includes('no longer exists on the server'))).toBe(true);
  });

  test.each([
    ['404（被放回 / 不归本机）', () => new MachineApiError(404, '{"error":"step s1 (not yours)"}')],
    ['网络错误', () => new Error('fetch failed')],
  ])('失败方式 7：心跳 %s → 照常跑，不停', async (_label, fail) => {
    const { client, running, stops, beats } = await heartbeatSetup(fail);
    await waitFor(() => beats() >= 5);
    expect(client.doneBodies).toHaveLength(0);
    await stops.get('s1')?.deliver({ discard: false });
    await running;
    expect(client.doneBodies).toHaveLength(1);
  });
});
