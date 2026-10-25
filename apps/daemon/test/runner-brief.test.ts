import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { PI_CAPABILITIES } from '../src/backend/pi.js';
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

function claimedStep(opts: { repoBound: boolean; continueSession?: string }): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: opts.continueSession
      ? { action: 'continue', sessionId: opts.continueSession }
      : { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '简报探针', spec: '写点东西' },
    project: opts.repoBound
      ? { id: 'p1', name: 'demo', repo: { kind: 'hosted', cloneUrl: 'http://x/r.git' } }
      : { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: '负责构建',
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
  async putUpload(url: string, _h: Record<string, string>, body: TranscriptUpload | string) {
    this.uploads.push({ url, body });
  }
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

function stubBackend(opts: {
  events?: StepEvent[];
  briefBackendId?: 'pi' | null;
  onSessionStart?: (cwd: string) => void;
  throwOnOpen?: boolean;
}): { backend: AgentBackend; seen: { cwd: string; systemPrompt: string | undefined }[] } {
  const seen: { cwd: string; systemPrompt: string | undefined }[] = [];
  const events = opts.events ?? [{ type: 'done', usage: [] }];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    ...(opts.briefBackendId === null
      ? {}
      : {
          brief: {
            backendId: (opts.briefBackendId ?? 'pi') as 'pi',
            composeBody: (_o, base) => `${base ?? ''}\n\n<skills>stub-catalog</skills>`,
          },
        }),
    async createSession(o) {
      if (opts.throwOnOpen === true) throw new Error('session open blew up');
      seen.push({ cwd: o.cwd, systemPrompt: o.systemPrompt });
      opts.onSessionStart?.(o.cwd);
      return handle(events);
    },
    async continueSession(_id, o) {
      seen.push({ cwd: o.cwd, systemPrompt: o.systemPrompt });
      opts.onSessionStart?.(o.cwd);
      return handle(events);
    },
  };
  return { backend, seen };
}

function handle(events: StepEvent[]): AgentSessionHandle {
  return {
    sessionId: 'pi-sess-1',
    events: (async function* gen() {
      for (const ev of events) yield ev;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  };
}

function fakeWorkspace(
  cwd: string,
  opts: { briefLeak?: string[] } = {},
): { ws: WorktreeOps; calls: string[] } {
  const calls: string[] = [];
  const ws: WorktreeOps = {
    async prepare() {
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
      return { output: 'Already up to date' };
    },
    async headCommit() {
      return 'abc123';
    },
    async countAhead() {
      return 0;
    },
    async restoreCheckpoint() {
      calls.push('restoreCheckpoint');
    },
    async cleanupOrphans() {
      return [];
    },
    async briefMarkerInRef() {
      calls.push('briefMarkerInRef');
      return opts.briefLeak ?? [];
    },
  };
  return { ws, calls };
}

async function run(opts: {
  claimed: ClaimedStep;
  backend: AgentBackend;
  workspace?: WorktreeOps;
  seed?: (cwd: string) => void;
}): Promise<{ client: FakeClient; lines: string[]; cwd: string }> {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-brief-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const cwd = join(workspacesDir, opts.claimed.conversationId);
  mkdirSync(cwd, { recursive: true });
  opts.seed?.(cwd);
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  await runStep(
    {
      client,
      journal,
      backendFor: () => opts.backend,
      logger,
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
      ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    },
    opts.claimed,
  );
  return { client, lines, cwd };
}

describe('brief wiring: write inventory and channel clearing', () => {
  test('file already on disk at createSession, content = systemPrompt body + backend contributions (failure mode 2)', async () => {
    let atOpen: string | null = null;
    const { backend, seen } = stubBackend({
      onSessionStart: (cwd) => {
        atOpen = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
      },
    });
    await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(seen.length).toBeGreaterThan(0);
    expect(atOpen).not.toBeNull();
    expect(atOpen as unknown as string).toContain('负责构建');
    expect(atOpen as unknown as string).toContain('<skills>stub-catalog</skills>');
  });

  test('with a brief channel → SessionOpts.systemPrompt absent (failure mode 1: channel not opened twice)', async () => {
    const { backend, seen } = stubBackend({});
    await run({ claimed: claimedStep({ repoBound: false }), backend });
    for (const s of seen) expect(s.systemPrompt).toBeUndefined();
  });

  test('backend without a brief channel → keeps inline systemPrompt and writes no file (failure mode 6)', async () => {
    const { backend, seen } = stubBackend({ briefBackendId: null });
    const { cwd } = await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(seen[0]?.systemPrompt).toContain('负责构建');
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
  });
});

describe('brief wiring: erase covers every exit', () => {
  test('successful close → created-state file deleted (positive case of failure mode 3)', async () => {
    const { backend } = stubBackend({});
    const { cwd, lines } = await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    expect(lines.some((l) => l.includes('brief removed'))).toBe(true);
  });

  test("appended state → user's existing file restored byte for byte", async () => {
    const { backend } = stubBackend({});
    const userText = '# 仓库约定\n\n- 用 pnpm\n';
    const { cwd } = await run({
      claimed: claimedStep({ repoBound: false }),
      backend,
      seed: (d) => writeFileSync(join(d, 'CLAUDE.md'), userText),
    });
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(userText);
  });

  test('openSession throw exit is also erased (key gap of failure mode 3)', async () => {
    const { backend } = stubBackend({ throwOnOpen: true });
    const { cwd, client, lines } = await run({
      claimed: claimedStep({ repoBound: false }),
      backend,
    });
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    expect(lines.some((l) => l.includes('brief removed') || l.includes('brief noop'))).toBe(true);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('stream-error exit is also erased (key gap of failure mode 3)', async () => {
    const { backend } = stubBackend({
      events: [
        {
          type: 'error',
          error: { message: 'stream blew up', retryable: false },
        } as StepEvent,
      ],
    });
    const { cwd } = await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
  });
});

describe('brief wiring: post-push marker detection (#958 gate 4)', () => {
  test('agent commits the marker into history itself → named in the transcript + log line', async () => {
    const cwdForWs = mkdtempSync(join(tmpdir(), 'cairn-brief-leak-'));
    mkdirSync(cwdForWs, { recursive: true });
    const { ws, calls } = fakeWorkspace(cwdForWs, { briefLeak: ['AGENTS.md'] });
    const { backend } = stubBackend({});
    const { client } = await run({
      claimed: claimedStep({ repoBound: true }),
      backend,
      workspace: ws,
    });
    expect(calls).toContain('briefMarkerInRef');
    expect(client.doneBodies[0]?.body.status).toBe('success');
    const transcript = JSON.stringify(client.uploads);
    expect(transcript).toContain('分支 cairn/conv-conv-1 的历史里带着运行简报的标记块');
    expect(transcript).toContain('AGENTS.md');
  });

  test('branch clean → no naming line (negative case, avoids reading "not detected" as "detection passed")', async () => {
    const cwdForWs = mkdtempSync(join(tmpdir(), 'cairn-brief-clean-'));
    mkdirSync(cwdForWs, { recursive: true });
    const { ws, calls } = fakeWorkspace(cwdForWs);
    const { backend } = stubBackend({});
    const { client } = await run({
      claimed: claimedStep({ repoBound: true }),
      backend,
      workspace: ws,
    });
    expect(calls).toContain('briefMarkerInRef');
    expect(JSON.stringify(client.uploads)).not.toContain('的历史里带着运行简报的标记块');
  });
});

describe('brief wiring: failure gate', () => {
  test('erase failure → no commitAll, closes as failed, transcript lands a line (failure mode 4)', async () => {
    const claimed = claimedStep({ repoBound: true });
    const cwdForWs = mkdtempSync(join(tmpdir(), 'cairn-brief-wt-'));
    const { ws, calls } = fakeWorkspace(cwdForWs);
    mkdirSync(cwdForWs, { recursive: true });
    const { backend } = stubBackend({
      onSessionStart: (cwd) => {
        rmSync(join(cwd, 'AGENTS.md'), { force: true });
        mkdirSync(join(cwd, 'AGENTS.md'));
      },
    });
    const { client } = await run({ claimed, backend, workspace: ws });
    expect(calls).not.toContain('commitAll');
    expect(calls).not.toContain('push');
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(JSON.stringify(client.uploads)).toContain('运行简报未能从工作区擦除');
  });

  test('write failure is fail-closed: no session opened (failure mode 5)', async () => {
    const { backend, seen } = stubBackend({});
    const { client, cwd } = await run({
      claimed: claimedStep({ repoBound: false }),
      backend,
      seed: (d) => mkdirSync(join(d, 'AGENTS.md')),
    });
    expect(seen.length).toBe(0);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(true);
  });
});
