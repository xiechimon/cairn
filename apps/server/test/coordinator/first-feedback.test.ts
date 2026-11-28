import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { seedMessages, seedMessageText } from '../../src/coordinator/runtime/seed.js';
import { chiefMessage, notification, step } from '../../src/db/schema.js';
import { COORDINATOR_SYSTEM_PROMPT, enqueueChiefStep } from '../../src/services/chief.js';
import { executeChiefTool } from '../../src/services/chief-tools.js';
import { withdrawChiefMessage } from '../../src/services/chief-turns.js';
import { setCoordinatorWake } from '../../src/services/coordinator-context.js';
import {
  createFirstFeedbackGuard,
  FIRST_FEEDBACK_DELAY_MS,
  type FirstFeedbackGuard,
  firstFeedback,
  firstFeedbackLine,
} from '../../src/services/first-feedback.js';
import { setImRuntime } from '../../src/services/im/runtime.js';
import { req } from '../helpers.js';
import { boot, stub, world } from './runner-world.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | undefined | null, timeoutMs = 4_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value !== undefined && value !== null) return value;
    await sleep(20);
  }
  throw new Error('timed out waiting for condition');
}

function ackRows(db: Awaited<ReturnType<typeof world>>['s']['db'], threadId: string) {
  return db
    .select()
    .from(chiefMessage)
    .all()
    .filter(
      (row) =>
        row.threadId === threadId &&
        typeof row.content === 'string' &&
        row.content.includes('"chief_ack"'),
    );
}

function lastUserRow(db: Awaited<ReturnType<typeof world>>['s']['db'], threadId: string) {
  return db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .all()
    .filter((row) => row.role === 'user')
    .at(-1);
}

function manualGuard(): { guard: FirstFeedbackGuard; advance(ms: number): void } {
  let now = 0;
  const timers: { at: number; fire: () => void }[] = [];
  const guard = createFirstFeedbackGuard({
    delayMs: FIRST_FEEDBACK_DELAY_MS,
    now: () => now,
    schedule: (fire, ms) => {
      const entry = { at: now + ms, fire };
      timers.push(entry);
      return () => {
        const index = timers.indexOf(entry);
        if (index >= 0) timers.splice(index, 1);
      };
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const entry of [...timers].sort((a, b) => a.at - b.at)) {
      if (entry.at > now) continue;
      const index = timers.indexOf(entry);
      if (index >= 0) timers.splice(index, 1);
      entry.fire();
    }
  };
  return { guard, advance };
}

afterEach(() => {
  setImRuntime(null);
  firstFeedback.reset();
});

describe('the runtime writes the first line from the request, in the user’s words', () => {
  it('names a question, a request and an interjection differently, in the message’s own script', () => {
    expect(firstFeedbackLine('帮我看一下 README 里写了什么？', 'turn')).toBe(
      '我先核对「帮我看一下 README 里写了什么」。',
    );
    expect(firstFeedbackLine('把这份方案改成三段', 'turn')).toBe(
      '收到，我来处理「把这份方案改成三段」。',
    );
    expect(firstFeedbackLine('你听到我刚才那句了吗？', 'steer')).toBe(
      '收到你这条：「你听到我刚才那句了吗」。',
    );
    expect(firstFeedbackLine('Can you check the build log?', 'turn')).toBe(
      'Let me check “Can you check the build log”.',
    );
    expect(firstFeedbackLine('Rewrite the summary in three paragraphs', 'turn')).toBe(
      'On it — “Rewrite the summary in three…”.',
    );
    expect(firstFeedbackLine('Did you hear what I said?', 'steer')).toBe(
      'Got it — “Did you hear what I said”.',
    );
  });

  it('never invents a result and never answers the request it acknowledges', () => {
    for (const text of ['帮我查一下部署状态', 'fix the failing test', 'B 影响了吗？']) {
      const line = firstFeedbackLine(text, 'turn');
      expect(line).not.toBeNull();
      expect(line).not.toMatch(/完成|已|成功|失败|结果|done|finished|passed|failed|merged/);
    }
  });

  it('stays silent for a bare greeting, thanks or emoji, and still speaks when a request follows', () => {
    expect(firstFeedbackLine('你好', 'turn')).toBeNull();
    expect(firstFeedbackLine('在吗？', 'turn')).toBeNull();
    expect(firstFeedbackLine('谢谢！', 'turn')).toBeNull();
    expect(firstFeedbackLine('thanks', 'turn')).toBeNull();
    expect(firstFeedbackLine('👍', 'turn')).toBeNull();
    expect(firstFeedbackLine('哈哈哈哈哈', 'turn')).toBeNull();
    expect(firstFeedbackLine('👌🙏😂', 'turn')).toBeNull();
    expect(firstFeedbackLine('好', 'turn')).toBeNull();
    expect(firstFeedbackLine('没问题', 'turn')).toBeNull();
    expect(firstFeedbackLine('yes', 'turn')).toBeNull();
    expect(firstFeedbackLine('好的，那你帮我看下 README', 'turn')).not.toBeNull();
    expect(firstFeedbackLine('嗯，帮我把这段改短一点', 'turn')).not.toBeNull();
  });

  it('flattens a long, noisy message to one short quoted line without fences, links or attachments', () => {
    const line = firstFeedbackLine(
      '请你看一下 ```ts\nconst a = 1;\n```\n然后 ![截图](attachment:att-1) 对比\n\n# 第二段 https://example.com/a 里的数字',
      'turn',
    );
    expect(line).not.toBeNull();
    expect(line!.length).toBeLessThan(45);
    expect(line).not.toContain('```');
    expect(line).not.toContain('attachment:');
    expect(line).not.toContain('\n');
    expect(line!.split('。').length).toBe(2);
  });

  it('cuts between whole characters even when an emoji sits on the boundary', () => {
    const line = firstFeedbackLine(`${'👍'.repeat(30)} tail`, 'turn');
    expect(line).not.toBeNull();
    expect(line).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });
});

describe('the guard fires once, is cancelled by real output, and merges a burst', () => {
  it('publishes the line at its deadline and clears the pending ack', () => {
    const { guard, advance } = manualGuard();
    const published: string[] = [];
    guard.arm('t-1', {
      messageId: 'm-1',
      text: '帮我看一下 README',
      steered: false,
      publish: (line) => published.push(line),
    });
    expect(guard.pending('t-1')).toBeDefined();
    advance(FIRST_FEEDBACK_DELAY_MS - 1);
    expect(published).toEqual([]);
    advance(1);
    expect(published).toEqual(['收到，我来处理「帮我看一下 README」。']);
    expect(guard.pending('t-1')).toBeUndefined();
  });

  it('publishes nothing once the model has spoken before the deadline', () => {
    const { guard, advance } = manualGuard();
    const published: string[] = [];
    guard.arm('t-2', {
      messageId: 'm-2',
      text: '帮我看一下 README',
      steered: false,
      publish: (line) => published.push(line),
    });
    guard.settle('t-2');
    advance(FIRST_FEEDBACK_DELAY_MS * 2);
    expect(published).toEqual([]);
  });

  it('answers a burst with one line that names the latest message at the earliest deadline', () => {
    const { guard, advance } = manualGuard();
    const published: string[] = [];
    guard.arm('t-3', {
      messageId: 'm-3a',
      text: '帮我看一下 README',
      steered: false,
      publish: (line) => published.push(`a:${line}`),
    });
    advance(400);
    guard.arm('t-3', {
      messageId: 'm-3b',
      text: '把这份方案改成三段',
      steered: false,
      publish: (line) => published.push(`b:${line}`),
    });
    expect(guard.pending('t-3')?.deadlineAt).toBe(FIRST_FEEDBACK_DELAY_MS);
    advance(FIRST_FEEDBACK_DELAY_MS - 400);
    expect(published).toEqual(['b:收到，我来处理「把这份方案改成三段」。']);
  });

  it('keeps an interjection line while the response it interrupted is still streaming', () => {
    const { guard, advance } = manualGuard();
    const published: string[] = [];
    guard.noteResponse('t-5');
    advance(100);
    guard.arm('t-5', {
      messageId: 'm-5',
      text: '你听到我刚才那句了吗？',
      steered: true,
      publish: (line) => published.push(line),
    });
    advance(200);
    guard.settleBeforeResponse('t-5');
    expect(guard.pending('t-5')?.messageId).toBe('m-5');
    guard.noteResponse('t-5');
    guard.settleBeforeResponse('t-5');
    expect(guard.pending('t-5')).toBeUndefined();
    advance(FIRST_FEEDBACK_DELAY_MS);
    expect(published).toEqual([]);
  });

  it('keeps a queued message’s line when the earlier turn ends first', () => {
    const { guard, advance } = manualGuard();
    guard.noteResponse('t-6');
    advance(100);
    guard.arm('t-6', {
      messageId: 'm-6',
      text: '顺便看一下日志',
      steered: false,
      publish: () => {},
    });
    advance(100);
    guard.settleBeforeResponse('t-6');
    expect(guard.pending('t-6')?.messageId).toBe('m-6');
    guard.noteResponse('t-6');
    guard.settleBeforeResponse('t-6');
    expect(guard.pending('t-6')).toBeUndefined();
  });

  it('moves a burst line to the latest message so an older answer cannot clear it', () => {
    const { guard, advance } = manualGuard();
    guard.noteResponse('t-7');
    advance(100);
    guard.arm('t-7', {
      messageId: 'm-7a',
      text: '帮我看一下 README',
      steered: false,
      publish: () => {},
    });
    advance(100);
    guard.arm('t-7', {
      messageId: 'm-7b',
      text: '顺便看一下日志',
      steered: false,
      publish: () => {},
    });
    expect(guard.pending('t-7')?.deadlineAt).toBe(FIRST_FEEDBACK_DELAY_MS + 100);
    advance(100);
    guard.settleBeforeResponse('t-7');
    expect(guard.pending('t-7')?.messageId).toBe('m-7b');
  });

  it('arms a fresh ack for an interjection once the previous one already fired', () => {
    const { guard, advance } = manualGuard();
    const published: string[] = [];
    guard.arm('t-4', {
      messageId: 'm-4a',
      text: '帮我看一下 README',
      steered: false,
      publish: (line) => published.push(line),
    });
    advance(FIRST_FEEDBACK_DELAY_MS);
    guard.arm('t-4', {
      messageId: 'm-4b',
      text: '你听到我刚才那句了吗？',
      steered: true,
      publish: (line) => published.push(line),
    });
    advance(FIRST_FEEDBACK_DELAY_MS);
    expect(published).toEqual([
      '收到，我来处理「帮我看一下 README」。',
      '收到你这条：「你听到我刚才那句了吗」。',
    ]);
  });
});

describe('admission writes one visible line into the thread', () => {
  it('posts the line as a system ack row on the hub, with no banner and no IM relay', async () => {
    const imCalls: { threadId: string; text: string }[] = [];
    setImRuntime({
      assertQuestionFits: () => {},
      notice: (threadId, text) => imCalls.push({ threadId, text }),
      turnFinished: () => {},
    });
    const w = await world('帮我看一下 README 里写了什么？');
    const frames: object[] = [];
    const stop = w.s.convHub.subscribe(w.threadId, {
      nextSeq: () => 1,
      send: async (payload) => {
        frames.push(payload);
      },
    });
    const startedAt = Date.now();
    const row = await waitFor(() => ackRows(w.s.db, w.threadId)[0]);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(row.role).toBe('system');
    expect(row.id).toBe(`ack-${lastUserRow(w.s.db, w.threadId)?.id}`);
    const content = JSON.parse(String(row.content)) as { kind: string; message: string };
    expect(content.kind).toBe('chief_ack');
    expect(content.message).toBe('我先核对「帮我看一下 README 里写了什么」。');
    expect(frames.some((frame) => JSON.stringify(frame).includes('chief_ack'))).toBe(true);
    expect(w.s.db.select().from(notification).all()).toHaveLength(0);
    expect(imCalls).toEqual([]);
    stop();
  });

  it('stays silent when assistant text for this thread is already stored', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    const sent = lastUserRow(w.s.db, w.threadId)!;
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'answer-before-the-deadline',
        threadId: w.threadId,
        role: 'assistant',
        content: JSON.stringify([{ type: 'text', text: 'README 里写的是用法。' }]),
        createdAt: sent.createdAt + 1,
      })
      .run();
    await sleep(FIRST_FEEDBACK_DELAY_MS + 400);
    expect(ackRows(w.s.db, w.threadId)).toHaveLength(0);
  });

  it('writes no line when the user withdraws the message before the deadline', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    const sent = lastUserRow(w.s.db, w.threadId)!;
    await expect(
      withdrawChiefMessage({ db: w.s.db, convHub: w.s.convHub }, w.teamId, w.threadId, sent.id),
    ).resolves.toEqual({ ok: true });
    expect(firstFeedback.pending(w.threadId)).toBeUndefined();
    expect(ackRows(w.s.db, w.threadId)).toHaveLength(0);
  });

  it('writes no line when a turn ends without visible text', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    const { faux } = stub('');
    const c = boot(w, faux);
    c.wake(w.threadId);
    await c.idle();
    expect(firstFeedback.pending(w.threadId)).toBeUndefined();
    expect(ackRows(w.s.db, w.threadId)).toHaveLength(0);
  });

  it('writes no line when notify_user already put a visible row in the thread', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    await executeChiefTool(
      {
        db: w.s.db,
        hub: w.s.hub,
        box: w.s.secretBox,
        user: w.s.user,
        convHub: w.s.convHub,
        reposDir: w.s.reposDir,
        attachmentsDir: w.s.attachmentsDir,
        skillsDir: w.s.skillsDir,
      },
      {
        teamId: w.teamId,
        userId: w.s.user.id,
        chiefId: 'chief-1',
        threadId: w.threadId,
        chiefAgentId: null,
        conversationId: w.threadId,
        toolCallId: 'tc-notify',
        turnPrompt: '帮我看一下 README 里写了什么？',
      },
      'notify_user',
      { message: '正在核对 README' },
    );
    expect(firstFeedback.pending(w.threadId)).toBeUndefined();
    expect(ackRows(w.s.db, w.threadId)).toHaveLength(0);
  });

  it('writes no line when ask_user already put a question card in the thread', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    await executeChiefTool(
      {
        db: w.s.db,
        hub: w.s.hub,
        box: w.s.secretBox,
        user: w.s.user,
        vapidKeys: w.s.vapidKeys,
        convHub: w.s.convHub,
        reposDir: w.s.reposDir,
        attachmentsDir: w.s.attachmentsDir,
        skillsDir: w.s.skillsDir,
      },
      {
        teamId: w.teamId,
        userId: w.s.user.id,
        chiefId: 'chief-1',
        threadId: w.threadId,
        chiefAgentId: null,
        conversationId: w.threadId,
        toolCallId: 'tc-ask',
        turnPrompt: '帮我看一下 README 里写了什么？',
      },
      'ask_user',
      { question: '看哪个分支？' },
    );
    expect(firstFeedback.pending(w.threadId)).toBeUndefined();
    expect(ackRows(w.s.db, w.threadId)).toHaveLength(0);
  });

  it('never arms a thanks message', async () => {
    const w = await world('谢谢！');
    expect(firstFeedback.pending(w.threadId)).toBeUndefined();
    expect(ackRows(w.s.db, w.threadId)).toHaveLength(0);
  });

  it('writes no line when the model’s own text streams first', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    const { faux } = stub('README 里写的是用法。');
    const c = boot(w, faux, { stopPollMs: 60_000 });
    setCoordinatorWake((threadId) => c.wake(threadId));
    c.wake(w.threadId);
    await c.idle();
    expect(
      w.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.role, 'assistant'))
        .all()
        .some((row) => JSON.stringify(row.content).includes('README')),
    ).toBe(true);
    expect(firstFeedback.pending(w.threadId)).toBeUndefined();
    expect(ackRows(w.s.db, w.threadId)).toHaveLength(0);
  });

  it('arms the interjection line when a second composer message really steers the running turn', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    w.s.db
      .update(step)
      .set({ status: 'claimed', machineId: null })
      .where(eq(step.id, w.stepId))
      .run();
    const posted = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: '你听到我刚才那句了吗？',
    });
    expect(posted.status).toBe(201);
    const row = await waitFor(() => ackRows(w.s.db, w.threadId)[0]);
    const content = JSON.parse(String(row.content)) as { message: string };
    expect(content.message).toBe('收到你这条：「你听到我刚才那句了吗」。');
  });
});

describe('the runtime line stays out of the model and off non-composer paths', () => {
  it('keeps a chief_ack row out of the seed and the transcript text', () => {
    const ack = {
      id: 'ack-m-1',
      role: 'system',
      content: JSON.stringify({
        kind: 'chief_ack',
        message: '我先核对「部署状态」。',
        provenance: 'user',
      }),
      createdAt: 1,
    };
    expect(seedMessageText(ack)).toBeNull();
    expect(seedMessages([ack])).toEqual([]);
  });

  it('never arms for the greeting step path', async () => {
    const w = await world('帮我看一下 README 里写了什么？');
    firstFeedback.settle(w.threadId);
    expect(
      enqueueChiefStep(
        { db: w.s.db, hub: w.s.hub, user: w.s.user, convHub: w.s.convHub },
        w.threadId,
        { prompt: 'channel greeting', trigger: 'user', ownerMessageIds: [] },
      ),
    ).toBeDefined();
    expect(firstFeedback.pending(w.threadId)).toBeUndefined();
  });
});

describe('the prompt hands first feedback to the runtime', () => {
  it('no longer asks the model for an acknowledgement before its first tool call', () => {
    expect(COORDINATOR_SYSTEM_PROMPT).not.toMatch(/ALWAYS start your very first model response/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/brief, natural acknowledgement/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/receipt line/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/interjection|newly arrived user message/i);
  });
});
