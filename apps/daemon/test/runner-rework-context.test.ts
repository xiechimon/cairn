// #1204 返工降级注入（runner 回退分支）：continue 意图的步在 daemon 侧续接
// 失败（SessionNotResumableError，#862 回退）回退新会话时，claim 载荷的
// reworkContext（首跑方案全文 + 全部历史返工意见）组合进新会话首轮 prompt
// ——新会话无前轮记忆，凭注入的既有事实重建（票面缺陷二：卡 #24 返工轮
// agent 靠读仓库现场自救，隐含前提全丢）。失败方式（先于实现固化）：
//  1. 注入缺位：回退新会话只发续轮指令，方案与历史意见丢失 → 组合 prompt
//     必须含任务文本、续轮指令、方案全文、每一条意见。
//  2. 旧 server 形（载荷无 reworkContext）→ 回退 prompt 逐字节保持续轮指令
//     （零回归——不能给旧载荷加任务文本拼接，那是 #720 new-session 载荷面）。
//  3. 误注入：续接成功路径不得注入（continueSession 收原 opts，createSession
//     不被调用）——注入只发生在回退分支。
//  4. 空上下文（planText null + feedbacks []）→ 不注入（与 2 同形）。

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
} from '@pacman/shared';
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

const INSTRUCTION = '用户在审核关口请求修改。修改反馈：「改掉按钮文案」。';

function claimedContinueStep(reworkContext?: {
  planText: string | null;
  feedbacks: string[];
}): ClaimedStep {
  return {
    step: {
      id: 's-rework',
      buildId: 'conv-rework',
      kind: 'plan',
      machineId: 'm-mea',
      createdAt: 1,
    },
    conversationId: 'conv-rework',
    session: { action: 'continue', sessionId: 'sess-old' },
    instruction: INSTRUCTION,
    todo: { id: 't1', seqNum: 3, title: '返工探针', spec: '写一行探针' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    ...(reworkContext !== undefined ? { reworkContext } : {}),
  };
}

class CaptureClient implements MachineApi {
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
      provider: {
        kind: 'http' as const,
        providerId: 'gw-rework',
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

interface CapturedSession {
  continueOpts: SessionOpts[];
  createOpts: SessionOpts[];
}

/** 会话开面探针后端：continue / create 两面各自捕获 opts；continue 语义由
 *  `resumeOk` 决定（true = 续接成功，false = SessionNotResumable 回退）。 */
function captureBackend(resumeOk: boolean, script: StepEvent[]): AgentBackend & CapturedSession {
  const captured: CapturedSession = { continueOpts: [], createOpts: [] };
  const handle = (): AgentSessionHandle => {
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
  };
  return {
    ...captured,
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts) {
      captured.createOpts.push(opts);
      return handle();
    },
    async continueSession(id: string, opts: SessionOpts) {
      captured.continueOpts.push(opts);
      if (!resumeOk) throw new SessionNotResumableError(id);
      return handle();
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

async function runClaimed(backend: AgentBackend, claimed: ClaimedStep): Promise<CaptureClient> {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-rework-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const client = new CaptureClient();
  const journal = new StepJournal(paths.outboxDir);
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger: captureLogger(),
      paths,
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimed,
    {},
  );
  return client;
}

describe('#1204 返工降级注入（runner resume fallback context）', () => {
  test('失败方式 1：reworkContext 在位 + 续接失败 → 新会话首轮 prompt 含任务文本、指令、方案全文与全部意见', async () => {
    const backend = captureBackend(false, successScript());
    const client = await runClaimed(
      backend,
      claimedContinueStep({
        planText: '# 方案 v1\n\n- Context: 探针',
        feedbacks: ['第一条返工意见', '第二条返工意见'],
      }),
    );

    expect(backend.continueOpts).toHaveLength(1);
    expect(backend.createOpts).toHaveLength(1);
    const prompt = backend.createOpts[0]!.prompt ?? '';
    expect(prompt).toContain('返工探针\n\n写一行探针'); // 任务文本（title+spec）
    expect(prompt).toContain(INSTRUCTION); // 续轮指令（回退前已选定）
    expect(prompt).toContain('# 方案 v1\n\n- Context: 探针'); // 方案全文
    expect(prompt).toContain('第一条返工意见');
    expect(prompt).toContain('第二条返工意见');
    // 步照常成功（注入不打断收尾）。
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 2：旧 server 载荷（无 reworkContext）→ 回退 prompt 逐字节保持续轮指令', async () => {
    const backend = captureBackend(false, successScript());
    await runClaimed(backend, claimedContinueStep());

    expect(backend.createOpts).toHaveLength(1);
    expect(backend.createOpts[0]!.prompt).toBe(INSTRUCTION);
  });

  test('失败方式 3：续接成功 → 不注入（continue 收原 opts，create 不被调）', async () => {
    const backend = captureBackend(true, successScript());
    await runClaimed(
      backend,
      claimedContinueStep({
        planText: '# 方案 v1',
        feedbacks: ['意见'],
      }),
    );

    expect(backend.continueOpts).toHaveLength(1);
    expect(backend.createOpts).toHaveLength(0);
    expect(backend.continueOpts[0]!.prompt).toBe(INSTRUCTION);
  });

  test('失败方式 4：空上下文（planText null + feedbacks []）→ 不注入（与旧载荷同形）', async () => {
    const backend = captureBackend(false, successScript());
    await runClaimed(backend, claimedContinueStep({ planText: null, feedbacks: [] }));

    expect(backend.createOpts).toHaveLength(1);
    expect(backend.createOpts[0]!.prompt).toBe(INSTRUCTION);
  });
});
