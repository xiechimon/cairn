import type { ConversationMessagesResponse } from '@cairn/shared';
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ApiMutations, useApiMutations } from '../src/api/hooks.js';
import { cacheUserMessage } from '../src/api/message-cache.js';

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
