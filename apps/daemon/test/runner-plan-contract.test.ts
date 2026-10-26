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
  buildPlanFirstRoundInstruction,
  buildRestartPrompt,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const TASK = { id: 't1', seqNum: 3, title: '契约探针', spec: '首轮规划要被告知 plan.md 契约。' };
const TASK_TEXT = buildTaskPromptText(TASK.title, TASK.spec);
const CONTRACT = buildPlanFirstRoundInstruction();

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

function firstRoundStep(opts: { kind?: 'plan' | 'build'; instruction?: string } = {}): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: opts.kind ?? 'plan', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    ...(opts.instruction !== undefined ? { instruction: opts.instruction } : {}),
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

function recordingBackend(): { backend: AgentBackend; prompts: string[] } {
  const prompts: string[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      prompts.push(opts.prompt ?? '');
      return handle('pi-sess-1');
    },
    async continueSession(id, opts) {
      prompts.push(opts.prompt ?? '');
      return handle(id);
    },
  };
  return { backend, prompts };
}

function handle(sessionId: string): AgentSessionHandle {
  const events: StepEvent[] = [{ type: 'done', usage: [] }];
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

async function setup(claimed: ClaimedStep, backend: AgentBackend) {
  const home = makeTestTempDir('cairn-runner-plan-');
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger } = captureLogger();
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
  return { client, home };
}

function withNote(home: string, basePrompt: string): string {
  return appendPlanLocationNote(basePrompt, join(home, 'plans', 'conv-1', PLAN_FILE_NAME));
}

describe('first-round plan step contract injection (#1025)', () => {
  test('plan step + instruction absent → session prompt = task text + contract instruction composed string + handoff-location annotation line (main bug reconciliation surface)', async () => {
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(firstRoundStep(), backend);
    expect(prompts).toHaveLength(1);
    const delivered = prompts[0];
    expect(delivered).toBe(withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT)));
    expect(delivered).toContain('plan.md');
    expect(delivered).toContain('（覆盖 Context/Changes/Edge cases/Verification 四段）');
    expect(delivered?.startsWith(TASK_TEXT)).toBe(true);
    expect(delivered).toContain(
      `plan.md 交接位置：${join(home, 'plans', 'conv-1', PLAN_FILE_NAME)}`,
    );
  });

  test("the transcript final draft's user-<stepId> line = the same delivered string (wire line consistent with the delivered content, including the annotation line)", async () => {
    const { backend } = recordingBackend();
    const { client, home } = await setup(firstRoundStep(), backend);
    const transcript = client.uploads.find((u) => u.stepId === 's1');
    const promptRow = transcript?.messages.find((m) => m.id === 'user-s1');
    expect(promptRow?.role).toBe('user');
    expect(promptRow?.content).toBe(
      withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT)),
    );
  });

  test('build step + instruction absent → prompt = pure task text (direct-execution first step injects no contract or annotation, negative case)', async () => {
    const { backend, prompts } = recordingBackend();
    await setup(firstRoundStep({ kind: 'build' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(TASK_TEXT);
    expect(prompts[0]).not.toContain('交接位置');
  });

  test('plan step + blank instruction → contract still injected (blank = no instruction, still first-round semantics, no empty shell injected)', async () => {
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(firstRoundStep({ instruction: '   ' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT)));
  });

  test('plan step + corrective instruction present → only that instruction is composed, contract not stacked (restart-round shape); annotation line still attached', async () => {
    const instruction = buildRestartPrompt('把测试也补上');
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(firstRoundStep({ instruction }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(
      withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, instruction)),
    );
    const delivered = prompts[0] ?? '';
    expect(delivered.split('Context/Changes/Edge cases/Verification').length - 1).toBe(1);
  });
});
