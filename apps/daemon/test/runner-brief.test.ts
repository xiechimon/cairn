// 简报接线的失败方式（先列后写，仓规）——每一条对应下面一组用例：
// 1. 通道双开：systemPrompt 与文件同时投递 → 模型看到两份重复清单（#917 点名
//    的病状被放大）。故有简报通道时 SessionOpts.systemPrompt 必须缺席。
// 2. 写早了：写盘点在返工回退（reset --hard + clean -fd）之前 → 文件被删，
//    这一步在零指令下空转。用例钉「createSession 时文件已在盘上」。
// 3. 漏擦出口：openSession 抛错 / 流抛错这两条 return 路径不擦 → 残留被下一次
//    复用同一 worktree 的步 git add -A 扫进提交（延迟污染）。
// 4. 擦除失败仍提交：resident 残留进分支。
// 5. 写失败降级：全搬之后没有回退通道，「带着空简报开会话」比失败更糟。
// 6. 误伤无通道后端：未来第三后端不读上下文文件，runner 必须保留 inline 通道。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  WorktreeOps,
} from '@cairn/shared';
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

function claimedStep(opts: { repoBound: boolean; continueSession?: string }): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: opts.continueSession
      ? { action: 'continue', sessionId: opts.continueSession }
      : { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '简报探针', spec: '写点东西' },
    project: opts.repoBound
      ? { id: 'p1', name: 'demo', repo: { kind: 'hosted', cloneUrl: 'http://x/r.git' } }
      : { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: '负责构建',
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

class FakeClient implements MachineApi {
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  /** 上传的交付物（transcript 终稿）——断言面取这里的实物。 */
  uploads: { url: string; body: TranscriptUpload | string }[] = [];
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
  async putUpload(url: string, _h: Record<string, string>, body: TranscriptUpload | string) {
    this.uploads.push({ url, body });
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

/** 记录每次开会话时的 cwd 与 systemPrompt（通道双开判据的数据面）。 */
function stubBackend(opts: {
  events?: StepEvent[];
  /** 缺省 = 具备简报通道；null = 无通道（inline systemPrompt 的逃生口）。 */
  briefBackendId?: 'pi' | null;
  onSessionStart?: (cwd: string) => void;
  throwOnOpen?: boolean;
}): { backend: AgentBackend; seen: { cwd: string; systemPrompt: string | undefined }[] } {
  const seen: { cwd: string; systemPrompt: string | undefined }[] = [];
  const events = opts.events ?? [{ type: 'done', usage: [] }];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    ...(opts.briefBackendId === null
      ? {}
      : {
          brief: {
            backendId: (opts.briefBackendId ?? 'pi') as 'pi',
            composeBody: (_o, base) => `${base ?? ''}\n\n<skills>stub-catalog</skills>`,
          },
        }),
    async createSession(o) {
      if (opts.throwOnOpen === true) throw new Error('session open blew up');
      seen.push({ cwd: o.cwd, systemPrompt: o.systemPrompt });
      opts.onSessionStart?.(o.cwd);
      return handle(events);
    },
    async continueSession(_id, o) {
      seen.push({ cwd: o.cwd, systemPrompt: o.systemPrompt });
      opts.onSessionStart?.(o.cwd);
      return handle(events);
    },
  };
  return { backend, seen };
}

function handle(events: StepEvent[]): AgentSessionHandle {
  return {
    sessionId: 'pi-sess-1',
    events: (async function* gen() {
      for (const ev of events) yield ev;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  };
}

/** fake worktree：只记调用序列，不碰真实 git（落盘面由 brief-file.test.ts 钉）。 */
function fakeWorkspace(
  cwd: string,
  opts: { briefLeak?: string[] } = {},
): { ws: WorktreeOps; calls: string[] } {
  const calls: string[] = [];
  const ws: WorktreeOps = {
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
      calls.push('commitAll');
      return { committed: true, head: 'def456' };
    },
    async push() {
      calls.push('push');
    },
    async mergeDefaultBranch() {
      return { output: 'Already up to date' };
    },
    async headCommit() {
      return 'abc123';
    },
    async countAhead() {
      return 0;
    },
    async restoreCheckpoint() {
      calls.push('restoreCheckpoint');
    },
    async cleanupOrphans() {
      return [];
    },
    // #958 闸 4：推送后检测面（缺省不实现 = 老实现/测试桩的形态）。
    async briefMarkerInRef() {
      calls.push('briefMarkerInRef');
      return opts.briefLeak ?? [];
    },
  };
  return { ws, calls };
}

/** 跑一步。种文件与 mkdir 都在 runStep 之前——cwd 的建立是 runner 自己的事
 * （无 repo 步 mkdirSync(cwd)），这里只是提前把它备好以便种种子。 */
async function run(opts: {
  claimed: ClaimedStep;
  backend: AgentBackend;
  workspace?: WorktreeOps;
  seed?: (cwd: string) => void;
}): Promise<{ client: FakeClient; lines: string[]; cwd: string }> {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-brief-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const cwd = join(workspacesDir, opts.claimed.conversationId);
  mkdirSync(cwd, { recursive: true });
  opts.seed?.(cwd);
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  await runStep(
    {
      client,
      journal,
      backendFor: () => opts.backend,
      logger,
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
      ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    },
    opts.claimed,
  );
  return { client, lines, cwd };
}

describe('简报接线：写盘点与通道清空', () => {
  test('createSession 时文件已在盘上，内容是 systemPrompt 正文 + 后端贡献（失败方式 2）', async () => {
    // 断言必须取**开会话那一刻**的盘上状态：runStep 返回时文件已被擦掉，
    // 在那之后断言等于在测擦除，测不到「写盘点在开会话之前」这条。
    let atOpen: string | null = null;
    const { backend, seen } = stubBackend({
      onSessionStart: (cwd) => {
        atOpen = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
      },
    });
    await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(seen.length).toBeGreaterThan(0);
    expect(atOpen).not.toBeNull();
    expect(atOpen as unknown as string).toContain('负责构建'); // composeWorkerSystemPrompt 正文
    expect(atOpen as unknown as string).toContain('<skills>stub-catalog</skills>'); // 后端贡献
  });

  test('有简报通道 → SessionOpts.systemPrompt 缺席（失败方式 1：通道不双开）', async () => {
    const { backend, seen } = stubBackend({});
    await run({ claimed: claimedStep({ repoBound: false }), backend });
    for (const s of seen) expect(s.systemPrompt).toBeUndefined();
  });

  test('无简报通道的后端 → 保留 inline systemPrompt，且不写文件（失败方式 6）', async () => {
    const { backend, seen } = stubBackend({ briefBackendId: null });
    const { cwd } = await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(seen[0]?.systemPrompt).toContain('负责构建');
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
  });
});

describe('简报接线：擦除覆盖各出口', () => {
  test('成功收尾 → 创建态文件被删（失败方式 3 的正例）', async () => {
    const { backend } = stubBackend({});
    const { cwd, lines } = await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    expect(lines.some((l) => l.includes('brief removed'))).toBe(true);
  });

  test('追加态 → 用户既有文件逐字节还原', async () => {
    const { backend } = stubBackend({});
    const userText = '# 仓库约定\n\n- 用 pnpm\n';
    const { cwd } = await run({
      claimed: claimedStep({ repoBound: false }),
      backend,
      seed: (d) => writeFileSync(join(d, 'CLAUDE.md'), userText),
    });
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(userText);
  });

  test('openSession 抛错出口也擦（失败方式 3 的关键漏点）', async () => {
    const { backend } = stubBackend({ throwOnOpen: true });
    const { cwd, client, lines } = await run({
      claimed: claimedStep({ repoBound: false }),
      backend,
    });
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    expect(lines.some((l) => l.includes('brief removed') || l.includes('brief noop'))).toBe(true);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('流抛错出口也擦（失败方式 3 的关键漏点）', async () => {
    const { backend } = stubBackend({
      events: [
        {
          type: 'error',
          error: { message: 'stream blew up', retryable: false },
        } as StepEvent,
      ],
    });
    const { cwd } = await run({ claimed: claimedStep({ repoBound: false }), backend });
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
  });
});

describe('简报接线：推送后标记检测（#958 闸 4）', () => {
  test('agent 自己提交把标记带进历史 → transcript 点名 + 日志行', async () => {
    const cwdForWs = mkdtempSync(join(tmpdir(), 'cairn-brief-leak-'));
    mkdirSync(cwdForWs, { recursive: true });
    const { ws, calls } = fakeWorkspace(cwdForWs, { briefLeak: ['AGENTS.md'] });
    const { backend } = stubBackend({});
    const { client } = await run({
      claimed: claimedStep({ repoBound: true }),
      backend,
      workspace: ws,
    });
    // 步照常收尾（检测是附加信号，不阻断），但点名必须真落到用户看得见的面。
    expect(calls).toContain('briefMarkerInRef');
    expect(client.doneBodies[0]?.body.status).toBe('success');
    const transcript = JSON.stringify(client.uploads);
    expect(transcript).toContain('分支 cairn/conv-conv-1 的历史里带着运行简报的标记块');
    expect(transcript).toContain('AGENTS.md');
  });

  test('分支干净 → 无点名行（负例，避免把「没检测」读成「检测过了」）', async () => {
    const cwdForWs = mkdtempSync(join(tmpdir(), 'cairn-brief-clean-'));
    mkdirSync(cwdForWs, { recursive: true });
    const { ws, calls } = fakeWorkspace(cwdForWs);
    const { backend } = stubBackend({});
    const { client } = await run({
      claimed: claimedStep({ repoBound: true }),
      backend,
      workspace: ws,
    });
    expect(calls).toContain('briefMarkerInRef');
    expect(JSON.stringify(client.uploads)).not.toContain('的历史里带着运行简报的标记块');
  });
});

describe('简报接线：失败闸', () => {
  test('擦除失败 → 不 commitAll、按 failed 收尾、transcript 落行（失败方式 4）', async () => {
    const claimed = claimedStep({ repoBound: true });
    const cwdForWs = mkdtempSync(join(tmpdir(), 'cairn-brief-wt-'));
    const { ws, calls } = fakeWorkspace(cwdForWs);
    mkdirSync(cwdForWs, { recursive: true });
    const { backend } = stubBackend({
      // 会话期把简报文件换成同名目录：擦除先读文件，读到目录即 EISDIR 抛出。
      // 不用 chmod 只读：root（云端容器）无视目录权限，那样擦除照常成功、
      // 本用例在 root 下恒红（#1458）。
      onSessionStart: (cwd) => {
        rmSync(join(cwd, 'AGENTS.md'), { force: true });
        mkdirSync(join(cwd, 'AGENTS.md'));
      },
    });
    const { client } = await run({ claimed, backend, workspace: ws });
    expect(calls).not.toContain('commitAll');
    expect(calls).not.toContain('push');
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    // 失败确实出在擦除这一口（cleanupBriefOnce 的 transcript 行），不是更早的某步。
    expect(JSON.stringify(client.uploads)).toContain('运行简报未能从工作区擦除');
  });

  test('写失败即 fail-closed：不开会话（失败方式 5）', async () => {
    const { backend, seen } = stubBackend({});
    const { client, cwd } = await run({
      claimed: claimedStep({ repoBound: false }),
      backend,
      // 目标名被占成目录 → readFileSync 抛 EISDIR → 写入路径整体失败。
      seed: (d) => mkdirSync(join(d, 'AGENTS.md')),
    });
    expect(seen.length).toBe(0);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(true);
  });
});
