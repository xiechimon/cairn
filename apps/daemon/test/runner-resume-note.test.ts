// #862 T1 跨机续跑降级标记：daemon 会话续接失败（SessionNotResumableError，
// 典型 = 他机认领释放步、原会话文件不在本机）回退新会话时，transcript 终稿
// 必须带一条显式 system 注记（shared RESUME_FRESH_SESSION_NOTE 单源；web 侧
// 走既有纯文本 system→note 路渲染，零 web 改动）。失败方式先于实现固化：
//   1. 静默降级：continue 失败→新会话重跑，会话上下文丢了但线程零痕迹，用户
//      误以为续上了历史 → 注记行是显式标记的唯一事实点。
//   2. 误标：claim 本来就是 new session（首轮/无历史会话）→ 不得注记，否则
//      首轮步条条带降级噪音。
//   3. JSON 误吞：注记 content 若带花括号会被 web 当 machine_selected 同族
//      跳过（mappers systemKindOf）→ canon 恒纯文本无花括号（server 侧同断言）。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
  WorktreeOps,
} from '@pacman/shared';
import { RESUME_FRESH_SESSION_NOTE } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

function captureLogger(): DaemonLogger {
  const noop = () => {};
  return {
    raw: noop,
    prefixed: noop,
    supervisor: noop,
    machine: noop,
    step: noop,
    workspace: noop,
    recover: noop,
    wake: noop,
    skills: noop,
    mcp: noop,
    gate: noop,
    trust: noop,
  };
}

function claimedContinueStep(): ClaimedStep {
  return {
    step: {
      id: 's-resume',
      buildId: 'conv-resume',
      kind: 'build',
      machineId: 'm-mea',
      createdAt: 1,
    },
    conversationId: 'conv-resume',
    // server 按同 build 历史 sessionId 判定续轮（释放步被他机认领即此形）。
    session: { action: 'continue', sessionId: 'sess-old' },
    todo: { id: 't1', seqNum: 3, title: '续跑探针', spec: '写一行探针' },
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

class CaptureClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
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
        providerId: 'gw-resume',
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
  async putUpload(url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
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

/** 续跑降级后端：continue 恒不可用（异机），create 新会话跑完。 */
function resumeFallbackBackend(script: StepEvent[]): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(_opts: SessionOpts): Promise<AgentSessionHandle> {
      let stopped = false;
      return {
        sessionId: 'pi-sess-fresh',
        events: (async function* () {
          for (const ev of script) {
            if (stopped) return;
            yield ev;
          }
        })(),
        async steer() {},
        async stop() {
          stopped = true;
        },
        usage: () => [],
      };
    },
    async continueSession(id: string, _opts: SessionOpts): Promise<AgentSessionHandle> {
      throw new SessionNotResumableError(id);
    },
  };
}

function successScript(): StepEvent[] {
  return [
    { type: 'message_end', message: { role: 'system', content: 'you are a builder' } },
    { type: 'message_end', message: { role: 'user', content: '写一行探针' } },
    { type: 'done', usage: [] },
  ];
}

function uploadedMessages(client: CaptureClient): { role: string; content: unknown }[] {
  const out: { role: string; content: unknown }[] = [];
  for (const u of client.uploads) {
    if (typeof u.body === 'string') continue;
    for (const m of u.body.messages) out.push({ role: m.role, content: m.content });
  }
  return out;
}

function contentText(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

describe('#862 T1 会话续接降级标记（runner resume note）', () => {
  test('continue 失败回退新会话 → transcript 带显式 system 注记（canon 原文），步照常成功', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-runner-resume-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const client = new CaptureClient();
    const journal = new StepJournal(paths.outboxDir);

    await runStep(
      {
        client,
        journal,
        backendFor: () => resumeFallbackBackend(successScript()),
        logger: captureLogger(),
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
      },
      claimedContinueStep(),
      {},
    );

    expect(client.doneBodies[0]?.body.status).toBe('success');
    const notes = uploadedMessages(client).filter(
      (m) => m.role === 'system' && contentText(m.content).includes(RESUME_FRESH_SESSION_NOTE),
    );
    expect(notes).toHaveLength(1);
  });

  test('claim 即 new session（首轮）→ 无降级注记（失败方式 2：首轮步不带噪音）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-runner-resume-new-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const client = new CaptureClient();
    const journal = new StepJournal(paths.outboxDir);
    const fresh = {
      ...claimedContinueStep(),
      session: { action: 'new' as const, sessionId: null },
    };

    await runStep(
      {
        client,
        journal,
        backendFor: () => resumeFallbackBackend(successScript()),
        logger: captureLogger(),
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
      },
      fresh,
      {},
    );

    expect(client.doneBodies[0]?.body.status).toBe('success');
    const notes = uploadedMessages(client).filter((m) =>
      contentText(m.content).includes(RESUME_FRESH_SESSION_NOTE),
    );
    expect(notes).toHaveLength(0);
  });
});

// —— #1149 环境钩子投影 ——
// 失败方式固化（issue #1149 验收）：
//   a. 钩子缺失 = 零 system 行（无钩子仓 transcript 与现状一致——红线）。
//   b. setup ok note → 一条 system 行：头部 `.agents/setup hook ok (Nms)` +
//      stdout 正文（用户在步日志里看得见装机做了什么）。
//   c. resume 失败 note → system 行带 exit code + stderr（非致命面：步照常
//      success，用户看得见失败原文）。
//   d. 输出超限 → 正文贴 truncated 标记（totalChars > output.length）。
describe('#1149 环境钩子投影（runner transcript）', () => {
  test('钩子缺失（hooks 缺省）→ 零 hook system 行（红线：无钩子仓零噪音）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-runner-hook-none-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const client = new CaptureClient();
    const journal = new StepJournal(paths.outboxDir);
    await runStep(
      {
        client,
        journal,
        backendFor: () => resumeFallbackBackend(successScript()),
        logger: captureLogger(),
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
      },
      claimedContinueStep(),
      {},
    );
    expect(client.doneBodies[0]?.body.status).toBe('success');
    const hookRows = uploadedMessages(client).filter(
      (m) => m.role === 'system' && contentText(m.content).includes('.agents/'),
    );
    expect(hookRows).toHaveLength(0);
  });

  test('setup ok note → system 行（头部 + stdout）；resume 失败 note → 行带 exit code + stderr', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-runner-hook-notes-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const client = new CaptureClient();
    const journal = new StepJournal(paths.outboxDir);
    const fakeWs: WorktreeOps = {
      async prepare() {
        return {
          cwd: join(home, 'ws'),
          baseRepoDir: join(home, 'repo'),
          branch: 'pacman/conv-resume',
          defaultBranch: 'main',
          reused: true,
          hooks: [
            {
              name: 'setup',
              status: 'ok',
              exitCode: 0,
              output: 'installing deps…\n',
              totalChars: 15,
              ms: 1200,
            },
            {
              name: 'resume',
              status: 'failed',
              exitCode: 2,
              output: 'restarting services…\nsvc not found\n',
              totalChars: 32,
              ms: 300,
            },
          ],
        };
      },
      async commitAll() {
        return { committed: true, head: 'def456' };
      },
      async push() {},
      async mergeDefaultBranch() {
        return { output: 'Already up to date' };
      },
      async landLocalFastForward() {},
      async headCommit() {
        return 'abc123';
      },
      async countAhead() {
        return 1;
      },
      async restoreCheckpoint() {},
      async cleanupOrphans() {
        return [];
      },
    };
    const claim = {
      ...claimedContinueStep(),
      project: {
        id: 'p1',
        name: 'demo',
        repo: { kind: 'github' as const, cloneUrl: 'https://github.com/x/y' },
      },
    };
    await runStep(
      {
        client,
        journal,
        backendFor: () => resumeFallbackBackend(successScript()),
        logger: captureLogger(),
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
        workspace: fakeWs,
      },
      claim,
      {},
    );
    expect(client.doneBodies[0]?.body.status).toBe('success');
    const hookRows = uploadedMessages(client).filter(
      (m) => m.role === 'system' && contentText(m.content).startsWith('.agents/'),
    );
    expect(hookRows).toHaveLength(2);
    const setupRow = contentText(hookRows[0]!.content);
    expect(setupRow).toContain('.agents/setup hook ok (1200ms)');
    expect(setupRow).toContain('installing deps…');
    const resumeRow = contentText(hookRows[1]!.content);
    expect(resumeRow).toContain('.agents/resume hook failed (exit 2)');
    expect(resumeRow).toContain('svc not found');
  });

  test('输出超限 → truncated 标记（totalChars > output.length）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-runner-hook-trunc-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const client = new CaptureClient();
    const journal = new StepJournal(paths.outboxDir);
    const big = 'A'.repeat(120_000);
    const fakeWs: WorktreeOps = {
      async prepare() {
        return {
          cwd: join(home, 'ws'),
          baseRepoDir: join(home, 'repo'),
          branch: 'pacman/conv-resume',
          defaultBranch: 'main',
          reused: true,
          hooks: [
            {
              name: 'setup',
              status: 'ok',
              exitCode: 0,
              output: big.slice(0, 100_000),
              totalChars: 120_000,
              ms: 5,
            },
          ],
        };
      },
      async commitAll() {
        return { committed: true, head: 'def456' };
      },
      async push() {},
      async mergeDefaultBranch() {
        return { output: 'Already up to date' };
      },
      async landLocalFastForward() {},
      async headCommit() {
        return 'abc123';
      },
      async countAhead() {
        return 1;
      },
      async restoreCheckpoint() {},
      async cleanupOrphans() {
        return [];
      },
    };
    const claim = {
      ...claimedContinueStep(),
      project: {
        id: 'p1',
        name: 'demo',
        repo: { kind: 'github' as const, cloneUrl: 'https://github.com/x/y' },
      },
    };
    await runStep(
      {
        client,
        journal,
        backendFor: () => resumeFallbackBackend(successScript()),
        logger: captureLogger(),
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
        workspace: fakeWs,
      },
      claim,
      {},
    );
    const hookRows = uploadedMessages(client).filter(
      (m) => m.role === 'system' && contentText(m.content).startsWith('.agents/'),
    );
    expect(hookRows).toHaveLength(1);
    expect(contentText(hookRows[0]!.content)).toContain('output truncated');
  });
});
