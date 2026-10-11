// #1025 首轮 plan 步契约注入（daemon runner 面）：plan.md 的产出契约此前只
// 存在于纠错提示词（#113 补写轮 / 驳回重规划 / 审核打回 / 失败重启），首个
// plan 步 claim 载荷 instruction 缺席 → buildTaskPrompt 只拼 title+spec，写不
// 写 plan.md 全凭模型自觉（#892 实测 28 build / 0 行 plan.md 的结构性根因）。
// 本票把契约提到首轮正典提示词：kind=plan、无 instruction 的任务 prompt =
// 任务文本 + 契约指令（composeTaskPromptWithInstruction 单源形状，指令殿后
// 拿最强注意力，#720 同律）；纠错轮自带契约句，不叠注。组合行的呈现层过滤
// 由 shared classifyUserText 承担（F17 见 web 侧单测），此处钉投递面与 wire 面。
// #1203 增面：plan 步 prompt 尾部追加交接位置注记行（shared
// appendPlanLocationNote 单源；路径 = <home>/plans/<convId>/plan.md，repo 检出
// 之外——local-repo 项目的 conv 工作区即 checkout，plan.md 落工作区根会被
// agent 提交进仓库根，#24 / PR #1201 首版实锤）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 契约不进会话（主 bug）：首轮 plan 步 prompt 仍只有 title+spec
//   2. wire 行缺位/漂移：transcript user-<stepId> 行 ≠ 投递串（呈现层与对账
//      面看不到 agent 实际收到什么）
//   3. build 步误注入：直执行首步（kind=build、无 instruction）也被注入契约
//      （执行轮被要求写 plan.md = 语义污染）
//   4. 纠错轮双重注入：instruction 在位（重启轮等纠错语境）时叠注契约（那些
//      指令自带契约句，叠注 = 同一指令双份）
//   5. 空白指令误判：plan 步 + 空白 instruction 被当纠错轮（契约缺席）——
//      空白 = 无指令（#720 同判），仍是首轮语义，契约必须照注
//   6.（#1203）注记行缺席/路径错树：plan 步投递串不含交接位置行，或路径落
//      在任务目录树里（等于没搬出 checkout）；build 步被误附（语义污染）

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
import {
  appendPlanLocationNote,
  buildPlanFirstRoundInstruction,
  buildRestartPrompt,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  PLAN_FILE_NAME,
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
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

/** 首轮步形（startBuilds 产物）：new session、instruction 缺席。 */
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
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-plan-'));
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

/** #1203 期望投递形：基础 prompt + 交接位置注记行（路径在 PACMAN_HOME 面）。 */
function withNote(home: string, basePrompt: string): string {
  return appendPlanLocationNote(basePrompt, join(home, 'plans', 'conv-1', PLAN_FILE_NAME));
}

describe('首轮 plan 步契约注入（#1025）', () => {
  test('plan 步 + instruction 缺席 → 会话 prompt = 任务文本 + 契约指令组合串 + 交接位置注记行（主 bug 对账面）', async () => {
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(firstRoundStep(), backend);
    expect(prompts).toHaveLength(1);
    const delivered = prompts[0];
    expect(delivered).toBe(withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT)));
    // 契约真的进了会话：文件名 + 四段名同串在位
    expect(delivered).toContain('plan.md');
    expect(delivered).toContain('（覆盖 Context/Changes/Edge cases/Verification 四段）');
    expect(delivered?.startsWith(TASK_TEXT)).toBe(true);
    // #1203：交接位置行带绝对路径，且不在任务目录树里（repo 检出之外）
    expect(delivered).toContain(
      `plan.md 交接位置：${join(home, 'plans', 'conv-1', PLAN_FILE_NAME)}`,
    );
  });

  test('transcript 终稿的 user-<stepId> 行 = 同一投递串（wire 行与投递内容一致，含注记行）', async () => {
    const { backend } = recordingBackend();
    const { client, home } = await setup(firstRoundStep(), backend);
    const transcript = client.uploads.find((u) => u.stepId === 's1');
    const promptRow = transcript?.messages.find((m) => m.id === 'user-s1');
    expect(promptRow?.role).toBe('user');
    expect(promptRow?.content).toBe(
      withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT)),
    );
  });

  test('build 步 + instruction 缺席 → prompt = 纯任务文本（直执行首步不注入契约与注记，负例）', async () => {
    const { backend, prompts } = recordingBackend();
    await setup(firstRoundStep({ kind: 'build' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(TASK_TEXT);
    expect(prompts[0]).not.toContain('交接位置');
  });

  test('plan 步 + 空白 instruction → 契约照注（空白 = 无指令，仍是首轮语义，不注入空壳）', async () => {
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(firstRoundStep({ instruction: '   ' }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, CONTRACT)));
  });

  test('plan 步 + 纠错 instruction 在位 → 只组合该指令，不叠注契约（重启轮形）；注记行照附', async () => {
    const instruction = buildRestartPrompt('把测试也补上');
    const { backend, prompts } = recordingBackend();
    const { home } = await setup(firstRoundStep({ instruction }), backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(
      withNote(home, composeTaskPromptWithInstruction(TASK_TEXT, instruction)),
    );
    // 契约句不双份（重启指令自带一份，不重复注入首轮契约）
    const delivered = prompts[0] ?? '';
    expect(delivered.split('Context/Changes/Edge cases/Verification').length - 1).toBe(1);
  });
});
