import type { ConversationMessagesResponse } from '@cairn/shared';
import { type InfiniteData, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ApiMutations, useApiMutations } from '../src/api/hooks.js';
import { cacheUserMessage, moveQueueToReplacement } from '../src/api/message-cache.js';

const message = { id: 'confirmed', role: 'user', content: 'A confirmed message', createdAt: 3 };
const key = ['messages', 'build-1', 'pages'];
const clients: QueryClient[] = [];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(qc);
  let mutations: ApiMutations | undefined;
  function Harness() {
    mutations = useApiMutations('t1');
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
  if (mutations === undefined) throw new Error('Mutation harness did not render');
  return { qc, mutations };
}

function newest(qc: QueryClient) {
  return qc.getQueryData<InfiniteData<ConversationMessagesResponse>>(key)?.pages[0];
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const qc of clients.splice(0)) qc.clear();
});

it('uses a confirmed steer response without SSE or a GET and deduplicates the later event', async () => {
  const { qc, mutations } = setup();
  vi.spyOn(api, 'post').mockResolvedValue({ conversationId: 'build-1', message });
  await mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: message.content });
  cacheUserMessage(qc, 'build-1', message);
  expect(newest(qc)?.messages).toEqual([message]);
});

it('keeps a queue acknowledgement separate from delivered messages', async () => {
  const { qc, mutations } = setup();
  const queued = { id: 'queued', content: 'After this turn', createdAt: 4, deliverAfterStop: false };
  vi.spyOn(api, 'post').mockResolvedValue({ conversationId: 'build-1', message: queued });
  await mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: queued.content, mode: 'queue' });
  expect(newest(qc)?.messages).toEqual([]);
  expect(newest(qc)?.queuedMessages).toEqual([{ id: queued.id, content: queued.content, createdAt: 4 }]);
});

it.each([{ conversationId: 'build-1' }, { conversationId: 'build-1', message: { id: 'queued', content: 'Edited' } }])('does not interpret queue operations as transcript confirmations: %j', async (result) => {
  const { qc, mutations } = setup();
  vi.spyOn(api, 'post').mockResolvedValue(result);
  await mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: 'Edited', queuedMessageId: 'queued', editQueued: true });
  expect(newest(qc)).toBeUndefined();
});

it.each(['build-1', 'replacement-build'])('removes a delivered capsule from its source when the target is %s without relying on GET', async (target) => {
  const { qc, mutations } = setup();
  cacheUserMessage(qc, 'build-1', { id: 'queued', content: message.content, createdAt: 2, deliverAfterStop: false });
  vi.spyOn(api, 'post').mockResolvedValue({ conversationId: target, message });
  await mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: message.content, queuedMessageId: 'queued' });
  expect(newest(qc)?.queuedMessages).toEqual([]);
  expect(qc.getQueryData<InfiniteData<ConversationMessagesResponse>>(['messages', target, 'pages'])?.pages[0]?.messages).toEqual([message]);
});

it('retains a queued capsule when delivery fails', async () => {
  const { qc, mutations } = setup();
  cacheUserMessage(qc, 'build-1', { id: 'queued', content: message.content, createdAt: 2, deliverAfterStop: false });
  vi.spyOn(api, 'post').mockRejectedValue(new Error('Delivery refused'));
  await expect(mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: message.content, queuedMessageId: 'queued' })).rejects.toThrow('Delivery refused');
  expect(newest(qc)?.queuedMessages).toHaveLength(1);
  expect(newest(qc)?.messages).toEqual([]);
});

it('does not create a success row on submission failure', async () => {
  const { qc, mutations } = setup();
  vi.spyOn(api, 'post').mockRejectedValue(new Error('Submission refused'));
  await expect(mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: message.content })).rejects.toThrow('Submission refused');
  expect(newest(qc)).toBeUndefined();
});

it('does not duplicate a replayed message already loaded on an older page', () => {
  const { qc } = setup();
  cacheUserMessage(qc, 'build-1', message);
  const page = newest(qc) as ConversationMessagesResponse;
  qc.setQueryData(key, { pages: [{ ...page, messages: [], nextCursor: 'older' }, page], pageParams: [null, 'older'] });
  cacheUserMessage(qc, 'build-1', message);
  expect(qc.getQueryData<InfiniteData<ConversationMessagesResponse>>(key)?.pages.flatMap((row) => row.messages)).toEqual([message]);
});

function queue(qc: QueryClient, conversationId: string) {
  return qc.getQueryData<InfiniteData<ConversationMessagesResponse>>(['messages', conversationId, 'pages'])?.pages[0]?.queuedMessages;
}

it.each([
  ['HTTP acknowledgement', 'http'],
  ['source-stream confirmation', 'sse'],
] as const)('moves every surviving capsule to the replacement build on %s', async (_name, entry) => {
  const { qc, mutations } = setup();
  const delivered = { id: 'queued-a', content: 'Same words', createdAt: 2, deliverAfterStop: false };
  const survivor = { id: 'queued-b', content: 'Same words', createdAt: 2, error: 'Task cannot accept a message', deliverAfterStop: false };
  const later = { id: 'queued-c', content: 'Third', createdAt: 5, deliverAfterStop: true };
  for (const row of [delivered, survivor, later]) cacheUserMessage(qc, 'build-1', row);
  cacheUserMessage(qc, 'replacement-build', { id: 'target-own', content: 'Queued on target', createdAt: 4, deliverAfterStop: false });
  const handoff = { conversationId: 'build-1', messageId: delivered.id };
  if (entry === 'http') {
    vi.spyOn(api, 'post').mockResolvedValue({ conversationId: 'replacement-build', message });
    await mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: delivered.content, queuedMessageId: delivered.id });
  } else cacheUserMessage(qc, 'replacement-build', message, handoff);
  cacheUserMessage(qc, 'replacement-build', message, handoff);
  expect(queue(qc, 'build-1')).toEqual([]);
  expect(queue(qc, 'replacement-build')).toEqual([
    { id: 'queued-b', content: 'Same words', createdAt: 2, error: 'Task cannot accept a message' },
    { id: 'target-own', content: 'Queued on target', createdAt: 4 },
    { id: 'queued-c', content: 'Third', createdAt: 5 },
  ]);
  expect(qc.getQueryData<InfiniteData<ConversationMessagesResponse>>(['messages', 'replacement-build', 'pages'])?.pages[0]?.messages).toEqual([message]);
  expect(newest(qc)?.messages).toEqual([]);
});

it('does not restore a capsule removed by a target GET while the source replacement GET is held', async () => {
  const { qc } = setup();
  const target = 'replacement-build';
  const targetKey = ['messages', target, 'pages'];
  const capsule = { id: 'queued-late', content: 'Still waiting', createdAt: 2, deliverAfterStop: false };
  cacheUserMessage(qc, 'build-1', capsule);
  cacheUserMessage(qc, target, capsule);
  const source = qc.getQueryData<InfiniteData<ConversationMessagesResponse>>(key)!;
  const withoutCapsule = { ...source, pages: source.pages.map((page) => ({ ...page, queuedMessages: [] })) };
  let finishSource!: (value: typeof source) => void;
  const held = new Promise<typeof source>((resolve) => { finishSource = resolve; });
  const sourceRead = vi.fn<() => Promise<typeof source>>()
    .mockReturnValueOnce(new Promise(() => {}))
    .mockReturnValueOnce(held);
  const observer = new QueryObserver(qc, { queryKey: key, queryFn: sourceRead, staleTime: Infinity });
  const stop = observer.subscribe(() => {});
  try {
    const firstRead = observer.refetch();
    moveQueueToReplacement(qc, 'build-1', target);
    await qc.fetchQuery({ queryKey: targetKey, queryFn: async () => withoutCapsule });
    expect(queue(qc, target)).toEqual([]);
    expect(observer.getCurrentResult().fetchStatus).toBe('fetching');
    finishSource(withoutCapsule);
    await firstRead;
    await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'));
    expect(sourceRead).toHaveBeenCalledTimes(2);
    expect(queue(qc, target)).toEqual([]);
  } finally {
    stop();
  }
});

it.each(['delivered', 'cancelled', 'absent in a fresh GET'] as const)('does not move a source capsule that the target confirmed as %s', async (outcome) => {
  const { qc, mutations } = setup();
  const target = 'replacement-build';
  const capsule = { id: 'already-resolved', content: 'Before rollover', createdAt: 2, deliverAfterStop: false };
  cacheUserMessage(qc, 'build-1', capsule);
  cacheUserMessage(qc, target, capsule);
  if (outcome === 'delivered') {
    cacheUserMessage(qc, target, message, { conversationId: target, messageId: capsule.id });
  } else if (outcome === 'cancelled') {
    vi.spyOn(api, 'post').mockResolvedValue({ conversationId: target });
    await mutations.sendSteer.mutateAsync({ conversationId: target, content: '', queuedMessageId: capsule.id, cancelQueued: true });
  } else {
    const targetKey = ['messages', target, 'pages'];
    const cached = qc.getQueryData<InfiniteData<ConversationMessagesResponse>>(targetKey)!;
    await qc.fetchQuery({
      queryKey: targetKey,
      queryFn: async () => ({ ...cached, pages: cached.pages.map((page) => ({ ...page, queuedMessages: [] })) }),
    });
  }
  moveQueueToReplacement(qc, 'build-1', target);
  expect(queue(qc, target)).toEqual([]);
});

it('moves the queue when a plain steer rolls the task over to a replacement build', async () => {
  const { qc, mutations } = setup();
  cacheUserMessage(qc, 'build-1', { id: 'queued-b', content: 'Still waiting', createdAt: 2, deliverAfterStop: false });
  vi.spyOn(api, 'post').mockResolvedValue({ conversationId: 'replacement-build', message });
  await mutations.sendSteer.mutateAsync({ conversationId: 'build-1', content: message.content, clientMessageId: 'c1' });
  expect(queue(qc, 'build-1')).toEqual([]);
  expect(queue(qc, 'replacement-build')).toEqual([{ id: 'queued-b', content: 'Still waiting', createdAt: 2 }]);
});

it('moves the queue when a thread message continues the task on a replacement build', async () => {
  const { qc, mutations } = setup();
  cacheUserMessage(qc, 'build-1', { id: 'queued-b', content: 'Still waiting', createdAt: 2, deliverAfterStop: false });
  vi.spyOn(api, 'post').mockResolvedValue({ todoId: 't1', conversationId: 'replacement-build', delivered: 'new-turn' });
  await mutations.messageThread.mutateAsync({ todoId: 't1', conversationId: 'build-1', content: 'Rework it' });
  expect(queue(qc, 'build-1')).toEqual([]);
  expect(queue(qc, 'replacement-build')).toEqual([{ id: 'queued-b', content: 'Still waiting', createdAt: 2 }]);
});
