import { mkdtempSync, writeFileSync } from 'node:fs';
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
} from '@cairn/shared';
import {
  appendPlanLocationNote,
  buildPlanRewritePrompt,
  CONTINUE_PROMPTS,
  PLAN_FILE_NAME,
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

function claimedNoRepoStep(
  kind: 'plan' | 'build',
  opts: { instruction?: string; continueSession?: string } = {},
): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: opts.continueSession
      ? { action: 'continue', sessionId: opts.continueSession }
      : { action: 'new', sessionId: null },
    ...(opts.instruction !== undefined ? { instruction: opts.instruction } : {}),
    todo: { id: 't1', seqNum: 3, title: '产物探针', spec: '写方案与改动' },
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
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function writingBackend(
  events: StepEvent[],
  onSessionStart: (cwd: string, prompt: string | undefined) => void,
): { backend: AgentBackend; prompts: (string | undefined)[]; continuedIds: (string | null)[] } {
  const prompts: (string | undefined)[] = [];
  const continuedIds: (string | null)[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      prompts.push(opts.prompt ?? undefined);
      continuedIds.push(null);
      onSessionStart(opts.cwd, opts.prompt);
      return handle('pi-sess-1', events);
    },
    async continueSession(id, opts) {
      prompts.push(opts.prompt ?? undefined);
      continuedIds.push(id);
      onSessionStart(opts.cwd, opts.prompt);
      return handle(id, events);
    },
  };
  return { backend, prompts, continuedIds };
}

function planPathFromPrompt(prompt: string | undefined): string | null {
  const m = /plan\.md 交接位置：(.+?)。该位置在仓库检出之外/.exec(prompt ?? '');
  return m?.[1] ?? null;
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

const DONE_EVENT: StepEvent = { type: 'done', usage: [] };

async function setup(claimed: ClaimedStep, backend: AgentBackend) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-artifact-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger,
    paths,
    workspacesDir,
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimed);
  return { client, lines, workspacesDir, home };
}

describe('plan.md artifact collection (gate 1 truth surface)', () => {
  test('plan step writes plan.md per the delivered annotation line (new location) → collected and uploaded; the new location is on the CAIRN_HOME side', async () => {
    const claimed = claimedNoRepoStep('plan');
    let notePath: string | null = null;
    const { backend } = writingBackend([DONE_EVENT], (_cwd, prompt) => {
      notePath = planPathFromPrompt(prompt);
      if (notePath !== null) writeFileSync(notePath, '# 方案\nContext: x');
    });
    const { client, home } = await setup(claimed, backend);
    expect(client.uploadNames).toEqual([['transcript.json', PLAN_FILE_NAME]]);
    const planPut = client.uploads.find((u) => u.url === 'http://server/up/1');
    expect(planPut?.body).toBe('# 方案\nContext: x');
    expect(notePath).toBe(join(home, 'plans', 'conv-1', PLAN_FILE_NAME));
  });

  test('new location absent + old location present (in-flight conv, agent wrote the workspace root) → falls back to a single read and still collects', async () => {
    const claimed = claimedNoRepoStep('plan');
    const { backend } = writingBackend([DONE_EVENT], (cwd) => {
      writeFileSync(join(cwd, PLAN_FILE_NAME), '# 旧位方案\nContext: y');
    });
    const { client } = await setup(claimed, backend);
    expect(client.uploadNames).toEqual([['transcript.json', PLAN_FILE_NAME]]);
    const planPut = client.uploads.find((u) => u.url === 'http://server/up/1');
    expect(planPut?.body).toBe('# 旧位方案\nContext: y');
  });

  test('new location present → new location wins (old-location residue does not override it)', async () => {
    const claimed = claimedNoRepoStep('plan');
    const { backend } = writingBackend([DONE_EVENT], (cwd, prompt) => {
      writeFileSync(join(cwd, PLAN_FILE_NAME), '旧位残留');
      const p = planPathFromPrompt(prompt);
      if (p !== null) writeFileSync(p, '# 新位方案');
    });
    const { client } = await setup(claimed, backend);
    const planPut = client.uploads.find((u) => u.url === 'http://server/up/1');
    expect(planPut?.body).toBe('# 新位方案');
  });

  test('new location blank file → not an artifact, not uploaded; no fallback to old-location residue (empty plan = no plan)', async () => {
    const claimed = claimedNoRepoStep('plan');
    const { backend } = writingBackend([DONE_EVENT], (cwd, prompt) => {
      writeFileSync(join(cwd, PLAN_FILE_NAME), '旧位残骸');
      const p = planPathFromPrompt(prompt);
      if (p !== null) writeFileSync(p, '   \n');
    });
    const { client } = await setup(claimed, backend);
    expect(client.uploadNames).toEqual([['transcript.json']]);
  });

  test('plan.md not written → no plan upload line (gate material truthfully empty)', async () => {
    const claimed = claimedNoRepoStep('plan');
    const { backend } = writingBackend([DONE_EVENT], () => {});
    const { client } = await setup(claimed, backend);
    expect(client.uploadNames).toEqual([['transcript.json']]);
  });
});

describe('continuation-round instruction delivery (gate 1 retry surface)', () => {
  test('continue step with instruction → session prompt = instruction + handoff-location annotation line (the make-up instruction really enters the session)', async () => {
    const claimed = claimedNoRepoStep('plan', {
      continueSession: 'pi-sess-9',
      instruction: buildPlanRewritePrompt(),
    });
    const { backend, prompts } = writingBackend([DONE_EVENT], () => {});
    const { home } = await setup(claimed, backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(
      appendPlanLocationNote(
        buildPlanRewritePrompt(),
        join(home, 'plans', 'conv-1', PLAN_FILE_NAME),
      ),
    );
  });

  test('instruction absent → CONTINUE_PROMPTS default by kind + handoff-location annotation line', async () => {
    const claimed = claimedNoRepoStep('plan', { continueSession: 'pi-sess-9' });
    const { backend, prompts } = writingBackend([DONE_EVENT], () => {});
    const { home } = await setup(claimed, backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(
      appendPlanLocationNote(CONTINUE_PROMPTS.plan, join(home, 'plans', 'conv-1', PLAN_FILE_NAME)),
    );
  });
});

describe('hasChanges transcript inference (gate 2 truth surface, no-repo degraded shape)', () => {
  test('claude-code SDK tool name Edit → hasChanges=true (case-normalized)', async () => {
    const claimed = claimedNoRepoStep('build');
    const { backend } = writingBackend(
      [
        {
          type: 'toolcall_end',
          call: { id: 'call-e1', name: 'Edit', arguments: {}, result: 'ok', endedAt: 1 },
        },
        DONE_EVENT,
      ],
      () => {},
    );
    const { client } = await setup(claimed, backend);
    expect(client.doneBodies[0]?.body.hasChanges).toBe(true);
  });

  test('pi tool name edit → hasChanges=true (original behavior unregressed)', async () => {
    const claimed = claimedNoRepoStep('build');
    const { backend } = writingBackend(
      [
        {
          type: 'toolcall_end',
          call: { id: 'call-e2', name: 'edit', arguments: {}, result: 'ok', endedAt: 1 },
        },
        DONE_EVENT,
      ],
      () => {},
    );
    const { client } = await setup(claimed, backend);
    expect(client.doneBodies[0]?.body.hasChanges).toBe(true);
  });

  test('read-class tool Read → hasChanges=false (zero changes reported truthfully, gate 2 interception material)', async () => {
    const claimed = claimedNoRepoStep('build');
    const { backend } = writingBackend(
      [
        {
          type: 'toolcall_end',
          call: { id: 'call-r1', name: 'Read', arguments: {}, result: 'ok', endedAt: 1 },
        },
        DONE_EVENT,
      ],
      () => {},
    );
    const { client } = await setup(claimed, backend);
    expect(client.doneBodies[0]?.body.hasChanges).toBe(false);
  });
});
