import {
  type ConversationMessagesResponse,
  conversationMessagesResponseSchema,
  transcriptRowSchema,
} from '@cairn/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((existing) => existing.id === row.id)
    ? rows.map((existing) => (existing.id === row.id ? row : existing))
    : [...rows, row];
}

type QueuedCapsule = NonNullable<ConversationMessagesResponse['queuedMessages']>[number];

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
  const sourceKey = ['messages', sourceConversationId, 'pages'];
  let moved: QueuedCapsule[] = [];
  void qc.cancelQueries({ queryKey: sourceKey });
  qc.setQueryData<InfiniteData<ConversationMessagesResponse>>(sourceKey, (data) => {
    if (data === undefined) return data;
    moved = data.pages.flatMap(
      (page) => withoutQueuedMessage(page, deliveredMessageId).queuedMessages ?? [],
    );
    return {
      ...data,
      pages: data.pages.map((page) =>
        page.queuedMessages === undefined ? page : { ...page, queuedMessages: [] },
      ),
    };
  });
  if (moved.length === 0) return;
  const targetKey = ['messages', targetConversationId, 'pages'];
  void qc.cancelQueries({ queryKey: targetKey });
  qc.setQueryData<InfiniteData<ConversationMessagesResponse>>(targetKey, (data) => {
    const current = data ?? emptyPages();
    return {
      ...current,
      pages: current.pages.map((page, index) => {
        if (index !== 0) return page;
        const queue = page.queuedMessages ?? [];
        const arriving = moved.filter((row) => !queue.some((existing) => existing.id === row.id));
        return {
          ...page,
          queuedMessages: [...arriving, ...queue].sort((a, b) => a.createdAt - b.createdAt),
        };
      }),
    };
  });
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
  const deliveredFrom = message?.role === 'user' ? source : undefined;
  if (deliveredFrom !== undefined)
    moveQueueToReplacement(
      qc,
      deliveredFrom.conversationId,
      conversationId,
      deliveredFrom.messageId,
    );
  const queryKey = ['messages', conversationId, 'pages'];
  void qc.cancelQueries({ queryKey });
  qc.setQueryData<InfiniteData<ConversationMessagesResponse>>(queryKey, (data) => {
    const current = data ?? emptyPages();
    const alreadyLoaded =
      message !== undefined &&
      current.pages.some((page) => page.messages.some((row) => row.id === message.id));
    return {
      ...current,
      pages: current.pages.map((currentPage, index) => {
        const page = withoutQueuedMessage(
          currentPage,
          deliveredFrom?.conversationId === conversationId ? deliveredFrom.messageId : undefined,
        );
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
