// remote_shell daemon 本地工具对拍（XMON-110 R2；规划 = XMON-85 §一，契约 =
// XMON-108 R1）。外部行为 = 「agent 拿到什么文本、审计 wire 收到什么、命令到底
// 跑没跑」，断言落在工具返回文本 + wire 录制面 + 文件系统副作用上，不落内部
// 字段名。执行面用真 bash spawn（本机小命令），wire 面用 fake（预检/回写的
// HTTP 半在 shell-wire.test.ts 对拍）。注册面 harness 同 secret-channel.test.ts
// （FakeClient + 录制 backend）。
// 先固化的失败场景（AGENTS.md 测试规则 3）：
//   1. 放行链：预检 allowed → 真命令执行 → 返回输出原文；回写 done+exitCode+output
//   2. 超时：杀**整个进程组**（后台子孙同死），回写 failed + 超时 errorMessage，
//      agent 拿到超时文本 + 部分输出
//   3. 大输出：截断带标记（含总字符数），回写/返回 ≤ SHELL_OUTPUT_CHAR_LIMIT
//   4. 预检 403：agent 拿到「未授权：<server 原因>」，命令未执行（无副作用），
//      无回写（denied 行回写 = server 409，压根不该发）
//   5. 预检断网：agent 拿到「预检失败：<原因>」，不静默成功，命令未执行
//   6. 回写失败：返回文本含真实输出 + 明确回写失败原因（绝不静默成功）
//   7. 非零退出码：回写仍 done（退出码是命令结果非执行失败），返回文本含退出码
//   8. 参数不合法：空 command / 超长 command → 明确原因，不发预检
//   9. spawn 失败（cwd 不存在）：回写 failed + errorMessage，返回执行失败原因
//  10. 注册面：claim localTools 含 remote_shell → 会话工具面含该词；
//      [] / 缺省（chief 步、旧 server）→ 不含（工具缺席 = 开关关，fail-closed）

import { existsSync, mkdtempSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentBackend,
  type AgentSessionHandle,
  type ClaimedStep,
  type MachineDoneBody,
  type MachineShellPrecheckResponse,
  type MachineShellResultBody,
  type MachineStreamEvent,
  type SessionOpts,
  SHELL_COMMAND_CHAR_LIMIT,
  SHELL_OUTPUT_CHAR_LIMIT,
  type ToolCallRecord,
  type TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { buildRemoteShellTool, type ShellWire } from '../src/shell-channel.js';
import { statePaths } from '../src/state.js';

// —— 工具面（场景 1-9）：fake wire + 真 bash ————————————————————————————————

class FakeWire implements ShellWire {
  precheckCalls: { stepId: string; command: string }[] = [];
  resultCalls: { runId: string; body: MachineShellResultBody }[] = [];
  precheckError: unknown = null;
  resultError: unknown = null;

  async shellPrecheck(stepId: string, command: string): Promise<MachineShellPrecheckResponse> {
    this.precheckCalls.push({ stepId, command });
    if (this.precheckError) throw this.precheckError;
    return { allowed: true, runId: 'run-1' };
  }

  async shellResult(runId: string, body: MachineShellResultBody): Promise<void> {
    this.resultCalls.push({ runId, body });
    if (this.resultError) throw this.resultError;
  }
}

function harness(opts: { timeoutMs?: number; cwd?: string } = {}) {
  const wire = new FakeWire();
  const lines: string[] = [];
  const cwd = opts.cwd ?? mkdtempSync(join(tmpdir(), 'cairn-shell-channel-'));
  const tool = buildRemoteShellTool({
    wire,
    stepId: 's1',
    cwd,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    onAudit: (line) => lines.push(line),
  });
  return { wire, lines, cwd, tool };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('remote_shell 工具（预检 + spawn + 回写）', () => {
  test('场景1 放行链：真命令执行，返回输出原文，回写 done/exitCode/output', async () => {
    const { wire, lines, tool } = harness();
    const out = await tool.execute({ command: 'echo hi' });
    expect(out).toBe('hi\n');
    expect(wire.precheckCalls).toEqual([{ stepId: 's1', command: 'echo hi' }]);
    expect(wire.resultCalls).toHaveLength(1);
    expect(wire.resultCalls[0]!.runId).toBe('run-1');
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 0 });
    expect(wire.resultCalls[0]!.body.output).toContain('hi');
    expect(lines.some((l) => l.includes('shell done') && l.includes('exit=0'))).toBe(true);
  });

  test('场景1b cwd = 会话工作目录：命令在其中执行', async () => {
    const { wire, cwd, tool } = harness();
    const out = await tool.execute({ command: 'pwd' });
    // macOS tmpdir 符号链接（/var → /private/var）：realpath 归一后比对。
    expect(out.trim()).toBe(realpathSync(cwd));
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 0 });
  });

  test('场景2 超时：杀整个进程组（后台子孙同死），回写 failed，返回超时文本', async () => {
    const { wire, lines, cwd, tool } = harness({ timeoutMs: 400 });
    const marker = join(cwd, 'bg-ticks.txt');
    const out = await tool.execute({
      command: `echo start; (while true; do echo tick >> '${marker}'; sleep 0.05; done) & sleep 30`,
    });
    // agent 拿到超时文本 + 超时前的部分输出。
    expect(out).toContain('超时');
    expect(out).toContain('start');
    // 回写 failed + 超时 errorMessage（契约：超时原因走 errorMessage）。
    expect(wire.resultCalls).toHaveLength(1);
    expect(wire.resultCalls[0]!.body.status).toBe('failed');
    expect(wire.resultCalls[0]!.body.errorMessage).toContain('超时');
    // 进程组级杀的硬证明：返回后后台子孙不再写文件（只杀 bash 本体的话
    // while 循环会继续 tick）。
    const sizeAtReturn = statSync(marker).size;
    expect(sizeAtReturn).toBeGreaterThan(0);
    await sleep(400);
    expect(statSync(marker).size).toBe(sizeAtReturn);
    expect(lines.some((l) => l.includes('shell timeout'))).toBe(true);
  }, 15_000);

  test('场景3 大输出：截断带标记，回写/返回 ≤ SHELL_OUTPUT_CHAR_LIMIT', async () => {
    const { wire, tool } = harness({ timeoutMs: 30_000 });
    const total = SHELL_OUTPUT_CHAR_LIMIT + 50_000;
    const out = await tool.execute({
      command: `tr '\\0' 'x' < /dev/zero | head -c ${total}`,
    });
    expect(out.length).toBeLessThanOrEqual(SHELL_OUTPUT_CHAR_LIMIT);
    expect(out).toContain('截断');
    expect(out).toContain(String(total));
    const written = wire.resultCalls[0]!.body.output ?? '';
    expect(written.length).toBeLessThanOrEqual(SHELL_OUTPUT_CHAR_LIMIT);
    expect(written).toContain('截断');
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 0 });
  }, 30_000);

  test('场景4 预检 403：返回未授权原因，命令未执行，无回写', async () => {
    const reason = '机器 m1 未开启 shell 访问（机器详情页），无法执行命令';
    const { wire, lines, cwd, tool } = harness();
    wire.precheckError = new MachineApiError(403, reason);
    const probe = join(cwd, 'must-not-exist');
    const out = await tool.execute({ command: `touch '${probe}'` });
    expect(out).toContain('未授权');
    expect(out).toContain(reason);
    expect(existsSync(probe)).toBe(false); // 命令从未跑过
    expect(wire.resultCalls).toHaveLength(0); // denied 行不回写
    expect(lines.some((l) => l.includes('shell denied'))).toBe(true);
  });

  test('场景5 预检断网：返回预检失败，不静默成功，命令未执行', async () => {
    const { wire, cwd, tool } = harness();
    wire.precheckError = new TypeError('fetch failed');
    const probe = join(cwd, 'must-not-exist');
    const out = await tool.execute({ command: `touch '${probe}'` });
    expect(out).toContain('预检失败');
    expect(out).toContain('fetch failed');
    expect(existsSync(probe)).toBe(false);
    expect(wire.resultCalls).toHaveLength(0);
  });

  test('场景6 回写失败：返回真实输出 + 明确回写失败原因（绝不静默成功）', async () => {
    const { wire, lines, tool } = harness();
    wire.resultError = new TypeError('fetch failed');
    const out = await tool.execute({ command: 'echo payload' });
    expect(out).toContain('payload'); // 命令确实跑了，结果如实给 agent
    expect(out).toContain('回写失败'); // 且不装作审计闭环了
    expect(wire.resultCalls).toHaveLength(1);
    expect(lines.some((l) => l.includes('shell writeback failed'))).toBe(true);
  });

  test('场景7 非零退出码：回写仍 done + exitCode，返回文本含退出码', async () => {
    const { wire, tool } = harness();
    const out = await tool.execute({ command: 'echo oops >&2; exit 3' });
    expect(out).toContain('oops');
    expect(out.trimEnd().endsWith('[exit 3]')).toBe(true);
    expect(wire.resultCalls[0]!.body).toMatchObject({ status: 'done', exitCode: 3 });
  });

  test('场景8 参数不合法：空 command / 超长 command → 明确原因，不发预检', async () => {
    const { wire, tool } = harness();
    const empty = await tool.execute({});
    expect(empty).toContain('command');
    const blank = await tool.execute({ command: '   ' });
    expect(blank).toContain('command');
    const overlong = await tool.execute({
      command: `echo ${'x'.repeat(SHELL_COMMAND_CHAR_LIMIT)}`,
    });
    expect(overlong).toContain('预检失败');
    expect(overlong).toContain(String(SHELL_COMMAND_CHAR_LIMIT));
    expect(wire.precheckCalls).toHaveLength(0);
    expect(wire.resultCalls).toHaveLength(0);
  });

  test('场景9 spawn 失败：回写 failed + errorMessage，返回执行失败原因', async () => {
    const { wire, lines, tool } = harness({ cwd: join(tmpdir(), 'cairn-shell-no-such-dir') });
    const out = await tool.execute({ command: 'echo hi' });
    expect(out).toContain('执行失败');
    expect(wire.resultCalls).toHaveLength(1);
    expect(wire.resultCalls[0]!.body.status).toBe('failed');
    expect(wire.resultCalls[0]!.body.errorMessage ?? '').not.toBe('');
    expect(lines.some((l) => l.includes('shell spawn failed'))).toBe(true);
  });
});

// —— 注册面（场景 10）：claim localTools → 会话工具面 ————————————————

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

function claimedStep(localTools?: string[]): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'shell 探针', spec: '跑一条命令' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    ...(localTools !== undefined ? { localTools } : {}),
  };
}

class FakeClient implements MachineApi {
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
  async done(_stepId: string, _body: MachineDoneBody) {}
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

/** 录制 backend：只记会话建立时的工具面（注册面断言不执行工具）。 */
function recordingBackend(slot: { sessionOpts: SessionOpts | null }): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      slot.sessionOpts = opts;
      return {
        sessionId: 'pi-sess-shell',
        events: (async function* () {
          yield { type: 'text_delta', text: 'ok' } as never;
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
  };
}

async function toolNamesFor(localTools?: string[]): Promise<string[]> {
  const home = mkdtempSync(join(tmpdir(), 'cairn-shell-reg-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger } = captureLogger();
  const slot: { sessionOpts: SessionOpts | null } = { sessionOpts: null };
  const deps = {
    client: new FakeClient(),
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => recordingBackend(slot),
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimedStep(localTools));
  return (slot.sessionOpts?.localTools ?? []).map((t) => t.name);
}

describe('remote_shell 注册面（claim localTools → 会话工具面）', () => {
  test('场景10a localTools 含 remote_shell → 工具面含该词', async () => {
    const names = await toolNamesFor(['remote_shell']);
    expect(names).toContain('remote_shell');
  });

  test('场景10b localTools = []（双闸任一关）→ 工具面不含该词', async () => {
    const names = await toolNamesFor([]);
    expect(names).not.toContain('remote_shell');
  });

  test('场景10c localTools 缺省（chief 步 / 旧 server）→ 工具面不含该词', async () => {
    const names = await toolNamesFor(undefined);
    expect(names).not.toContain('remote_shell');
  });
});
