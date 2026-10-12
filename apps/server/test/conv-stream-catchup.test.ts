// #740 conversation stream 中途进场补发：hub 在飞回合文本缓冲 + subscribe
// 快照补发。票面失败方式清单（先固化，代码是让场景通过的手段）：
// ① 双份文本（服务半）：补发必须是「当前段快照」而非叠加——镜像 web
//    liveTextStore 的收敛律（message 行落库即清），否则补发 + 客户端既有
//    缓冲双份（客户端半见 apps/web/test/sse-conversation-stream.test.ts）。
// ② 陈旧缓冲跨回合：message 行（任意角色，含用户行开新回合）/ step 终态
//    （done/failed/stopped）/ rewind——三个清空点逐一钉；终态缺失的死回合
//    由下一回合的用户行兜底清。
// ③ 无界内存：per-conv 字节上限（保尾弃头）+ 缓冲会话数上限（LRU 驱逐）。
// ④ 多订阅者：先后进场各自补发一次，互不串扰、不重复。
// ⑤ 跨会话隔离：补发按 conversationId 键控，A 会话缓冲不进 B 会话流
//    （鉴权面不变——stream 端点既有门禁覆盖，补发不新增读路径）。
// ⑥ wire 形状：补发就是一条既有 text_delta 事件（四事件词表零变更），
//    逐帧过 shared conversationStreamEventSchema；回合终局后新订阅零补发。
// live 栈中途进场实测（第二客户端见前缀）归 docs/verify/740/ 证据面。

import type { ConversationStepEvent, TranscriptRow } from '@pacman/shared';
import { conversationStreamEventSchema } from '@pacman/shared';
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

// —— hub 单元面：替身连接直接驱动 ————————————————————————————————————

/** 收帧替身：subscribe 补发与 live 发布都落 frames。 */
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

describe('hub 缓冲：进场补发与接缝（#740 失败方式 ①⑥）', () => {
  test('零订阅期流掉的增量在 subscribe 时一次性补齐，随后增量照常', () => {
    const hub = new ConversationStreamHub();
    // 回合在飞、无人订阅（#640「开始任务」→ toast → 抽屉未开的真实形态）。
    hub.publishTextDelta('c1', '正在');
    hub.publishTextDelta('c1', '分析仓库');
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    // 补发 = 一条 text_delta，内容 = 已流出文本的精确拼接（不重不断）。
    expect(textFrames(conn)).toEqual(['正在分析仓库']);
    // 接缝：补发之后 live 增量继续打字。
    hub.publishTextDelta('c1', '结构');
    expect(textFrames(conn)).toEqual(['正在分析仓库', '结构']);
  });

  test('补发帧过 shared 词表 schema（wire 零变更）', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '前缀');
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    const replay = conn.frames.find((f) => (f as { type: string }).type === 'text_delta');
    expect(replay).toBeDefined();
    expect(conversationStreamEventSchema.parse(replay)).toBeTruthy();
  });

  test('空缓冲零补发', () => {
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

describe('hub 缓冲：清空点（#740 失败方式 ②）', () => {
  test('清空点（#955 段界律）：文本行 / 用户行清，工具行与仅思考行不清', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '段一');
    // assistant 文本行 = 段界。
    hub.publishMessage('c1', {
      id: 'm1',
      role: 'assistant',
      content: [{ type: 'text', text: '终稿' }],
      createdAt: 1,
    } as unknown as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
    // live 工具行**不清**（#955 D7）：它带 500ms/2000ms 重试链、可能迟到，
    // 一次迟到就把正在流的下一段抹掉——这正是旧律（任何行都清）的病灶。
    hub.publishTextDelta('c1', '段二');
    hub.publishMessage('c1', {
      id: 'm2',
      role: 'assistant',
      content: { kind: 'toolcall', call: { name: 'bash' } },
      createdAt: 2,
    } as unknown as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段二']);
    // 仅思考段行**不清**：思考内容从不进文本缓冲，清它只会误伤同窗的正文。
    hub.publishMessage('c1', {
      id: 'm2b',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '想一下' }],
      createdAt: 3,
    } as unknown as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段二']);
    // 用户行（新回合开始 / steer）照旧清：死回合残段不得补进新回合开头。
    hub.publishTextDelta('c1', '段三');
    hub.publishMessage('c1', {
      id: 'm3',
      role: 'user',
      content: '再来',
      createdAt: 4,
    } as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
  });

  test('step 终态清空（done/failed/stopped）；claimed 不清', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '段');
    hub.publishStep('c1', stepRow('c1', 'claimed'));
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段']);
    for (const status of ['done', 'failed', 'stopped'] as const) {
      hub.publishTextDelta('c1', '段');
      hub.publishStep('c1', stepRow('c1', status));
      // 断言不带定制消息（toEqual 单参律）；status 覆盖面由循环本身保证。
      expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
    }
  });

  test('终态缺失的死回合：下一回合用户行进场即清（跨回合陈旧兜底）', () => {
    const hub = new ConversationStreamHub();
    // daemon 死亡形态：增量后无 done、无终稿上传。
    hub.publishTextDelta('c1', '死回合残段');
    hub.publishMessage('c1', {
      id: 'm9',
      role: 'user',
      content: '新回合',
      createdAt: 9,
    } as TranscriptRow);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
  });

  test('clearConversationBuffer（rewind 通道）：显式清空后零补发', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('c1', '残段');
    hub.clearConversationBuffer('c1');
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual([]);
  });
});

describe('hub 缓冲：边界（#740 失败方式 ③④⑤）', () => {
  test('字节上限保尾弃头：超限段补发 = 上限内的最长尾部后缀', () => {
    const hub = new ConversationStreamHub();
    const head = 'a'.repeat(64 * 1024);
    const tail = '尾部'.repeat(48 * 1024); // CJK 3B/char → 约 144KiB，总段超上限
    hub.publishTextDelta('c1', head + tail);
    const conn = new FakeConn();
    hub.subscribe('c1', conn);
    const [replay] = textFrames(conn);
    expect(replay).toBeDefined();
    expect(Buffer.byteLength(replay!)).toBeLessThanOrEqual(CONV_TEXT_BUFFER_MAX_BYTES);
    // 保尾：补发内容 = 原文的尾后缀（无中段拼接、无代理对劈裂——用尾锚对账）。
    expect((head + tail).endsWith(replay!)).toBe(true);
    expect(replay!.length).toBeGreaterThan(0);
  });

  test('缓冲会话数上限：第 N+1 个会话进场驱逐最旧缓冲', () => {
    const hub = new ConversationStreamHub();
    for (let i = 0; i < CONV_TEXT_BUFFER_MAX_CONVS; i++) hub.publishTextDelta(`c${i}`, `段${i}`);
    hub.publishTextDelta('c-new', '新段');
    expect(textFrames(subscribeFresh(hub, 'c0'))).toEqual([]);
    expect(textFrames(subscribeFresh(hub, 'c1'))).toEqual(['段1']);
    expect(textFrames(subscribeFresh(hub, 'c-new'))).toEqual(['新段']);
  });

  test('多订阅者：先后进场各自补发一次，互不串扰', () => {
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

  test('跨会话隔离：A 会话缓冲不进 B 会话流', () => {
    const hub = new ConversationStreamHub();
    hub.publishTextDelta('cA', 'A 的段');
    expect(textFrames(subscribeFresh(hub, 'cB'))).toEqual([]);
  });
});

// —— chief wire 面：真路由 + 机器 API 驱动 ————————————————————————————

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

/** chief 线程就位 + 机器已 claim（m4a 同款引导裁剪）。 */
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

/** 收集流上短时间内到达的全部帧（证明性读取，非阻塞等待）。 */
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

describe('chief wire 面：中途进场补发（#740 票面症状路径）', () => {
  test('零订阅期 delta → 开流即一条补发 text_delta → 实时照常 → done 后新流零补发', async () => {
    const { s, token, threadId, stepId } = await setupChief({ pingIntervalMs: 50 });
    try {
      // 回合在飞、无人订阅：增量直接流掉（症状原态）。
      await delta(s.app, token, stepId, '正在');
      await delta(s.app, token, stepId, '梳理需求');
      // 观众进场（点 toast「查看会话」开抽屉 = 订阅建立）。
      const stream = await openConvStream(s.app, threadId);
      try {
        const replay = await stream.next((ev) => ev.type === 'text_delta');
        expect(conversationStreamEventSchema.parse(replay)).toBeTruthy();
        expect((replay as { text: string }).text).toBe('正在梳理需求');
        // 接缝：进场后 live 增量继续实时到达。
        await delta(s.app, token, stepId, '，随后动笔');
        const live = await stream.next(
          (ev) => ev.type === 'text_delta' && (ev as { text: string }).text === '，随后动笔',
        );
        expect(conversationStreamEventSchema.parse(live)).toBeTruthy();
      } finally {
        stream.close();
      }
      // 回合终局（step done）→ 缓冲清空：新流零补发。
      const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { status: 'success' },
      });
      expect(doneRes.status).toBe(200);
      const after = await openConvStream(s.app, threadId);
      try {
        // 收两帧 ping（~100ms）证明流活着，随后短窗收帧证无 text_delta 补发。
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

  test('rewind 清缓冲（服务层防御清空点）：显式清空后新流零补发', async () => {
    const { s, threadId, anchorMessageId, stepId, token } = await setupChief({
      pingIntervalMs: 50,
    });
    try {
      // 回合正常收尾（rewind 门 = activeRun 空）。
      const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { status: 'success' },
      });
      expect(doneRes.status).toBe(200);
      // 状态失步形态（rewind 防御清的目标态）：缓冲带残段。
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

// —— #905 活动相位：单槽补发、终态清空、跨会话隔离 ————————————————
// 失败方式（先固化）：
//   A1 进场无补发：断线重连/换页后活行退回「处理中…」黑盒，直到下一次相位
//      变化才有信号——subscribe 必须补发最后一份 activity。
//   A2 死相位复活：步终局（done/failed/stopped）或 rewind 后，新订阅仍补发
//      「思考中」——终态清空点必须覆盖 activity 单槽（与文本缓冲同律）。
//   A3 陈旧叠加：单槽语义——连续多份 activity 只补发最后一份，不回放历史。
//   A4 跨会话串扰：A 会话的相位不进 B 会话补发。
//   A5 wire 词表：activity 帧逐帧过 shared conversationStreamEventSchema。

describe('hub 活动相位（#905）', () => {
  const act = (phase: 'thinking' | 'tool' | 'responding', at: number, extra?: object) =>
    ({ stepId: 'step-1', at, phase, ...extra }) as import('@pacman/shared').StepActivity;

  function activityFrames(conn: FakeConn): unknown[] {
    return conn.frames.filter((f) => (f as { type: string }).type === 'activity');
  }

  test('A1/A3/A5: 零订阅期多份 activity → 进场只补发最后一份，帧过词表', () => {
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
    // 补发之后 live 相位照常直达。
    hub.publishActivity('c1', act('responding', 300));
    expect(activityFrames(conn)).toHaveLength(2);
  });

  test('A2: step 终态（done/failed/stopped）清 activity；claimed 不清', () => {
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

  test('A2: clearConversationBuffer（rewind 通道）同清 activity', () => {
    const hub = new ConversationStreamHub();
    hub.publishActivity('c1', act('thinking', 100));
    hub.clearConversationBuffer('c1');
    expect(activityFrames(subscribeFresh(hub, 'c1'))).toHaveLength(0);
  });

  test('A4: 跨会话隔离——A 的相位不进 B 的补发与 live 流', () => {
    const hub = new ConversationStreamHub();
    hub.publishActivity('cA', act('thinking', 100));
    const b = subscribeFresh(hub, 'cB');
    expect(activityFrames(b)).toHaveLength(0);
    hub.publishActivity('cA', act('tool', 200, { tool: 'read' }));
    expect(activityFrames(b)).toHaveLength(0);
  });

  test('缓冲会话数上限同律驱逐 activity 单槽（无界内存防御）', () => {
    const hub = new ConversationStreamHub();
    for (let i = 0; i <= CONV_TEXT_BUFFER_MAX_CONVS; i++) {
      hub.publishActivity(`c${i}`, act('thinking', i));
    }
    // 最旧会话（c0）被驱逐：进场零补发；最新会话仍在。
    expect(activityFrames(subscribeFresh(hub, 'c0'))).toHaveLength(0);
    expect(activityFrames(subscribeFresh(hub, `c${CONV_TEXT_BUFFER_MAX_CONVS}`))).toHaveLength(1);
  });
});
