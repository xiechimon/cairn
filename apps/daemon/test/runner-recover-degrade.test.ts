import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  DeliveredImage,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import {
  buildTaskPromptText,
  CONTINUE_PROMPTS,
  classifyUserText,
  formatAttachmentToken,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal, type StepJournalEntry } from '../src/journal.js';
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
  attachments: Record<
    string,
    { fileName: string; mimeType: string; sizeBytes: number; contentBase64: string }
  > = {};

  async attachment(_stepId: string, attachmentId: string) {
    const hit = this.attachments[attachmentId];
    if (hit === undefined) throw new Error(`unused attachment ${attachmentId}`);
    return hit;
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
  hooks?: { onCreate?: () => void },
): {
  backend: AgentBackend;
  calls: ('create' | 'continue')[];
  prompts: (string | undefined)[];
  images: (readonly DeliveredImage[] | undefined)[];
} {
  const calls: ('create' | 'continue')[] = [];
  const prompts: (string | undefined)[] = [];
  const images: (readonly DeliveredImage[] | undefined)[] = [];
  const record = (opts: SessionOpts) => {
    prompts.push(opts.prompt ?? undefined);
    images.push(opts.promptImages);
  };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      calls.push('create');
      record(opts);
      hooks?.onCreate?.();
      return handle('pi-new-sess', events);
    },
    async continueSession(id, opts) {
      calls.push('continue');
      if (throwOnContinue) {
        throw new SessionNotResumableError(id);
      }
      record(opts);
      return handle(id, events);
    },
  };
  return { backend, calls, prompts, images };
}

async function runRecover(
  claimed: ClaimedStep,
  backend: AgentBackend,
  resume: { sessionId: string | null; prompt: string | null },
) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-recover-degrade-'));
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

async function runExec(
  claimed: ClaimedStep,
  backend: AgentBackend,
  hooks?: {
    beforeRun?: (ctx: {
      paths: ReturnType<typeof statePaths>;
      journal: StepJournal;
      client: FakeClient;
    }) => void;
  },
) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-exec-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  hooks?.beforeRun?.({ paths, journal, client });
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
  return { client, home, lines, paths, journal };
}

describe('#1286 recover-surface session degradation', () => {
  const SESSION_ID = 'pi-sess-missing';

  test('1. recover + missing .jsonl → degrade to new session, step succeeds (main bug fixed)', async () => {
    const claimed = recoverStep('build', SESSION_ID);
    const resumePrompt = claimed.instruction ?? 'fallback prompt text';
    const { backend, calls, prompts } = recoveringBackend(true);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: resumePrompt,
    });

    expect(calls).toContain('continue');
    expect(calls).toContain('create');
    expect(calls.indexOf('create')).toBeGreaterThan(calls.indexOf('continue'));
    expect(prompts).toHaveLength(1);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('2. recover + .jsonl present → normal continue, no degradation triggered', async () => {
    const claimed = recoverStep('build', SESSION_ID);
    const resumePrompt = claimed.instruction ?? 'fallback prompt text';
    const { backend, calls } = recoveringBackend(false);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: resumePrompt,
    });

    expect(calls).toEqual(['continue']);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('3. non-recover (no opts.resume) → continue failure degrades to new session, step succeeds (#1312)', async () => {
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

  test('4. journal.prompt null + .jsonl missing → explicit failure with readable wording (no silent empty resend)', async () => {
    const claimed = recoverStep('build', SESSION_ID);
    const { backend, calls, prompts } = recoveringBackend(true);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: null,
    });

    expect(calls).toEqual(['continue']);
    expect(prompts).toHaveLength(0);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toContain('no journal prompt to resend');
  });

  test('5. chief step recover + missing .jsonl → degrade to new session, same rule', async () => {
    const claimed = recoverStep('chief', SESSION_ID);
    const resumePrompt = 'chief recover test prompt';
    const { backend, calls } = recoveringBackend(true);
    const { client } = await runRecover(claimed, backend, {
      sessionId: SESSION_ID,
      prompt: resumePrompt,
    });

    expect(calls).toContain('continue');
    expect(calls).toContain('create');
    expect(calls.indexOf('create')).toBeGreaterThan(calls.indexOf('continue'));
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('6. execution-time session on another machine → degrade, annotation names the other machine (#1312)', async () => {
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

  test('7. non-empty plan.md at the local handoff location → degraded prompt points at that file, wire line is not a user bubble', async () => {
    const claimed = execStep(SESSION_ID);
    const { backend, prompts } = recoveringBackend(true);
    let planFile = '';
    const { client, paths } = await runExec(claimed, backend, {
      beforeRun: ({ paths: statePathsForRun }) => {
        planFile = join(statePathsForRun.plansDir, claimed.conversationId, PLAN_FILE_NAME);
        mkdirSync(dirname(planFile), { recursive: true });
        writeFileSync(planFile, '# 方案\nContext: 已确认\n');
      },
    });
    expect(planFile).toBe(join(paths.plansDir, 'conv-1', PLAN_FILE_NAME));
    expect(existsSync(planFile)).toBe(true);
    const delivered = prompts[0] ?? '';
    expect(delivered).toContain(`已确认方案位置：${planFile}`);
    expect(delivered).not.toContain('已确认的方案在');
    const user = client.uploads
      .flatMap((upload) => upload.messages)
      .find((message) => message.role === 'user');
    expect(classifyUserText(String(user?.content).trim(), TASK)).toBe('task-prompt');
  });

  test('8. machine switched and no local plan.md → degraded prompt does not point at the handoff path', async () => {
    const claimed = execStep(SESSION_ID);
    (claimed.session as { priorMachineId?: string }).priorMachineId = 'other-box';
    const { backend, prompts } = recoveringBackend(true);
    const { paths } = await runExec(claimed, backend);
    const absent = join(paths.plansDir, 'conv-1', PLAN_FILE_NAME);
    expect(existsSync(absent)).toBe(false);
    expect(prompts[0]).toBe(buildTaskPromptText(TASK.title, TASK.spec));
    expect(prompts[0]).not.toContain(absent);
  });

  test('9. blank plan.md is not treated as a handoff artifact', async () => {
    const claimed = execStep(SESSION_ID);
    const { backend, prompts } = recoveringBackend(true);
    await runExec(claimed, backend, {
      beforeRun: ({ paths }) => {
        const planFile = join(paths.plansDir, 'conv-1', PLAN_FILE_NAME);
        mkdirSync(dirname(planFile), { recursive: true });
        writeFileSync(planFile, '  \n');
      },
    });
    expect(prompts[0]).toBe(buildTaskPromptText(TASK.title, TASK.spec));
  });

  test('10. journal swapped to the original task before opening the session, no continuation-round placeholder sentence left', async () => {
    const held: { entry: StepJournalEntry | null } = { entry: null };
    let journal: StepJournal | null = null;
    const { backend } = recoveringBackend(true, [DONE_EVENT], {
      onCreate: () => {
        held.entry = journal?.get('s1') ?? null;
      },
    });
    await runExec(execStep(SESSION_ID), backend, {
      beforeRun: (ctx) => {
        journal = ctx.journal;
      },
    });
    expect(held.entry).not.toBeNull();
    expect(held.entry?.prompt).toContain(TASK.spec);
    expect(held.entry?.prompt).not.toContain(CONTINUE_PROMPTS.build);
    expect(held.entry?.sessionAction).toBe('new');
    expect(held.entry?.sessionId).toBeNull();
  });

  test('11. degraded prompt expands attachment tokens, does not reuse continuation-round images', async () => {
    const specPng = Buffer.from('89504e470d0a1a0a', 'hex');
    const instrPng = Buffer.from('89504e470d0a1a0b', 'hex');
    const specToken = formatAttachmentToken('spec.png', 't1/spec.png');
    const instrToken = formatAttachmentToken('instr.png', 't1/instr.png');
    const claimed = execStep(SESSION_ID);
    claimed.todo = { ...TASK, spec: `${TASK.spec}\n\n${specToken}` };
    claimed.instruction = instrToken;
    const { backend, prompts, images } = recoveringBackend(true);
    const { client } = await runExec(claimed, backend, {
      beforeRun: ({ client: fake }) => {
        fake.attachments.spec = {
          fileName: 'spec.png',
          mimeType: 'image/png',
          sizeBytes: specPng.byteLength,
          contentBase64: specPng.toString('base64'),
        };
        fake.attachments.instr = {
          fileName: 'instr.png',
          mimeType: 'image/png',
          sizeBytes: instrPng.byteLength,
          contentBase64: instrPng.toString('base64'),
        };
      },
    });
    const delivered = prompts[0] ?? '';
    expect(delivered).not.toContain('attachment:');
    expect(delivered).toContain('[image attached: spec.png]');
    expect(delivered).toContain('[image attached: instr.png]');
    expect(images[0]).toEqual([
      { data: specPng.toString('base64'), mimeType: 'image/png' },
      { data: instrPng.toString('base64'), mimeType: 'image/png' },
    ]);
    const user = client.uploads
      .flatMap((upload) => upload.messages)
      .find((message) => message.role === 'user');
    expect(String(user?.content)).toContain(specToken);
    expect(String(user?.content)).toContain(instrToken);
  });
});
