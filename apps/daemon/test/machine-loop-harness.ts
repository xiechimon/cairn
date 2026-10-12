// 机器主循环（02 §5.4 上线序列 canon + claim 退避 + recover 对账 + 步执行
// 全链，fake MachineApi/fake AgentBackend 注入——pi 真执行面归 integration）。
// #1128：machine-loop.test.ts 的共享 harness 收编位——FakeMachineApi /
// fakeBackend / boot / waitFor / CLAIMED 钉桩在此；8 个 scenario 文件
// （boot / claim / step-exec / recover / steer / stop / backends / parallel）
// 各自 import。每个测试自 boot 自停，无跨用例共享态，拆分零重写。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineAttachmentResponse,
  MachineCapabilities,
  MachineDoneBody,
  MachineStreamEvent,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@pacman/shared';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import type { ClaudeCodeAuthProbe } from '../src/claude-code-auth.js';
import { loadDaemonConfig } from '../src/config.js';
import { type DaemonLogger, formatLine } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runMachine } from '../src/machine-loop.js';
import { ensureStateDirs, type StatePaths, saveMachineJson, statePaths } from '../src/state.js';

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'pacman-loop-'));
}

function captureLogger(): { logger: DaemonLogger; lines: string[] } {
  const lines: string[] = [];
  const push = (prefix: string | undefined, msg: string) =>
    lines.push(formatLine(prefix ? { prefix, msg } : { msg }));
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

export const CLAIMED: ClaimedStep = {
  step: { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
  conversationId: 'conv-1',
  session: { action: 'new', sessionId: null },
  todo: { id: 't1', seqNum: 3, title: '探针任务', spec: '写一行探针' },
  project: { id: 'p1', name: 'demo', repo: null },
  agent: {
    id: 'a1',
    displayName: 'stub-builder',
    description: '职责说明',
    provider: 'stub-gw',
    modelId: 'stub-model',
    thinkingLevel: null,
  },
};

/** 长轮询假客户端：claim 挂起直到测试推入结果或 abort。 */
export class FakeMachineApi implements MachineApi {
  claimQueue: (ClaimedStep | Error)[] = [];
  parked: ((v: ClaimedStep | null) => void) | null = null;
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: { url: string; body: TranscriptUpload }[] = [];
  toolCalls: { stepId: string; call: ToolCallRecord }[] = [];
  recoverSteps: {
    id: string;
    buildId: string;
    kind: 'plan' | 'build' | 'merge';
    machineId: string | null;
    createdAt: number;
  }[] = [];
  failClaims = 0;
  /** W3 steer 拉取-确认的 fake 面：可设的拉取响应 + 事件发射口（stream
   * 回调被记录，测试直接注入 steer 事件模拟 server 信号）。 */
  steerResponse: string | null = null;
  /** #730 图片附件下载 fake 面：id → 响应或 Error。 */
  attachments: Record<string, MachineAttachmentResponse | Error> = {};
  attachmentCalls: string[] = [];
  /** M7 #308 stop 拉取-确认的 fake 面（steer 同形：可设响应 = discard 位）。 */
  stopResponse: boolean | null = null;
  onStreamEvent: ((ev: MachineStreamEvent) => void) | null = null;
  /** claim 请求计数（#482：wake 事件不得引发在飞 claim 中断重发）。 */
  claimCalls = 0;
  /** #1148：claim body 记录面（maxWorkers 自报断言用）。 */
  claimBodies: unknown[] = [];

  enrollBodies: unknown[] = [];
  presenceBodies: unknown[] = [];
  /** #1108：GET me 载荷叠加面（并发上限注入；缺省 = 旧 server 无字段形）。 */
  mePatch: Record<string, unknown> = {};

  async enroll(body: { teamId: string; apiKey: string; name?: string; claudeCode?: unknown }) {
    this.calls.push(`enroll:${body.teamId}`);
    this.enrollBodies.push(body);
    return {
      machineId: 'm1',
      token: 'a'.repeat(64),
      teamId: body.teamId,
      serverUrl: 'http://server',
    };
  }
  async me() {
    return {
      id: 'm1',
      name: 'n',
      teamId: 't1',
      online: true,
      latestCliVersion: null,
      kind: 'remote' as const,
      enabledRuntimes: [],
      shellEnabled: false,
      ...this.mePatch,
    };
  }
  async presence(body?: { cliVersion?: string; claudeCode?: unknown }) {
    this.calls.push('presence');
    this.presenceBodies.push(body);
  }
  async recover() {
    this.calls.push('recover');
    return { steps: this.recoverSteps };
  }
  async claim(signal?: AbortSignal, body?: unknown): Promise<ClaimedStep | null> {
    this.claimCalls += 1;
    if (body !== undefined) this.claimBodies.push(body);
    if (this.failClaims > 0) {
      this.failClaims -= 1;
      throw new Error('network down');
    }
    const next = this.claimQueue.shift();
    if (next instanceof Error) throw next;
    if (next) return next;
    return new Promise<ClaimedStep | null>((resolve, reject) => {
      // #1148：parked 解析即清（与 abort 同律）——「parked ≠ null」恒表示一条
      // 挂起中的 claim（多步连续推送的测试不再可能把第二步推给已消费的旧
      // resolver——那是静默丢弃面）。
      this.parked = (v) => {
        this.parked = null;
        resolve(v);
      };
      signal?.addEventListener('abort', () => {
        this.parked = null;
        reject(new Error('aborted'));
      });
    });
  }
  async heartbeat(stepId: string) {
    this.calls.push(`heartbeat:${stepId}`);
  }
  async tool(stepId: string, call: ToolCallRecord) {
    this.toolCalls.push({ stepId, call });
  }
  async transcriptDelta(stepId: string, text: string) {
    this.calls.push(`transcriptDelta:${stepId}:${text.length}`);
  }
  async relayTool(stepId: string, name: string, params: Record<string, unknown>) {
    this.calls.push(`relayTool:${stepId}:${name}`);
    void params;
    return '{}';
  }
  async token(stepId: string) {
    this.calls.push(`token:${stepId}`);
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
  async uploadUrls(stepId: string) {
    this.calls.push(`upload-urls:${stepId}`);
    return {
      uploads: [
        { name: 'transcript.json', url: 'http://server/up/1', method: 'PUT' as const, headers: {} },
      ],
    };
  }
  async putUpload(url: string, _headers: Record<string, string>, body: TranscriptUpload) {
    this.uploads.push({ url, body });
  }
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
    this.calls.push(`done:${stepId}:${body.status}`);
    // done 后解除挂起 claim（模拟 server 无步可领）。
  }
  async stream(signal: AbortSignal, onEvent: unknown, onConnected?: () => void) {
    this.onStreamEvent = onEvent as (ev: MachineStreamEvent) => void;
    onConnected?.();
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve());
    });
  }
  async steer(stepId: string) {
    this.calls.push(`steer:${stepId}`);
    return this.steerResponse;
  }
  async attachment(stepId: string, attachmentId: string): Promise<MachineAttachmentResponse> {
    this.attachmentCalls.push(`${stepId}:${attachmentId}`);
    const hit = this.attachments[attachmentId];
    if (hit === undefined) throw new Error(`machine api 404: attachment ${attachmentId}`);
    if (hit instanceof Error) throw hit;
    return hit;
  }
  async stop(stepId: string) {
    this.calls.push(`stop:${stepId}`);
    return this.stopResponse;
  }
  async syncResult(syncId: string, body: { status: string; errorMessage?: string }) {
    this.calls.push(`syncResult:${syncId}:${body.status}`);
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
}

export function fakeBackend(events: StepEvent[], sessionId = 'pi-sess-1') {
  const created: { opts: unknown; continued: string | null }[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      created.push({ opts, continued: null });
      return handle(sessionId, events);
    },
    async continueSession(id, opts) {
      created.push({ opts, continued: id });
      return handle(id, events);
    },
  };
  return { backend, created };
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

export async function boot(opts: {
  api?: FakeMachineApi;
  backend?: AgentBackend;
  /** spec 17 A3：claude-code 后端测试注入面（缺省 = 首个 runtime 步惰性构造）。 */
  claudeCodeBackend?: AgentBackend;
  /** #867 T6：凭据预检注入面（缺省 = 已登录桩）。 */
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  /** #1251：机器能力清单探测注入面（缺省 = 真探针，读测试机真实
   * ~/.claude.json / 技能目录——内容断言用注入桩，形状断言用缺省）。 */
  capabilitiesProbe?: () => MachineCapabilities;
  withMachineJson?: boolean;
  /** 预置 machine.json（既有注册启动路径）：serverUrl 可指向旧 server。 */
  preEnrolled?: { serverUrl: string };
  /** #1026：runMachine 起动前预置 journal 条目（recover 快路径派发面）。 */
  seedJournal?: (paths: StatePaths) => void;
  /** #1148：cap 解析 env 源注入面（PACMAN_DAEMON_MAX_CONCURRENT；缺省 =
   * 真 process.env，proxyEnv 同律）。 */
  capEnv?: NodeJS.ProcessEnv;
}) {
  const home = tmpHome();
  const { logger, lines } = captureLogger();
  const config = loadDaemonConfig(
    {
      serverUrl: 'http://server',
      apiKey: 'pacman_k',
      teamId: 'team-1',
      home,
      name: 'test-mbp',
    },
    {},
  );
  const paths = statePaths(home, config.workspacesDir);
  opts.seedJournal?.(paths);
  if (opts.preEnrolled) {
    ensureStateDirs(paths);
    saveMachineJson(paths, {
      machineId: 'm-old',
      token: 'b'.repeat(64),
      teamId: 'team-1',
      serverUrl: opts.preEnrolled.serverUrl,
    });
  }
  const api = opts.api ?? new FakeMachineApi();
  const handle = await runMachine({
    config,
    paths,
    logger,
    client: api,
    backend: opts.backend ?? fakeBackend([]).backend,
    claudeCodeBackend: opts.claudeCodeBackend,
    // #867 T6：runtime 步先过机器本地凭据预检——缺省真探针在 CI（无 claude
    // 登录）会探成「未登录」把 runtime 步拦掉，故测试恒注已登录桩。
    claudeCodeAuthProbe:
      opts.claudeCodeAuthProbe ??
      (async () => ({ state: 'logged-in', method: 'oauth_token', provider: 'firstParty' })),
    ...(opts.capabilitiesProbe !== undefined ? { capabilitiesProbe: opts.capabilitiesProbe } : {}),
    idleSleepPrevention: false,
    presenceIntervalMs: 60_000,
    claimBackoffBaseMs: 10,
    proxyEnv: {},
    ...(opts.capEnv !== undefined ? { capEnv: opts.capEnv } : {}),
  });
  return { handle, api, lines, paths, home };
}

export async function waitFor(fn: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout');
}
