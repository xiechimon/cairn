// per-step 团队密钥取用通道对拍（02 §8 运行时层；#508）。
// 外部行为 = 「哪一步收到了什么、agent 能取到什么、步收尾后还剩什么」，断言
// 落在工具面与审计行上，不落内部字段名。harness 同 runner-local.test.ts
// （FakeClient + 录制 backend）。
// 先固化的失败场景（AGENTS.md 测试规则 3）：
//   1. 执行步：token 带 secrets → 会话工具面含 get_secret，agent 取到正确值
//   2. 取用留审计行（步 id + agent id + 密钥名 + 时间），行内**不含值**
//   3. 未授权的名字 → 明确原因（not granted），不产审计行
//   4. 步收尾（done）后同一通道不可再取（凭据生命周期随步）
//   5. 规划/审核步：连取用工具都不注册（按 kind 裁剪）
//   6. 明文不铺进进程环境：会话面除取用工具外任何位都不含值

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
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { GET_SECRET_TOOL_NAME } from '../src/secret-channel.js';
import { statePaths } from '../src/state.js';

const SECRET_NAME = 'STRIPE_API_KEY';
const SECRET_VALUE = 'sk_live_stripe_per_step';

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

function claimedStep(kind: ClaimedStep['step']['kind']): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: '密钥探针', spec: '跑构建' },
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
  secrets: Record<string, string> = {};

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
      secrets: this.secrets,
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

interface Probe {
  /** 会话建立时的工具面（步内）。 */
  sessionOpts: SessionOpts | null;
  /** 步内取用结果（agent 视角：拿到的文本）。 */
  taken: string | null;
  /** 步收尾后同一通道再取一次（凭据生命周期对拍）。 */
  afterStep: string | null;
}

/** 录制 backend：会话建立即记 opts + 步内取一次密钥；收尾后由测试再取一次。 */
function probingBackend(probe: Probe): AgentBackend {
  const tool = () => probe.sessionOpts?.localTools?.[0] ?? null;
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      probe.sessionOpts = opts;
      const t = tool();
      probe.taken = t ? await t.execute({ name: SECRET_NAME }) : null;
      return {
        sessionId: 'pi-sess-secret',
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

async function setup(kind: ClaimedStep['step']['kind'], secrets: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-secret-channel-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  client.secrets = secrets;
  const probe: Probe = { sessionOpts: null, taken: null, afterStep: null };
  const deps = {
    client,
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => probingBackend(probe),
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimedStep(kind));
  // 步已收尾（done → clearCredentials）：同一工具再取一次。
  const t = probe.sessionOpts?.localTools?.[0];
  probe.afterStep = t ? await t.execute({ name: SECRET_NAME }) : null;
  return { client, lines, probe };
}

describe('团队密钥取用通道（02 §8 运行时层）', () => {
  test('执行步：工具面可见 + 取到正确值', async () => {
    const { probe, client } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    expect(probe.sessionOpts?.localTools?.[0]?.name).toBe(GET_SECRET_TOOL_NAME);
    expect(probe.taken).toBe(SECRET_VALUE);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('取用留审计行：步 id + agent id + 密钥名 + 时间，行内不含值', async () => {
    const { lines } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    const audits = lines.filter((l) => l.includes('secret taken'));
    expect(audits).toHaveLength(1);
    // 时间面：行内含 ISO 时间戳（审计「何时取用」）。
    expect(audits[0]).toMatch(
      new RegExp(
        `^\\[step\\] secret taken step=s1 agent=a1 name=${SECRET_NAME} at=\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z$`,
      ),
    );
    // 永不写值：整本日志无明文。
    expect(lines.some((l) => l.includes(SECRET_VALUE))).toBe(false);
  });

  test('未授权的名字 = 明确原因，且不产审计行', async () => {
    const { probe, lines } = await setup('build', { OTHER_KEY: SECRET_VALUE });
    expect(probe.taken).toContain('not granted');
    expect(probe.taken).toContain(SECRET_NAME); // 报的是问的那个名字
    expect(lines.some((l) => l.includes('secret taken'))).toBe(false);
  });

  test('步收尾后不可再取（凭据生命周期随步，失败/中断同路）', async () => {
    const { probe, lines } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    expect(probe.afterStep).not.toBe(SECRET_VALUE);
    expect(probe.afterStep).toContain('no team secret is available for this step');
    // 收尾后的空取不产生第二条审计行。
    expect(lines.filter((l) => l.includes('secret taken'))).toHaveLength(1);
  });

  test('按 kind 裁剪：规划 / 审核步不注册取用工具', async () => {
    for (const kind of ['plan', 'review'] as const) {
      const { probe } = await setup(kind, { [SECRET_NAME]: SECRET_VALUE });
      expect(probe.sessionOpts?.localTools ?? []).toEqual([]);
      expect(probe.taken).toBeNull();
    }
  });

  test('明文不铺进进程环境：会话面除取用工具外无值', async () => {
    const { probe } = await setup('build', { [SECRET_NAME]: SECRET_VALUE });
    const { localTools: _localTools, ...rest } = probe.sessionOpts ?? ({} as SessionOpts);
    expect(JSON.stringify(rest)).not.toContain(SECRET_VALUE);
  });
});
