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
      await steered;
      yield { type: 'result', subtype: 'success', is_error: false } as SDKMessage;
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
    return Object.assign(messages, { interrupt }) as unknown as Query;
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
      await waitFor(() => events.some((event) => event.type === 'steer'));
      expect(await steering).toBe('delivered');
      expect(events.slice(-2).map((event) => event.type)).toEqual(['toolcall_end', 'steer']);
      expect(events.at(-2)).toMatchObject({
        type: 'toolcall_end',
        call: { id: 'empty', result: undefined, isError },
      });
      await handle.steer('Later instruction');
      await waitFor(() => received.length === 3);
      expect(received.slice(1).map((message) => message.message.content)).toEqual([
        'Queued instruction',
        'Later instruction',
      ]);
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
    await handle.steer('Next instruction');
    await waitFor(() => received.length === 2);
    expect(received[1]?.message.content).toBe('Next instruction');
    await waitFor(() => events.some((event) => event.type === 'steer'));
  } finally {
    end.resolve();
    await handle.stop();
    await collected;
  }
});
