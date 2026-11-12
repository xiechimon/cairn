import type { MachineAskBody, MachineAskResponse, MachineSteerAckBody } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ASK_KEEP_ALIVE_INTERVAL_MS, AskChannel } from '../src/ask-channel.js';

type AskUser = (
  stepId: string,
  body: MachineAskBody,
  opts?: { signal?: AbortSignal },
) => Promise<MachineAskResponse>;

function answered(requestId: string): MachineAskResponse {
  return { status: 'answered', requestId, answers: [], reason: null };
}

function channelWith(askUser: AskUser | undefined) {
  const acks: MachineSteerAckBody[] = [];
  const logs: string[] = [];
  const asked: MachineAskBody[] = [];
  const channel = new AskChannel({
    client: {
      ...(askUser !== undefined
        ? {
            askUser: (stepId, body, opts) => {
              asked.push(body);
              return askUser(stepId, body, opts);
            },
          }
        : {}),
      steerAck: async (_stepId, body) => {
        if (body !== undefined) acks.push(body);
      },
    },
    stepId: 'step-1',
    log: (message) => logs.push(message),
  });
  return { channel, acks, logs, asked };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AskChannel', () => {
  test('reports whether the client can ask and refuses to ask without it', async () => {
    const { channel } = channelWith(undefined);
    expect(channel.available).toBe(false);
    await expect(channel.ask({})).rejects.toThrow('ask channel unavailable');
  });

  test('sends the questions and provenance and returns the response as JSON', async () => {
    const { channel, asked } = channelWith(async (_stepId, body) => answered(body.requestId));
    expect(channel.available).toBe(true);
    const questions = [{ id: 'q1' }];
    const raw = await channel.ask({ questions, provenance: 'plan', ignored: 1 });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.requestId).toMatch(/^ask-/);
    expect(asked[0]).toEqual({ requestId: asked[0]?.requestId, questions, provenance: 'plan' });
    expect(JSON.parse(raw)).toEqual({
      status: 'answered',
      requestId: asked[0]?.requestId,
      answers: [],
      reason: null,
    });
  });

  test('acknowledges an answered poll once a tool result carries its request id', async () => {
    const { channel, acks, asked } = channelWith(async (_stepId, body) => answered(body.requestId));
    await channel.ask({ questions: [] });
    const requestId = asked[0]?.requestId ?? '';
    await channel.ackPollsReachedBy({ text: 'unrelated' });
    expect(acks).toEqual([]);
    await channel.ackPollsReachedBy({ text: `result for ${requestId}` });
    expect(acks).toEqual([{ answerIds: [requestId], via: 'poll' }]);
    await channel.ackPollsReachedBy({ text: `result for ${requestId}` });
    expect(acks).toHaveLength(1);
  });

  test('does not track a poll that was not answered', async () => {
    const { channel, acks, asked } = channelWith(async (_stepId, body) => ({
      status: 'cancelled',
      requestId: body.requestId,
      answers: null,
      reason: 'closed',
    }));
    await channel.ask({ questions: [] });
    await channel.ackPollsReachedBy({ text: asked[0]?.requestId });
    expect(acks).toEqual([]);
  });

  test('turns a failed ask into a cancelled response', async () => {
    const { channel } = channelWith(async () => {
      throw new Error('socket closed');
    });
    const parsed = JSON.parse(await channel.ask({ questions: [] }));
    expect(parsed).toMatchObject({
      status: 'cancelled',
      answers: null,
      reason: 'ask channel aborted: socket closed',
    });
    expect(parsed.requestId).toMatch(/^ask-/);
  });

  test('abort cancels an ask in flight and its answer is not tracked', async () => {
    const { channel, acks, asked } = channelWith(
      (_stepId, body, opts) =>
        new Promise((resolve) => {
          opts?.signal?.addEventListener('abort', () => resolve(answered(body.requestId)));
        }),
    );
    const pending = channel.ask({ questions: [] });
    channel.abort();
    await pending;
    await channel.ackPollsReachedBy({ text: asked[0]?.requestId });
    expect(acks).toEqual([]);
  });

  test('calls keepAlive on an interval while an ask is in flight and stops afterwards', async () => {
    vi.useFakeTimers();
    let release: (value: MachineAskResponse) => void = () => {};
    const { channel } = channelWith(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const keepAlive = vi.fn();
    channel.keepAlive = keepAlive;
    const pending = channel.ask({ questions: [] });
    await vi.advanceTimersByTimeAsync(ASK_KEEP_ALIVE_INTERVAL_MS * 2);
    expect(keepAlive).toHaveBeenCalledTimes(2);
    release(answered('ask-x'));
    await pending;
    await vi.advanceTimersByTimeAsync(ASK_KEEP_ALIVE_INTERVAL_MS * 2);
    expect(keepAlive).toHaveBeenCalledTimes(2);
  });

  test('skips an empty acknowledgement and logs a failed one', async () => {
    const logs: string[] = [];
    const steerAck = vi.fn(async () => {
      throw new Error('offline');
    });
    const channel = new AskChannel({
      client: { steerAck },
      stepId: 'step-1',
      log: (message) => logs.push(message),
    });
    await channel.ackAnswers([], 'session-start');
    expect(steerAck).not.toHaveBeenCalled();
    await channel.ackAnswers(['a1'], 'session-start');
    expect(steerAck).toHaveBeenCalledWith('step-1', { answerIds: ['a1'], via: 'session-start' });
    expect(logs).toEqual(['answer ack failed: offline']);
  });
});
