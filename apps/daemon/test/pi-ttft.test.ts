import { describe, expect, test } from 'vitest';
import {
  type AgentSessionEventLike,
  mapPiSessionEvent,
  newMapState,
  notePromptSent,
} from '../src/backend/pi.js';

function clock(start: number) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const delta = (type: string, model = 'm1'): AgentSessionEventLike => ({
  type: 'message_update',
  message: { role: 'assistant', provider: 'gw', model },
  assistantMessageEvent: { type, delta: 'x' },
});

const end = (model = 'm1'): AgentSessionEventLike => ({
  type: 'message_end',
  message: {
    role: 'assistant',
    provider: 'gw',
    model,
    stopReason: 'stop',
    usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 0 },
  },
});

function settle(state: ReturnType<typeof newMapState>) {
  const [done] = mapPiSessionEvent({ type: 'agent_settled' }, state);
  return done?.type === 'done' ? done.usage : [];
}

describe('pi sessions measure time to first token from the prompt send', () => {
  test('the first streamed delta after the prompt sets ttftMs on that model', () => {
    const c = clock(1000);
    const state = newMapState({ now: c.now });
    notePromptSent(state);
    c.advance(250);
    mapPiSessionEvent(delta('thinking_delta'), state);
    c.advance(400);
    mapPiSessionEvent(delta('text_delta'), state);
    mapPiSessionEvent(end(), state);
    expect(settle(state)).toEqual([
      { model: 'gw/m1', input: 10, output: 2, cacheRead: 5, cacheWrite: 0, ttftMs: 250 },
    ]);
  });

  test('a tool call with no text still counts as the first token', () => {
    const c = clock(0);
    const state = newMapState({ now: c.now });
    notePromptSent(state);
    c.advance(90);
    mapPiSessionEvent(delta('toolcall_delta'), state);
    mapPiSessionEvent(end(), state);
    expect(settle(state)[0]?.ttftMs).toBe(90);
  });

  test('later assistant messages in the same turn do not overwrite it', () => {
    const c = clock(0);
    const state = newMapState({ now: c.now });
    notePromptSent(state);
    c.advance(100);
    mapPiSessionEvent(delta('text_delta'), state);
    mapPiSessionEvent(end(), state);
    c.advance(5000);
    mapPiSessionEvent(delta('text_delta'), state);
    mapPiSessionEvent(end(), state);
    expect(settle(state)[0]?.ttftMs).toBe(100);
  });

  test('only the model that streamed first carries it', () => {
    const c = clock(0);
    const state = newMapState({ now: c.now });
    notePromptSent(state);
    c.advance(70);
    mapPiSessionEvent(delta('text_delta', 'm1'), state);
    mapPiSessionEvent(end('m1'), state);
    mapPiSessionEvent(delta('text_delta', 'm2'), state);
    mapPiSessionEvent(end('m2'), state);
    expect(settle(state).map((u) => [u.model, u.ttftMs])).toEqual([
      ['gw/m1', 70],
      ['gw/m2', undefined],
    ]);
  });

  test('without a prompt send there is no ttftMs', () => {
    const state = newMapState({ now: () => 5 });
    mapPiSessionEvent(delta('text_delta'), state);
    mapPiSessionEvent(end(), state);
    expect(settle(state)[0]).not.toHaveProperty('ttftMs');
  });

  test('a stream event that carries no content does not stop the clock', () => {
    const c = clock(0);
    const state = newMapState({ now: c.now });
    notePromptSent(state);
    c.advance(10);
    mapPiSessionEvent(delta('start'), state);
    c.advance(30);
    mapPiSessionEvent(delta('text_delta'), state);
    mapPiSessionEvent(end(), state);
    expect(settle(state)[0]?.ttftMs).toBe(40);
  });
});
