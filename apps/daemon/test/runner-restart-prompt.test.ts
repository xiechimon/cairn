// #720 重启轮反馈投递（daemon runner 面）：new session worker 步在 claim 载荷
// instruction 在位时，会话 prompt 必须是「任务文本 + 指令」组合串——此前 prompt
// 恒为 title+spec（buildTaskPrompt），重启轮的返工理由 agent 从来看不到（票面
// 主 bug）。组合形状单源 = shared composeTaskPromptWithInstruction（裁决正本 =
// issue #720 裁决评论）；投递机制沿用 #703/#719 的形状（instruction 在位即
// 投递），不为 new session 发明第二套。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 反馈不进会话：new session + instruction 在位 → createSession prompt 只有
//      title+spec（主 bug：用户填的返工理由 agent 收不到）
//   2. 组合串形漂移：prompt ≠ shared composeTaskPromptWithInstruction 单源形状
//   3. wire 行缺位：transcript 上传的 user-<stepId> 行不是组合串（呈现层与
//      对账面看不到 agent 实际收到什么）
//   4. 空白指令注入：instruction 空白 → 组合出空壳（负例：不注入空指令）
//   5. 无指令回归：instruction 缺席的 new session build 步 → prompt = 纯任务
//      文本（现行行为不动；plan 步自 #1025 起首轮注入 plan.md 契约，见
//      runner-plan-contract.test.ts）
// #1203：plan 步（含重启轮形）投递串尾部附 plan.md 交接位置注记行——重启
// new session 上下文真空，位置行是 agent 唯一知道「写哪里」的通道；build 步
// 不附。断言里的组合串 = withNote(home, compose(...)) 同形。

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

/** 重启轮首步形（server restart 分支产物）：new session + instruction 携反馈。 */
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
    // #920：默认空清单 = 零团队技能（selection=whitelist，既有断言零扰动）。
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

/** #1203：plan 步投递串尾部附交接位置注记行（build 步不附）。 */
function withNote(home: string, basePrompt: string): string {
  return appendPlanLocationNote(basePrompt, join(home, 'plans', 'conv-1', PLAN_FILE_NAME));
}

describe('重启轮反馈投递（#720）', () => {
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

  test('new session + instruction 在位 → 会话 prompt = 任务文本 + 重启指令组合串', async () => {
    const instruction = buildRestartPrompt('把测试也补上');
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(restartStep({ instruction }), backend);
    expect(prompts).toHaveLength(1);
    const delivered = prompts[0];
    expect(delivered).toBe(
      withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, instruction)),
    );
    // 反馈真的进了会话（主 bug 的对账面：任务语境与返工理由同串在位）
    expect(delivered).toContain('把测试也补上');
    expect(delivered?.startsWith(TASK_TEXT)).toBe(true);
  });

  test('transcript 终稿的 user-<stepId> 行 = 组合串（wire 行与投递内容一致）', async () => {
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

  test('new session + 空白 instruction → 不注入空壳，prompt = 纯任务文本（build 负例；plan 步空白指令 = 首轮语义，契约照注，见 runner-plan-contract.test.ts）', async () => {
    const { backend, prompts } = recordingBackend();
    await setup(restartStep({ instruction: '   ', kind: 'build' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(TASK_TEXT);
  });

  test('new session + instruction 缺席 → prompt = 纯任务文本（build 步回归钉；plan 步自 #1025 起注入契约，另见 runner-plan-contract.test.ts）', async () => {
    const { backend, prompts } = recordingBackend();
    await setup(restartStep({ kind: 'build' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(TASK_TEXT);
  });

  test('无 withPlan 重启（build 首步）同律：组合串在位', async () => {
    const instruction = buildRestartPrompt('换一种实现方式');
    const { backend, prompts } = recordingBackend();
    await setup(restartStep({ instruction, kind: 'build' }), backend);
    expect(prompts[0]).toBe(composeTaskPromptWithInstruction(TASK_TEXT, instruction));
  });
});
