import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  WorktreeOps,
} from '@cairn/shared';
import { WORKER_REMOTE_TOOLS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { WorkspaceManager } from '../src/workspace.js';
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

function claimedStep(opts: {
  repoBound: boolean;
  continueSession?: string;
  provider?: string;
}): ClaimedStep {
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
      provider: opts.provider ?? null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

class FakeClient implements MachineApi {
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: { url: string; body: TranscriptUpload | string }[] = [];
  relayCalls: { stepId: string; name: string; params: Record<string, unknown> }[] = [];
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
  async relayTool(stepId: string, name: string, params: Record<string, unknown>) {
    this.relayCalls.push({ stepId, name, params });
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
  onSessionStart?: (cwd: string, session: SessionOpts) => void | Promise<void>;
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
      await opts.onSessionStart?.(o.cwd, o);
      return handle(events);
    },
    async continueSession(_id, o) {
      seen.push({ cwd: o.cwd, systemPrompt: o.systemPrompt });
      await opts.onSessionStart?.(o.cwd, o);
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
      return { committed: true, head: 'def456', setupDrift: [] };
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
  const home = testTempDir('cairn-runner-brief-');
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

describe('brief delivery through the session prompt', () => {
  test.each([undefined, 'pi', null] as const)(
    'delivers runtime guidance for channel %s without writing files',
    async (briefBackendId) => {
      const { backend, seen } = stubBackend({ briefBackendId });
      const { cwd, client } = await run({ claimed: claimedStep({ repoBound: false }), backend });
      expect(client.doneBodies[0]?.body.status).toBe('success');
      expect(seen[0]?.systemPrompt).toContain('负责构建');
      if (briefBackendId !== null) expect(seen[0]?.systemPrompt).toContain('stub-catalog');
      expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    },
  );

  test('Claude receives AGENTS.md guidance through the prompt while native CLAUDE.md stays untouched', async () => {
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const { backend, seen } = stubBackend({});
      const claude = createClaudeCodeBackend({});
      const { cwd, client } = await run({
        claimed: claimedStep({ repoBound: false }),
        backend: { ...backend, capabilities: claude.capabilities, brief: claude.brief },
        seed: (cwd) => writeFileSync(join(cwd, file), 'repository-guidance-sentinel\n'),
      });
      expect(client.doneBodies[0]?.body.status).toBe('success');
      expect(seen[0]?.systemPrompt).toContain('负责构建');
      if (file === 'AGENTS.md')
        expect(seen[0]?.systemPrompt).toContain('repository-guidance-sentinel');
      else expect(seen[0]?.systemPrompt).not.toContain('repository-guidance-sentinel');
      expect(readFileSync(join(cwd, file), 'utf8')).toBe('repository-guidance-sentinel\n');
    }
  });

  test.each(['open', 'stream'] as const)(
    '%s failure leaves repository guidance unchanged',
    async (failure) => {
      const { backend } = stubBackend({
        throwOnOpen: failure === 'open',
        events: [{ type: 'error', error: { message: 'stream failed', retryable: false } }],
      });
      const { cwd, client } = await run({
        claimed: claimedStep({ repoBound: false }),
        backend,
        seed: (cwd) => writeFileSync(join(cwd, 'AGENTS.md'), 'repository guidance\n'),
      });
      expect(client.doneBodies[0]?.body.status).toBe('failed');
      expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('repository guidance\n');
      expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    },
  );
});

describe('brief wiring: post-push marker detection (#958 gate 4)', () => {
  test('agent commits the marker into history itself → named in the transcript + log line', async () => {
    const cwdForWs = testTempDir('cairn-brief-leak-');
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
    const cwdForWs = testTempDir('cairn-brief-clean-');
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

test('generated worker brief requests light and dark screenshots through attach_file', async () => {
  let brief = '';
  const { backend } = stubBackend({
    onSessionStart: (_cwd, session) => {
      brief = session.systemPrompt ?? '';
    },
  });
  await run({ claimed: claimedStep({ repoBound: false }), backend });
  expect(brief).toContain('UI tasks');
  expect(brief).toContain('light and dark screenshots');
  expect(brief).toContain('attach_file');
});

test('runner prepares attach_file locally and relays only workspace bytes', async () => {
  const claimed = claimedStep({ repoBound: false });
  claimed.remoteTools = [...WORKER_REMOTE_TOOLS];
  const { backend } = stubBackend({
    onSessionStart: async (cwd, session) => {
      writeFileSync(join(cwd, 'report.txt'), 'runner attachment');
      expect(() =>
        session.executeRemoteTool?.('attach_file', { path: '../outside.txt' }),
      ).toThrow();
      await session.executeRemoteTool?.('attach_file', {
        path: 'report.txt',
        caption: 'Report',
        contentBase64: 'forged',
        teamId: 'foreign',
        mimeType: 'image/png',
      });
    },
  });
  const { client } = await run({ claimed, backend });
  expect(client.doneBodies[0]?.body.status).toBe('success');
  expect(client.relayCalls).toEqual([
    {
      stepId: 's1',
      name: 'attach_file',
      params: {
        fileName: 'report.txt',
        caption: 'Report',
        contentBase64: Buffer.from('runner attachment').toString('base64'),
      },
    },
  ]);
});

test('runtime guidance reaches the session while tracked workspace status stays empty', async () => {
  const { backend } = stubBackend({
    onSessionStart: (cwd, session) => {
      expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('');
      expect(session.systemPrompt).toContain('memory-sentinel');
      expect(session.systemPrompt).toContain('<skills>stub-catalog</skills>');
    },
  });
  const claimed = claimedStep({ repoBound: false });
  if (claimed.agent)
    claimed.agent.memories = [{ title: 'Test memory', content: 'memory-sentinel' }];
  const { client } = await run({
    claimed,
    backend,
    seed: (cwd) => {
      execFileSync('git', ['init', '-b', 'main'], { cwd });
      writeFileSync(join(cwd, 'AGENTS.md'), 'Repository guidance\n');
      execFileSync('git', ['add', 'AGENTS.md'], { cwd });
      execFileSync(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd },
      );
    },
  });
  expect(client.doneBodies[0]?.body.status).toBe('success');
});

test('an intentional no-op worker completes successfully through the real workspace manager', async () => {
  const repo = testTempDir('cairn-noop-repo-');
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
  writeFileSync(join(repo, 'AGENTS.md'), 'Repository guidance\n');
  mkdirSync(join(repo, '.agents'));
  writeFileSync(join(repo, '.agents/setup'), '#!/bin/sh\necho setup > setup-output\n', {
    mode: 0o755,
  });
  execFileSync('git', ['add', 'AGENTS.md', '.agents/setup'], { cwd: repo });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
    { cwd: repo },
  );
  const claimed = claimedStep({ repoBound: true });
  if (claimed.project?.repo) claimed.project.repo.cloneUrl = repo;
  const { logger } = captureLogger();
  const { backend } = stubBackend({
    events: [
      { type: 'text_delta', text: 'No changes; waiting for the requested decision.' },
      { type: 'done', usage: [] },
    ],
    onSessionStart: (cwd) => {
      const gitFile = readFileSync(join(cwd, '.git'), 'utf8').trim().slice('gitdir: '.length);
      const hook = join(gitFile, 'hooks/pre-commit');
      mkdirSync(join(hook, '..'), { recursive: true });
      writeFileSync(hook, '#!/bin/sh\necho empty-step-hook-ran >&2\nexit 1\n', { mode: 0o755 });
      execFileSync('git', ['config', 'core.hooksPath', join(gitFile, 'hooks')], { cwd });
    },
  });
  const { client } = await run({ claimed, backend, workspace: new WorkspaceManager({ logger }) });
  expect(client.doneBodies[0]?.body).toMatchObject({ status: 'success', hasChanges: false });
  expect(client.doneBodies[0]?.body.errorMessage).toBeUndefined();
});
