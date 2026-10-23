// 审核步执行面（#511）：审核者拿到的材料与工作区随关口分叉，且审核绝不产
// 可合并改动。harness 同 runner-local.test.ts（FakeClient + 录制型 fake
// WorktreeOps + 捕获 SessionOpts 的 backend）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 审核关口 + repo 绑定：开只读检出（prepare 在），审核者读得到本轮产物。
//   2. 审核关口：审核者写入被丢弃——收尾 rewind 到步起点，且不 commitAll /
//      不 push / 不 merge；done 不带 commit、hasChanges=false（审核步不产
//      可合并改动，票面「既有性质不因本票破坏」）。
//   3. 确认关口（gate=confirm）：不开检出（事实还不存在，只审方案）——cwd
//      回落裸任务目录，但材料照常交付。
//   4. 材料投递：#330 引入的空 continue prompt（CONTINUE_PROMPTS.review = ''）
//      必须不再吃掉审核材料——createSession 收到的 prompt = instruction。
//   5. 只读是硬的：审核会话的 edit/write 工具不在工具面（bash 保留 = 跑验证
//      命令），且 readOnly 只对审核步开。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  GitCredentials,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
  WorktreeOps,
} from '@cairn/shared';
import { buildReviewStepPrompt, type DocumentDiffFile } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { builtinToolNames, PI_CAPABILITIES, sessionToolNames } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const HOSTED_REPO = { kind: 'hosted' as const, cloneUrl: 'http://localhost:9/git/t/r.git' };
const PLAN_TEXT = '# plan v1\n\n## Changes\n- 加 parseInput\n';
const CHANGES: DocumentDiffFile[] = [
  {
    path: 'src/parse.ts',
    additions: 1,
    deletions: 0,
    hunks: [{ header: '@@ -0,0 +1,1 @@', lines: ['+export function parseInput() {}'] }],
  },
];

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
    gate: noop,
    trust: noop,
    mcp: noop,
  };
}

function claimedReview(
  gate: 'confirm' | 'review',
  repo: NonNullable<ClaimedStep['project']>['repo'],
): ClaimedStep {
  return {
    step: { id: 's-review', buildId: 'conv-1', kind: 'review', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    instruction: buildReviewStepPrompt({
      agentId: 'a1',
      gate,
      planText: PLAN_TEXT,
      ...(gate === 'review' ? { changes: CHANGES } : {}),
    }),
    todo: { id: 't1', seqNum: 1, title: '审核探针', spec: '实现一段示例代码' },
    project: { id: 'p1', name: 'demo', repo },
    agent: {
      id: 'a1',
      displayName: 'stub-reviewer',
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
  /** 回传的 transcript 终稿全文（回退失败行这类 system 行的可观测面）。 */
  uploadedTranscript = '';

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
      git: null as GitCredentials | null,
    };
  }
  async skillsManifest() {
    // #920：默认空清单 = 零团队技能（selection=whitelist，既有断言零扰动）。
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
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    this.uploadedTranscript += typeof body === 'string' ? body : JSON.stringify(body);
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
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

/** 录制型 fake worktree：全操作进 calls（rewind 序靠 calls 判读）。检出 cwd
 * 刻意与裸任务目录不同名（真 WorkspaceManager 两者同路径）——这样「审核者
 * 跑在检出里还是裸目录里」在断言里可分辨。 */
const CHECKOUT_CWD = '/tmp/fake-workspace/worktrees/conv-1';
function fakeWorkspace(calls: string[], opts: { rewindError?: string } = {}): WorktreeOps {
  return {
    async prepare(input) {
      calls.push(`prepare:${input.cloneUrl}`);
      return {
        cwd: CHECKOUT_CWD,
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: true,
      };
    },
    async commitAll() {
      calls.push('commitAll');
      return { committed: true, head: 'abc123' };
    },
    async push(_cwd, branch) {
      calls.push(`push:${branch}`);
    },
    async mergeDefaultBranch() {
      calls.push('mergeDefaultBranch');
      return { output: 'Already up to date' };
    },
    async headCommit() {
      calls.push('headCommit');
      return 'abc123';
    },
    async countAhead() {
      return 1;
    },
    async restoreCheckpoint(_cwd, commit) {
      calls.push(`restoreCheckpoint:${commit}`);
      if (opts.rewindError !== undefined) throw new Error(opts.rewindError);
    },
    async cleanupOrphans() {
      return [];
    },
  };
}

/** 捕获 SessionOpts 的自然完成 backend。 */
function capturingBackend(captured: SessionOpts[]): AgentBackend {
  const session = (): AgentSessionHandle => ({
    sessionId: 'pi-sess-review',
    events: (async function* () {
      yield { type: 'text_delta', text: 'ok' } as never;
      yield { type: 'done', usage: [] } as never;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  });
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts) {
      captured.push(opts);
      return session();
    },
    async continueSession() {
      throw new Error('审核步不接续主 conv 会话');
    },
  };
}

/** #700：按事件脚本回放的 backend——message_end / toolcall_end 原样进
 * transcript（#519 形状：verdict JSON 文本行 → set_task_meta 工具行 →
 * 空收尾轮）。 */
function scriptedBackend(captured: SessionOpts[], script: unknown[]): AgentBackend {
  const session = (): AgentSessionHandle => ({
    sessionId: 'pi-sess-review',
    events: (async function* () {
      for (const ev of script) yield ev as never;
      yield { type: 'done', usage: [] } as never;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  });
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts) {
      captured.push(opts);
      return session();
    },
    async continueSession() {
      throw new Error('审核步不接续主 conv 会话');
    },
  };
}

async function setup(claimed: ClaimedStep, opts: { rewindError?: string } = {}) {
  return setupWithBackend(claimed, opts, (captured) => capturingBackend(captured));
}

async function setupWithBackend(
  claimed: ClaimedStep,
  opts: { rewindError?: string },
  backendFor: (captured: SessionOpts[]) => AgentBackend,
) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-review-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const calls: string[] = []; // 单一调用序：client 与 workspace 共写一份（rewind 先于 done 的时序靠它判读）
  const client = new FakeClient();
  client.calls = calls;
  const captured: SessionOpts[] = [];
  const deps = {
    client,
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => backendFor(captured),
    logger: captureLogger(),
    paths,
    workspace: fakeWorkspace(calls, opts),
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimed);
  return { client, calls, captured };
}

describe('审核步执行面（#511）', () => {
  test('失败方式 1+2：审核关口开只读检出，审核者写入被丢弃、不 commit / 不 push', async () => {
    const { client, calls, captured } = await setup(claimedReview('review', HOSTED_REPO));
    expect(calls).toContain(`prepare:${HOSTED_REPO.cloneUrl}`);
    // 审核者跑在检出里（不是裸任务目录）——「能读到文件」的可观测面
    expect(captured[0]!.cwd).toBe(CHECKOUT_CWD);
    // 写入丢弃：rewind 到步起点（headAtStart），且在 done 之前
    expect(calls).toContain('restoreCheckpoint:abc123');
    expect(calls.indexOf('restoreCheckpoint:abc123')).toBeLessThan(
      calls.indexOf('done:s-review:success'),
    );
    // 不产可合并改动：无 commit / 无 push / 无 merge
    expect(calls).not.toContain('commitAll');
    expect(calls.some((c) => c.startsWith('push:'))).toBe(false);
    expect(calls).not.toContain('mergeDefaultBranch');
    const body = client.doneBodies[0]!.body;
    expect(body.status).toBe('success');
    expect(body.hasChanges).toBe(false);
    expect(body.commit).toBeUndefined();
  });

  test('失败方式 3：确认关口不开检出（cwd 回落裸任务目录），材料照常交付', async () => {
    const { calls, captured } = await setup(claimedReview('confirm', HOSTED_REPO));
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(calls.some((c) => c.startsWith('push:'))).toBe(false);
    // 无检出 = 不取步起点 head（git 收尾面整段不参与）+ 会话 cwd 回落裸任务目录
    expect(calls).not.toContain('headCommit');
    expect(captured[0]!.cwd).not.toBe(CHECKOUT_CWD);
    // 确认关口材料仍含方案（只是不含变更段）
    expect(captured[0]!.prompt).toContain(PLAN_TEXT);
    expect(captured[0]!.prompt).not.toContain('src/parse.ts');
  });

  test('失败方式 4：审核材料真的投递（prompt = instruction，不吃 CONTINUE_PROMPTS 空串）', async () => {
    const { captured } = await setup(claimedReview('review', HOSTED_REPO));
    const prompt = captured[0]!.prompt ?? '';
    expect(prompt).not.toBe('');
    expect(prompt).toContain(PLAN_TEXT);
    expect(prompt).toContain('src/parse.ts');
    expect(prompt).toContain('+export function parseInput() {}');
  });

  test('失败方式 5：审核会话只读——readOnly 置位，edit/write 不在工具面、bash 保留', async () => {
    const { captured } = await setup(claimedReview('review', HOSTED_REPO));
    expect(captured[0]!.readOnly).toBe(true);
    expect(builtinToolNames(true)).toEqual(['read', 'bash']);
    expect(builtinToolNames(false)).toEqual(['read', 'bash', 'edit', 'write']);
    // 工具面组装：只读摘掉写类内建工具，relay/MCP 面照旧（审核者仍要取事实）
    expect(
      sessionToolNames({ readOnly: true, remoteTools: ['save_memory'], mcpTools: ['mcp__x__y'] }),
    ).toEqual(['read', 'bash', 'save_memory', 'mcp__x__y']);
    expect(
      sessionToolNames({ readOnly: false, remoteTools: ['save_memory'], mcpTools: [] }),
    ).toEqual(['read', 'bash', 'edit', 'write', 'save_memory']);
  });

  test('只读检出回退失败不静默：落一条 system 行走 transcript（写入残留要让人看见）', async () => {
    const { client, calls } = await setup(claimedReview('review', HOSTED_REPO), {
      rewindError: 'fatal: unable to create file',
    });
    expect(calls).toContain('restoreCheckpoint:abc123');
    // 审核本身仍算成功（verdict 不该因回退失败丢掉），但残留必须可见
    expect(client.doneBodies[0]!.body.status).toBe('success');
    expect(client.uploadedTranscript).toContain('审核检出未能回退到本轮起点');
    expect(client.uploadedTranscript).toContain('fatal: unable to create file');
  });

  test('审核关口 + 未绑 repo：不开检出（裸目录退化形），材料仍含变更', async () => {
    const { calls, captured } = await setup(claimedReview('review', null));
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(captured[0]!.prompt).toContain('src/parse.ts');
  });

  // —— #700（B-C13）verdict 提取回传面：done body 的 findings / findingsError
  //    两态。失败方式枚举先于实现固化：
  //    1. #519 形状（verdict JSON 之后跟 set_task_meta 工具调用 + 空收尾轮）
  //       → findings 照常携带（旧实现被尾部工具行击穿回 null）。
  //    2. 全程无 JSON（散文输出）→ findings 缺位、findingsError 携带原因
  //       （server 据此报「判定提取失败」，不再冒充「审核未返回结论」）。
  test('#700 失败方式 1：#519 形状全链——JSON 后跟工具调用 → done body 携带 findings', async () => {
    const verdictJson = JSON.stringify({
      conclusion: '方案在边界情况上存在硬风险，需修复两处',
      findings: [
        { id: '1', severity: 'blocking', summary: '未处理空输入', file: 'src/parse.ts', line: 42 },
      ],
    });
    const { client } = await setupWithBackend(
      claimedReview('review', HOSTED_REPO),
      {},
      (captured) =>
        scriptedBackend(captured, [
          { type: 'message_end', message: { role: 'assistant', content: verdictJson } },
          {
            type: 'toolcall_end',
            call: {
              id: 'call-set-meta',
              name: 'set_task_meta',
              arguments: { title: '审核探针' },
              result: '{}',
              isError: false,
              endedAt: 123,
            },
          },
          { type: 'message_end', message: { role: 'assistant', content: '' } },
        ]),
    );
    const body = client.doneBodies[0]!.body;
    expect(body.status).toBe('success');
    expect(body.findings).toEqual({
      conclusion: '方案在边界情况上存在硬风险，需修复两处',
      findings: [
        { id: '1', severity: 'blocking', summary: '未处理空输入', file: 'src/parse.ts', line: 42 },
      ],
    });
    expect(body.findingsError).toBeUndefined();
  });

  test('#700 失败方式 2：全程无 JSON → done body 携带 findingsError、不携带 findings', async () => {
    const { client } = await setupWithBackend(
      claimedReview('review', HOSTED_REPO),
      {},
      (captured) =>
        scriptedBackend(captured, [
          {
            type: 'message_end',
            message: { role: 'assistant', content: '看完了，方案整体可行。' },
          },
        ]),
    );
    const body = client.doneBodies[0]!.body;
    expect(body.status).toBe('success');
    expect(body.findings).toBeUndefined();
    expect(body.findingsError).toContain('未找到');
  });
});
