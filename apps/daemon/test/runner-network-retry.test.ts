// #1257 provider_network 会话续跑重试（runner 步内闸）：relay 流断
// （upstream stream disconnected / connection reset 族，分类 = network 桶）
// 是瞬态基础设施毛刺——按 Multica 语义自动重试（会话续跑，不断会话），
// 总尝试 3 次（首跑 + 立即重试 + 末次延迟约 5 秒），退避后仍断才按失败
// 收尾。失败方式（先于实现固化）：
//  1. 首轮流断 → 立即续跑重试（continueSession 同一 sessionId），第二轮
//     成功 → 步 success（2 次会话开启）。
//  2. 两轮流断 → 第三轮（延迟后）成功 → 步 success（3 次会话开启）。
//  3. 三轮流断 → 按失败收尾：done(failed) 携原错误，不再开第四轮。
//  4. quota 类错误（402/usage limit）→ 不重试（挂起语义在 server done 面），
//     单轮收尾 failed。
//  5. 停止钮在位 → 不重试（用户要的是退出，不是续跑）。
//  5b. 停止在两轮之间（续跑会话开启途中）到达 → 续跑会话一开即中断，报 stopped。
//  6. 中途有进展的流断 → 重试走 continue（断点续跑，不重放整轮）。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  ProviderConfig,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { StepStops } from '../src/step-stops.js';

const NETWORK_ERROR = 'upstream stream disconnected: connection reset by peer';
const QUOTA_ERROR = '402: {"message":"insufficient quota: usage limit reached"}';

function gateway(providerId: string): ProviderConfig {
  return {
    kind: 'http',
    providerId,
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
  };
}

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

function claimedStep(): ClaimedStep {
  return {
    step: { id: 'step-net1', buildId: 'b-net', kind: 'build', machineId: null, createdAt: 1 },
    conversationId: 'conv-net',
    session: { action: 'new', sessionId: null },
    instruction: null,
    todo: {
      id: 't-net',
      seqNum: 1,
      title: '流断重试探针',
      spec: '写一行探针',
    },
    project: { id: 'p-net', name: 'demo', repo: null },
    agent: {
      id: 'a-net',
      displayName: 'stub-builder',
      description: null,
      provider: 'gw-net',
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];

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
      provider: gateway('gw-net'),
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
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult() {}
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: never) => void) {}
}

type Script = StepEvent[];

/** 每次会话开启（create 或 continue）按序取下一条脚本；记录 continue 的
 * sessionId 以钉「续跑不断会话」语义。末次重试的 ~5s 延迟注入 1ms。
 * onCreate = 新会话开启途中的钩子（停止钮在位的注入点）。 */
function scriptedNetworkBackend(
  scripts: Script[],
  onCreate?: () => void,
  onContinue?: () => void,
): {
  backend: AgentBackend;
  opened: { kind: 'new' | 'continue'; sessionId: string | null }[];
} {
  const opened: { kind: 'new' | 'continue'; sessionId: string | null }[] = [];
  let idx = 0;
  const nextHandle = (sessionId: string, _kind: 'new' | 'continue'): AgentSessionHandle => {
    const script = scripts[idx++] ?? [{ type: 'done', usage: [] }];
    let stopped = false;
    return {
      sessionId,
      events: (async function* () {
        for (const ev of script) {
          if (stopped) return;
          yield ev as never;
        }
      })(),
      async steer() {},
      async stop() {
        stopped = true;
      },
      usage: () => [],
    };
  };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(_sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      onCreate?.();
      const handle = nextHandle(`pi-sess-${idx}`, 'new');
      opened.push({ kind: 'new', sessionId: handle.sessionId });
      return handle;
    },
    async continueSession(sessionId: string, _sessionOpts: SessionOpts) {
      onContinue?.();
      const handle = nextHandle(sessionId, 'continue');
      opened.push({ kind: 'continue', sessionId });
      return handle;
    },
  };
  return { backend, opened };
}

interface RunCaseOpts {
  stopRequested?: boolean;
  stopBeforeRetry?: boolean;
  finalWaitMs?: number;
}

async function runNetworkCase(
  scripts: Script[],
  opts: RunCaseOpts = {},
): Promise<{
  client: FakeClient;
  lines: string[];
  opened: { kind: 'new' | 'continue'; sessionId: string | null }[];
}> {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-net-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const stops = new StepStops();
  const stopNow = () => void stops.get('step-net1')?.deliver({ discard: false });
  const { backend, opened } = scriptedNetworkBackend(
    scripts,
    opts.stopRequested ? stopNow : undefined,
    opts.stopBeforeRetry ? stopNow : undefined,
  );
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
    stops,
  };
  await runStep(deps, claimedStep(), {
    ...(opts.finalWaitMs !== undefined ? { providerNetworkFinalWaitMs: opts.finalWaitMs } : {}),
  });
  return { client, lines, opened };
}

describe('#1257 runner provider_network 流断重试（会话续跑）', () => {
  test('失败方式 1：首轮流断 → 立即 continueSession 同一会话续跑，第二轮成功 → 步 success（两次开启）', async () => {
    const { client, opened, lines } = await runNetworkCase([
      [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
      [
        { type: 'text_delta', text: '修好了' },
        { type: 'done', usage: [] },
      ],
    ]);

    expect(opened).toHaveLength(2);
    expect(opened[0]?.kind).toBe('new');
    expect(opened[1]?.kind).toBe('continue');
    expect(opened[1]?.sessionId).toBe(opened[0]?.sessionId); // 会话续跑，不断会话
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('provider network'))).toBe(true);
  });

  test('失败方式 2：两轮流断 → 第三轮（延迟后）成功 → 步 success（三次开启）', async () => {
    const { client, opened } = await runNetworkCase(
      [
        [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
        [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
        [
          { type: 'text_delta', text: 'ok' },
          { type: 'done', usage: [] },
        ],
      ],
      { finalWaitMs: 1 },
    );

    expect(opened).toHaveLength(3);
    expect(opened[1]?.kind).toBe('continue');
    expect(opened[2]?.kind).toBe('continue');
    expect(opened[2]?.sessionId).toBe(opened[0]?.sessionId);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 3：三轮流断 → 失败收尾（done(failed) 携原错误，无第四轮）', async () => {
    const { client, opened } = await runNetworkCase(
      [
        [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
        [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
        [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
      ],
      { finalWaitMs: 1 },
    );

    expect(opened).toHaveLength(3); // 首跑 + 两次重试 = 上限
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toContain(NETWORK_ERROR);
  });

  test('失败方式 4：quota 类错误 → 不重试（单轮收尾，挂起语义归 server done 面）', async () => {
    const { client, opened } = await runNetworkCase([
      [{ type: 'error', error: { message: QUOTA_ERROR, retryable: false } }],
    ]);

    expect(opened).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toContain('402');
  });

  test('失败方式 5：停止钮在位 → 不重试（用户意图优先于续跑）', async () => {
    const { client, opened } = await runNetworkCase(
      [
        [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
        [{ type: 'done', usage: [] }],
      ],
      { stopRequested: true },
    );

    expect(opened).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('stopped');
  });

  test('失败方式 5b：停止在两轮之间到达 → 续跑会话一开即中断，报 stopped', async () => {
    const { client, opened } = await runNetworkCase(
      [
        [{ type: 'error', error: { message: NETWORK_ERROR, retryable: false } }],
        [
          { type: 'text_delta', text: '续跑中' },
          { type: 'done', usage: [] },
        ],
      ],
      { stopBeforeRetry: true },
    );

    expect(opened).toHaveLength(2);
    expect(client.doneBodies[0]?.body.status).toBe('stopped');
  });

  test('失败方式 6：中途有进展的流断 → 重试仍走 continue（断点续跑，不重放整轮）', async () => {
    const { client, opened } = await runNetworkCase([
      [
        { type: 'text_delta', text: '写了一半' },
        { type: 'error', error: { message: NETWORK_ERROR, retryable: false } },
      ],
      [
        { type: 'text_delta', text: '接着写完' },
        { type: 'done', usage: [] },
      ],
    ]);

    expect(opened).toHaveLength(2);
    expect(opened[1]?.kind).toBe('continue');
    expect(opened[1]?.sessionId).toBe(opened[0]?.sessionId);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });
});
