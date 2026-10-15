// runner 图片附件接线（#730）失败方式先于实现固化：
//   1. spec 携带整行图片 token → backend 收到的 prompt 是展开文本（锚行），
//      promptImages 携带 base64 图片；transcript 的 user 行保留**原始**
//      prompt（token 原样——web 渲染面 ATTACHMENT_LINE chip 不因展开而丢）。
//   2. journal.claim 记录的也是原始 prompt（recover 重放时重新解析——
//      token 不因首次解析而漂移）。
//   3. 下载失败（pending）→ 步照常跑（不 failed）：prompt 文本带不可用注记，
//      promptImages 空。
//   4. chief 步不经本机制（instruction 原样透传，零解析）。
//   5. 无 token 步 → sessionOpts.prompt 与原始文本逐字节一致（零回归）。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineAttachmentResponse,
  SessionOpts,
  TranscriptUpload,
} from '@pacman/shared';
import { formatAttachmentToken } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

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

class FakeClient implements MachineApi {
  attachmentCalls: string[] = [];
  attachments: Record<string, MachineAttachmentResponse | Error> = {};

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
  async tool() {}
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
  async attachment(stepId: string, attachmentId: string) {
    this.attachmentCalls.push(`${stepId}:${attachmentId}`);
    const hit = this.attachments[attachmentId];
    if (hit === undefined) throw new Error(`machine api 404: attachment ${attachmentId}`);
    if (hit instanceof Error) throw hit;
    return hit;
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
  transcripts: TranscriptUpload[] = [];
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload) {
    this.transcripts.push(body);
  }
  async done() {}
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
  async stream() {}
}

function recordedBackend(): { backend: AgentBackend; seen: SessionOpts[] } {
  const seen: SessionOpts[] = [];
  return {
    seen,
    backend: {
      capabilities: PI_CAPABILITIES,
      async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
        seen.push(opts);
        return {
          sessionId: 'sess-img',
          events: (async function* () {
            yield { type: 'done', usage: [] } as never;
          })(),
          async steer() {},
          async stop() {},
          usage: () => [],
        };
      },
      async continueSession(): Promise<never> {
        throw new Error('unused');
      },
    },
  };
}

function claimed(spec: string, opts: { kind?: 'build' | 'chief' } = {}): ClaimedStep {
  const kind = opts.kind ?? 'build';
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    ...(kind === 'build'
      ? { todo: { id: 't1', seqNum: 1, title: '图片任务', spec } }
      : { instruction: spec }),
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

async function setup(claim: ClaimedStep, client: FakeClient) {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-img-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const journal = new StepJournal(paths.outboxDir);
  const { backend, seen } = recordedBackend();
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claim);
  return { seen, lines, paths };
}

describe('runner 图片附件接线（#730）', () => {
  test('失败方式 1：spec 整行 png token → backend 收展开文本 + 图片；transcript 保留原始 token', async () => {
    const client = new FakeClient();
    client.attachments.id1 = {
      fileName: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: PNG.byteLength,
      contentBase64: PNG.toString('base64'),
    };
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    const spec = `任务标题\n\n${token}\n\n执行后写 README`;
    const { seen } = await setup(claimed(spec), client);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toContain('[image attached: shot.png]');
    expect(seen[0]!.prompt).not.toContain('attachment:t1/id1.png');
    expect(seen[0]!.promptImages).toEqual([
      { data: PNG.toString('base64'), mimeType: 'image/png' },
    ]);
    expect(client.attachmentCalls).toEqual(['s1:id1']);
    // transcript 终稿 = 原始 prompt（title + spec，token 原样——web 渲染面
    // chip 不因展开丢）
    const userRow = client.transcripts[0]!.messages.find((m) => m.id === 'user-s1');
    expect(userRow?.content).toBe(`图片任务\n\n${spec}`);
  });

  test('失败方式 3：下载 409 → 步照常 success，prompt 带不可用注记，零图片', async () => {
    const client = new FakeClient();
    client.attachments.id1 = new Error('machine api 409: attachment id1 not ready (pending)');
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    const { seen } = await setup(claimed(`任务\n\n${token}`), client);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toContain(token); // token 原样保留
    expect(seen[0]!.prompt).toContain('不可用');
    expect(seen[0]!.promptImages ?? []).toHaveLength(0);
  });

  test('失败方式 4：chief 步 instruction 原样透传（零解析、零下载）', async () => {
    const client = new FakeClient();
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    const { seen } = await setup(claimed(`看图 ${token}`, { kind: 'chief' }), client);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toBe(`看图 ${token}`);
    expect(client.attachmentCalls).toHaveLength(0);
    expect(seen[0]!.promptImages).toBeUndefined();
  });

  test('失败方式 5：无 token 步 → prompt 逐字节一致（零回归）', async () => {
    const client = new FakeClient();
    const spec = '纯文本任务，没有附件。';
    const { seen } = await setup(claimed(spec), client);
    expect(seen[0]!.prompt).toBe(`图片任务\n\n${spec}`);
    expect(seen[0]!.promptImages).toBeUndefined();
    expect(client.attachmentCalls).toHaveLength(0);
  });
});
