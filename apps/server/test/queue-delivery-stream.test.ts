import { conversationStreamEventSchema } from '@cairn/shared';
import { expect, test } from 'vitest';
import { ConversationStreamHub } from '../src/services/events.js';

test('rollover forwards a valid destination envelope without changing source live buffers', () => {
  const hub = new ConversationStreamHub();
  const sourceFrames: object[] = [];
  const targetFrames: object[] = [];
  hub.publishTextDelta('source', 'Source reply');
  hub.publishThinkingDelta('source', 'Source thinking');
  hub.subscribe('source', {
    nextSeq: () => 1,
    send: async (event) => {
      sourceFrames.push(event);
    },
  });
  hub.subscribe('target', {
    nextSeq: () => 1,
    send: async (event) => {
      targetFrames.push(event);
    },
  });
  const message = {
    id: 'delivered',
    role: 'user' as const,
    content: 'Continue',
    createdAt: 3,
    actor: null,
  };
  const deliveredQueue = { conversationId: 'source', messageId: 'queued' };
  hub.publishMessage('target', message, deliveredQueue);
  const event = { type: 'message', message, deliveredQueue };
  expect(targetFrames).toEqual([event]);
  expect(sourceFrames.at(-1)).toEqual({ ...event, conversationId: 'target' });
  expect(conversationStreamEventSchema.parse(sourceFrames.at(-1))).toEqual(sourceFrames.at(-1));
  const replay: object[] = [];
  hub.subscribe('source', {
    nextSeq: () => 1,
    send: async (frame) => {
      replay.push(frame);
    },
  });
  expect(replay).toEqual([
    { type: 'text_delta', text: 'Source reply' },
    { type: 'thinking_delta', text: 'Source thinking' },
  ]);
});

test('same-build delivery emits once and uncorrelated messages stay stream-local', () => {
  const hub = new ConversationStreamHub();
  const sourceFrames: object[] = [];
  const targetFrames: object[] = [];
  hub.subscribe('source', {
    nextSeq: () => 1,
    send: async (event) => {
      sourceFrames.push(event);
    },
  });
  hub.subscribe('target', {
    nextSeq: () => 1,
    send: async (event) => {
      targetFrames.push(event);
    },
  });
  const message = {
    id: 'delivered',
    role: 'user' as const,
    content: 'Continue',
    createdAt: 3,
    actor: null,
  };
  const deliveredQueue = { conversationId: 'source', messageId: 'queued' };
  hub.publishMessage('source', message, deliveredQueue);
  expect(sourceFrames).toEqual([{ type: 'message', message, deliveredQueue }]);
  hub.publishMessage('target', message);
  hub.publishMessage('target', { ...message, role: 'assistant' }, deliveredQueue);
  expect(sourceFrames).toHaveLength(1);
  expect(targetFrames).toHaveLength(2);
});
