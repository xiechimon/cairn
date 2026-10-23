import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  AgentTodoReport,
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
    step: { id: 'step-todo1', buildId: 'b1', kind: 'build', machineId: null, createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    instruction: null,
    todo: { id: 't1', seqNum: 1, title: '清单探针', spec: '做一下' },
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
  todos: AgentTodoReport[] = [];
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
  async transcriptDelta() {}
  async thinkingDelta() {}
  async transcriptRow(_stepId: string, _row: TranscriptRow) {}
  async activity(_stepId: string, _report: StepActivityReport) {}
  agentTodo(_stepId: string, todo: AgentTodoReport): Promise<void> {
    this.todos.push({ items: todo.items.map((it) => ({ ...it })) });
    return Promise.resolve();
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

function backendOf(script: StepEvent[]): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(_sessionOpts: SessionOpts): Promise<AgentSessionHandle> {
      const events = (async function* () {
        for (const ev of script) yield ev;
      })();
      return {
        sessionId: 'pi-sess-todo',
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

async function run(script: StepEvent[]) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-todo-'));
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

const LIST_V1 = ['- [ ] 通读 poteto 的推文观点', '- [x] 查 pi 模型上下文'].join('\n');
const LIST_V2 = ['- [x] 通读 poteto 的推文观点', '- [x] 查 pi 模型上下文'].join('\n');

describe('runner agent todo 转发（#1524）', () => {
  test('文本段任务行 → 整表上报一次', async () => {
    const client = await run([
      { type: 'text_delta', text: LIST_V1 },
      { type: 'done', usage: [] },
    ]);
    expect(client.todos).toEqual([
      {
        items: [
          { text: '通读 poteto 的推文观点', state: 'todo' },
          { text: '查 pi 模型上下文', state: 'done' },
        ],
      },
    ]);
  });

  test('重复整表去重；状态变化再报', async () => {
    const client = await run([
      { type: 'text_delta', text: LIST_V1 },
      { type: 'message_end', message: { role: 'assistant', content: '换段' } },
      { type: 'text_delta', text: LIST_V1 },
      { type: 'message_end', message: { role: 'assistant', content: '再换段' } },
      { type: 'text_delta', text: LIST_V2 },
      { type: 'done', usage: [] },
    ]);
    expect(client.todos).toHaveLength(2);
    expect(client.todos[1]?.items[0]).toEqual({ text: '通读 poteto 的推文观点', state: 'done' });
  });

  test('围栏内的任务行不触发上报', async () => {
    const client = await run([
      { type: 'text_delta', text: ['```md', '- [ ] 假清单', '```'].join('\n') },
      { type: 'done', usage: [] },
    ]);
    expect(client.todos).toEqual([]);
  });

  test('纯散文不触发上报（无清单零噪声）', async () => {
    const client = await run([
      { type: 'text_delta', text: '没有清单的正文，说完就收。' },
      { type: 'done', usage: [] },
    ]);
    expect(client.todos).toEqual([]);
  });

  test('toolcall_end 携带 todo 投影 → 同一上报面', async () => {
    const client = await run([
      {
        type: 'toolcall_end',
        call: {
          id: 't1',
          name: 'TodoWrite',
          arguments: {},
          result: 'ok',
          todo: [{ text: '读 README', state: 'doing' }],
        },
      },
      { type: 'done', usage: [] },
    ]);
    expect(client.todos).toEqual([{ items: [{ text: '读 README', state: 'doing' }] }]);
  });

  test('同一清单先文本段后调用行 → 去重为一报', async () => {
    const client = await run([
      { type: 'text_delta', text: LIST_V1 },
      {
        type: 'toolcall_end',
        call: {
          id: 't1',
          name: 'TodoWrite',
          arguments: {},
          result: 'ok',
          todo: [
            { text: '通读 poteto 的推文观点', state: 'todo' },
            { text: '查 pi 模型上下文', state: 'done' },
          ],
        },
      },
      { type: 'done', usage: [] },
    ]);
    expect(client.todos).toHaveLength(1);
  });

  test('步收尾正常（todo 面不扰步生命周期）', async () => {
    const client = await run([
      { type: 'text_delta', text: LIST_V1 },
      { type: 'done', usage: [] },
    ]);
    expect(client.doneBodies[0]?.status).toBe('success');
  });
});
