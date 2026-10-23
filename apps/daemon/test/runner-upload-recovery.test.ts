// #1026/#1028 daemon 侧（#904 调研副产物 2/4）：终稿回传通道的失败恢复面。
// 现状失败方式清单（先固化，代码是让场景通过的手段）：
//  1. 预签名 URL 只存 server 进程内存：server 重启后旧 URL 404 → PUT 失败 →
//     整步 journal 残留，且恢复只能整会话重跑（#1028：恢复不得依赖进程内存）；
//  2. PUT 成功 / done 失败 → journal 残留但终稿快照（doneBody + plan 内容）
//     未持久 → recover 只能整会话重跑：白烧一轮 agent + 同内容重复版本
//     （#1026：恢复不重跑整会话）；
//  3. 语义性 4xx（#1027 拒绝腿）误当 transient 重试 → 白烧重试轮（409 重试
//     永不成功，只有 404/5xx/网络断才值得重取 URL 重传）。

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
import { PLAN_FILE_NAME } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { resumePendingUpload, runStep } from '../src/runner.js';
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

/** 无 repo 绑定的 plan 步（裸任务目录退化形，同 runner-artifact 形）。 */
function claimedPlanStep(): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
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

/** 可注入失败序列的假客户端：PUT 失败按 failPutStatuses 顺序消耗（404/5xx =
 * transient，409 = 语义拒）；done 失败按 failDone 计数。 */
class FlakyClient implements MachineApi {
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: { url: string; body: TranscriptUpload | string }[] = [];
  uploadNames: string[][] = [];
  failPutStatuses: number[] = [];
  failDone = 0;

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
  async putUpload(url: string, headers: Record<string, string>, body: TranscriptUpload | string) {
    const status = this.failPutStatuses.shift();
    if (status !== undefined) throw new MachineApiError(status, 'flaky upload failure');
    this.uploads.push({ url, body });
    void headers;
  }
  async done(stepId: string, body: MachineDoneBody) {
    if (this.failDone > 0) {
      this.failDone -= 1;
      throw new MachineApiError(503, 'server restarting');
    }
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

/** 会话期把 plan.md 写进 cwd 的后端（agent 产物形态）。 */
function planWritingBackend(events: StepEvent[]): {
  backend: AgentBackend;
  prompts: (string | undefined)[];
} {
  const prompts: (string | undefined)[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      prompts.push(opts.prompt ?? undefined);
      writeFileSync(join(opts.cwd, PLAN_FILE_NAME), '# 方案\nContext: 恢复探针');
      return handle('pi-sess-1', events);
    },
    async continueSession(id, opts) {
      prompts.push(opts.prompt ?? undefined);
      void id;
      return handle(id, events);
    },
  };
  return { backend, prompts };
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

async function setup(claimed: ClaimedStep, backend: AgentBackend, client: MachineApi) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-upload-recovery-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = captureLogger();
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
  return { deps, client, journal, lines, workspacesDir };
}

describe('#1028 预签名 URL 失效重传（恢复不依赖 server 进程内存）', () => {
  test('PUT 404（server 重启后旧 URL 失效）→ 重取 URL 重传：done 落、journal 清', async () => {
    const { backend } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failPutStatuses = [404]; // 首 PUT 撞旧 URL 404（server 刚重启）
    const { journal } = await setup(claimedPlanStep(), backend, client);
    // URL 重取了一轮（transcript.json + plan.md 两份重传）。
    expect(client.uploadNames).toHaveLength(2);
    expect(client.uploadNames[1]).toEqual(['transcript.json', PLAN_FILE_NAME]);
    expect(
      client.uploads.filter((u) => typeof u.body === 'string' && u.body.includes('恢复探针')),
    ).toHaveLength(1);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(journal.pending()).toHaveLength(0);
  });

  test('PUT 409（语义拒绝）→ 不重试：URL 只取一轮，journal 残留待 recover 补报', async () => {
    const { backend } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failPutStatuses = [409]; // #1027 拒绝腿（如已收尾步迟到上传）
    const { journal } = await setup(claimedPlanStep(), backend, client);
    expect(client.uploadNames).toHaveLength(1); // 没有第二轮 URL 请求
    expect(client.doneBodies).toHaveLength(0); // done 未发
    expect(journal.pending()).toHaveLength(1); // 残留（awaiting-upload）
  });
});

describe('#1026 done 失败 → 终稿快照残留 + recover 快路径补报', () => {
  test('done 失败 → journal 残留含 doneBody+planContent；快路径补报不再跑 agent 轮', async () => {
    const { backend, prompts } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failDone = 1; // PUT 成功、done 失败（server 重启窗）
    const { deps, journal } = await setup(claimedPlanStep(), backend, client);

    // 残留快照：状态 + 终稿 body + plan 内容。
    const pending = journal.pending();
    expect(pending).toHaveLength(1);
    const entry = pending[0]!;
    expect(entry.state).toBe('awaiting-upload');
    expect(entry.planContent).toBe('# 方案\nContext: 恢复探针');
    expect(entry.doneBody).toMatchObject({ status: 'success', sessionId: 'pi-sess-1' });

    // 首轮上传已落（PUT 成功在前）。
    expect(
      client.uploads.filter((u) => typeof u.body === 'string' && u.body.includes('恢复探针')),
    ).toHaveLength(1);

    // 快路径补报：重传（transcript + plan）+ done；不再开 session。
    client.failDone = 0;
    await resumePendingUpload(deps, entry);
    expect(prompts).toHaveLength(1); // 无第二轮 agent 会话
    expect(
      client.uploads.filter((u) => typeof u.body === 'string' && u.body.includes('恢复探针')),
    ).toHaveLength(2); // plan 重传一轮
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body).toEqual(entry.doneBody);
    expect(journal.pending()).toHaveLength(0); // 补报完成清残留
  });

  test('快路径 done 再失败 → journal 残留保留（下次重启再试，仍不重跑 agent 轮）', async () => {
    const { backend } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failDone = 2; // 首次 done 失败 + 快路径 done 再失败
    const { deps, journal } = await setup(claimedPlanStep(), backend, client);
    const entry = journal.pending()[0]!;
    expect(entry).toBeTruthy();
    client.failDone = 1;
    await resumePendingUpload(deps, entry);
    expect(client.doneBodies).toHaveLength(0);
    expect(journal.pending()).toHaveLength(1); // 残留保留
    expect(journal.pending()[0]?.doneBody).toEqual(entry.doneBody); // 快照仍在
  });
});
