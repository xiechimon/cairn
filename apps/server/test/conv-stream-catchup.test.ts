import type { ConversationStepEvent, TranscriptRow } from '@cairn/shared';
import { conversationStreamEventSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { rewindChiefThread } from '../src/services/chief.js';
import {
  CONV_TEXT_BUFFER_MAX_BYTES,
  CONV_TEXT_BUFFER_MAX_CONVS,
  ConversationStreamHub,
  type TeamStreamConnection,
} from '../src/services/events.js';
import { bootServer, issueApiKey, machineIdByName, openConvStream } from './helpers.js';

class FakeConn implements TeamStreamConnection {
  readonly frames: object[] = [];
  private seq = 0;
  nextSeq(): number {
    return ++this.seq;
  }
  send(payload: object): Promise<void> {
    this.frames.push(payload);
    return Promise.resolve();
  }
}

function stepRow(
  buildId: string,
  status: ConversationStepEvent['step']['status'],
): ConversationStepEvent['step'] {
  return {
    id: 'step-1',
    buildId,
    kind: 'chief',
    machineId: 'm-1',
    createdAt: 1,
    status,
    checkpointCommit: null,
    skillInjection: null,
  };
}

function textFrames(conn: FakeConn): string[] {
  return conn.frames
    .filter(
      (f): f is { type: string; text: string } => (f as { type: string }).type === 'text_delta',
    )
    .map((f) => f.text);
}

function subscribeFresh(hub: ConversationStreamHub, conversationId: string): FakeConn {
  const conn = new FakeConn();
  hub.subscribe(conversationId, conn);
  return conn;
}

describe('hub buffer: entry catch-up and seams (#740 failure modes 1 and 6)', () => {
  test('deltas missed during the zero-subscriber period are caught up in one go on subscribe, then normal increments', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '正在');
    hub.publishTextDelta('c1', '分析仓库');
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    expect(textFrames(conn)).toEqual(['正在分析仓库']);
    hub.publishTextDelta('c1', '结构');
    expect(textFrames(conn)).toEqual(['正在分析仓库', '结构']);
  });

  test('catch-up frames pass the shared vocabulary schema (wire unchanged)', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '前缀');
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    const replay = conn.frames.find((f) => (f as { type: string }).type === 'text_delta');
    expect(replay).toBeDefined();
    expect(conversationStreamEventSchema.parse(replay)).toBeTruthy();
  });

  test('empty buffer, zero catch-up', () => {
    const hub = new ConversationStreamHub();
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    hub.publishMessage('c1', {
      id: 'm1',
      role: 'user',
      content: 'hi',
      createdAt: 1,
    } as TranscriptRow);
    expect(textFrames(conn)).toEqual([]);
  });
});

describe('hub buffer: clear points (#740 failure mode 2)', () => {
  test('clear points (#955 segment-boundary law): text lines / user lines cleared, tool lines and thinking-only lines not', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '段一');
    hub.publishMessage('c1', {
      id: 'm1',
      role: 'assistant',
      content: [{ type: 'text', text: '终稿' }],
      createdAt: 1,
    } as unknown as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
    hub.publishTextDelta('c1', '段二');
    hub.publishMessage('c1', {
      id: 'm2',
      role: 'assistant',
      content: { kind: 'toolcall', call: { name: 'bash' } },
      createdAt: 2,
    } as unknown as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段二']);
    hub.publishMessage('c1', {
      id: 'm2b',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '想一下' }],
      createdAt: 3,
    } as unknown as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段二']);
    hub.publishTextDelta('c1', '段三');
    hub.publishMessage('c1', {
      id: 'm3',
      role: 'user',
      content: '再来',
      createdAt: 4,
    } as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
  });

  test('step terminal clears (done/failed/stopped); claimed does not', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '段');
    hub.publishStep('c1', stepRow('c1', 'claimed'));
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段']);
    for (const status of ['done', 'failed', 'stopped'] as const) {
      hub.publishTextDelta('c1', '段');
      hub.publishStep('c1', stepRow('c1', status));
      expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
    }
  });

  test('dead turn with no terminal: next turn user line entering clears it (cross-turn staleness fallback)', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '死回合残段');
    hub.publishMessage('c1', {
      id: 'm9',
      role: 'user',
      content: '新回合',
      createdAt: 9,
    } as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
  });

  test('clearConversationBuffer (rewind channel): explicit clear then zero catch-up', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '残段');
    hub.clearConversationBuffer('c1');
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
  });
});

describe('hub thinking buffer (#1308): closing a body segment must not wipe the just-written thinking snapshot', () => {
  function thinkingFrames(conn: FakeConn): string[] {
    return conn.frames
      .filter(
        (f): f is { type: string; text: string } =>
          (f as { type: string }).type === 'thinking_delta',
      )
      .map((f) => f.text);
  }

  test('assistant text line keeps the thinking snapshot while clearing the body buffer and active phase', () => {
    const hub = new ConversationStreamHub();
    hub.publishThinkingDelta('c1', 'REASONING-MARKER-1308');
    hub.publishTextDelta('c1', '草稿');
    hub.publishActivity('c1', {
      stepId: 'step-1',
      at: 100,
      phase: 'thinking',
    });
    hub.publishMessage('c1', {
      id: 'm-text',
      role: 'assistant',
      content: [{ type: 'text', text: '终稿' }],
      createdAt: 1,
    } as unknown as TranscriptRow);
    const conn = subscribeFresh(hub, 'c1');
    expect(thinkingFrames(conn)).toEqual(['REASONING-MARKER-1308']);
    expect(textFrames(conn)).toEqual([]);
    expect(conn.frames.filter((f) => (f as { type: string }).type === 'activity')).toEqual([]);
  });

  test('user lines and step terminals still clear the thinking snapshot', () => {
    const userHub = new ConversationStreamHub();
    userHub.publishThinkingDelta('c1', 'REASONING-MARKER-1308');
    userHub.publishMessage('c1', {
      id: 'm-user',
      role: 'user',
      content: '新回合',
      createdAt: 2,
    } as TranscriptRow);
    expect(thinkingFrames(subscribeFresh(userHub, 'c1'))).toEqual([]);

    const stepHub = new ConversationStreamHub();
    stepHub.publishThinkingDelta('c1', 'REASONING-MARKER-1308');
    stepHub.publishStep('c1', stepRow('c1', 'done'));
    expect(thinkingFrames(subscribeFresh(stepHub, 'c1'))).toEqual([]);
  });
});

describe('hub buffer: boundaries (#740 failure modes 3/4/5)', () => {
  test('byte cap keeps the tail and drops the head: over-limit segment catch-up = longest tail suffix within the cap', () => {
    const hub = new ConversationStreamHub();
    const head = 'a'.repeat(64 * 1024);
    const tail = '尾部'.repeat(48 * 1024);
    hub.publishTextDelta('c1', head + tail);
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    const [replay] = textFrames(conn);
    expect(replay).toBeDefined();
    expect(Buffer.byteLength(replay!)).toBeLessThanOrEqual(CONV_TEXT_BUFFER_MAX_BYTES);
    expect((head + tail).endsWith(replay!)).toBe(true);
    expect(replay!.length).toBeGreaterThan(0);
  });

  test('buffer session-count cap: the (N+1)-th session entering evicts the oldest buffer', () => {
    const hub = new ConversationStreamHub();
    for (let i = 0; i < CONV_TEXT_BUFFER_MAX_CONVS; i++) hub.publishTextDelta(`c${i}`, `段${i}`);
    hub.publishTextDelta('c-new', '新段');
    expect(textFrames(subscribeFresh(hub, 'c0'))).toEqual([]);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段1']);
    expect(textFrames(subscribeFresh(hub, 'c-new'))).toEqual(['新段']);
  });

  test('multiple subscribers: each entering gets one catch-up of its own, no crosstalk', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '前缀');
    const first = new FakeConn();
    hub.subscribe('c1', first);
    hub.publishTextDelta('c1', '一');
    const second = new FakeConn();
    hub.subscribe('c1', second);
    hub.publishTextDelta('c1', '二');
    expect(textFrames(first)).toEqual(['前缀', '一', '二']);
    expect(textFrames(second)).toEqual(['前缀一', '二']);
  });

  test('cross-session isolation: session A buffer does not enter session B stream', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('cA', 'A 的段');
    expect(textFrames(subscribeFresh(hub, 'cB'))).toEqual([]);
  });
});

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

const AGENT_ID = 'agent-740';

async function setupChief(opts: { pingIntervalMs?: number } = {}) {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: opts.pingIntervalMs ?? 3_600_000 });
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'm740', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = machineIdByName(s, 'm740');
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'agent-740',
      modelId: 'stub-model',
      provider: 'stub-gw',
      machineId,
    })
    .run();
  const patchRes = await call(s.app, 'PATCH', `/api/teams/${s.team.id}/chief`, {
    body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  });
  expect(patchRes.status).toBe(200);
  const msgRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
    body: { content: '写一份 catch-up 测试稿。' },
  });
  expect(msgRes.status).toBe(201);
  const { thread, message } = (await msgRes.json()) as {
    thread: { id: string };
    message: { id: string };
  };
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
    cred: token,
    body: {},
  });
  const claimBody = (await claimRes.json()) as { step: { step: { id: string } } | null };
  expect(claimBody.step).not.toBeNull();
  return {
    s,
    token,
    threadId: thread.id,
    anchorMessageId: message.id,
    stepId: claimBody.step!.step.id,
  };
}

async function delta(app: Hono, token: string, stepId: string, text: string): Promise<void> {
  const res = await call(app, 'POST', `/api/machine/tool/${stepId}`, {
    cred: token,
    body: { kind: 'transcript_delta', text },
  });
  expect(res.status).toBe(200);
}

async function collectFrames(
  stream: Awaited<ReturnType<typeof openConvStream>>,
  ms: number,
): Promise<Record<string, unknown>[]> {
  const frames: Record<string, unknown>[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      frames.push(await stream.next(() => true, Math.max(1, end - Date.now())));
    } catch {
      break;
    }
  }
  return frames;
}

describe('chief wire surface: mid-way entry catch-up (#740 ticket symptom path)', () => {
  test('delta during zero-subscriber period -> one catch-up text_delta on stream open -> live as usual -> new stream after done has zero catch-up', async () => {
    const { s, token, threadId, stepId } = await setupChief({ pingIntervalMs: 50 });
    try {
      await delta(s.app, token, stepId, '正在');
      await delta(s.app, token, stepId, '梳理需求');
      const stream = await openConvStream(s.app, threadId);
      try {
        const replay = await stream.next((ev) => ev.type === 'text_delta');
        expect(conversationStreamEventSchema.parse(replay)).toBeTruthy();
        expect((replay as { text: string }).text).toBe('正在梳理需求');
        await delta(s.app, token, stepId, '，随后动笔');
        const live = await stream.next(
          (ev) => ev.type === 'text_delta' && (ev as { text: string }).text === '，随后动笔',
        );
        expect(conversationStreamEventSchema.parse(live)).toBeTruthy();
      } finally {
        stream.close();
      }
      const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { status: 'success' },
      });
      expect(doneRes.status).toBe(200);
      const after = await openConvStream(s.app, threadId);
      try {
        await after.next((ev) => ev.type === 'ping');
        await after.next((ev) => ev.type === 'ping');
        const leaked = (await collectFrames(after, 150)).filter((ev) => ev.type === 'text_delta');
        expect(leaked).toEqual([]);
      } finally {
        after.close();
      }
    } finally {
      s.dispose();
    }
  });

  test('rewind clears the buffer (service-layer defensive clear point): explicit clear then new stream zero catch-up', async () => {
    const { s, threadId, anchorMessageId, stepId, token } = await setupChief({
      pingIntervalMs: 50,
    });
    try {
      const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { status: 'success' },
      });
      expect(doneRes.status).toBe(200);
      s.convHub.publishTextDelta(threadId, '死回合残段');
      const rewind = rewindChiefThread(
        { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user, convHub: s.convHub },
        s.team.id,
        threadId,
        { messageId: anchorMessageId },
      );
      expect(rewind.thread).toBeDefined();
      const after = await openConvStream(s.app, threadId);
      try {
        await after.next((ev) => ev.type === 'ping');
        const leaked = (await collectFrames(after, 150)).filter((ev) => ev.type === 'text_delta');
        expect(leaked).toEqual([]);
      } finally {
        after.close();
      }
    } finally {
      s.dispose();
    }
  });
});

describe('hub activity phase (#905)', () => {
  const act = (phase: 'thinking' | 'tool' | 'responding', at: number, extra?: object) =>
    ({ stepId: 'step-1', at, phase, ...extra }) as import('@cairn/shared').StepActivity;

  function activityFrames(conn: FakeConn): unknown[] {
    return conn.frames.filter((f) => (f as { type: string }).type === 'activity');
  }

  test('A1/A3/A5: multiple activity entries during zero-subscriber period -> catch-up carries only the last, frames pass the vocabulary', () => {
    const hub = new ConversationStreamHub();
    hub.publishActivity('c1', act('thinking', 100));
    hub.publishActivity('c1', act('tool', 200, { tool: 'bash' }));
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    const frames = activityFrames(conn);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      type: 'activity',
      activity: { stepId: 'step-1', at: 200, phase: 'tool', tool: 'bash' },
    });
    expect(conversationStreamEventSchema.parse(frames[0])).toBeTruthy();
    hub.publishActivity('c1', act('responding', 300));
    expect(activityFrames(conn)).toHaveLength(2);
  });

  test('A2: step terminal (done/failed/stopped) clears activity; claimed does not', () => {
    for (const status of ['done', 'failed', 'stopped'] as const) {
      const hub = new ConversationStreamHub();
      hub.publishActivity('c1', act('thinking', 100));
      hub.publishStep('c1', stepRow('c1', status));
      const conn = subscribeFresh(hub, 'c1');
      expect(activityFrames(conn)).toHaveLength(0);
    }
    const hub = new ConversationStreamHub();
    hub.publishActivity('c1', act('thinking', 100));
    hub.publishStep('c1', stepRow('c1', 'claimed'));
    const conn = subscribeFresh(hub, 'c1');
    expect(activityFrames(conn)).toHaveLength(1);
  });

  test('A2: clearConversationBuffer (rewind channel) also clears activity', () => {
    const hub = new ConversationStreamHub();
    hub.publishActivity('c1', act('thinking', 100));
    hub.clearConversationBuffer('c1');
    expect(activityFrames(subscribeFresh(hub, 'c1'))).toHaveLength(0);
  });

  test('A4: cross-session isolation -- A phase does not enter B catch-up or live stream', () => {
    const hub = new ConversationStreamHub();
    hub.publishActivity('cA', act('thinking', 100));
    const b = subscribeFresh(hub, 'cB');
    expect(activityFrames(b)).toHaveLength(0);
    hub.publishActivity('cA', act('tool', 200, { tool: 'read' }));
    expect(activityFrames(b)).toHaveLength(0);
  });

  test('buffer session-count cap evicts the activity single slot by the same law (unbounded-memory defense)', () => {
    const hub = new ConversationStreamHub();
    for (let i = 0; i <= CONV_TEXT_BUFFER_MAX_CONVS; i++) {
      hub.publishActivity(`c${i}`, act('thinking', i));
    }
    expect(activityFrames(subscribeFresh(hub, 'c0'))).toHaveLength(0);
    expect(activityFrames(subscribeFresh(hub, `c${CONV_TEXT_BUFFER_MAX_CONVS}`))).toHaveLength(1);
  });
});

describe('hub agent todo list (#1524)', () => {
  const list = (at: number) =>
    ({
      stepId: 'step-1',
      at,
      items: [
        { text: '通读 poteto 的推文观点', state: 'todo' },
        { text: '开票沉淀注释规则', state: 'doing' },
        { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
      ],
    }) as import('@cairn/shared').AgentTodo;

  function todoFrames(conn: FakeConn): unknown[] {
    return conn.frames.filter((f) => (f as { type: string }).type === 'agent_todo');
  }

  test('multiple lists during zero-subscriber period -> catch-up carries only the last, frames pass the vocabulary', () => {
    const hub = new ConversationStreamHub();
    hub.publishAgentTodo('c1', { ...list(100), items: [{ text: '旧', state: 'todo' }] });
    hub.publishAgentTodo('c1', list(200));
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    const frames = todoFrames(conn);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ type: 'agent_todo', todo: list(200) });
    expect(conversationStreamEventSchema.parse(frames[0])).toBeTruthy();
    hub.publishAgentTodo('c1', { ...list(300), items: [{ text: '新', state: 'doing' }] });
    expect(todoFrames(conn)).toHaveLength(2);
  });

  test('step terminal (done/failed/stopped) clears the list slot; claimed does not', () => {
    for (const status of ['done', 'failed', 'stopped'] as const) {
      const hub = new ConversationStreamHub();
      hub.publishAgentTodo('c1', list(100));
      hub.publishStep('c1', stepRow('c1', status));
      expect(todoFrames(subscribeFresh(hub, 'c1'))).toHaveLength(0);
    }
    const hub = new ConversationStreamHub();
    hub.publishAgentTodo('c1', list(100));
    hub.publishStep('c1', stepRow('c1', 'claimed'));
    expect(todoFrames(subscribeFresh(hub, 'c1'))).toHaveLength(1);
  });

  test('clearConversationBuffer (rewind channel) also clears the list slot', () => {
    const hub = new ConversationStreamHub();
    hub.publishAgentTodo('c1', list(100));
    hub.clearConversationBuffer('c1');
    expect(todoFrames(subscribeFresh(hub, 'c1'))).toHaveLength(0);
  });

  test('cross-session isolation -- A list does not enter B catch-up or live stream', () => {
    const hub = new ConversationStreamHub();
    hub.publishAgentTodo('cA', list(100));
    const b = subscribeFresh(hub, 'cB');
    expect(todoFrames(b)).toHaveLength(0);
    hub.publishAgentTodo('cA', list(200));
    expect(todoFrames(b)).toHaveLength(0);
  });

  test('buffer session-count cap evicts the list single slot by the same law (unbounded-memory defense)', () => {
    const hub = new ConversationStreamHub();
    for (let i = 0; i <= CONV_TEXT_BUFFER_MAX_CONVS; i++) {
      hub.publishAgentTodo(`c${i}`, list(i));
    }
    expect(todoFrames(subscribeFresh(hub, 'c0'))).toHaveLength(0);
    expect(todoFrames(subscribeFresh(hub, `c${CONV_TEXT_BUFFER_MAX_CONVS}`))).toHaveLength(1);
  });
});
