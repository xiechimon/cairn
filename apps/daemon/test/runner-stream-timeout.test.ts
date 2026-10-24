// runner 流超时护栏（#699）：三臂事件到达即重置（body 臂对齐 first/idle 的
// 事件重置语义）+ 步级绝对上界（不随事件重置）+ 超时文案指名触发臂与数值。
// 失败方式枚举先于实现固化（票面四条照抄）：
//   1. 活跃流被墙杀：事件间隔 < body 预算、总时长 > body 预算的流必须自然
//      完成（body 按事件重置的核心证明——总时长超预算而不死）。
//   2. 真死流永远不死：首事件后停发的流由 idle 臂在既有时限内收掉。
//   3. 完全无上界的步：事件流持续活跃但撞步级绝对上界（duration cap），
//      上界不随事件重置；env 旋钮可配。
//   4. 文案指错凶手：first/idle/body/duration 四臂的失败文案各自指名
//      触发臂与数值，build.errorMessage 携带。

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
  WorktreeOps,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import {
  runStep,
  STREAM_DURATION_CAP_DEFAULT_MS,
  STREAM_DURATION_CAP_ENV,
  type StreamTimeoutArm,
  streamTimeoutMessage,
} from '../src/runner.js';
import { statePaths } from '../src/state.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    mcp: (msg) => push('mcp', msg),
    skills: (msg) => push('skills', msg),
    gate: (msg) => push('gate', msg),
    trust: (msg) => push('trust', msg),
  };
  return { logger, lines };
}

/** repo 绑定的 build 步（worktree 面走 fake WorktreeOps）。 */
function claimedBuildStep(): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '超时探针', spec: '写一行探针' },
    project: {
      id: 'p1',
      name: 'demo',
      repo: { kind: 'hosted', cloneUrl: 'http://server/git/t1/demo.git' },
    },
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
  async putUpload() {}
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

function fakeWorkspace(cwd: string): WorktreeOps {
  return {
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
      return { committed: true, head: 'def456' };
    },
    async push() {},
    async mergeDefaultBranch() {
      return { output: 'Already up to date' };
    },
    async headCommit() {
      return 'abc123';
    },
    async countAhead() {
      return 0;
    },
    async restoreCheckpoint() {},
    async cleanupOrphans() {
      return [];
    },
  };
}

/** 节流事件流后端：首事件延迟 firstEventMs，之后每 intervalMs 一条
 * text_delta；events=Infinity 即永不收尾（死流/无上界流形态）。stop() 经
 * gate 立即打断所有等待（真 handle.stop() 语义同形）。 */
function streamingBackend(opts: {
  firstEventMs: number;
  intervalMs: number;
  events: number;
  finish: 'done' | 'silent';
}) {
  let stopped = false;
  let releaseStop: (() => void) | null = null;
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession() {
      const gate = new Promise<void>((r) => {
        releaseStop = r;
      });
      const sleepOrStop = (ms: number) => Promise.race([sleep(ms), gate]);
      const handle: AgentSessionHandle = {
        sessionId: 'pi-sess-timeout',
        events: (async function* () {
          await sleepOrStop(opts.firstEventMs);
          let emitted = 0;
          while (!stopped && emitted < opts.events) {
            yield { type: 'text_delta', text: `t${emitted}` } as StepEvent;
            emitted += 1;
            await sleepOrStop(opts.intervalMs);
          }
          if (!stopped && opts.finish === 'done') {
            yield { type: 'done', usage: [] } as StepEvent;
          }
        })(),
        async steer() {},
        async stop() {
          stopped = true;
          releaseStop?.();
        },
        usage: () => [],
      };
      return handle;
    },
    async continueSession() {
      throw new Error('unused in timeout tests');
    },
  };
  return { backend };
}

function toolExecutionBackend(opts: { finish: 'done' | 'silent'; parallel?: boolean }) {
  let stopped = false;
  let releaseStop: () => void = () => {};
  const observations = { completedTools: 0, stoppedDuringTool: false };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession() {
      const gate = new Promise<void>((resolve) => {
        releaseStop = resolve;
      });
      const call: ToolCallRecord = { id: 'long-tool', name: 'bash', arguments: {} };
      return {
        sessionId: 'tool-timeout-session',
        events: (async function* (): AsyncGenerator<StepEvent> {
          yield { type: 'toolcall_end', call };
          if (opts.parallel) {
            yield { type: 'toolcall_end', call: { ...call, id: 'parallel-tool' } };
            yield { type: 'toolcall_end', call: { ...call, result: '' } };
          }
          await Promise.race([sleep(240), gate]);
          if (stopped) {
            observations.stoppedDuringTool = true;
            return;
          }
          observations.completedTools += 1;
          yield {
            type: 'toolcall_end',
            call: { ...call, id: opts.parallel ? 'parallel-tool' : call.id, result: '' },
          };
          if (opts.finish === 'done') {
            yield { type: 'done', usage: [] };
          } else {
            await gate;
          }
        })(),
        async steer() {},
        async stop() {
          stopped = true;
          releaseStop();
        },
        usage: () => [],
      };
    },
    async continueSession() {
      throw new Error('unused');
    },
  };
  return { backend, observations };
}

/** 全部超时面放宽（不干扰被测臂）。 */
const WIDE = 4_000;

async function run(opts: {
  backend: AgentBackend;
  timeouts: { first: number; idle: number; body: number };
  durationCapMs?: number;
  envCap?: string;
}): Promise<MachineDoneBody> {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-timeout-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const prevEnv = process.env[STREAM_DURATION_CAP_ENV];
  if (opts.envCap !== undefined) process.env[STREAM_DURATION_CAP_ENV] = opts.envCap;
  try {
    await runStep(
      {
        client,
        journal,
        backendFor: () => opts.backend,
        logger,
        paths,
        workspace: fakeWorkspace(join(home, 'ws', 'conv-1')),
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
      },
      claimedBuildStep(),
      {
        streamTimeouts: opts.timeouts,
        ...(opts.durationCapMs !== undefined ? { streamDurationCapMs: opts.durationCapMs } : {}),
      },
    );
  } finally {
    if (opts.envCap !== undefined) {
      if (prevEnv === undefined) delete process.env[STREAM_DURATION_CAP_ENV];
      else process.env[STREAM_DURATION_CAP_ENV] = prevEnv;
    }
  }
  expect(client.doneBodies).toHaveLength(1);
  return client.doneBodies[0]!.body;
}

describe('runner 流超时护栏（#699）', () => {
  test('失败方式 1：事件间隔 < body 预算、总时长 > body 预算的活跃流自然完成', async () => {
    // 10 条事件每 40ms 一条 = 总流时长 ~400ms，body 预算 120ms——不按事件
    // 重置则 120ms 处必死；按事件重置则每个事件续 120ms 预算，自然完成。
    const started = Date.now();
    const body = await run({
      backend: streamingBackend({ firstEventMs: 20, intervalMs: 40, events: 10, finish: 'done' })
        .backend,
      timeouts: { first: WIDE, idle: WIDE, body: 120 },
      durationCapMs: WIDE,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(350); // 流真跑满 400ms 量级
    expect(body.status).toBe('success');
    expect(body.errorMessage).toBeUndefined();
  });

  test('失败方式 2：首事件后停发的死流由 idle 臂在既有时限内收掉', async () => {
    // 首事件 20ms 到位（first 过），之后永无事件——idle=80ms 收尸。
    const body = await run({
      backend: streamingBackend({ firstEventMs: 20, intervalMs: WIDE, events: 1, finish: 'silent' })
        .backend,
      timeouts: { first: WIDE, idle: 80, body: WIDE },
      durationCapMs: WIDE,
    });
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('stream timeout (arm=idle, idle=80ms)');
  });

  test('失败方式 3：持续活跃但无上界的流撞步级绝对上界（不随事件重置）', async () => {
    // 事件每 30ms 持续活跃（first/idle/body 全放宽永不触发），cap=150ms 收。
    const body = await run({
      backend: streamingBackend({
        firstEventMs: 20,
        intervalMs: 30,
        events: Number.POSITIVE_INFINITY,
        finish: 'silent',
      }).backend,
      timeouts: { first: WIDE, idle: WIDE, body: WIDE },
      durationCapMs: 150,
    });
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('stream timeout (arm=duration, cap=150ms)');
  });

  test('失败方式 3（env 旋钮）：CAIRN_STREAM_DURATION_CAP_MS 配置上界生效', async () => {
    const body = await run({
      backend: streamingBackend({
        firstEventMs: 20,
        intervalMs: 30,
        events: Number.POSITIVE_INFINITY,
        finish: 'silent',
      }).backend,
      timeouts: { first: WIDE, idle: WIDE, body: WIDE },
      envCap: '250',
    });
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('stream timeout (arm=duration, cap=250ms)');
  });

  test('失败方式 4（first）：无任何事件 → 文案指名 first 臂与数值', async () => {
    const body = await run({
      backend: streamingBackend({
        firstEventMs: WIDE,
        intervalMs: WIDE,
        events: Number.POSITIVE_INFINITY,
        finish: 'silent',
      }).backend,
      timeouts: { first: 60, idle: WIDE, body: WIDE },
      durationCapMs: WIDE,
    });
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('stream timeout (arm=first, first=60ms)');
  });

  test('失败方式 4（body）：body 预算最紧的安静流 → 文案指名 body 臂与数值', async () => {
    // 首事件后安静；body=80ms < idle（WIDE）→ body 臂先到——证明事件重置后
    // body 仍是独立在案、可触发的护栏，不是被 idle 完全遮蔽的死代码。
    const body = await run({
      backend: streamingBackend({ firstEventMs: 20, intervalMs: WIDE, events: 1, finish: 'silent' })
        .backend,
      timeouts: { first: WIDE, idle: WIDE, body: 80 },
      durationCapMs: WIDE,
    });
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('stream timeout (arm=body, body=80ms)');
  });

  test('失败方式 4（文案单源）：四臂文案指名臂位与数值', () => {
    const timeouts = { first: 300_000, idle: 480_000, body: 540_000, durationCap: 3_600_000 };
    const cases: [StreamTimeoutArm, string][] = [
      ['first', 'stream timeout (arm=first, first=300000ms)'],
      ['idle', 'stream timeout (arm=idle, idle=480000ms)'],
      ['body', 'stream timeout (arm=body, body=540000ms)'],
      ['duration', 'stream timeout (arm=duration, cap=3600000ms)'],
    ];
    for (const [arm, expected] of cases) {
      expect(streamTimeoutMessage(arm, timeouts)).toBe(expected);
    }
  });

  test('上界缺省 = 3600000（env 未设时回落默认墙）', () => {
    expect(STREAM_DURATION_CAP_DEFAULT_MS).toBe(3_600_000);
    // env 缺省/非法值回落默认值由 runStep 内部判定；此处钉默认值本身。
  });
});

describe('runner 工具执行存活（#1591）', () => {
  test.each([false, true])('静默工具超过 idle 阈值仍完成（parallel=%s）', async (parallel) => {
    const { backend, observations } = toolExecutionBackend({ finish: 'done', parallel });
    const body = await run({
      backend,
      timeouts: { first: WIDE, idle: 80, body: WIDE },
      durationCapMs: WIDE,
    });
    expect(body.status).toBe('success');
    expect(observations).toEqual({ completedTools: 1, stoppedDuringTool: false });
  });

  test('工具结束后静默超过 idle 阈值仍失败', async () => {
    const { backend, observations } = toolExecutionBackend({ finish: 'silent' });
    const body = await run({
      backend,
      timeouts: { first: WIDE, idle: 80, body: WIDE },
      durationCapMs: WIDE,
    });
    expect(observations.completedTools).toBe(1);
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('stream timeout (arm=idle, idle=80ms)');
  });

  test('工具仍在执行时总时长上限生效', async () => {
    const { backend, observations } = toolExecutionBackend({ finish: 'done' });
    const body = await run({
      backend,
      timeouts: { first: WIDE, idle: 80, body: WIDE },
      durationCapMs: 160,
    });
    expect(observations.stoppedDuringTool).toBe(true);
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('stream timeout (arm=duration, cap=160ms)');
  });
});
