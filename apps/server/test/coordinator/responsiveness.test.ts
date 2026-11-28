import {
  CHIEF_MESSAGE_READ,
  CHIEF_REMOTE_TOOLS,
  CHIEF_TOOL_COUNT,
  SUBAGENT_TIMEOUT_DEFAULT_SEC,
  SUBAGENT_TIMEOUT_MAX_SEC,
  SUBAGENT_TOOL_DEF,
} from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Model,
  type Context as ModelContext,
  type Provider,
  type ToolResultMessage,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import { coordinatorToolsExtension, createStepGate } from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import { chiefMessage, notification } from '../../src/db/schema.js';
import { COORDINATOR_SYSTEM_PROMPT, enqueueChiefStep } from '../../src/services/chief.js';
import { executeChiefTool } from '../../src/services/chief-tools.js';
import { setCoordinatorWake } from '../../src/services/coordinator-context.js';
import { setImRuntime } from '../../src/services/im/runtime.js';
import { req } from '../helpers.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';
import { boot, world } from './runner-world.js';

interface RecordedRequest {
  index: number;
  receivedAt: number;
  messages: ModelContext['messages'];
  abortedAt: number | null;
}

type Handler = (
  ctx: ModelContext,
  model: Model<never>,
  options: { signal?: AbortSignal } | undefined,
  rec: RecordedRequest,
) => ReturnType<Provider['streamSimple']>;

function makeStreamingProvider(handlers: Handler[]) {
  const base = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  const requests: RecordedRequest[] = [];
  let callIndex = 0;
  const provider: Provider = {
    ...base.provider,
    streamSimple(model, context, options) {
      if (context.messages[0]?.content === SUGGEST_REPLIES_ASK) {
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          ...fauxAssistantMessage('{"replies":[]}'),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
        return stream;
      }
      const index = callIndex++;
      const rec: RecordedRequest = {
        index,
        receivedAt: Date.now(),
        messages: structuredClone(context.messages),
        abortedAt: null,
      };
      requests.push(rec);
      const handler = handlers[index];
      if (handler === undefined) {
        throw new Error(`Unexpected model request #${index}`);
      }
      return handler(context, model as Model<never>, options, rec);
    },
  };
  return { base, provider, requests };
}

function slowTextStream(
  model: Model<never>,
  chunks: string[],
  delayMs: number,
  options: { signal?: AbortSignal } | undefined,
  rec: RecordedRequest,
  onFirstChunk?: () => void,
) {
  const stream = createAssistantMessageEventStream();
  let accumulated = '';
  const buildMessage = (stopReason: AssistantMessage['stopReason']): AssistantMessage => ({
    ...fauxAssistantMessage(accumulated, { stopReason }),
    api: model.api,
    provider: model.provider,
    model: model.id,
  });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let finished = false;
  const finishAbort = () => {
    if (finished) return;
    finished = true;
    rec.abortedAt = Date.now();
    for (const t of timers) clearTimeout(t);
    const msg = buildMessage('aborted');
    stream.push({ type: 'error', reason: 'aborted', error: msg });
    stream.end(msg);
  };
  if (options?.signal?.aborted) {
    queueMicrotask(finishAbort);
    return stream;
  }
  options?.signal?.addEventListener('abort', finishAbort, { once: true });
  chunks.forEach((chunk, i) => {
    timers.push(
      setTimeout(
        () => {
          if (finished) return;
          if (i === 0) {
            const opening = buildMessage('stop');
            stream.push({ type: 'start', partial: opening });
            stream.push({ type: 'text_start', contentIndex: 0, partial: opening });
          }
          accumulated += chunk;
          const partial = buildMessage('stop');
          stream.push({ type: 'text_delta', contentIndex: 0, delta: chunk, partial });
          if (i === 0) onFirstChunk?.();
          if (i === chunks.length - 1) {
            timers.push(
              setTimeout(() => {
                if (finished) return;
                finished = true;
                const finalMsg = buildMessage('stop');
                stream.push({
                  type: 'text_end',
                  contentIndex: 0,
                  content: accumulated,
                  partial: finalMsg,
                });
                stream.push({ type: 'done', reason: 'stop', message: finalMsg });
                stream.end(finalMsg);
              }, delayMs),
            );
          }
        },
        i === 0 ? 15 : 15 + i * delayMs,
      ),
    );
  });
  return stream;
}

function instantStream(model: Model<never>, message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  const stamped: AssistantMessage = {
    ...message,
    api: model.api,
    provider: model.provider,
    model: model.id,
  };
  stream.push({ type: 'done', reason: stamped.stopReason as 'stop', message: stamped });
  stream.end(stamped);
  return stream;
}

async function waitFor<T>(fn: () => T | undefined | null, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = fn();
    if (val !== undefined && val !== null) return val;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Timed out waiting for condition');
}

function noticeRows(db: Awaited<ReturnType<typeof world>>['s']['db'], threadId: string) {
  return db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .all()
    .filter((row) => typeof row.content === 'string' && row.content.includes('"chief_notice"'));
}

afterEach(() => {
  setImRuntime(null);
  vi.restoreAllMocks();
});

describe('Coordinator responsiveness contracts, prompt, tools, mirror, and runtime middleware', () => {
  it('lowers SUBAGENT_TIMEOUT_DEFAULT_SEC to 30 while preserving explicit max 300 and tool parity', () => {
    expect(SUBAGENT_TIMEOUT_DEFAULT_SEC).toBe(30);
    expect(SUBAGENT_TIMEOUT_MAX_SEC).toBe(300);
    expect(CHIEF_TOOL_COUNT).toBe(47);
    expect(CHIEF_REMOTE_TOOLS).toHaveLength(CHIEF_TOOL_COUNT);

    const notifyDef = CHIEF_REMOTE_TOOLS.find((t) => t.name === 'notify_user');
    expect(notifyDef?.description).toMatch(/user turn/i);
    expect(notifyDef?.description).toMatch(/omit.*provenance|without.*provenance/i);
    expect(notifyDef?.description).toMatch(/\[wake:/i);

    const timeoutDesc = (
      SUBAGENT_TOOL_DEF.parameters as {
        properties?: { timeoutSec?: { description?: string } };
      }
    )?.properties?.timeoutSec?.description;
    expect(timeoutDesc).toContain('default 30');
    expect(timeoutDesc).toContain('300');
  });

  it('updates COORDINATOR_SYSTEM_PROMPT for ack-first, ~30s delegation keeping inline host file jobs, and all interjection intents', () => {
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/consecutive user messages/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/corrects or replaces/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/acknowledge|short acknowledgement/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/notify_user/);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/~?30\s*s|30 seconds/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/cancel|replace|side question/i);
    expect(COORDINATOR_SYSTEM_PROMPT).toMatch(/user_computer_shell|attach_file/);
  });

  it('defaults reversible choices and uses Cairn schedules for recurring briefs', () => {
    const asking = COORDINATOR_SYSTEM_PROMPT.match(/<asking>([\s\S]*?)<\/asking>/)?.[1] ?? '';
    const tools = COORDINATOR_SYSTEM_PROMPT.match(/<tools>([\s\S]*?)<\/tools>/)?.[1] ?? '';

    expect(asking).toMatch(/choose and state a reasonable, reversible default/i);
    expect(asking).toMatch(/project references first/i);
    expect(asking).toMatch(/well-known context-appropriate choices/i);
    expect(asking).toMatch(/do not ask for a competitor list just because/i);
    expect(asking).toMatch(/need itself is ambiguous/i);
    expect(asking).toMatch(/spend money.*credentials.*irreversible.*other people/i);
    expect(tools).toMatch(/recurring requests.*Cairn's schedule_todo.*deferred.*tool_search/i);
    expect(tools).toMatch(/recurring brief or research.*current Coordinator thread/i);
    expect(tools).toMatch(/not in a separate task or in a provider's scheduler/i);
    expect(tools).toMatch(/a provider's own scheduler is not cairn/i);
    expect(tools).toMatch(/never create one even when the provider's skill or toolset offers it/i);
    expect(tools).toMatch(/defaults you chose in the scheduled instructions/i);
    expect(tools).toMatch(/confirm.*only after Cairn returns the schedule record/i);
  });

  it('notify_user in user turns dedupes by toolCallId and relays to IM without desktop notification banners while keeping event-turn provenance and legacy fallback', async () => {
    const w = await world('查一下');
    const imCalls: { threadId: string; text: string }[] = [];
    setImRuntime({
      assertQuestionFits: () => {},
      notice: (threadId, text) => imCalls.push({ threadId, text }),
      turnFinished: () => {},
    });

    const deps = {
      db: w.s.db,
      hub: w.s.hub,
      box: w.s.secretBox,
      user: w.s.user,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
      skillsDir: w.s.skillsDir,
      convHub: w.s.convHub,
    };

    const res1 = JSON.parse(
      await executeChiefTool(
        deps,
        {
          teamId: w.teamId,
          userId: w.s.user.id,
          chiefId: 'chief-1',
          threadId: w.threadId,
          chiefAgentId: null,
          conversationId: w.threadId,
          toolCallId: 'tc-1',
          turnPrompt: '查一下',
        },
        'notify_user',
        { message: '正在核对记录' },
      ),
    ) as { notified: boolean; duplicate?: boolean };
    expect(res1.notified).toBe(true);
    expect(res1.duplicate).toBeUndefined();

    const res2 = JSON.parse(
      await executeChiefTool(
        deps,
        {
          teamId: w.teamId,
          userId: w.s.user.id,
          chiefId: 'chief-1',
          threadId: w.threadId,
          chiefAgentId: null,
          conversationId: w.threadId,
          toolCallId: 'tc-2',
          turnPrompt: '查一下',
        },
        'notify_user',
        { message: '正在核对记录' },
      ),
    ) as { notified: boolean; duplicate?: boolean };
    expect(res2.notified).toBe(true);
    expect(res2.duplicate).toBeUndefined();

    const replay = JSON.parse(
      await executeChiefTool(
        deps,
        {
          teamId: w.teamId,
          userId: w.s.user.id,
          chiefId: 'chief-1',
          threadId: w.threadId,
          chiefAgentId: null,
          conversationId: w.threadId,
          toolCallId: 'tc-1',
          turnPrompt: '查一下',
        },
        'notify_user',
        { message: '正在核对记录' },
      ),
    ) as { notified: boolean; duplicate?: boolean };
    expect(replay).toEqual({ notified: true, duplicate: true });

    expect(noticeRows(w.s.db, w.threadId)).toHaveLength(2);
    expect(imCalls).toHaveLength(2);
    expect(w.s.db.select().from(notification).all()).toHaveLength(0);

    await expect(
      executeChiefTool(
        deps,
        {
          teamId: w.teamId,
          userId: w.s.user.id,
          chiefId: 'chief-1',
          threadId: w.threadId,
          chiefAgentId: null,
          conversationId: w.threadId,
          turnPrompt: '[wake:settle] provenance=todo-1\nDone',
        },
        'notify_user',
        { message: '任务完成了' },
      ),
    ).rejects.toThrow(/provenance/i);

    await executeChiefTool(
      deps,
      {
        teamId: w.teamId,
        userId: w.s.user.id,
        chiefId: 'chief-1',
        threadId: w.threadId,
        chiefAgentId: null,
        conversationId: w.threadId,
        turnPrompt: '[wake:settle] provenance=todo-1\nDone',
      },
      'notify_user',
      { message: '任务完成了', provenance: 'todo-1' },
    );
    await executeChiefTool(
      deps,
      {
        teamId: w.teamId,
        userId: w.s.user.id,
        chiefId: 'chief-1',
        threadId: w.threadId,
        chiefAgentId: null,
        conversationId: w.threadId,
        turnPrompt: '[wake:settle] provenance=todo-1\nDone',
      },
      'notify_user',
      { message: '任务完成了', provenance: 'todo-1' },
    );
    expect(noticeRows(w.s.db, w.threadId)).toHaveLength(3);
    expect(imCalls).toHaveLength(3);
    expect(w.s.db.select().from(notification).all()).toHaveLength(1);
  });

  it('mirror resets streamed buffer across multi-round assistant text rows so shared leading prefix emits intact without clipping or duplicating', async () => {
    const { provider } = makeStreamingProvider([
      (_ctx, model, options, rec) => {
        const stream = createAssistantMessageEventStream();
        const partial: AssistantMessage = {
          ...fauxAssistantMessage('正在查', { stopReason: 'toolUse' }),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        setTimeout(() => {
          stream.push({ type: 'start', partial });
          stream.push({ type: 'text_start', contentIndex: 0, partial });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: '正在查', partial });
          setTimeout(() => {
            const doneMsg: AssistantMessage = {
              ...fauxAssistantMessage(
                [{ type: 'text', text: '正在查' }, fauxToolCall('todos', {}, { id: 'tc-r1' })],
                { stopReason: 'toolUse' },
              ),
              api: model.api,
              provider: model.provider,
              model: model.id,
            };
            stream.push({ type: 'done', reason: 'toolUse', message: doneMsg });
            stream.end(doneMsg);
          }, 160);
        }, 15);
        void options;
        void rec;
        return stream;
      },
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['正在查', '，结果是全部正常。'], 160, options, rec),
    ]);

    const models = createCoordinatorModels([provider]);
    const dir = makeTestTempDir('coord-resp-mirror-');
    try {
      const api = fakeMachineApi();
      const gate = createStepGate();
      const harness = await openCoordinatorHarness(
        `${dir}/c.sqlite`,
        models.models,
        BACKGROUND_CONTEXT,
        { extensions: [coordinatorToolsExtension(api, gate)] },
      );
      await runCoordinatorTurn(
        {
          harness,
          models,
          api,
          context: BACKGROUND_CONTEXT,
          heartbeatMs: 10_000,
          now: () => 1,
          gate,
        },
        chiefStep('step-mirror-1', '看一下状态'),
      );
      await harness.close(BACKGROUND_CONTEXT);

      expect(api.deltas.map((d) => d.text).join('')).toBe('正在查正在查，结果是全部正常。');
    } finally {
      releaseTestTempDir(dir);
    }
  }, 15_000);

  it('emits zero reminders on no-tool turn and injects interjection-first reminder on mid-work steers, post-ack correction, Round 2+ streaming, conflicting rapid steers, and non-mail wake steer, while preserving cache prefix and 409 withdraw-after-read', async () => {
    const wNoTool = await world('你好');
    const pNoTool = makeStreamingProvider([
      (_ctx, model) => instantStream(model, fauxAssistantMessage('你好！')),
    ]);
    const cNoTool = boot(wNoTool, pNoTool.base, {
      fixedProviders: [pNoTool.provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => cNoTool.wake(threadId));
    cNoTool.wake(wNoTool.threadId);
    await cNoTool.idle();
    expect(JSON.stringify(pNoTool.requests[0]!.messages)).not.toContain('<system_reminder>');

    const wPre = await world('今天星期几');
    let onPreChunk = () => {};
    const preChunkSent = new Promise<void>((r) => {
      onPreChunk = r;
    });
    const pPre = makeStreamingProvider([
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['星期'], 1_500, options, rec, onPreChunk),
      (_ctx, model) => instantStream(model, fauxAssistantMessage('明天星期三')),
    ]);
    const cPre = boot(wPre, pPre.base, { fixedProviders: [pPre.provider], stopPollMs: 60_000 });
    setCoordinatorWake((threadId) => cPre.wake(threadId));
    cPre.wake(wPre.threadId);
    await preChunkSent;
    await req(wPre.s.app, 'POST', `/api/conversations/${wPre.threadId}/messages`, {
      content: '改问明天',
    });
    await cPre.idle();
    expect(JSON.stringify(pPre.requests[1]!.messages)).not.toContain('<system_reminder>');

    const w = await world('先查一下 A');
    const p = makeStreamingProvider([
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage(
            [
              { type: 'text', text: '我先去查一下 A。' },
              fauxToolCall('ask_user', {
                questions: [{ header: 'Q', question: 'Ok?', options: [{ label: 'Yes' }] }],
              }),
            ],
            { stopReason: 'toolUse' },
          ),
        ),
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['第二轮正在回答 A，并回应你的旁路问题。'], 1_500, options, rec),
      (_ctx, model) => instantStream(model, fauxAssistantMessage('按最新纠偏看 B。')),
    ]);
    const c = boot(w, p.base, { fixedProviders: [p.provider], stopPollMs: 60_000 });
    setCoordinatorWake((threadId) => c.wake(threadId));
    c.wake(w.threadId);

    const qRow = await waitFor(() =>
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .find((row) => JSON.stringify(row.content).includes('ask_user_question')),
    );

    const steer1 = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: '等一下，顺便问个旁路问题：B 影响了吗？',
    });
    expect(steer1.status).toBe(201);
    await new Promise((r) => setTimeout(r, 80));

    await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${qRow.id}/answer`,
      { answers: [{ header: 'Q', choices: ['Yes'] }] },
    );

    await waitFor(() => p.requests[1]);
    expect(JSON.stringify(p.requests[1]!.messages.at(-1)?.content)).toContain('<system_reminder>');
    expect(JSON.stringify(p.requests[1]!.messages.at(-1)?.content)).toMatch(
      /cancel|replace|side question|answer.*first/i,
    );
    expect(p.requests[1]!.messages.slice(0, p.requests[0]!.messages.length)).toEqual(
      p.requests[0]!.messages,
    );

    const steer1Row = w.s.db
      .select()
      .from(chiefMessage)
      .all()
      .find(
        (m) =>
          m.role === 'user' &&
          m.threadId === w.threadId &&
          typeof m.content === 'string' &&
          m.content.includes('旁路问题'),
      );
    const withdrawRes = await req(
      w.s.app,
      'DELETE',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/messages/${steer1Row!.id}`,
    );
    expect(withdrawRes.status).toBe(409);
    const withdrawBody = (await withdrawRes.json()) as { reason?: string };
    expect(withdrawBody.reason).toBe(CHIEF_MESSAGE_READ);

    const postAck1 = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: '看下 C',
    });
    const postAck2 = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: '刚才说错了，不用看 C，改成看 B',
    });
    expect(postAck1.status).toBe(201);
    expect(postAck2.status).toBe(201);
    await c.idle();

    expect(p.requests[2]!).toBeDefined();
    expect(JSON.stringify(p.requests[2]!.messages.at(-1)?.content)).toContain('<system_reminder>');
    expect(p.requests[2]!.messages.slice(0, p.requests[1]!.messages.length)).toEqual(
      p.requests[1]!.messages,
    );

    const wWake = await world('初始');
    const pWake = makeStreamingProvider([
      (_ctx, model) => instantStream(model, fauxAssistantMessage('初始完成')),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage(
            [
              fauxToolCall('ask_user', {
                provenance: 'todo-wake',
                questions: [{ header: 'W', question: 'Continue?', options: [{ label: 'Go' }] }],
              }),
            ],
            { stopReason: 'toolUse' },
          ),
        ),
      (_ctx, model) => instantStream(model, fauxAssistantMessage('收到醒来插话')),
    ]);
    const cWake = boot(wWake, pWake.base, { fixedProviders: [pWake.provider], stopPollMs: 60_000 });
    setCoordinatorWake((threadId) => cWake.wake(threadId));
    cWake.wake(wWake.threadId);
    await cWake.idle();

    enqueueChiefStep(
      { db: wWake.s.db, hub: wWake.s.hub, user: wWake.s.user, machineHub: wWake.s.machineHub },
      wWake.threadId,
      { trigger: 'wake', provenance: 'todo-wake', ownerMessageIds: [], prompt: '任务完了' },
    );
    const wakeQ = await waitFor(() =>
      wWake.s.db
        .select()
        .from(chiefMessage)
        .all()
        .find((row) => JSON.stringify(row.content).includes('ask_user_question')),
    );
    await req(wWake.s.app, 'POST', `/api/conversations/${wWake.threadId}/messages`, {
      content: '趁现在先回我一句进度',
    });
    await req(
      wWake.s.app,
      'POST',
      `/api/teams/${wWake.teamId}/chief/threads/${wWake.threadId}/questions/${wakeQ.id}/answer`,
      { answers: [{ header: 'W', choices: ['Go'] }] },
    );
    await cWake.idle();
    expect(JSON.stringify(pWake.requests[2]!.messages.at(-1)?.content)).toContain(
      '<system_reminder>',
    );
  }, 20_000);

  it('silence guard triggers at 4 silent tool calls and >=12s elapsed, ignores failed notify_user isError=true, resets on visible text or ok notify_user/ask_user, completes slow non-subagent tools before steer, keeps timeoutSec=300 subagent barge-in, and stays off in event turns', async () => {
    const w = await world('连续查很多项');
    const p = makeStreamingProvider([
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('todos', {}, { id: 's1' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('projects', {}, { id: 's2' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('notify_user', {}, { id: 's-err' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('machines', {}, { id: 's3' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('skills', {}, { id: 's4' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage(
            [fauxToolCall('notify_user', { message: '还在看，马上好' }, { id: 's-ok' })],
            { stopReason: 'toolUse' },
          ),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('todos', {}, { id: 's5' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) => instantStream(model, fauxAssistantMessage('查完了。')),
    ]);
    const c = boot(w, p.base, { fixedProviders: [p.provider], stopPollMs: 60_000 });
    setCoordinatorWake((threadId) => c.wake(threadId));
    c.wake(w.threadId);
    await c.idle();

    expect(p.requests).toHaveLength(8);
    expect(JSON.stringify(p.requests[1]!.messages.at(-1)?.content)).not.toContain(
      '<system_reminder>',
    );
    expect(JSON.stringify(p.requests[2]!.messages.at(-1)?.content)).not.toContain(
      '<system_reminder>',
    );
    expect(JSON.stringify(p.requests[3]!.messages.at(-1)?.content)).not.toContain(
      '<system_reminder>',
    );
    expect(JSON.stringify(p.requests[4]!.messages.at(-1)?.content)).toContain('<system_reminder>');
    expect(JSON.stringify(p.requests[5]!.messages.at(-1)?.content)).not.toContain(
      '<system_reminder>',
    );
    expect(JSON.stringify(p.requests[6]!.messages.at(-1)?.content)).not.toContain(
      '<system_reminder>',
    );
    expect(JSON.stringify(p.requests[7]!.messages.at(-1)?.content)).not.toContain(
      '<system_reminder>',
    );

    const realNow = Date.now;
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    const wSlowClock = await world('慢时钟');
    const pSlowClock = makeStreamingProvider([
      (_ctx, model) => {
        offset += 13_000;
        return instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('todos', {}, { id: 'c1' })], {
            stopReason: 'toolUse',
          }),
        );
      },
      (_ctx, model) => instantStream(model, fauxAssistantMessage('超时提醒后收尾。')),
    ]);
    const cSlowClock = boot(wSlowClock, pSlowClock.base, {
      fixedProviders: [pSlowClock.provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => cSlowClock.wake(threadId));
    cSlowClock.wake(wSlowClock.threadId);
    await cSlowClock.idle();
    expect(JSON.stringify(pSlowClock.requests[1]!.messages.at(-1)?.content)).toContain(
      '<system_reminder>',
    );
    vi.restoreAllMocks();

    const wSub = await world('用长超时子代理查一下');
    let subStarted = () => {};
    const subChunk = new Promise<void>((r) => {
      subStarted = r;
    });
    const pSub = makeStreamingProvider([
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage(
            [
              fauxToolCall(
                'subagent',
                { task: 'slow read', label: 'check', timeoutSec: 300 },
                { id: 'sub-300' },
              ),
            ],
            { stopReason: 'toolUse' },
          ),
        ),
      (_ctx, model, options, rec) =>
        slowTextStream(model, ['子代理慢查询中...'], 1_500, options, rec, subStarted),
      (_ctx, model) => instantStream(model, fauxAssistantMessage('已立刻中断子代理并回应。')),
    ]);
    const cSub = boot(wSub, pSub.base, { fixedProviders: [pSub.provider], stopPollMs: 60_000 });
    setCoordinatorWake((threadId) => cSub.wake(threadId));
    cSub.wake(wSub.threadId);
    await subChunk;
    const tSteer = Date.now();
    await req(wSub.s.app, 'POST', `/api/conversations/${wSub.threadId}/messages`, {
      content: '先不用查了',
    });
    await cSub.idle();
    expect(pSub.requests[1]!.abortedAt).not.toBeNull();
    expect((pSub.requests[1]!.abortedAt ?? 0) - tSteer).toBeLessThan(800);
    expect(JSON.stringify(pSub.requests[2]!.messages.at(-1)?.content)).toContain(
      '<system_reminder>',
    );

    const wEvent = await world('init');
    const pEvent = makeStreamingProvider([
      (_ctx, model) => instantStream(model, fauxAssistantMessage('ok')),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('todos', {}, { id: 'e1' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('projects', {}, { id: 'e2' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('machines', {}, { id: 'e3' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) =>
        instantStream(
          model,
          fauxAssistantMessage([fauxToolCall('skills', {}, { id: 'e4' })], {
            stopReason: 'toolUse',
          }),
        ),
      (_ctx, model) => instantStream(model, fauxAssistantMessage('event done')),
    ]);
    const cEvent = boot(wEvent, pEvent.base, {
      fixedProviders: [pEvent.provider],
      stopPollMs: 60_000,
    });
    setCoordinatorWake((threadId) => cEvent.wake(threadId));
    cEvent.wake(wEvent.threadId);
    await cEvent.idle();
    enqueueChiefStep(
      { db: wEvent.s.db, hub: wEvent.s.hub, user: wEvent.s.user, machineHub: wEvent.s.machineHub },
      wEvent.threadId,
      { trigger: 'wake', provenance: 'todo-ev', ownerMessageIds: [], prompt: 'Background event' },
    );
    await cEvent.idle();
    expect(JSON.stringify(pEvent.requests[5]!.messages)).not.toContain('<system_reminder>');
  }, 20_000);

  it('ResponsivenessTracker preserves cache prefix across warm cross-turns, resets on cache epoch expiry and compaction/rewind, clears flags on endTurn and clearConversation', async () => {
    const mod = await import('../../src/coordinator/runtime/responsiveness.js');
    let clock = 1_000;
    const tracker = mod.createResponsivenessTracker({ now: () => clock, reuseMs: 1_000 });
    mod.coordinatorResponsivenessExtension(tracker);

    tracker.beginTurn('conv-1', { interactive: true, mailTurn: false });

    const u1 = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '帮我查一下' }],
      timestamp: 1,
    };
    const a1 = {
      ...fauxAssistantMessage([fauxToolCall('todos', {}, { id: 'c1' })], { stopReason: 'toolUse' }),
      timestamp: 2,
    };
    const t1: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'todos',
      content: [{ type: 'text', text: '[]' }],
      isError: false,
      timestamp: 3,
    };
    const u2 = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '先停一下' }],
      timestamp: 4,
    };

    const r1 = mod.applyResponsivenessBeforeRequest(tracker, 'conv-1', [u1, a1, t1, u2]);
    expect(r1).toBeDefined();
    expect(JSON.stringify(r1!.messages[3])).toContain('<system_reminder>');
    const frozenAtIdx3 = structuredClone(r1!.messages[3]);

    const a2 = { ...fauxAssistantMessage('停下来先回你'), timestamp: 5 };
    mod.observeResponsivenessAfterResponse(tracker, 'conv-1', a2);
    tracker.endTurn('conv-1');

    clock += 200;
    tracker.beginTurn('conv-1', { interactive: true, mailTurn: false });
    const u3 = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '继续吧' }],
      timestamp: 6,
    };
    const r2 = mod.applyResponsivenessBeforeRequest(tracker, 'conv-1', [u1, a1, t1, u2, a2, u3]);
    expect(r2).toBeDefined();
    expect(r2!.messages[3]).toEqual(frozenAtIdx3);
    expect(JSON.stringify(r2!.messages[5])).not.toContain('<system_reminder>');

    clock += 1_500;
    const r3 = mod.applyResponsivenessBeforeRequest(tracker, 'conv-1', [u1, a1, t1, u2, a2, u3]);
    expect(JSON.stringify(r3?.messages?.[3] ?? u2)).not.toContain('<system_reminder>');

    const compacted = mod.applyResponsivenessBeforeRequest(tracker, 'conv-1', [u3]);
    expect(JSON.stringify(compacted?.messages?.[0] ?? u3)).not.toContain('<system_reminder>');

    tracker.endTurn('conv-1');
    tracker.beginTurn('conv-1', { interactive: true, mailTurn: false });
    const a3 = {
      ...fauxAssistantMessage([fauxToolCall('projects', {}, { id: 'c3' })], {
        stopReason: 'toolUse',
      }),
      timestamp: 7,
    };
    const rPreIdle = mod.applyResponsivenessBeforeRequest(tracker, 'conv-1', [
      u1,
      a1,
      t1,
      u2,
      a2,
      u3,
      a3,
      { ...t1, toolCallId: 'c3', timestamp: 8 },
      { ...u2, content: [{ type: 'text' as const, text: '补充问一句' }], timestamp: 9 },
    ]);
    expect(JSON.stringify(rPreIdle?.messages?.at(-1))).toContain('<system_reminder>');
    tracker.endTurn('conv-1');

    clock += 1_500;
    tracker.beginTurn('conv-1', { interactive: true, mailTurn: false });
    const rPostIdle = mod.applyResponsivenessBeforeRequest(tracker, 'conv-1', [
      u1,
      a1,
      t1,
      u2,
      a2,
      u3,
      a3,
      { ...t1, toolCallId: 'c3', timestamp: 8 },
      { ...u2, content: [{ type: 'text' as const, text: '补充问一句' }], timestamp: 9 },
      a2,
      { ...u3, content: [{ type: 'text' as const, text: '下一轮' }], timestamp: 10 },
    ]);
    expect(rPostIdle).toBeUndefined();
    expect(tracker.stateOf('conv-1').injected.size).toBe(0);

    tracker.endTurn('conv-1');
    tracker.beginTurn('conv-1', { interactive: true, mailTurn: false });

    const summary = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '<summary>compacted history</summary>' }],
      timestamp: 11,
    };
    const turnUser = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '查一下全部状态' }],
      timestamp: 12,
    };
    const longPre = [
      u1,
      a1,
      t1,
      u2,
      a2,
      u3,
      a3,
      { ...t1, toolCallId: 'c3', timestamp: 8 },
      a2,
      turnUser,
    ];
    mod.applyResponsivenessBeforeRequest(tracker, 'conv-1', longPre);
    expect(tracker.stateOf('conv-1').turnStartIndex).toBe(9);

    const silentPairs = Array.from({ length: 4 }, (_, n) => [
      {
        ...fauxAssistantMessage([fauxToolCall('todos', {}, { id: `comp-${n}` })], {
          stopReason: 'toolUse',
        }),
        timestamp: 20 + n * 2,
      },
      {
        role: 'toolResult' as const,
        toolCallId: `comp-${n}`,
        toolName: 'todos',
        content: [{ type: 'text' as const, text: '[]' }],
        isError: false,
        timestamp: 21 + n * 2,
      },
    ]).flat();
    const compactedLongerThanOldStart = [summary, a2, turnUser, ...silentPairs];
    expect(compactedLongerThanOldStart.length).toBe(11);
    const rCompacted = mod.applyResponsivenessBeforeRequest(
      tracker,
      'conv-1',
      compactedLongerThanOldStart,
    );
    expect(tracker.stateOf('conv-1').turnStartIndex).toBe(2);
    expect(rCompacted).toBeDefined();
    expect(JSON.stringify(rCompacted!.messages.at(-1))).toContain('<system_reminder>');

    tracker.clear('conv-1');
  });
});
