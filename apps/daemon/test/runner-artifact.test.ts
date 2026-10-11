// #703 产物闸 daemon 侧真值面：闸的判定素材由 runner 收尾时产出——
// ① plan.md 产物收集（#1203 起从 PACMAN_HOME 面 `<home>/plans/<convId>/`
//    读；旧位 = 工作区根目录仅作回落腿——在飞 conv 的方案仍在旧位时读一次，
//    不写回），空白文件不算产物（空方案 = 无方案）；
// ② 续轮指令投递（claim 载荷 instruction）：补写/驳回重规划轮的指令必须真的
//    进会话——此前 worker continue 步一律发 CONTINUE_PROMPTS 占位句，闸 1 的
//    「重试一次」是空转（B-C10 两轮全空的同源）；
// ③ hasChanges 的 transcript 推断（无 repo 退化形）：CHANGE_TOOLS 匹配归一
//    大小写——claude-code 后端工具名是 Edit/Write/Bash（SDK 原名），pi 是
//    edit/write/bash；不归一会把 claude-code 无 repo 步的改动判成零，闸 2
//    误拦合法构建。
// 失败方式枚举先于实现固化：
//   1. plan 步按注记行写 plan.md（新位）→ 未收集未上传（#1203 主修面：
//      agent 照旧位写才会撞 repo checkout）
//   2. 新位缺席 + 旧位在（在飞 conv）→ 未收集（回落腿失效，方案打不开）
//   3. plan.md 空白文件 → 被当产物上传（闸上「有物」是空文档）
//   4. 新位空白 + 旧位残留 → 旧位内容被复活上传（空方案语义被回落吞掉）
//   5. 补写轮 instruction 未投递（continueSession 收到 CONTINUE_PROMPTS 占位）
//   6. claude-code 步 Edit 工具行 → hasChanges=false（闸 2 误拦）

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
} from '@pacman/shared';
import {
  appendPlanLocationNote,
  buildPlanRewritePrompt,
  CONTINUE_PROMPTS,
  PLAN_FILE_NAME,
} from '@pacman/shared';
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

/** 无 repo 绑定的步（裸任务目录退化形）。 */
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
    // #920：默认空清单 = 零团队技能（selection=whitelist，既有断言零扰动）。
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
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {
    /* no-op stub for branch sync (M7 #319) */
  }
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

/** 会话期把文件写盘的后端（plan.md 产物形态探针）。onSessionStart 收到投递
 *  prompt——「听话 agent」测试按投递注记行解析 plan.md 交接位置落笔。 */
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

/** 从投递 prompt 解析 plan.md 交接位置（听话 agent 面：#1203 注记行真带路径）。 */
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
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-artifact-'));
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

describe('plan.md 产物收集（闸 1 真值面）', () => {
  test('plan 步按投递注记行写 plan.md（新位）→ 收集并上传；新位在 PACMAN_HOME 面', async () => {
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
    // 注记行真带路径且在 PACMAN_HOME 面（worktree/裸任务目录树之外）。
    expect(notePath).toBe(join(home, 'plans', 'conv-1', PLAN_FILE_NAME));
  });

  test('新位缺席 + 旧位在（在飞 conv，agent 写工作区根）→ 回落读一次仍收集', async () => {
    const claimed = claimedNoRepoStep('plan');
    const { backend } = writingBackend([DONE_EVENT], (cwd) => {
      writeFileSync(join(cwd, PLAN_FILE_NAME), '# 旧位方案\nContext: y');
    });
    const { client } = await setup(claimed, backend);
    expect(client.uploadNames).toEqual([['transcript.json', PLAN_FILE_NAME]]);
    const planPut = client.uploads.find((u) => u.url === 'http://server/up/1');
    expect(planPut?.body).toBe('# 旧位方案\nContext: y');
  });

  test('新位在场 → 新位为准（旧位残留不盖新位）', async () => {
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

  test('新位空白文件 → 不算产物不上传；不回落旧位残骸（空方案 = 无方案）', async () => {
    const claimed = claimedNoRepoStep('plan');
    const { backend } = writingBackend([DONE_EVENT], (cwd, prompt) => {
      writeFileSync(join(cwd, PLAN_FILE_NAME), '旧位残骸');
      const p = planPathFromPrompt(prompt);
      if (p !== null) writeFileSync(p, '   \n');
    });
    const { client } = await setup(claimed, backend);
    expect(client.uploadNames).toEqual([['transcript.json']]);
  });

  test('未写 plan.md → 无 plan 上传行（闸素材如实为空）', async () => {
    const claimed = claimedNoRepoStep('plan');
    const { backend } = writingBackend([DONE_EVENT], () => {});
    const { client } = await setup(claimed, backend);
    expect(client.uploadNames).toEqual([['transcript.json']]);
  });
});

describe('续轮指令投递（闸 1 重试面）', () => {
  test('continue 步携带 instruction → 会话 prompt = instruction + 交接位置注记行（补写指令真的进会话）', async () => {
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

  test('instruction 缺省 → CONTINUE_PROMPTS 按 kind 兜底 + 交接位置注记行', async () => {
    const claimed = claimedNoRepoStep('plan', { continueSession: 'pi-sess-9' });
    const { backend, prompts } = writingBackend([DONE_EVENT], () => {});
    const { home } = await setup(claimed, backend);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(
      appendPlanLocationNote(CONTINUE_PROMPTS.plan, join(home, 'plans', 'conv-1', PLAN_FILE_NAME)),
    );
  });
});

describe('hasChanges transcript 推断（闸 2 真值面，无 repo 退化形）', () => {
  test('claude-code SDK 工具名 Edit → hasChanges=true（大小写归一）', async () => {
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

  test('pi 工具名 edit → hasChanges=true（原行为不回归）', async () => {
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

  test('读类工具 Read → hasChanges=false（零改动如实上报，闸 2 的拦截素材）', async () => {
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
