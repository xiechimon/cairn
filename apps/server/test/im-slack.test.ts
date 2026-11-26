import { join } from 'node:path';
import { ASK_USER_QUESTION_KIND, type AskUserQuestionContent } from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  type Context,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { AskChannel } from '../../daemon/src/ask-channel.js';
import { buildHostTools } from '../../daemon/src/backend/claude-code.js';
import { MachineClient } from '../../daemon/src/machine-client.js';
import { stepRemoteToolExecutor } from '../../daemon/src/step-remote-tools.js';
import { openCoordinatorHarness } from '../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../src/coordinator/runtime/models.js';
import { coordinatorToolsExtension, createStepGate } from '../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../src/coordinator/runtime/turn.js';
import {
  chiefMessage,
  chiefThread,
  externalEffect,
  imTurnOrigin,
  machine,
  notification,
  step,
} from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { nowMs } from '../src/lib/ids.js';
import { askQuestionContentOf, writeQuestion } from '../src/services/chief-question-store.js';
import { announceQuestion } from '../src/services/chief-questions.js';
import { drainEffects, effectRegistry, recordEffect } from '../src/services/external-effects.js';
import { createImService } from '../src/services/im/core.js';
import { ImSendError } from '../src/services/im/errors.js';
import { setImRuntime } from '../src/services/im/runtime.js';
import {
  CARD_TOO_LONG_NOTICE,
  createSlackAdapter,
  slackCardBlocks,
} from '../src/services/im/slack.js';
import type {
  ImConnectionHandlers,
  ImEnv,
  ImInboundAction,
  ImInboundMessage,
} from '../src/services/im/types.js';
import { machineAsk } from '../src/services/machine-relay.js';
import { turnProvenance } from '../src/services/turn-provenance.js';
import { chiefStep, fakeMachineApi } from './coordinator/fake-machine-api.js';
import { bootServer, insertMachine, req, seedRoute } from './helpers.js';

vi.mock('mdast-util-from-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mdast-util-from-markdown')>();
  return { ...actual, fromMarkdown: vi.fn(actual.fromMarkdown) };
});

const APP_TOKEN = 'xapp-1-A0123BCDE-456789-abcdef';
const BOT_TOKEN = 'xoxb-123456789012-abcdefghijkl';
const PARK = Symbol('park');

type SlackReply =
  | Record<string, unknown>
  | Uint8Array
  | typeof PARK
  | { __http: number; retryAfter?: number };

interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
  query: Record<string, string>;
  httpMethod: string;
  authorization: string | null;
}

interface FakeSocket {
  url: string;
  sent: string[];
  closed: boolean;
  receive(frame: unknown): void;
  drop(code: number, reason: string): void;
  close(): void;
}

interface FakeSlack {
  env: ImEnv;
  calls: RecordedCall[];
  sockets: FakeSocket[];
  slept: number[];
  queue(method: string, reply: SlackReply): void;
}

function fakeSlackEnv(): FakeSlack {
  const calls: RecordedCall[] = [];
  const sockets: FakeSocket[] = [];
  const slept: number[] = [];
  const queues = new Map<string, SlackReply[]>();
  const env: ImEnv = {
    now: () => Date.now(),
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetch: (url, init) => {
      const target = new URL(String(url));
      const method = target.pathname.endsWith('/users.info')
        ? (target.pathname.split('/').pop() ?? '')
        : (String(url).split('/').pop() ?? '');
      const body =
        init?.body === undefined || init.body === null
          ? {}
          : (JSON.parse(String(init.body)) as Record<string, unknown>);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        method,
        body,
        query: Object.fromEntries(target.searchParams),
        httpMethod: init?.method ?? 'GET',
        authorization: headers.authorization ?? null,
      });
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
        if (method === 'chat.postMessage' && String(body.text ?? '').trim() === '') {
          resolve(
            new Response(JSON.stringify({ ok: false, error: 'no_text' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
          return;
        }
        const queued = queues.get(method)?.shift();
        if (queued === undefined || queued === PARK) return;
        if (queued instanceof Uint8Array) {
          resolve(new Response(queued, { status: 200 }));
          return;
        }
        if (typeof queued === 'object' && '__http' in queued) {
          const http = queued as { __http: number; retryAfter?: number };
          resolve(
            new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
              status: http.__http,
              headers: {
                'content-type': 'application/json',
                ...(http.retryAfter !== undefined
                  ? { 'retry-after': String(http.retryAfter) }
                  : {}),
              },
            }),
          );
          return;
        }
        resolve(
          new Response(JSON.stringify(queued), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      });
    },
    connectSocket: (url, handlers) => {
      const socket: FakeSocket = {
        url,
        sent: [],
        closed: false,
        receive: (frame) => handlers.onMessage(JSON.stringify(frame)),
        drop: (code, reason) => handlers.onClose(code, reason),
        close: () => {
          if (socket.closed) return;
          socket.closed = true;
          handlers.onClose(1000, 'normal');
        },
      };
      sockets.push(socket);
      return {
        send: (text) => socket.sent.push(text),
        close: () => socket.close(),
      };
    },
  };
  return {
    env,
    calls,
    sockets,
    slept,
    queue(method, reply) {
      queues.set(method, [...(queues.get(method) ?? []), reply]);
    },
  };
}

const AUTH_OK = {
  ok: true,
  url: 'https://cairn-hq.slack.com/',
  team: 'Cairn HQ',
  user: 'cairn_bot',
  team_id: 'T0TEAM',
  user_id: 'U0BOT',
  bot_id: 'B0BOT',
} as const;

const OPEN_OK = {
  ok: true,
  url: 'wss://wss-primary.slack.com/link/?ticket=t-1',
} as const;

function imEnvelope(envelopeId: string, event: Record<string, unknown>): Record<string, unknown> {
  return { envelope_id: envelopeId, type: 'events_api', payload: { event } };
}

function messageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message',
    channel: 'D0DM',
    channel_type: 'im',
    user: 'U42',
    text: 'hello cairn',
    ts: '1700000001.000001',
    ...overrides,
  };
}

const SHORT_QUESTION = { header: 'Pick', question: 'Which option?', options: [{ label: 'A' }] };
const LONG_QUESTION = { ...SHORT_QUESTION, question: `Which option? ${'x'.repeat(45_000)}` };
const SHORTEN_ERROR = /too long for the Slack card.*ask a shorter question.*ordinary message/i;
const ANSWERS = [{ header: 'Pick', choices: ['A'] }];

async function slackQuestionWorld() {
  const s = bootServer({ vapidKeys: null });
  const deps = { ...s, box: s.secretBox };
  const storageDir = makeTestTempDir('slack-question-');
  const slack = fakeSlackEnv();
  const im = createImService({
    ...deps,
    env: slack.env,
    adapters: { slack: createSlackAdapter(slack.env) },
  });
  setImRuntime(im.runtime);
  onTestFinished(async () => {
    setImRuntime(null);
    await im.shutdown();
  });
  slack.queue('auth.test', AUTH_OK);
  slack.queue('auth.test', AUTH_OK);
  slack.queue('apps.connections.open', OPEN_OK);
  await im.createConnection(
    s.team.id,
    'slack',
    { appToken: APP_TOKEN, botToken: BOT_TOKEN },
    { pairedSenders: [{ id: 'U42', name: 'Slack user', chatKey: 'D0DM', addedAt: nowMs() }] },
  );
  await vi.waitFor(() => expect(slack.sockets).toHaveLength(1));
  slack.queue('users.info', { ok: true });
  slack.queue('chat.postMessage', { ok: true, ts: '1' });
  slack.queue('chat.postMessage', { ok: true, ts: '2' });
  const socket = slack.sockets[0]!;
  socket.receive({ type: 'hello' });
  socket.receive(imEnvelope('e-question', messageEvent()));
  const origin = await vi.waitFor(() => {
    const found = s.db.select().from(imTurnOrigin).get();
    if (found === undefined) throw new Error('Slack turn not queued');
    return found;
  });
  const turn = () => s.db.select().from(step).where(eq(step.id, origin.stepId)).get()!;
  const provenance = turnProvenance(turn().prompt);
  expect(provenance).toMatch(/^im:slack:/);
  const posts = () => slack.calls.filter((call) => call.method === 'chat.postMessage');
  const questions = () =>
    s.db
      .select()
      .from(chiefMessage)
      .all()
      .flatMap(({ content }) => {
        const parsed = askQuestionContentOf(content);
        return parsed === null ? [] : [parsed];
      });
  const state = () => ({
    questions: questions().length,
    notifications: s.db.select().from(notification).all().length,
    effects: s.db.select().from(externalEffect).where(eq(externalEffect.kind, 'im-send')).all()
      .length,
    posts: posts().length,
  });
  const clickShortCard = async () => {
    await vi.waitFor(() => {
      expect(posts()).toHaveLength(1);
      expect(
        s.db.select().from(externalEffect).where(eq(externalEffect.kind, 'im-send')).get()?.state,
      ).toBe('delivered');
    });
    const blocks = posts()[0]?.body.blocks as { type: string; elements?: unknown[] }[];
    expect(blocks[0]).toMatchObject({
      type: 'section',
      text: { type: 'plain_text', text: 'Which option?\n\n1. A' },
    });
    const actions = blocks[1]?.elements;
    expect(actions).toEqual([
      expect.objectContaining({ value: expect.stringMatching(/^imcb:ask-.*:0$/) }),
    ]);
    socket.receive({
      envelope_id: 'e-short-answer',
      type: 'interactive',
      payload: { type: 'block_actions', user: { id: 'U42' }, channel: { id: 'D0DM' }, actions },
    });
    expect(questions()).toEqual([
      expect.objectContaining({ status: 'answered', answers: ANSWERS }),
    ]);
  };
  return { s, deps, storageDir, turn, provenance, posts, questions, state, origin, clickShortCard };
}

describe('Slack question size guard', () => {
  const ampersands = '&'.repeat(7997);

  test.each([
    [39_999, ' Proceed'],
    [40_000, ' Proceed?'],
    [40_001, ' Proceed?!'],
  ] as const)(
    'a fresh Slack question with a %i-character escaped fallback respects the limit',
    async (length, suffix) => {
      const { s, deps, origin, provenance, posts, state } = await slackQuestionWorld();
      s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, origin.stepId)).run();
      const before = state();
      const requestId = 'ask-11111111-2222-3333-4444-555555555555';
      const question = { ...SHORT_QUESTION, question: `${ampersands}${suffix}` };
      const expectedFallback = `${'&amp;'.repeat(ampersands.length)}${suffix}\n\n1. A`;
      expect(expectedFallback).toHaveLength(length);
      const ask = machineAsk(
        deps,
        null,
        origin.stepId,
        { requestId, provenance: provenance ?? undefined, questions: [question] },
        { holdMs: 0 },
      );
      if (length > 40_000) {
        await expect(ask).rejects.toMatchObject({
          status: 422,
          message: expect.stringMatching(SHORTEN_ERROR),
        });
        expect(state()).toEqual(before);
        return;
      }
      await expect(ask).resolves.toMatchObject({ status: 'pending', requestId });
      expect(state().questions).toBe(before.questions + 1);
      await vi.waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]?.body.text).toBe(expectedFallback);
      expect(posts()[0]?.body.blocks).toContainEqual(expect.objectContaining({ type: 'actions' }));
    },
    4_000,
  );

  test('a server-written approval over the escaped fallback limit sends only the notice', async () => {
    const { s, deps, origin, posts, questions } = await slackQuestionWorld();
    s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, origin.stepId)).run();
    const requestId = 'ask-33333333-4444-5555-6666-777777777777';
    writeQuestion(
      s.db,
      origin.threadId,
      requestId,
      {
        kind: ASK_USER_QUESTION_KIND,
        requestId,
        status: 'pending',
        questions: [
          {
            header: 'Approval',
            question: `${ampersands} Proceed?!`,
            options: [{ label: 'Approve' }],
          },
        ],
        answers: null,
      },
      nowMs(),
    );
    announceQuestion(deps, origin.threadId, requestId);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    expect(Object.keys(posts()[0]!.body).sort()).toEqual(['channel', 'text']);
    expect(posts()[0]?.body.text).toBe(CARD_TOO_LONG_NOTICE);
    expect(questions()).toEqual([expect.objectContaining({ requestId, status: 'pending' })]);
  }, 4_000);

  test('draining an oversized queued snapshot sends only the notice', async () => {
    const { s, origin, posts } = await slackQuestionWorld();
    const requestId = 'ask-33333333-4444-5555-6666-777777777777';
    writeQuestion(
      s.db,
      origin.threadId,
      requestId,
      {
        kind: ASK_USER_QUESTION_KIND,
        requestId,
        status: 'pending',
        questions: [SHORT_QUESTION],
        answers: null,
      },
      nowMs(),
    );
    const { row } = recordEffect(s.db, {
      teamId: s.team.id,
      kind: 'im-send',
      scopeKind: 'step',
      scopeId: origin.stepId,
      stepId: origin.stepId,
      dedupeKey: requestId,
      payload: {
        connId: origin.connId,
        chatKey: origin.chatKey,
        text: LONG_QUESTION.question,
        buttons: [[{ label: 'Old choice', value: `imcb:${requestId}:0` }]],
        requestId,
      },
    });

    await drainEffects(s.db, effectRegistry);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toEqual({ channel: origin.chatKey, text: CARD_TOO_LONG_NOTICE });
    expect(
      s.db.select().from(externalEffect).where(eq(externalEffect.id, row.id)).get()?.state,
    ).toBe('delivered');
  }, 4_000);

  test('draining a queued Slack card keeps its original conversation text', async () => {
    const { s, origin, posts } = await slackQuestionWorld();
    const requestId = 'ask-44444444-5555-6666-7777-888888888888';
    const firstThread = s.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, origin.threadId))
      .get()!;
    const secondThreadId = 'chief-project-fixture';
    s.db
      .insert(chiefThread)
      .values({ ...firstThread, id: secondThreadId, projectId: 'project-fixture' })
      .run();
    const first: AskUserQuestionContent = {
      kind: ASK_USER_QUESTION_KIND,
      requestId,
      status: 'pending',
      questions: [SHORT_QUESTION],
      answers: null,
    };
    writeQuestion(s.db, origin.threadId, requestId, first, nowMs());
    s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, origin.stepId)).run();
    announceQuestion(s, origin.threadId, requestId);
    expect(s.db.select().from(externalEffect).get()?.state).toBe('pending');

    const secondQuestion = { ...SHORT_QUESTION, question: 'Which project?' };
    writeQuestion(
      s.db,
      secondThreadId,
      requestId,
      { ...first, questions: [secondQuestion] },
      nowMs(),
    );
    const stored = s.db.select().from(chiefMessage).where(eq(chiefMessage.id, requestId)).get();
    expect(stored?.threadId).toBe(origin.threadId);
    expect(askQuestionContentOf(stored?.content)?.questions).toEqual([secondQuestion]);

    await drainEffects(s.db, effectRegistry);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({
      channel: origin.chatKey,
      text: 'Which option?\n\n1. A',
      blocks: [
        { type: 'section', text: { type: 'plain_text', text: 'Which option?\n\n1. A' } },
        { type: 'actions', elements: [{ text: { text: 'A' }, value: `imcb:${requestId}:0` }] },
      ],
    });
  }, 4_000);

  test.each([
    ['blank', '   '],
    ['multi-megabyte', 'x'.repeat(3 * 1024 * 1024)],
  ])(
    'the card check refuses %s text without scanning it',
    (_label, text) => {
      const segment = Intl.Segmenter.prototype.segment;
      const buildSections = vi
        .spyOn(Intl.Segmenter.prototype, 'segment')
        .mockImplementation(function (this: Intl.Segmenter) {
          return segment.call(this, 'fixture');
        });
      const scan = vi.spyOn(String.prototype, 'replace');
      const parse = vi.mocked(fromMarkdown);
      parse.mockClear();
      onTestFinished(() => {
        buildSections.mockRestore();
        scan.mockRestore();
      });
      const blocks = slackCardBlocks({
        text,
        buttons: [[{ label: 'A', value: 'imcb:ask-fixture:0' }]],
      });
      expect(blocks).toBeNull();
      expect(scan.mock.contexts).not.toContain(text);
      expect(parse).not.toHaveBeenCalled();
      expect(buildSections).not.toHaveBeenCalled();
    },
    3_000,
  );

  test('a padded button label is read only through its 75th code point', () => {
    const word = 'Pick💡';
    const label = word + ' '.repeat(2 * 1024 * 1024);
    const stringIterator = String.prototype[Symbol.iterator];
    let pointsRead = 0;
    const iterator = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (
      this: string,
    ) {
      const points = stringIterator.call(this);
      if (this === label) {
        const next = points.next.bind(points);
        points.next = () => {
          expect(++pointsRead).toBeLessThanOrEqual(75);
          return next();
        };
      }
      return points;
    });
    onTestFinished(() => iterator.mockRestore());
    const blocks = slackCardBlocks({
      text: `Which option?\n\n1. ${word}`,
      buttons: [[{ label, value: 'imcb:ask-fixture:0' }]],
    });
    expect(pointsRead).toBe(75);
    expect(blocks?.[1]).toMatchObject({ elements: [{ text: { text: word + ' '.repeat(70) } }] });
  }, 3_000);

  test('the in-server model gets a tool error without a card and can shorten its ask', async () => {
    const { s, deps, storageDir, turn, provenance, posts, state, clickShortCard } =
      await slackQuestionWorld();
    const stepId = turn().id;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    const before = state();
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    let received: { result: unknown; state: ReturnType<typeof state> } | undefined;
    const sawAnswer = vi.fn();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('ask_user', { provenance, questions: [LONG_QUESTION] })], {
        stopReason: 'toolUse',
      }),
      (context: Context) => {
        const result = context.messages.at(-1);
        received = { result, state: state() };
        if (result?.role !== 'toolResult' || !result.isError)
          return fauxAssistantMessage('No refusal received.');
        return fauxAssistantMessage(
          [fauxToolCall('ask_user', { provenance, questions: [SHORT_QUESTION] })],
          { stopReason: 'toolUse' },
        );
      },
      (context: Context) => {
        sawAnswer(context.messages.at(-1));
        return fauxAssistantMessage('I will use option A.');
      },
    ]);
    const ctx = BACKGROUND_CONTEXT;
    const models = createCoordinatorModels([faux.provider]);
    const api = fakeMachineApi();
    api.askUser = (id, body) =>
      machineAsk(deps, null, id, body, {
        holdMs: body.questions[0]?.question === LONG_QUESTION.question ? 0 : 4000,
      });
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(
      join(storageDir, 'coordinator.sqlite'),
      models.models,
      ctx,
      { extensions: [coordinatorToolsExtension(api, gate)] },
    );
    const running = runCoordinatorTurn(
      { harness, models, api, context: ctx, heartbeatMs: 1000, now: Date.now, gate },
      chiefStep(stepId, 'Ask the Slack user.'),
    );
    try {
      await vi.waitFor(() => expect(received !== undefined || posts().length > 0).toBe(true), {
        timeout: 4000,
      });
      expect(received?.state ?? state()).toEqual(before);
      expect(received?.result).toMatchObject({
        role: 'toolResult',
        isError: true,
        content: [{ type: 'text', text: expect.stringMatching(SHORTEN_ERROR) }],
      });
      await clickShortCard();
    } finally {
      await running;
      await harness.close(ctx);
    }
    expect(sawAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'toolResult',
        content: [
          expect.objectContaining({ text: expect.stringContaining('"status":"answered"') }),
        ],
      }),
    );
    expect(api.dones.map(({ body }) => body.status)).toEqual(['success']);
  }, 8_000);

  test.each(['ask', 'tool'] as const)(
    'the daemon %s relay gets a tool error, then sends a clickable shorter ask',
    async (path) => {
      const { s, storageDir, turn, provenance, posts, questions, state, clickShortCard } =
        await slackQuestionWorld();
      const machineId = insertMachine(s);
      const token = 'slack-question-fixture-token';
      s.db
        .update(machine)
        .set({ tokenHash: hashCredential(token) })
        .where(eq(machine.id, machineId))
        .run();
      const claim = (id: string) =>
        s.db
          .update(step)
          .set({ status: 'claimed', machineId, claimedAt: nowMs() })
          .where(eq(step.id, id))
          .run();
      const stepId = turn().id;
      claim(stepId);
      const client = new MachineClient({
        claim: { stepId, generation: turn().claimedAt! },
        serverUrl: 'http://fixture.invalid',
        getToken: () => token,
        fetchImpl: async (input, init) => {
          init?.signal?.throwIfAborted();
          const url = new URL(String(input));
          if (url.pathname.startsWith('/api/machine/ask/')) url.searchParams.set('holdMs', '400');
          return s.app.request(new Request(url, init));
        },
      });
      const channel = new AskChannel({
        client: path === 'ask' ? client : {},
        stepId,
        log: () => {},
      });
      const definition = { name: 'ask_user', description: 'Ask the user.' };
      const relay = stepRemoteToolExecutor({
        client,
        stepId,
        cwd: storageDir,
        remoteTools: [definition],
        askChannel: channel,
        attachFiles: false,
        verifyEvidence: null,
      });
      const tool = buildHostTools({ remoteTools: [definition], localTools: [], relay })[0]!;
      const requestId = 'ask-11111111-2222-3333-4444-555555555555';
      const ask = (question: typeof SHORT_QUESTION) =>
        tool.handler({ provenance, requestId, questions: [question] }, undefined as never);
      const before = state();
      let received: Awaited<ReturnType<typeof ask>> | undefined;
      const rejected = ask(LONG_QUESTION).then((result) => {
        received = result;
      });
      try {
        await vi.waitFor(() => expect(received !== undefined || posts().length > 0).toBe(true));
        expect(state()).toEqual(before);
        expect(received).toMatchObject({
          isError: true,
          content: [{ type: 'text', text: expect.stringMatching(SHORTEN_ERROR) }],
        });
        expect(turn().status).toBe('claimed');
        const shortened = ask(SHORT_QUESTION);
        if (path === 'tool') {
          await shortened;
          const replay = await ask(LONG_QUESTION);
          expect(replay.isError).not.toBe(true);
          expect(questions()).toEqual([
            expect.objectContaining({ requestId, questions: [SHORT_QUESTION] }),
          ]);
        }
        await clickShortCard();
        if (path === 'ask') {
          expect(await shortened).toMatchObject({
            content: [{ type: 'text', text: expect.stringContaining('"status":"answered"') }],
          });
        }
      } finally {
        channel.abort();
        await rejected;
      }

      s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepId)).run();
      seedRoute(s, 'coordinator');
      const sent = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
        content: 'Ask me from Cairn.',
      });
      expect(sent.status).toBe(201);
      const webStep = s.db.select().from(step).where(eq(step.status, 'pending')).get()!;
      claim(webStep.id);
      const webRequestId = 'ask-22222222-3333-4444-5555-666666666666';
      const web = await s.app.request(`/api/machine/ask/${webStep.id}?holdMs=0`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: webRequestId, questions: [LONG_QUESTION] }),
      });
      expect(web.status).toBe(200);
      expect(questions()).toContainEqual(
        expect.objectContaining({
          requestId: webRequestId,
          status: 'pending',
          questions: [LONG_QUESTION],
        }),
      );
      expect(posts()).toHaveLength(1);
    },
    8_000,
  );
});

describe('slack adapter', () => {
  let slack: FakeSlack;
  const adapter = createSlackAdapter();

  beforeEach(() => {
    slack = fakeSlackEnv();
  });

  async function readySession(handlers: ImConnectionHandlers) {
    slack.queue('auth.test', AUTH_OK);
    slack.queue('apps.connections.open', OPEN_OK);
    const session = await adapter.connect(
      { appToken: APP_TOKEN, botToken: BOT_TOKEN },
      handlers,
      slack.env,
    );
    await vi.waitFor(() => expect(slack.sockets).toHaveLength(1));
    return session;
  }

  const cardNotice = '内容太长或无法完整显示，这里不提供按钮：请在 Cairn 里查看全文后作答。';
  const chatPosts = () => slack.calls.filter((call) => call.method === 'chat.postMessage');
  const blocksOf = (post: RecordedCall) =>
    (post.body.blocks ?? []) as { type: string; text?: { text: string } }[];
  const sectionsOf = (post: RecordedCall) =>
    blocksOf(post)
      .filter((block) => block.type === 'section')
      .map((block) => block.text?.text ?? '');
  const markdownOf = (post: RecordedCall) =>
    blocksOf(post)
      .filter((block) => block.type === 'markdown')
      .map((block) => block.text as unknown as string);
  const actionBlocksOf = (post: RecordedCall) =>
    blocksOf(post).filter((block) => block.type === 'actions');
  const escaped = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  test('check returns the workspace name from auth.test', async () => {
    slack.queue('auth.test', AUTH_OK);
    const checked = await createSlackAdapter(slack.env).check({
      appToken: APP_TOKEN,
      botToken: BOT_TOKEN,
    });
    expect(checked).toEqual({ ok: true, accountLabel: 'Cairn HQ' });
    expect(slack.calls[0]?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
  });

  test('check rejects malformed tokens without a request', async () => {
    const badApp = await createSlackAdapter(slack.env).check({
      appToken: 'nope',
      botToken: BOT_TOKEN,
    });
    const badBot = await createSlackAdapter(slack.env).check({
      appToken: APP_TOKEN,
      botToken: 'nope',
    });
    expect(badApp.ok).toBe(false);
    expect(badBot.ok).toBe(false);
    expect(slack.calls).toHaveLength(0);
  });

  test('check reports a refused bot token', async () => {
    slack.queue('auth.test', { ok: false, error: 'invalid_auth' });
    const checked = await createSlackAdapter(slack.env).check({
      appToken: APP_TOKEN,
      botToken: BOT_TOKEN,
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.reason).toContain('invalid_auth');
  });

  test('opens a socket from apps.connections.open and is ready on hello', async () => {
    const statuses: string[] = [];
    const session = await readySession({
      onMessage: () => {},
      onStatus: (status) => statuses.push(status),
    });
    expect(slack.calls.map((call) => call.method)).toEqual(['auth.test', 'apps.connections.open']);
    expect(slack.calls[1]?.authorization).toBe(`Bearer ${APP_TOKEN}`);
    expect(slack.sockets[0]?.url).toBe(OPEN_OK.url);
    slack.sockets[0]?.receive({ type: 'hello' });
    await vi.waitFor(() => expect(statuses).toContain('ready'));
    await session.stop();
  });

  test('delivers im messages with the inbound shape and acks the envelope', async () => {
    const inbound: ImInboundMessage[] = [];
    const session = await readySession({
      onMessage: (msg) => inbound.push(msg),
      onStatus: () => {},
    });
    slack.queue('users.info', {
      ok: true,
      user: { name: 'ian', profile: { display_name: 'Ian Chen' } },
    });
    slack.sockets[0]?.receive(imEnvelope('env-1', messageEvent()));
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0]).toMatchObject({
      chat: { key: 'D0DM', kind: 'direct', title: null },
      sender: { id: 'U42', name: 'Ian Chen' },
      text: 'hello cairn',
      images: [],
      messageId: '1700000001.000001',
      mentioned: false,
    });
    expect(slack.sockets[0]?.sent).toContain(JSON.stringify({ envelope_id: 'env-1' }));
    await session.stop();
  });

  test('asks users.info with a query parameter, the form Slack accepts', async () => {
    const inbound: ImInboundMessage[] = [];
    const session = await readySession({
      onMessage: (msg) => inbound.push(msg),
      onStatus: () => {},
    });
    slack.queue('users.info', {
      ok: true,
      user: { name: 'sam', profile: { display_name: 'Sam Example' } },
    });
    slack.sockets[0]?.receive(imEnvelope('e-name', messageEvent()));
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    const lookup = slack.calls.find((call) => call.method === 'users.info');
    expect(lookup?.httpMethod).toBe('GET');
    expect(lookup?.query).toEqual({ user: 'U42' });
    expect(lookup?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
    expect(inbound[0]?.sender.name).toBe('Sam Example');
    await session.stop();
  });

  test('acks but ignores group messages, subtypes, non-message events and the bot itself', async () => {
    const inbound: ImInboundMessage[] = [];
    const session = await readySession({
      onMessage: (msg) => inbound.push(msg),
      onStatus: () => {},
    });
    const socket = slack.sockets[0];
    socket?.receive(imEnvelope('e-chan', messageEvent({ channel_type: 'channel' })));
    socket?.receive(imEnvelope('e-botmsg', messageEvent({ subtype: 'bot_message' })));
    socket?.receive(imEnvelope('e-self', messageEvent({ user: 'U0BOT' })));
    socket?.receive(
      imEnvelope('e-react', { type: 'reaction_added', user: 'U42', reaction: 'eyes' }),
    );
    await vi.waitFor(() => expect(socket?.sent).toHaveLength(4));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(inbound).toHaveLength(0);
    await session.stop();
  });

  test('routes interactive block_actions to onAction and acks the envelope', async () => {
    const actions: ImInboundAction[] = [];
    const session = await readySession({
      onMessage: () => {},
      onAction: (action) => actions.push(action),
      onStatus: () => {},
    });
    const socket = slack.sockets[0];
    socket?.receive({
      envelope_id: 'e-int',
      type: 'interactive',
      payload: {
        type: 'block_actions',
        user: { id: 'U42' },
        channel: { id: 'D0DM' },
        actions: [{ action_id: 'cairn-0-0', type: 'button', value: 'imcb:q-1:1' }],
      },
    });
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    expect(actions[0]).toEqual({
      chat: { key: 'D0DM', kind: 'direct', title: null },
      sender: { id: 'U42', name: null },
      value: 'imcb:q-1:1',
      messageId: 'slack-ia:e-int:cairn-0-0',
    });
    expect(socket?.sent).toContain(JSON.stringify({ envelope_id: 'e-int' }));
    await session.stop();
  });

  test('downloads file_share attachments into the inbound message', async () => {
    const inbound: ImInboundMessage[] = [];
    const session = await readySession({
      onMessage: (msg) => inbound.push(msg),
      onStatus: () => {},
    });
    slack.queue('users.info', {
      ok: true,
      user: { name: 'ian', profile: { display_name: 'Ian' } },
    });
    slack.queue('report.txt', new TextEncoder().encode('hello file'));
    slack.sockets[0]?.receive(
      imEnvelope(
        'e-file',
        messageEvent({
          subtype: 'file_share',
          text: '',
          files: [
            {
              id: 'F1',
              name: 'report.txt',
              mimetype: 'text/plain',
              size: 10,
              url_private_download: 'https://files.slack.com/files-pri/T0-F1/report.txt',
            },
          ],
        }),
      ),
    );
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0]?.files).toHaveLength(1);
    expect(inbound[0]?.files[0]).toMatchObject({ name: 'report.txt', mimeType: 'text/plain' });
    expect(Buffer.from(inbound[0]?.files[0]?.dataBase64 ?? '', 'base64').toString()).toBe(
      'hello file',
    );
    const download = slack.calls.find((call) => call.method === 'report.txt');
    expect(download?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
    await session.stop();
  });

  test('send posts chat.postMessage with the bot token', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1700000002.000002' });
    await session.send({ chatKey: 'D0DM', text: 'hi there' });
    const posts = slack.calls.filter((call) => call.method === 'chat.postMessage');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ channel: 'D0DM', text: 'hi there' });
    expect(posts[0]?.authorization).toBe(`Bearer ${BOT_TOKEN}`);
    expect(slack.calls.map((call) => call.method)).toEqual([
      'auth.test',
      'apps.connections.open',
      'chat.postMessage',
    ]);
    await session.stop();
  });

  test('send cuts the reply fallback before a prepend grapheme that ends in an ampersand', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const head = 'a'.repeat(3_996);
    await session.send({ chatKey: 'D0DM', text: `${head}\u0600&tail` });
    const post = slack.calls.find((call) => call.method === 'chat.postMessage');
    expect(post?.body.text).toBe(head);
    await session.stop();
  });

  test('send escapes angle brackets in a message without buttons so they stay literal', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    await session.send({ chatKey: 'D0DM', text: 'a & <b> c' });
    const post = slack.calls.find((call) => call.method === 'chat.postMessage');
    expect(post?.body.text).toBe('a &amp; &lt;b&gt; c');
    expect(markdownOf(post!)).toEqual(['a &amp; &lt;b&gt; c']);
    await session.stop();
  });

  test('send keeps a labeled link in the question inert inside the card it answers', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const question =
      'ship the *release*? <https://approve.example/now|Approve in Cairn> <@U42> & soon';
    await session.send({
      chatKey: 'D0DM',
      text: question,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const post = slack.calls.find((call) => call.method === 'chat.postMessage');
    expect(post?.body.text).toBe(
      'ship the *release*? &lt;https://approve.example/now|Approve in Cairn&gt; &lt;@U42&gt; &amp; soon',
    );
    expect(post?.body.unfurl_links).toBe(false);
    expect(post?.body.unfurl_media).toBe(false);
    expect(post?.body.mrkdwn).toBe(false);
    expect(post?.body.parse).toBe('none');
    expect(post?.body.blocks).toEqual([
      {
        type: 'section',
        text: { type: 'plain_text', text: question },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            value: 'approve-1',
            action_id: 'cairn-0-0',
          },
        ],
      },
    ]);
    await session.stop();
  });

  test('send answers a blank question with the notice alone', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    slack.queue('chat.postMessage', { ok: true, ts: '2' });
    for (const text of ['', '   ']) {
      await session.send({
        chatKey: 'D0DM',
        text,
        buttons: [[{ label: 'Approve', value: 'approve-1' }]],
      });
    }
    const posts = chatPosts();
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.body)).toEqual([
      { channel: 'D0DM', text: cardNotice },
      { channel: 'D0DM', text: cardNotice },
    ]);
    await session.stop();
  });

  test('send keeps a wide-grapheme question whole across card sections', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = '\u{1f600}'.repeat(1600);
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const post = slack.calls.find((call) => call.method === 'chat.postMessage') as RecordedCall;
    expect(post.body.text).toBe(text);
    expect(sectionsOf(post)).toEqual(['\u{1f600}'.repeat(1500), '\u{1f600}'.repeat(100)]);
    expect(blocksOf(post).at(-1)?.type).toBe('actions');
    await session.stop();
  });

  test('send posts an 8200-character approval as one card', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const recipient = 'Recipient: Sam Example <https://approve.example/now|Approve in Cairn>';
    const details = '调用详情：这一步会向外部服务写入数据，请确认收款方与金额。\n'.repeat(300);
    const text = `${recipient}\n${details}`.slice(0, 8200);
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    const post = posts[0] as RecordedCall;
    expect(post.body.text).toBe(escaped(text));
    expect(post.body.unfurl_links).toBe(false);
    expect(post.body.unfurl_media).toBe(false);
    expect(post.body.mrkdwn).toBe(false);
    expect(post.body.parse).toBe('none');
    expect(markdownOf(post)).toEqual([]);
    const sections = sectionsOf(post);
    expect(sections).toHaveLength(3);
    expect(sections.join('')).toBe(text);
    expect(sections[0]).toContain(recipient);
    expect(blocksOf(post).at(-1)?.type).toBe('actions');
    expect(actionBlocksOf(post)).toHaveLength(1);
    await session.stop();
  });

  test('send keeps leading spaces inside the card', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = `${' '.repeat(2900)}ship it?${'y'.repeat(500)}`;
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    expect(sectionsOf(posts[0] as RecordedCall).join('')).toBe(text);
    expect(blocksOf(posts[0] as RecordedCall).at(-1)?.type).toBe('actions');
    await session.stop();
  });

  test('send keeps a run of 4500 spaces between words inside the card', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = `a${' '.repeat(4500)}b`;
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    expect(sectionsOf(posts[0] as RecordedCall).join('')).toBe(text);
    expect(blocksOf(posts[0] as RecordedCall).at(-1)?.type).toBe('actions');
    await session.stop();
  });

  test('send keeps a run of 6000 spaces between words inside the card', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = `a${' '.repeat(6000)}b`;
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    expect(sectionsOf(posts[0] as RecordedCall).join('')).toBe(text);
    expect(blocksOf(posts[0] as RecordedCall).at(-1)?.type).toBe('actions');
    await session.stop();
  });

  test('send drops the buttons when the card would exceed the block limit', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    slack.queue('chat.postMessage', { ok: true, ts: '2' });
    const rows = Array.from({ length: 50 }, (_, index) => [
      { label: `Option ${index + 1}`, value: `option-${index + 1}` },
    ]);
    await session.send({ chatKey: 'D0DM', text: 'ship it?', buttons: rows });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ channel: 'D0DM', text: cardNotice });
    await session.stop();
  });

  test('send answers an over-limit card with plain text sections', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = `${'x'.repeat(3000)}${' '.repeat(3000)}${'y'.repeat(6500)}`;
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    const post = posts[0] as RecordedCall;
    expect(markdownOf(post)).toEqual([]);
    expect(sectionsOf(post)).toEqual([
      'x'.repeat(3000),
      ' '.repeat(3000),
      'y'.repeat(3000),
      'y'.repeat(3000),
      'y'.repeat(500),
    ]);
    expect(sectionsOf(post).join('')).toBe(text);
    expect(blocksOf(post).at(-1)?.type).toBe('actions');
    await session.stop();
  });

  test('send drops the buttons when the card would exceed the character budget', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = 'x'.repeat(45_000);
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ channel: 'D0DM', text: cardNotice });
    await session.stop();
  });

  test('send keeps the buttons just inside the character budget', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = 'x'.repeat(11000);
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    const post = posts[0] as RecordedCall;
    expect(sectionsOf(post)).toEqual([
      'x'.repeat(3000),
      'x'.repeat(3000),
      'x'.repeat(3000),
      'x'.repeat(2000),
    ]);
    expect(blocksOf(post).at(-1)?.type).toBe('actions');
    await session.stop();
  });

  test('send keeps the card when 49 rows fit the block limit', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const rows = Array.from({ length: 49 }, (_, index) => [
      { label: `Option ${index + 1}`, value: `option-${index + 1}` },
    ]);
    await session.send({ chatKey: 'D0DM', text: 'ship it?', buttons: rows });
    const post = slack.calls.find((call) => call.method === 'chat.postMessage');
    const blocks = post?.body.blocks as { type: string }[];
    expect(blocks).toHaveLength(50);
    expect(blocks[0]).toEqual({
      type: 'section',
      text: { type: 'plain_text', text: 'ship it?' },
    });
    expect(blocks.filter((block) => block.type === 'actions')).toHaveLength(49);
    await session.stop();
  });

  test('send keeps a flag whole when a plain section boundary falls inside it', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const flag = '\u{1f1e8}\u{1f1f3}';
    const text = `${'x'.repeat(2998)}${flag}${'y'.repeat(9500)}`;
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    const sections = sectionsOf(posts[0] as RecordedCall);
    expect(sections[0]).toBe('x'.repeat(2998));
    expect(sections[1]?.startsWith(flag)).toBe(true);
    for (const section of sections) expect(section.length).toBeLessThanOrEqual(3000);
    expect(sections.join('')).toBe(text);
    await session.stop();
  });

  test('send keeps a combining mark whole when a plain section boundary falls inside it', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = `${'x'.repeat(2999)}e\u0301${'y'.repeat(9500)}`;
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const posts = slack.calls.filter((call) => call.method === 'chat.postMessage');
    expect(posts).toHaveLength(1);
    const sections = sectionsOf(posts[0] as RecordedCall);
    expect(sections[0]).toBe('x'.repeat(2999));
    expect(sections[1]?.startsWith('e\u0301')).toBe(true);
    for (const section of sections) expect(section.length).toBeLessThanOrEqual(3000);
    expect(sections.join('')).toBe(text);
    await session.stop();
  });

  test('send renders buttons as block kit actions', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    await session.send({
      chatKey: 'D0DM',
      text: 'choose',
      buttons: [[{ label: 'Approve', value: 'approve-1' }], [{ label: 'No', value: 'no' }]],
    });
    const post = slack.calls.find((call) => call.method === 'chat.postMessage');
    expect(post?.body.blocks).toEqual([
      {
        type: 'section',
        text: { type: 'plain_text', text: 'choose' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            value: 'approve-1',
            action_id: 'cairn-0-0',
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'No' },
            value: 'no',
            action_id: 'cairn-1-0',
          },
        ],
      },
    ]);
    await session.stop();
  });

  test('send delivers markdown source to Slack verbatim in the card', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text =
      'pick **one** or _two_, the ~~old~~ way:\n## Lane\n- first\n  - second\n`code` and [doc](https://docs.example/p)';
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const post = chatPosts()[0] as RecordedCall;
    expect(sectionsOf(post)).toEqual([text]);
    await session.stop();
  });

  test('send keeps inline and fenced code literal in the card', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = 'a < b and `x < y & z` then\n```ts\nif (a && b) { <x> }\n```\ndone';
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const post = chatPosts()[0] as RecordedCall;
    expect(sectionsOf(post)).toEqual([text]);
    await session.stop();
  });

  test('send keeps a non-http link literal inside the plain-text card', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text =
      'read [the doc](https://docs.example/p?q=1&r=2) but not [local](file:///etc/hosts) nor [fn](javascript:alert(1))';
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const post = chatPosts()[0] as RecordedCall;
    const blocks = blocksOf(post);
    expect(markdownOf(post)).toEqual([]);
    expect(blocks.slice(0, -1).every((block) => block.type === 'section')).toBe(true);
    expect(sectionsOf(post).join('')).toBe(text);
    expect(blocks.at(-1)?.type).toBe('actions');
    await session.stop();
  });

  test('send keeps slack control syntax from the text inert in cards and replies', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    slack.queue('chat.postMessage', { ok: true, ts: '2' });
    const text =
      'heads up <!channel> and <!here> and <@U42> or @channel, <https://approve.example/now|Approve in Cairn>';
    const inert =
      'heads up &lt;!channel&gt; and &lt;!here&gt; and &lt;@U42&gt; or @channel, &lt;https://approve.example/now|Approve in Cairn&gt;';
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    await session.send({ chatKey: 'D0DM', text });
    const posts = chatPosts();
    expect(posts).toHaveLength(2);
    expect(sectionsOf(posts[0] as RecordedCall)).toEqual([text]);
    expect(markdownOf(posts[1] as RecordedCall)).toEqual([inert]);
    expect(posts[0]?.body.text).toBe(inert);
    expect(posts[1]?.body.text).toBe(inert);
    await session.stop();
  });

  test('send keeps the card fallback text escaped while the section carries the source', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = '**本次变化** <https://approve.example/now|ok> & co';
    await session.send({
      chatKey: 'D0DM',
      text,
      buttons: [[{ label: 'Approve', value: 'approve-1' }]],
    });
    const post = chatPosts()[0] as RecordedCall;
    expect(post.body.text).toBe('**本次变化** &lt;https://approve.example/now|ok&gt; &amp; co');
    expect(post.body.mrkdwn).toBe(false);
    expect(post.body.parse).toBe('none');
    expect(sectionsOf(post)).toEqual([text]);
    const blocks = post.body.blocks as {
      type: string;
      elements?: { text?: { type?: string } }[];
    }[];
    const buttons = blocks.find((block) => block.type === 'actions')?.elements ?? [];
    expect(buttons[0]?.text?.type).toBe('plain_text');
    await session.stop();
  });

  test('send renders a reply without buttons as a markdown block', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    await session.send({ chatKey: 'D0DM', text: 'reply with **bold** and _soft_' });
    const post = chatPosts()[0] as RecordedCall;
    expect(post.body).toMatchObject({
      channel: 'D0DM',
      text: 'reply with **bold** and _soft_',
      parse: 'none',
      link_names: false,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(markdownOf(post)).toEqual(['reply with **bold** and _soft_']);
    await session.stop();
  });

  test('send posts once when Slack rejects the message', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: false, error: 'invalid_blocks' });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    await expect(
      session.send({
        chatKey: 'D0DM',
        text: 'ship it?',
        buttons: [[{ label: 'Approve', value: 'approve-1' }]],
      }),
    ).rejects.toSatisfy((err) => err instanceof ImSendError && err.kind === 'drop');
    expect(slack.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(1);
    await session.stop();
  });

  test('send surfaces a permanent rejection as a permanent ImSendError', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: false, error: 'channel_not_found' });
    await expect(session.send({ chatKey: 'D0DM', text: 'hi there' })).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'permanent',
    );
    expect(slack.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(1);
    await session.stop();
  });

  test('send posts a long reply as one markdown message without threading', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    await session.send({
      chatKey: 'D0DM',
      text: 'x'.repeat(6500),
      replyToMessageId: '1700000000.000000',
    });
    const posts = slack.calls.filter((call) => call.method === 'chat.postMessage');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.thread_ts).toBeUndefined();
    expect(markdownOf(posts[0] as RecordedCall)).toEqual(['x'.repeat(6500)]);
    await session.stop();
  });

  test('send keeps a whitespace run inside one reply message', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: true, ts: '1' });
    const text = `${'a'.repeat(3000)}${'\n'.repeat(3000)}tail`;
    await session.send({
      chatKey: 'D0DM',
      text,
    });
    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    expect(markdownOf(posts[0] as RecordedCall)).toEqual([text]);
    await session.stop();
  });

  test('send honors retry-after through a retryable ImSendError', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { __http: 429, retryAfter: 7 });
    await expect(session.send({ chatKey: 'D0DM', text: 'hi' })).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'retry' && err.retryAfterMs === 7000,
    );
    await session.stop();
  });

  test('send marks auth failures permanent and expired', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('chat.postMessage', { ok: false, error: 'invalid_auth' });
    await expect(session.send({ chatKey: 'D0DM', text: 'hi' })).rejects.toSatisfy(
      (err) => err instanceof ImSendError && err.kind === 'permanent' && err.authExpired === true,
    );
    await session.stop();
  });

  test('a disconnect envelope triggers a fresh apps.connections.open', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('apps.connections.open', {
      ok: true,
      url: 'wss://wss-primary.slack.com/link/?ticket=t-2',
    });
    slack.sockets[0]?.receive({ type: 'disconnect', reason: 'warning' });
    await vi.waitFor(() => expect(slack.sockets).toHaveLength(2));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(2);
    expect(slack.sockets[0]?.closed).toBe(true);
    expect(slack.sockets[1]?.url).toContain('ticket=t-2');
    await session.stop();
  });

  test('a dropped socket reconnects with backoff', async () => {
    const statuses: { status: string; detail?: string }[] = [];
    const session = await readySession({
      onMessage: () => {},
      onStatus: (status, detail) => statuses.push({ status, detail }),
    });
    slack.sockets[0]?.receive({ type: 'hello' });
    slack.queue('apps.connections.open', PARK);
    slack.sockets[0]?.drop(1006, 'abnormal closure');
    await vi.waitFor(() =>
      expect(
        slack.calls.filter((call) => call.method === 'apps.connections.open').length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(statuses.map((row) => row.status)).toContain('degraded');
    await session.stop();
  });

  test('invalid_auth on apps.connections.open reports expired and stops', async () => {
    slack.queue('auth.test', AUTH_OK);
    slack.queue('apps.connections.open', { ok: false, error: 'invalid_auth' });
    const statuses: string[] = [];
    const session = await adapter.connect(
      { appToken: APP_TOKEN, botToken: BOT_TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      slack.env,
    );
    await vi.waitFor(() => expect(statuses).toContain('expired'));
    const opens = slack.calls.filter((call) => call.method === 'apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(
      opens,
    );
    expect(slack.sockets).toHaveLength(0);
    await session.stop();
  });

  test('link_disabled disconnect reports an error and stops', async () => {
    const statuses: { status: string; detail?: string }[] = [];
    const session = await readySession({
      onMessage: () => {},
      onStatus: (status, detail) => statuses.push({ status, detail }),
    });
    slack.sockets[0]?.receive({ type: 'disconnect', reason: 'link_disabled' });
    await vi.waitFor(() => expect(statuses.map((row) => row.status)).toContain('error'));
    const opens = slack.calls.filter((call) => call.method === 'apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(
      opens,
    );
    await session.stop();
  });

  test('stop closes the socket and halts reconnects', async () => {
    const session = await readySession({ onMessage: () => {}, onStatus: () => {} });
    slack.queue('apps.connections.open', PARK);
    await session.stop();
    expect(slack.sockets[0]?.closed).toBe(true);
    const opens = slack.calls.filter((call) => call.method === 'apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(
      opens,
    );
  });

  test('persistent initial connection failures transition to degraded instead of staying connecting', async () => {
    const statuses: string[] = [];
    slack.queue('auth.test', AUTH_OK);
    slack.queue('apps.connections.open', { __http: 500 });
    slack.queue('apps.connections.open', { __http: 500 });
    slack.queue('apps.connections.open', PARK);
    const session = await adapter.connect(
      { appToken: APP_TOKEN, botToken: BOT_TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      slack.env,
    );
    await vi.waitFor(() => expect(statuses).toContain('degraded'));
    await session.stop();
  });

  test('missing_scope on apps.connections.open reports error and stops retrying', async () => {
    const statuses: string[] = [];
    slack.queue('auth.test', AUTH_OK);
    slack.queue('apps.connections.open', { ok: false, error: 'missing_scope' });
    const session = await adapter.connect(
      { appToken: APP_TOKEN, botToken: BOT_TOKEN },
      { onMessage: () => {}, onStatus: (status) => statuses.push(status) },
      slack.env,
    );
    await vi.waitFor(() => expect(statuses).toContain('error'));
    const opens = slack.calls.filter((call) => call.method === 'apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slack.calls.filter((call) => call.method === 'apps.connections.open')).toHaveLength(
      opens,
    );
    await session.stop();
  });

  test('stop resolves immediately while sleeping in reconnect backoff', async () => {
    slack.queue('auth.test', AUTH_OK);
    slack.queue('apps.connections.open', { __http: 500 });
    const envWithRealSleep: ImEnv = {
      ...slack.env,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
    const session = await adapter.connect(
      { appToken: APP_TOKEN, botToken: BOT_TOKEN },
      { onMessage: () => {}, onStatus: () => {} },
      envWithRealSleep,
    );
    await vi.waitFor(() => expect(slack.calls.length).toBeGreaterThanOrEqual(2));
    const startedStop = Date.now();
    await session.stop();
    expect(Date.now() - startedStop).toBeLessThan(500);
  });
});
