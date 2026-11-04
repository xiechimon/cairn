import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  GitCredentials,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  ToolCallRecord,
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

function claimedStep(mcpServers?: string[]): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'mcp 三态探针', spec: '改一行' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    remoteTools: [],
    ...(mcpServers !== undefined ? { mcpServers } : {}),
  };
}

class FakeClient implements MachineApi {
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  git: GitCredentials | null = null;

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
      git: this.git,
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
  async putUpload() {}
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

function fakeWorkspace(): WorktreeOps {
  return {
    async prepare(input) {
      return {
        cwd: join(input.workspacesRoot, input.conversationId),
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      return { committed: false, head: null };
    },
    async push() {},
    async mergeDefaultBranch() {
      return { output: 'Already up to date' };
    },
    async headCommit() {
      return null;
    },
    async countAhead() {
      return 0;
    },
    async restoreCheckpoint() {},
    async cleanupOrphans() {
      return [];
    },
  };
}

function capturingBackend(captured: SessionOpts[]): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts): Promise<AgentSessionHandle> {
      captured.push(opts);
      return {
        sessionId: 'cap-sess',
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

async function run(claimed: ClaimedStep, localConfig?: Record<string, unknown>) {
  const captured: SessionOpts[] = [];
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-mcp-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const mcpConfigPath = join(home, 'claude.json');
  if (localConfig !== undefined) {
    writeFileSync(mcpConfigPath, JSON.stringify(localConfig), 'utf8');
  }
  await runStep(
    {
      client,
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => capturingBackend(captured),
      logger,
      paths,
      workspace: fakeWorkspace(),
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath,
      heartbeatIntervalMs: 60_000,
    },
    claimed,
  );
  const opts = captured[0];
  if (opts === undefined) throw new Error('createSession was not called');
  return { opts, lines, client };
}

describe('runner three-state passthrough (#1307 failure modes 5/6)', () => {
  test('claim [] = managed empty: SessionOpts.mcpServers key present and [] (does not collapse back to default)', async () => {
    const { opts } = await run(claimedStep([]));
    expect('mcpServers' in opts).toBe(true);
    expect(opts.mcpServers).toEqual([]);
  });

  test('claim absent = inherit: SessionOpts.mcpServers key absent (does not retroactively create managed empty)', async () => {
    const { opts } = await run(claimedStep(undefined));
    expect('mcpServers' in opts).toBe(false);
  });

  test('claim [slug] = managed set: endpoints resolved from the local config enter SessionOpts', async () => {
    const { opts } = await run(claimedStep(['demo']), {
      mcpServers: { demo: { url: 'https://example.invalid/mcp' } },
    });
    expect(opts.mcpServers).toEqual([
      { slug: 'demo', transport: 'http', url: 'https://example.invalid/mcp' },
    ]);
  });
});

describe('runner managed-ness does not flip with resolution results (#1307 failure modes 7/8)', () => {
  test('all checked slugs missing from the local config: still managed (key present as []) + degradation line still printed', async () => {
    const { opts, lines } = await run(claimedStep(['ghost']), { mcpServers: {} });
    expect('mcpServers' in opts).toBe(true);
    expect(opts.mcpServers).toEqual([]);
    expect(lines.some((l) => l.startsWith('[mcp]') && l.includes('ghost'))).toBe(true);
  });

  test('managed empty lands an observation line ([mcp] prefix, shape visible on the execution surface)', async () => {
    const { lines } = await run(claimedStep([]));
    expect(lines.some((l) => l.startsWith('[mcp]') && l.includes('managed-empty'))).toBe(true);
  });
});
