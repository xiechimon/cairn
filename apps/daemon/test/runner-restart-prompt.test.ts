import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineHeartbeatBody,
  MachineStreamEvent,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import {
  appendPlanLocationNote,
  buildRestartPrompt,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const TASK = { id: 't1', seqNum: 3, title: '重启探针', spec: '第一轮会失败，重启轮要带上反馈。' };
const TASK_TEXT = buildTaskPromptText(TASK.title, TASK.spec);

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

function restartStep(opts: { instruction?: string; kind?: 'plan' | 'build' } = {}): ClaimedStep {
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
  heartbeats: MachineHeartbeatBody[] = [];
  async heartbeat(_stepId: string, body: MachineHeartbeatBody = {}) {
    this.heartbeats.push(body);
  }
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

async function setup(
  claimed: ClaimedStep,
  backend: AgentBackend,
  options: { skill?: string; observeClient?: (client: FakeClient) => void } = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-restart-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  options.observeClient?.(client);
  const skillsDir = join(home, 'skills');
  if (options.skill !== undefined) {
    mkdirSync(join(skillsDir, 'probe'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'probe', 'SKILL.md'),
      `---\nname: probe\ndescription: Probe skill\n---\n${options.skill}`,
    );
  }
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
      ...(options.skill !== undefined ? { skillsDir } : {}),
    },
    claimed,
  );
  return { client, home };
}

function withNote(home: string, basePrompt: string): string {
  return appendPlanLocationNote(basePrompt, join(home, 'plans', 'conv-1', PLAN_FILE_NAME));
}

describe('restart-round feedback delivery (#720)', () => {
  test('reports the prepared harness before opening the agent session', async () => {
    const { backend } = recordingBackend();
    let reported: MachineHeartbeatBody[] = [];
    const createSession = backend.createSession.bind(backend);
    backend.createSession = async (opts) => {
      expect(reported).toContainEqual({
        baseSha: null,
        harnessHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      return createSession(opts);
    };
    await setup(restartStep({ kind: 'build' }), backend, {
      observeClient: (client) => {
        reported = client.heartbeats;
      },
    });
  });

  test('runtime fingerprint changes with injected skill content and tool descriptions', async () => {
    const claimed = restartStep({ kind: 'build' });
    const { backend } = recordingBackend();
    const first = await setup(claimed, backend, { skill: 'first skill body' });
    const same = await setup(claimed, backend, { skill: 'first skill body' });
    const changed = await setup(claimed, backend, { skill: 'changed skill body' });
    expect(first.client.heartbeats[0]?.harnessHash).toBe(same.client.heartbeats[0]?.harnessHash);
    expect(first.client.heartbeats[0]?.harnessHash).not.toBe(
      changed.client.heartbeats[0]?.harnessHash,
    );
    claimed.remoteTools = [{ name: 'probe', description: 'Probe a resource', parameters: {} }];
    const withTool = await setup(claimed, backend, { skill: 'first skill body' });
    expect(first.client.heartbeats[0]?.harnessHash).not.toBe(
      withTool.client.heartbeats[0]?.harnessHash,
    );
  });

  test('new session + instruction present → session prompt = task text + restart instruction composed string', async () => {
    const instruction = buildRestartPrompt('把测试也补上');
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(restartStep({ instruction }), backend);
    expect(prompts).toHaveLength(1);
    const delivered = prompts[0];
    expect(delivered).toBe(
      withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, instruction)),
    );
    expect(delivered).toContain('把测试也补上');
    expect(delivered?.startsWith(TASK_TEXT)).toBe(true);
  });

  test("the transcript final draft's user-<stepId> line = the composed string (wire line consistent with the delivered content)", async () => {
    const instruction = buildRestartPrompt('把测试也补上');
    const { backend } = recordingBackend();
    const { client, home } = await setup(restartStep({ instruction }), backend);
    const transcript = client.uploads.find((u) => u.stepId === 's1');
    const promptRow = transcript?.messages.find((m) => m.id === 'user-s1');
    expect(promptRow?.role).toBe('user');
    expect(promptRow?.content).toBe(
      withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, instruction)),
    );
  });

  test('new session + blank instruction → no empty shell injected, prompt = pure task text (build negative case; plan step blank instruction = first-round semantics, contract still injected, see runner-plan-contract.test.ts)', async () => {
    const { backend, prompts } = recordingBackend();
    await setup(restartStep({ instruction: '   ', kind: 'build' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(TASK_TEXT);
  });

  test('new session + instruction absent → prompt = pure task text (build step regression pin; plan step injects the contract since #1025, see runner-plan-contract.test.ts)', async () => {
    const { backend, prompts } = recordingBackend();
    await setup(restartStep({ kind: 'build' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(TASK_TEXT);
  });

  test('restart without withPlan (build first step) same rule: composed string present', async () => {
    const instruction = buildRestartPrompt('换一种实现方式');
    const { backend, prompts } = recordingBackend();
    await setup(restartStep({ instruction, kind: 'build' }), backend);
    expect(prompts[0]).toBe(composeTaskPromptWithInstruction(TASK_TEXT, instruction));
  });
});
