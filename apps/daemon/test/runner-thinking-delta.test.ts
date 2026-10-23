// #1308 runner 半：thinking_delta 按 text_delta 同一节流窗批量上报，不进
// transcript_delta。失败方式：
//   1. 每个 token 各打一发（不节流）。
//   2. 思考正文进 transcriptDelta（正文通道被污染）。
//   3. 窗内两段被拆成两次，或跨窗两段被粘成一次。
//   4. 收尾不补刷缓冲 → 最后一截思考到不了 wire，只留落库行。
//   5. 活动相位不再报 thinking。
//   6. 落库段行丢失思考正文。

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
  StepActivityReport,
  StepEvent,
  ToolCallRecord,
  TranscriptRow,
  TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

function logger(): DaemonLogger {
  const push = () => {};
  return {
    raw: push,
    prefixed: push,
    supervisor: push,
    machine: push,
    step: push,
    workspace: push,
    recover: push,
    wake: push,
    mcp: push,
    skills: push,
    gate: push,
    trust: push,
  };
}

function claimedStep(): ClaimedStep {
  return {
    step: { id: 'step-think1', buildId: 'b1', kind: 'build', machineId: null, createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    instruction: null,
    todo: { id: 't1', seqNum: 1, title: '思考流探针', spec: '想一下' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: 'gw-noop',
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

class RecordingClient implements MachineApi {
  thinking: string[] = [];
  deltas: string[] = [];
  rows: TranscriptRow[] = [];
  activities: StepActivityReport[] = [];
  doneBodies: MachineDoneBody[] = [];

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
  async transcriptDelta(_stepId: string, text: string) {
    this.deltas.push(text);
  }
  async thinkingDelta(_stepId: string, text: string) {
    this.thinking.push(text);
  }
  async transcriptRow(_stepId: string, row: TranscriptRow) {
    this.rows.push(row);
  }
  async activity(_stepId: string, report: StepActivityReport) {
    this.activities.push(report);
  }
  async relayTool() {
    return '{}';
  }
  async token() {
    return {
      provider: {
        kind: 'http' as const,
        providerId: 'gw-noop',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions' as const,
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
  async done(_stepId: string, body: MachineDoneBody) {
    this.doneBodies.push(body);
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
  async shellResult() {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function backendOf(script: StepEvent[] | AsyncIterable<StepEvent>): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(_sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      const events = (async function* () {
        if (Symbol.asyncIterator in script) {
          for await (const ev of script as AsyncIterable<StepEvent>) yield ev;
          return;
        }
        for (const ev of script as StepEvent[]) yield ev;
      })();
      return {
        sessionId: 'pi-sess-think',
        events,
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

async function run(script: StepEvent[] | AsyncIterable<StepEvent>) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-think-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const client = new RecordingClient();
  await runStep(
    {
      client,
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => backendOf(script),
      logger: logger(),
      paths,
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimedStep(),
  );
  return client;
}

describe('runner thinking_delta 节流转发（#1308）', () => {
  test('同一窗口内的两段合成一次上报，不进正文通道', async () => {
    const client = await run([
      { type: 'thinking_delta', text: 'alpha' },
      { type: 'thinking_delta', text: 'beta' },
      { type: 'done', usage: [] },
    ]);
    expect(client.thinking).toEqual(['alphabeta']);
    expect(client.deltas).toEqual([]);
    expect(client.activities.some((report) => report.phase === 'thinking')).toBe(true);
    expect(client.rows).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'alphabeta' }],
      }),
    ]);
    expect(client.doneBodies[0]?.status).toBe('success');
  });

  test('跨过节流窗的两段各报一次', async () => {
    async function* paced(): AsyncIterable<StepEvent> {
      yield { type: 'thinking_delta', text: 'alpha' };
      await new Promise((resolve) => setTimeout(resolve, 400));
      yield { type: 'thinking_delta', text: 'beta' };
      yield { type: 'done', usage: [] };
    }
    const client = await run(paced());
    expect(client.thinking).toEqual(['alpha', 'beta']);
    expect(client.deltas).toEqual([]);
  });

  test('正文增量仍只走 transcriptDelta', async () => {
    const client = await run([
      { type: 'text_delta', text: 'answer' },
      { type: 'done', usage: [] },
    ]);
    expect(client.thinking).toEqual([]);
    expect(client.deltas).toEqual(['answer']);
  });
});
