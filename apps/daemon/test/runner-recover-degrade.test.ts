// #1286 recover 面会话降级（pi 懒落盘窗口重启时 .jsonl 缺失的兜底）：
// recover 面（opts.resume 在位）的 continueSession 抛 SessionNotResumableError
// → 降级 new session 重发 journal.prompt；执行面（非 recover）直传步可见失败
// （#1260 语义保留）。失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. recover + .jsonl 缺失 → 降级 new session，步成功（主 bug）
//   2. recover + .jsonl 在 → 正常 continue，不触发降级
//   3. 非 recover 执行期 continue 失败 → 降级 new session，步成功，
//      卡片注记「本机找不到会话」，投递文本含原任务（#1312）
//   6. 执行期 continue 失败且 priorMachineId 不是本机 → 同样降级，
//      注记改为「在另一台机器上」（#1312）
//   4. journal.prompt 为 null + .jsonl 缺失 → 降级 new session，prompt 走
//      buildTaskPrompt 单源（不静默空重发——写实现时有 prompt 即投递）
//   5. chief 步 recover 同律（journal 面相同）

import { mkdtempSync } from 'node:fs';
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
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const TASK = {
  id: 't1',
  seqNum: 3,
  title: '降级探针',
  spec: 'recover 降级到 new session 时此文本应进入会话。',
};
const DONE_EVENT: StepEvent = { type: 'done', usage: [] };

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

function recoverStep(kind: 'build' | 'plan' | 'chief' = 'build', sessionId: string): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'continue', sessionId },
    todo: kind === 'chief' ? undefined : TASK,
    ...(kind === 'chief' ? {} : { project: { id: 'p1', name: 'demo', repo: null } }),
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

function execStep(sessionId: string): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'continue', sessionId },
    todo: TASK,
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
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: TranscriptUpload[] = [];

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
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload) {
    this.uploads.push(body);
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
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function handle(sessionId: string, events: StepEvent[]): AgentSessionHandle {
  return {
    sessionId,
    events: (async function* gen() {
      for (const ev of events) yield ev;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  };
}

function recoveringBackend(
  throwOnContinue: boolean,
  events: StepEvent[] = [DONE_EVENT],
): {
  backend: AgentBackend;
  calls: ('create' | 'continue')[];
  prompts: (string | undefined)[];
} {
  const calls: ('create' | 'continue')[] = [];
  const prompts: (string | undefined)[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      calls.push('create');
      prompts.push(opts.prompt ?? undefined);
      return handle('pi-new-sess', events);
    },
    async continueSession(id, opts) {
      calls.push('continue');
      if (throwOnContinue) {
        throw new SessionNotResumableError(id);
      }
      prompts.push(opts.prompt ?? undefined);
      return handle(id, events);
    },
  };
  return { backend, calls, prompts };
}

async function runRecover(
  claimed: ClaimedStep,
  backend: AgentBackend,
  resume: { sessionId: string | null; prompt: string | null },
) {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-recover-degrade-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimed,
    { resume, running: 1 },
  );
  return { client, home, lines };
}

async function runExec(claimed: ClaimedStep, backend: AgentBackend) {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-exec-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimed,
  );
  return { client, home, lines };
}

describe('#1286 recover 面会话降级', () => {
  const SESSION_ID = 'pi-sess-missing';

  test('1. recover + .jsonl 缺失 → 降级 new session，步成功（主 bug 修复）', async () => {
    const claimed = recoverStep('build', SESSION_ID);
    const resumePrompt = claimed.instruction ?? 'fallback prompt text';
    const { backend, calls, prompts } = recoveringBackend(true);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: resumePrompt,
    });

    // continueSession 被调用后抛错 → createSession 被调用（降级）
    expect(calls).toContain('continue');
    expect(calls).toContain('create');
    // create 排在 continue 之后（顺序：先 continue 失败，再 create）
    expect(calls.indexOf('create')).toBeGreaterThan(calls.indexOf('continue'));
    // 降级后的 createSession prompt = resume 的原 prompt
    expect(prompts).toHaveLength(1);
    // 步成功完成
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('2. recover + .jsonl 在 → 正常 continue，不触发降级', async () => {
    const claimed = recoverStep('build', SESSION_ID);
    const resumePrompt = claimed.instruction ?? 'fallback prompt text';
    const { backend, calls } = recoveringBackend(false);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: resumePrompt,
    });

    // continueSession 成功，未触发降级，createSession 不被调用
    expect(calls).toEqual(['continue']);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('3. 非 recover（无 opts.resume）→ continue 失败降级 new session，步成功（#1312）', async () => {
    const claimed = execStep(SESSION_ID);
    const { backend, calls, prompts } = recoveringBackend(true);
    const { client, lines } = await runExec(claimed, backend);

    expect(calls).toEqual(['continue', 'create']);
    expect(prompts).toEqual([expect.stringContaining(TASK.spec)]);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(client.doneBodies[0]?.body.errorMessage).toBeUndefined();
    const note = client.uploads
      .flatMap((upload) => upload.messages)
      .find((message) => message.role === 'system' && String(message.content).includes(SESSION_ID));
    expect(String(note?.content)).toContain('本机找不到会话');
    expect(lines.join('\n')).toContain('falling back to new session');
  });

  test('4. journal.prompt 为 null + .jsonl 缺失 → 显式失败带可读文案（不静默空重发）', async () => {
    const claimed = recoverStep('build', SESSION_ID);
    const { backend, calls, prompts } = recoveringBackend(true);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: null,
    });

    // continueSession 被调用并抛错，createSession 不被调用（不空重发）
    expect(calls).toEqual(['continue']);
    expect(prompts).toHaveLength(0);
    // 步失败，带可读文案
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toContain('no journal prompt to resend');
  });

  test('5. chief 步 recover + .jsonl 缺失 → 降级 new session，同律', async () => {
    const claimed = recoverStep('chief', SESSION_ID);
    const resumePrompt = 'chief recover test prompt';
    const { backend, calls } = recoveringBackend(true);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: resumePrompt,
    });

    // chief 步同降级
    expect(calls).toContain('continue');
    expect(calls).toContain('create');
    expect(calls.indexOf('create')).toBeGreaterThan(calls.indexOf('continue'));
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('6. 执行期会话在另一台机器 → 降级，注记点名异机（#1312）', async () => {
    const claimed = execStep(SESSION_ID);
    (claimed.session as { priorMachineId?: string }).priorMachineId = 'other-box';
    const { backend, calls } = recoveringBackend(true);
    const { client } = await runExec(claimed, backend);

    expect(calls).toEqual(['continue', 'create']);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    const note = client.uploads
      .flatMap((upload) => upload.messages)
      .find((message) => message.role === 'system');
    expect(String(note?.content)).toContain('另一台机器');
    expect(String(note?.content)).not.toContain('本机找不到会话');
  });
});
