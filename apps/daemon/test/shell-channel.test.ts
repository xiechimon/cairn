import { existsSync, mkdtempSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentBackend,
  type AgentSessionHandle,
  type ClaimedStep,
  type MachineDoneBody,
  type MachineShellPrecheckResponse,
  type MachineShellResultBody,
  type MachineStreamEvent,
  type SessionOpts,
  SHELL_COMMAND_CHAR_LIMIT,
  SHELL_OUTPUT_CHAR_LIMIT,
  type ToolCallRecord,
  type TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { buildRemoteShellTool, type ShellWire } from '../src/shell-channel.js';
import { statePaths } from '../src/state.js';

class FakeWire implements ShellWire {
  precheckCalls: { stepId: string; command: string }[] = [];
  resultCalls: { runId: string; body: MachineShellResultBody }[] = [];
  precheckError: unknown = null;
  resultError: unknown = null;

  async shellPrecheck(stepId: string, command: string): Promise<MachineShellPrecheckResponse> {
    this.precheckCalls.push({ stepId, command });
    if (this.precheckError) throw this.precheckError;
    return { allowed: true, runId: 'run-1' };
  }

  async shellResult(runId: string, body: MachineShellResultBody): Promise<void> {
    this.resultCalls.push({ runId, body });
    if (this.resultError) throw this.resultError;
  }
}

function harness(opts: { timeoutMs?: number; cwd?: string } = {}) {
  const wire = new FakeWire();
  const lines: string[] = [];
  const cwd = opts.cwd ?? mkdtempSync(join(tmpdir(), 'cairn-shell-channel-'));
  const tool = buildRemoteShellTool({
    wire,
    stepId: 's1',
    cwd,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    onAudit: (line) => lines.push(line),
  });
  return { wire, lines, cwd, tool };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('remote_shell tool (precheck + spawn + result write-back)', () => {
  test('scenario 1 allow chain: real command executes, output returned verbatim, done/exitCode/output written back', async () => {
    const { wire, lines, tool } = harness();
    const out = await tool.execute({ command: 'echo hi' });
    expect(out).toBe('hi\n');
    expect(wire.precheckCalls).toEqual([{ stepId: 's1', command: 'echo hi' }]);
    expect(wire.resultCalls).toHaveLength(1);
    expect(wire.resultCalls[0]!.runId).toBe('run-1');
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 0 });
    expect(wire.resultCalls[0]!.body.output).toContain('hi');
    expect(lines.some((l) => l.includes('shell done') && l.includes('exit=0'))).toBe(true);
  });

  test('scenario 1b cwd = session working directory: command executes in it', async () => {
    const { wire, cwd, tool } = harness();
    const out = await tool.execute({ command: 'pwd' });
    // macOS tmpdir symlinks /var to /private/var; pwd is resolved.
    expect(out.trim()).toBe(realpathSync(cwd));
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 0 });
  });

  test('scenario 2 timeout: the whole process group is killed (background children die with it), failed written back, timeout text returned', async () => {
    const { wire, lines, cwd, tool } = harness({ timeoutMs: 400 });
    const marker = join(cwd, 'bg-ticks.txt');
    const out = await tool.execute({
      command: `echo start; (while true; do echo tick >> '${marker}'; sleep 0.05; done) & sleep 30`,
    });
    expect(out).toContain('超时');
    expect(out).toContain('start');
    expect(wire.resultCalls).toHaveLength(1);
    expect(wire.resultCalls[0]!.body.status).toBe('failed');
    expect(wire.resultCalls[0]!.body.errorMessage).toContain('超时');
    const sizeAtReturn = statSync(marker).size;
    expect(sizeAtReturn).toBeGreaterThan(0);
    await sleep(400);
    expect(statSync(marker).size).toBe(sizeAtReturn);
    expect(lines.some((l) => l.includes('shell timeout'))).toBe(true);
  }, 15_000);

  test('scenario 3 large output: truncated with a marker, write-back/return ≤ SHELL_OUTPUT_CHAR_LIMIT', async () => {
    const { wire, tool } = harness({ timeoutMs: 30_000 });
    const total = SHELL_OUTPUT_CHAR_LIMIT + 50_000;
    const out = await tool.execute({
      command: `tr '\\0' 'x' < /dev/zero | head -c ${total}`,
    });
    expect(out.length).toBeLessThanOrEqual(SHELL_OUTPUT_CHAR_LIMIT);
    expect(out).toContain('截断');
    expect(out).toContain(String(total));
    const written = wire.resultCalls[0]!.body.output ?? '';
    expect(written.length).toBeLessThanOrEqual(SHELL_OUTPUT_CHAR_LIMIT);
    expect(written).toContain('截断');
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 0 });
  }, 30_000);

  test('scenario 4 precheck 403: unauthorized reason returned, command not executed, no write-back', async () => {
    const reason = '机器 m1 未开启 shell 访问（机器详情页），无法执行命令';
    const { wire, lines, cwd, tool } = harness();
    wire.precheckError = new MachineApiError(403, reason);
    const probe = join(cwd, 'must-not-exist');
    const out = await tool.execute({ command: `touch '${probe}'` });
    expect(out).toContain('未授权');
    expect(out).toContain(reason);
    expect(existsSync(probe)).toBe(false);
    expect(wire.resultCalls).toHaveLength(0);
    expect(lines.some((l) => l.includes('shell denied'))).toBe(true);
  });

  test('scenario 5 precheck offline: precheck failure returned, no silent success, command not executed', async () => {
    const { wire, cwd, tool } = harness();
    wire.precheckError = new TypeError('fetch failed');
    const probe = join(cwd, 'must-not-exist');
    const out = await tool.execute({ command: `touch '${probe}'` });
    expect(out).toContain('预检失败');
    expect(out).toContain('fetch failed');
    expect(existsSync(probe)).toBe(false);
    expect(wire.resultCalls).toHaveLength(0);
  });

  test('scenario 6 write-back failure: real output returned + explicit write-back failure reason (never a silent success)', async () => {
    const { wire, lines, tool } = harness();
    wire.resultError = new TypeError('fetch failed');
    const out = await tool.execute({ command: 'echo payload' });
    expect(out).toContain('payload');
    expect(out).toContain('回写失败');
    expect(wire.resultCalls).toHaveLength(1);
    expect(lines.some((l) => l.includes('shell writeback failed'))).toBe(true);
  });

  test('scenario 7 non-zero exit code: write-back still done + exitCode, returned text contains the exit code', async () => {
    const { wire, tool } = harness();
    const out = await tool.execute({ command: 'echo oops >&2; exit 3' });
    expect(out).toContain('oops');
    expect(out.trimEnd().endsWith('[exit 3]')).toBe(true);
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 3 });
  });

  test('scenario 8 invalid arguments: empty command / overlong command → explicit reason, no precheck sent', async () => {
    const { wire, tool } = harness();
    const empty = await tool.execute({});
    expect(empty).toContain('command');
    const blank = await tool.execute({ command: '   ' });
    expect(blank).toContain('command');
    const overlong = await tool.execute({
      command: `echo ${'x'.repeat(SHELL_COMMAND_CHAR_LIMIT)}`,
    });
    expect(overlong).toContain('预检失败');
    expect(overlong).toContain(String(SHELL_COMMAND_CHAR_LIMIT));
    expect(wire.precheckCalls).toHaveLength(0);
    expect(wire.resultCalls).toHaveLength(0);
  });

  test('scenario 9 spawn failure: failed + errorMessage written back, execution failure reason returned', async () => {
    const { wire, lines, tool } = harness({ cwd: join(tmpdir(), 'cairn-shell-no-such-dir') });
    const out = await tool.execute({ command: 'echo hi' });
    expect(out).toContain('执行失败');
    expect(wire.resultCalls).toHaveLength(1);
    expect(wire.resultCalls[0]!.body.status).toBe('failed');
    expect(wire.resultCalls[0]!.body.errorMessage ?? '').not.toBe('');
    expect(lines.some((l) => l.includes('shell spawn failed'))).toBe(true);
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

function claimedStep(localTools?: string[]): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'shell 探针', spec: '跑一条命令' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    ...(localTools !== undefined ? { localTools } : {}),
  };
}

class FakeClient implements MachineApi {
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
  async done(_stepId: string, _body: MachineDoneBody) {}
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

function recordingBackend(slot: { sessionOpts: SessionOpts | null }): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      slot.sessionOpts = opts;
      return {
        sessionId: 'pi-sess-shell',
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

async function toolNamesFor(localTools?: string[]): Promise<string[]> {
  const home = mkdtempSync(join(tmpdir(), 'cairn-shell-reg-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger } = captureLogger();
  const slot: { sessionOpts: SessionOpts | null } = { sessionOpts: null };
  const deps = {
    client: new FakeClient(),
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => recordingBackend(slot),
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimedStep(localTools));
  return (slot.sessionOpts?.localTools ?? []).map((t) => t.name);
}

describe('remote_shell registration surface (claim localTools → session tool surface)', () => {
  test('scenario 10a localTools contains remote_shell → tool surface contains it', async () => {
    const names = await toolNamesFor(['remote_shell']);
    expect(names).toContain('remote_shell');
  });

  test('scenario 10b localTools = [] (either switch off) → tool surface does not contain it', async () => {
    const names = await toolNamesFor([]);
    expect(names).not.toContain('remote_shell');
  });

  test('scenario 10c localTools absent (chief step / old server) → tool surface does not contain it', async () => {
    const names = await toolNamesFor(undefined);
    expect(names).not.toContain('remote_shell');
  });
});
