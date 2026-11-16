import { setTimeout as delay } from 'node:timers/promises';
import {
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { StepEvent } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';
import { boot, CLAIMED, defer, FakeMachineApi, waitFor } from './machine-loop-harness.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn(),
}));

afterEach(() => {
  vi.mocked(query).mockReset();
});

test('TH-13: steer posted at 1 s waits for a 5 s claude-code tool result without cancelling the tool', async () => {
  const api = new FakeMachineApi();
  const steerText = 'Use the tool result to finish the task.';
  api.steerResponse = steerText;
  const order: string[] = [];
  const interrupt = vi.fn(async () => {});
  let toolCancelled = false;
  let toolStartedAt = 0;
  let toolFinishedAt = 0;
  let steerPostedAt = 0;
  let steerDeliveredAt = 0;
  let postSteer: ReturnType<typeof setTimeout> | undefined;
  vi.mocked(query).mockImplementation(({ prompt, options }) => {
    if (typeof prompt === 'string') throw new Error('Expected streaming input');
    const input = prompt[Symbol.asyncIterator]();
    const messages = (async function* (): AsyncGenerator<SDKMessage, void> {
      await input.next();
      const steered = input.next().then((message) => {
        if (!message.done) {
          steerDeliveredAt = Date.now();
          order.push('steer_delivered');
          expect(message.value.message.content).toBe(steerText);
        }
        return message;
      });
      toolStartedAt = Date.now();
      order.push('tool_started');
      postSteer = setTimeout(() => {
        steerPostedAt = Date.now();
        order.push('steer_posted');
        api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
      }, 1_000);
      const tool = delay(5_000, undefined, { signal: options?.abortController?.signal });
      yield {
        type: 'assistant',
        user_message_uuid: 'initial-user',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-sleep', name: 'Bash', input: { command: 'sleep 5' } },
          ],
        },
      } as SDKMessage;
      try {
        await tool;
      } catch (error) {
        toolCancelled = true;
        throw error;
      }
      toolFinishedAt = Date.now();
      order.push('tool_result');
      yield {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-sleep',
              content: 'Tool completed',
              is_error: false,
            },
          ],
        },
        parent_tool_use_id: null,
      };
      const delivered = await steered;
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        user_message_uuids: [delivered.value?.uuid],
      } as SDKMessage;
    })();
    return Object.assign(messages, { interrupt }) as unknown as Query;
  });
  const { handle } = await boot({ api, claudeCodeBackend: createClaudeCodeBackend({}) });
  try {
    await waitFor(() => api.parked !== null);
    api.parked?.({ ...CLAIMED, agent: { ...CLAIMED.agent!, provider: 'claude-code' } });
    await waitFor(() => api.doneBodies.length === 1, 8_000);
    expect(order).toEqual(['tool_started', 'steer_posted', 'tool_result', 'steer_delivered']);
    expect(steerPostedAt - toolStartedAt).toBeGreaterThanOrEqual(950);
    expect(steerPostedAt).toBeLessThan(toolFinishedAt);
    expect(toolFinishedAt - toolStartedAt).toBeGreaterThanOrEqual(4_950);
    expect(steerDeliveredAt).toBeGreaterThanOrEqual(toolFinishedAt);
    expect(toolCancelled).toBe(false);
    expect(interrupt).not.toHaveBeenCalled();
    expect(api.calls).toContain('steer-ack:s1');
    expect(api.toolCalls.map(({ call }) => call.result)).toEqual([undefined, 'Tool completed']);
    expect(api.toolCalls[1]?.call.isError).toBe(false);
    expect(api.doneBodies[0]?.body.status).toBe('success');
  } finally {
    clearTimeout(postSteer);
    await handle.stop();
    await handle.done;
  }
}, 12_000);

function toolStart(ids: string[]): SDKMessage {
  return {
    type: 'assistant',
    user_message_uuid: 'initial-user',
    message: {
      role: 'assistant',
      content: ids.map((id) => ({ type: 'tool_use', id, name: 'Bash', input: {} })),
    },
  } as SDKMessage;
}

function toolResult(id: string, isError = false): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: id, content: 'Tool finished', is_error: isError },
      ],
    },
    parent_tool_use_id: null,
  };
}

async function controlledSession(messages: AsyncGenerator<SDKMessage, void>) {
  const received: SDKUserMessage[] = [];
  const interrupt = vi.fn(async () => {});
  vi.mocked(query).mockImplementation(({ prompt }) => {
    if (typeof prompt === 'string') throw new Error('Expected streaming input');
    void (async () => {
      for await (const message of prompt) received.push(message);
    })();
    const stream = (async function* () {
      yield* messages;
      yield {
        ...RESULT,
        user_message_uuids: received.slice(1).map((message) => message.uuid),
      } as SDKMessage;
    })();
    return Object.assign(stream, { interrupt }) as unknown as Query;
  });
  const handle = await createClaudeCodeBackend({}).createSession({
    provider: { kind: 'http', providerId: 'fake-claude' },
    modelId: 'fake-model',
    cwd: '/tmp',
    prompt: 'Begin the task.',
  });
  const events: StepEvent[] = [];
  const collected = (async () => {
    for await (const event of handle.events) events.push(event);
  })();
  return { handle, received, events, collected, interrupt };
}

test('parallel tools hold queued steers in order, including images, until every tool returns', async () => {
  const firstTool = defer();
  const lastTool = defer();
  const end = defer();
  const { handle, received, events, collected, interrupt } = await controlledSession(
    (async function* () {
      yield toolStart(['first', 'last']);
      await firstTool.promise;
      yield toolResult('first');
      await lastTool.promise;
      yield toolResult('last', true);
      await end.promise;
    })(),
  );
  try {
    await waitFor(() => events.filter((event) => event.type === 'toolcall_end').length === 2);
    const image = { data: 'aW1n', mimeType: 'image/png' };
    const firstSteer = handle.steer('First steer', [image]);
    const lastSteer = handle.steer('Last steer');
    await delay(0);
    expect(received).toHaveLength(1);
    expect(events.some((event) => event.type === 'steer')).toBe(false);
    firstTool.resolve();
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === 'toolcall_end' &&
          event.call.id === 'first' &&
          event.call.result !== undefined,
      ),
    );
    expect(received).toHaveLength(1);
    expect(events.some((event) => event.type === 'steer')).toBe(false);
    lastTool.resolve();
    await waitFor(() => received.length === 3);
    end.resolve();
    await Promise.all([firstSteer, lastSteer]);
    await waitFor(() => events.filter((event) => event.type === 'steer').length === 2);
    expect(received.slice(1).map((message) => message.message.content)).toEqual([
      [
        { type: 'text', text: 'First steer' },
        { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
      ],
      'Last steer',
    ]);
    expect(
      events
        .filter((event) => event.type === 'toolcall_end' || event.type === 'steer')
        .map((event) =>
          event.type === 'steer'
            ? event.text
            : `${event.call.id}:${event.call.result === undefined ? 'start' : 'result'}`,
        ),
    ).toEqual([
      'first:start',
      'last:start',
      'first:result',
      'last:result',
      'First steer',
      'Last steer',
    ]);
    expect(interrupt).not.toHaveBeenCalled();
  } finally {
    firstTool.resolve();
    lastTool.resolve();
    end.resolve();
    await handle.stop();
    await collected;
  }
});

test.each([false, true])(
  'a tool result without content releases queued and later steers (is_error=%s)',
  async (isError) => {
    const otherTool = defer();
    const emptyTool = defer();
    const end = defer();
    const completion: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'empty', ...(isError ? { is_error: true } : {}) },
        ],
      },
      parent_tool_use_id: null,
    };
    const { handle, received, events, collected, interrupt } = await controlledSession(
      (async function* () {
        yield toolStart(['other', 'empty']);
        await otherTool.promise;
        yield toolResult('other');
        await emptyTool.promise;
        yield completion;
        await end.promise;
      })(),
    );
    try {
      await waitFor(() => events.filter((event) => event.type === 'toolcall_end').length === 2);
      const steering = handle.steer('Queued instruction').then(
        () => 'delivered',
        () => 'rejected',
      );
      otherTool.resolve();
      await waitFor(() => events.filter((event) => event.type === 'toolcall_end').length === 3);
      expect(received).toHaveLength(1);
      expect(events.some((event) => event.type === 'steer')).toBe(false);
      emptyTool.resolve();
      await waitFor(() => received.length === 2);
      expect(events.at(-1)).toMatchObject({
        type: 'toolcall_end',
        call: { id: 'empty', result: undefined, isError },
      });
      const later = handle.steer('Later instruction');
      await waitFor(() => received.length === 3);
      expect(received.slice(1).map((message) => message.message.content)).toEqual([
        'Queued instruction',
        'Later instruction',
      ]);
      end.resolve();
      expect(await steering).toBe('delivered');
      await later;
      expect(interrupt).not.toHaveBeenCalled();
    } finally {
      otherTool.resolve();
      emptyTool.resolve();
      end.resolve();
      await handle.stop();
      await collected;
    }
  },
);

test.each(['stop', 'error', 'end'] as const)(
  'a queued steer is rejected when the session closes via %s',
  async (closure) => {
    const end = defer();
    const { handle, received, events, collected } = await controlledSession(
      (async function* () {
        yield toolStart(['unfinished']);
        await end.promise;
        if (closure === 'error') throw new Error('Fake backend failed');
      })(),
    );
    try {
      await waitFor(() => events.some((event) => event.type === 'toolcall_end'));
      const steering = handle.steer('Queued steer').then(
        () => 'delivered',
        () => 'rejected',
      );
      if (closure === 'stop') await handle.stop();
      end.resolve();
      await collected;
      expect(await steering).toBe('rejected');
      expect(received).toHaveLength(1);
      expect(events.some((event) => event.type === 'steer')).toBe(false);
      await expect(handle.steer('Late steer')).rejects.toThrow();
    } finally {
      end.resolve();
      await handle.stop();
      await collected;
    }
  },
);

test('steer is delivered immediately when no tool is running', async () => {
  const end = defer();
  const { handle, received, events, collected } = await controlledSession(
    (async function* () {
      yield toolStart(['completed']);
      yield toolResult('completed');
      await end.promise;
    })(),
  );
  try {
    await waitFor(() =>
      events.some((event) => event.type === 'toolcall_end' && event.call.result !== undefined),
    );
    const delivery = handle.steer('Next instruction');
    await waitFor(() => received.length === 2);
    expect(received[1]?.message.content).toBe('Next instruction');
    end.resolve();
    await delivery;
    await waitFor(() => events.some((event) => event.type === 'steer'));
  } finally {
    end.resolve();
    await handle.stop();
    await collected;
  }
});

function finalText(text: string): SDKMessage {
  return {
    type: 'assistant',
    user_message_uuid: 'initial-user',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  } as SDKMessage;
}

const RESULT = { type: 'result', subtype: 'success', is_error: false } as SDKMessage;

async function cliSession(
  turn: (input: AsyncIterator<SDKUserMessage>) => AsyncGenerator<SDKMessage, void>,
) {
  vi.mocked(query).mockImplementation(({ prompt }) => {
    if (typeof prompt === 'string') throw new Error('Expected streaming input');
    return Object.assign(turn(prompt[Symbol.asyncIterator]()), {
      interrupt: vi.fn(async () => {}),
    }) as unknown as Query;
  });
  const handle = await createClaudeCodeBackend({}).createSession({
    provider: { kind: 'http', providerId: 'fake-claude' },
    modelId: 'fake-model',
    cwd: '/tmp',
    prompt: 'Open the browser.',
  });
  const events: StepEvent[] = [];
  const collected = (async () => {
    for await (const event of handle.events) events.push(event);
  })();
  return { handle, events, collected };
}

const replies = (events: StepEvent[]) =>
  events.flatMap((event) =>
    event.type === 'message_end' && Array.isArray(event.message.content)
      ? event.message.content.flatMap((block) =>
          (block as { type?: string }).type === 'text' ? [(block as { text: string }).text] : [],
        )
      : [],
  );

test('an enqueued late steer is not consumed by a result for the preceding answer', async () => {
  const finish = defer();
  const backlog = defer();
  const preceding = defer();
  let submitted = false;
  const { handle, events, collected } = await cliSession(async function* (input) {
    const initial = await input.next();
    yield finalText('1 + 3 = 4');
    await finish.promise;
    yield { ...RESULT, user_message_uuids: [initial.value?.uuid] } as SDKMessage;
    preceding.resolve();
    await backlog.promise;
    const late = await input.next();
    if (!late.done) {
      submitted = true;
      yield finalText('2 + 4 = 6');
      yield { ...RESULT, user_message_uuids: [late.value.uuid] } as SDKMessage;
    }
  });
  await waitFor(() => replies(events).length === 1);
  let acknowledged = false;
  const delivery = handle.steer('No, 2 + 4').then(
    () => {
      acknowledged = true;
      return 'consumed';
    },
    () => 'unread',
  );
  await delay(0);
  finish.resolve();
  await preceding.promise;
  await delay(0);
  expect(acknowledged).toBe(false);
  backlog.resolve();
  await collected;
  expect(await delivery).toBe('consumed');
  expect(submitted).toBe(true);
  expect(replies(events)).toEqual(['1 + 3 = 4', '2 + 4 = 6']);
});

test.each([false, true])(
  'a transmitted UUID stays unread when the Query ends without its receipt (crash=%s)',
  async (crash) => {
    const finish = defer();
    const transmitted = defer();
    const { handle, events, collected } = await cliSession(async function* (input) {
      const initial = await input.next();
      yield finalText('1 + 3 = 4');
      const late = await input.next();
      expect(late.value?.message.content).toBe('No, 2 + 4');
      transmitted.resolve();
      await finish.promise;
      if (crash) throw new Error('CLI exited before reading the supplement');
      yield { ...RESULT, user_message_uuids: [initial.value?.uuid] } as SDKMessage;
    });
    await waitFor(() => replies(events).length === 1);
    const delivery = handle.steer('No, 2 + 4').then(
      () => 'consumed',
      () => 'unread',
    );
    await transmitted.promise;
    finish.resolve();
    await collected;
    expect(await delivery).toBe('unread');
    expect(events.some((event) => event.type === 'steer')).toBe(false);
  },
);

test.each([false, true])(
  'only a matching consumed UUID in the SDK result acknowledges a steer (error=%s)',
  async (error) => {
    const finish = defer();
    const consumed = defer();
    const { handle, events, collected } = await cliSession(async function* (input) {
      await input.next();
      yield toolStart(['first']);
      yield toolResult('first');
      const steer = await input.next();
      yield steer.value as SDKMessage;
      consumed.resolve();
      await finish.promise;
      yield finalText('6');
      yield { ...RESULT, is_error: error, user_message_uuids: [steer.value?.uuid] } as SDKMessage;
    });
    await waitFor(() => events.some((event) => event.type === 'toolcall_end'));
    let acknowledged = false;
    const delivery = handle.steer('Calculate 2 + 4').then(() => {
      acknowledged = true;
    });
    await consumed.promise;
    await delay(0);
    expect.soft(acknowledged).toBe(false);
    finish.resolve();
    await collected;
    await delivery;
    expect(replies(events)).toEqual(['6']);
    expect(events.filter((event) => event.type === 'steer')).toEqual([
      { type: 'steer', text: 'Calculate 2 + 4' },
    ]);
  },
);

test('an older SDK without a consumed UUID receipt leaves the steer unread', async () => {
  const finish = defer();
  const { handle, events, collected } = await cliSession(async function* (input) {
    await input.next();
    const frame = finalText('First answer') as unknown as Record<string, unknown>;
    delete frame.user_message_uuid;
    yield frame as SDKMessage;
    await finish.promise;
    yield RESULT;
    expect((await input.next()).done).toBe(true);
  });
  await waitFor(() => replies(events).length === 1);
  const delivery = handle.steer('Keep this supplement').then(
    () => 'consumed',
    () => 'unread',
  );
  finish.resolve();
  await collected;
  expect(await delivery).toBe('unread');
  expect(events.some((event) => event.type === 'steer')).toBe(false);
});

test('a steer that lands after the final reply but before the result gets its own turn', async () => {
  const steered = defer();
  const { handle, events, collected } = await cliSession(async function* (input) {
    await input.next();
    yield finalText('Browser is open on example.com.');
    await steered.promise;
    yield RESULT;
    for (let next = await input.next(); !next.done; next = await input.next()) {
      yield finalText(`Opening ${String(next.value.message.content)}`);
      yield { ...RESULT, user_message_uuids: [next.value.uuid] } as SDKMessage;
    }
  });
  await waitFor(() => replies(events).length === 1);
  const delivery = handle.steer('zhipin.com');
  steered.resolve();
  await collected;
  await delivery;
  expect(replies(events)).toEqual(['Browser is open on example.com.', 'Opening zhipin.com']);
  expect(events.map((event) => event.type).filter((type) => type === 'done')).toEqual(['done']);
  expect(events.at(-1)?.type).toBe('done');
  await expect(handle.steer('too late')).rejects.toThrow('closed before steer delivery');
});

test('a successful turn stays successful when the CLI fails while exiting after its result', async () => {
  const { events, collected } = await cliSession(async function* (input) {
    await input.next();
    yield finalText('Done.');
    yield RESULT;
    await input.next();
    throw new Error('Claude Code process exited with code 1');
  });
  await collected;
  expect(events.at(-1)?.type).toBe('done');
  expect(events.some((event) => event.type === 'error')).toBe(false);
});
