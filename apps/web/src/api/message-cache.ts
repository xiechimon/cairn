import {
  type ConversationMessagesResponse,
  conversationMessagesResponseSchema,
  transcriptRowSchema,
} from '@cairn/shared';
import {
  type InfiniteData,
  notifyManager,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { patchQueryData, refreshQueries } from './invalidate.js';

function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((existing) => existing.id === row.id)
    ? rows.map((existing) => (existing.id === row.id ? row : existing))
    : [...rows, row];
}

type MessagePages = InfiniteData<ConversationMessagesResponse>;

const trackedClients = new WeakSet<QueryClient>();
const queueIds = new WeakMap<Query, { present: Set<string>; confirmed: Set<string> }>();

function idsFor(query: Query) {
  let ids = queueIds.get(query);
  if (ids === undefined) {
    ids = { present: new Set(), confirmed: new Set() };
    queueIds.set(query, ids);
  }
  return ids;
}

export function trackQueueConfirmations(qc: QueryClient): void {
  if (trackedClients.has(qc)) return;
  trackedClients.add(qc);
  const cache = qc.getQueryCache();
  const captureQueue = (query: Query, fromRead: boolean) => {
    const [kind, , scope] = query.queryKey;
    if (kind !== 'messages' || scope !== 'pages') return;
    const queue = (query.state.data as MessagePages | undefined)?.pages?.[0]?.queuedMessages;
    if (queue === undefined) return;
    const ids = idsFor(query);
    const present = new Set(queue.map(({ id }) => id));
    if (fromRead) for (const id of ids.present) if (!present.has(id)) ids.confirmed.add(id);
    ids.present = present;
  };
  for (const query of cache.getAll()) captureQueue(query, false);
  cache.subscribe((event) => {
    if (event.type === 'added') captureQueue(event.query, false);
    else if (event.type === 'updated' && event.action.type === 'success')
      captureQueue(event.query, !event.action.manual);
  });
}

function rememberQueueRemoval(qc: QueryClient, key: QueryKey, id: string): void {
  idsFor(qc.getQueryCache().build(qc, { queryKey: key })).confirmed.add(id);
}

export function confirmQueuedMessageRemoval(
  qc: QueryClient,
  conversationId: string,
  id: string,
): void {
  trackQueueConfirmations(qc);
  const key = ['messages', conversationId, 'pages'];
  rememberQueueRemoval(qc, key, id);
  void patchQueryData<MessagePages>(
    qc,
    key,
    (data) => data && { ...data, pages: data.pages.map((page) => withoutQueuedMessage(page, id)) },
  );
}

function withoutQueuedMessage(
  page: ConversationMessagesResponse,
  messageId: string | undefined,
): ConversationMessagesResponse {
  return messageId === undefined || page.queuedMessages === undefined
    ? page
    : { ...page, queuedMessages: page.queuedMessages.filter((row) => row.id !== messageId) };
}

const emptyPages = (): InfiniteData<ConversationMessagesResponse> => ({
  pages: [
    {
      messages: [],
      chips: null,
      historyEpoch: 0,
      steerPending: [],
      activeRun: null,
      nextCursor: null,
    },
  ],
  pageParams: [null],
});

export function moveQueueToReplacement(
  qc: QueryClient,
  sourceConversationId: string,
  targetConversationId: string,
  deliveredMessageId?: string,
): void {
  if (sourceConversationId === targetConversationId) return;
  trackQueueConfirmations(qc);
  const sourceKey = ['messages', sourceConversationId, 'pages'];
  const targetKey = ['messages', targetConversationId, 'pages'];
  const cache = qc.getQueryCache();
  const apply = () =>
    notifyManager.batch(() => {
      const source = qc.getQueryData<MessagePages>(sourceKey);
      if (source === undefined) return;
      const capsules = source.pages[0]?.queuedMessages ?? [];
      if (capsules.length === 0) return;
      void patchQueryData<MessagePages>(
        qc,
        sourceKey,
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) =>
              page.queuedMessages === undefined ? page : { ...page, queuedMessages: [] },
            ),
          },
      );
      void patchQueryData<MessagePages>(qc, targetKey, (data) => {
        const current = data ?? emptyPages();
        const newest = current.pages[0];
        if (newest === undefined) return data;
        const target = cache.find({ queryKey: targetKey });
        const confirmed = target === undefined ? undefined : queueIds.get(target)?.confirmed;
        const queue = newest.queuedMessages ?? [];
        const arriving = capsules.filter(
          ({ id }) =>
            id !== deliveredMessageId &&
            !confirmed?.has(id) &&
            !queue.some((existing) => existing.id === id),
        );
        if (arriving.length === 0) return data;
        return {
          ...current,
          pages: [
            {
              ...newest,
              queuedMessages: [...arriving, ...queue].sort((a, b) => a.createdAt - b.createdAt),
            },
            ...current.pages.slice(1),
          ],
        };
      });
    });
  const filters = {
    predicate: ({ queryKey: [kind, id, scope] }: Query) =>
      kind === 'messages' &&
      scope === 'pages' &&
      (id === sourceConversationId || id === targetConversationId),
  };
  if (cache.findAll(filters).some((query) => query.state.fetchStatus !== 'idle'))
    void refreshQueries(qc, filters, apply);
  else apply();
}

export function cacheUserMessage(
  qc: QueryClient,
  conversationId: string,
  value: unknown,
  source?: { conversationId: string; messageId?: string | undefined },
): void {
  if (typeof value !== 'object' || value === null) return;
  const queued = 'deliverAfterStop' in value;
  const capsule = queued
    ? conversationMessagesResponseSchema.shape.queuedMessages.unwrap().element.safeParse(value).data
    : undefined;
  const message = queued ? undefined : transcriptRowSchema.safeParse(value).data;
  if (capsule === undefined && message?.role !== 'user') return;
  trackQueueConfirmations(qc);
  const deliveredFrom = message?.role === 'user' ? source : undefined;
  const queryKey = ['messages', conversationId, 'pages'];
  if (deliveredFrom !== undefined) {
    if (deliveredFrom.messageId !== undefined) {
      rememberQueueRemoval(qc, queryKey, deliveredFrom.messageId);
      if (deliveredFrom.conversationId !== conversationId)
        rememberQueueRemoval(
          qc,
          ['messages', deliveredFrom.conversationId, 'pages'],
          deliveredFrom.messageId,
        );
    }
    moveQueueToReplacement(
      qc,
      deliveredFrom.conversationId,
      conversationId,
      deliveredFrom.messageId,
    );
  }
  patchQueryData<MessagePages>(qc, queryKey, (data) => {
    const target = qc.getQueryCache().find({ queryKey });
    if (
      capsule !== undefined &&
      target !== undefined &&
      queueIds.get(target)?.confirmed.has(capsule.id)
    )
      return data;
    const current = data ?? emptyPages();
    const alreadyLoaded =
      message !== undefined &&
      current.pages.some((page) => page.messages.some((row) => row.id === message.id));
    return {
      ...current,
      pages: current.pages.map((currentPage, index) => {
        const page = withoutQueuedMessage(currentPage, deliveredFrom?.messageId);
        if (capsule !== undefined)
          return index === 0
            ? { ...page, queuedMessages: upsert(page.queuedMessages ?? [], capsule) }
            : page;
        if (message === undefined) return page;
        if (alreadyLoaded)
          return {
            ...page,
            messages: page.messages.map((row) => (row.id === message.id ? message : row)),
          };
        return index === 0 ? { ...page, messages: [...page.messages, message] } : page;
      }),
    };
  });
}
