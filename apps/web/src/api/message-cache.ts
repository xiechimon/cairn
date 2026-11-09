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

function withoutQueuedMessage(
  page: ConversationMessagesResponse,
  messageId: string | undefined,
): ConversationMessagesResponse {
  return messageId === undefined || page.queuedMessages === undefined
    ? page
    : { ...page, queuedMessages: page.queuedMessages.filter((row) => row.id !== messageId) };
}

export function cacheUserMessage(
  qc: QueryClient,
  conversationId: string,
  value: unknown,
  deliveredQueue?: { conversationId: string; messageId: string },
): void {
  if (typeof value !== 'object' || value === null) return;
  const queued = 'deliverAfterStop' in value;
  const capsule = queued
    ? conversationMessagesResponseSchema.shape.queuedMessages.unwrap().element.safeParse(value).data
    : undefined;
  const message = queued ? undefined : transcriptRowSchema.safeParse(value).data;
  if (capsule === undefined && message?.role !== 'user') return;
  const deliveredFrom = message?.role === 'user' ? deliveredQueue : undefined;
  if (deliveredFrom !== undefined && deliveredFrom.conversationId !== conversationId) {
    const sourceKey = ['messages', deliveredFrom.conversationId, 'pages'];
    void qc.cancelQueries({ queryKey: sourceKey });
    qc.setQueryData<InfiniteData<ConversationMessagesResponse>>(sourceKey, (data) =>
      data === undefined
        ? data
        : {
            ...data,
            pages: data.pages.map((page) => withoutQueuedMessage(page, deliveredFrom.messageId)),
          },
    );
  }
  const queryKey = ['messages', conversationId, 'pages'];
  void qc.cancelQueries({ queryKey });
  qc.setQueryData<InfiniteData<ConversationMessagesResponse>>(queryKey, (data) => {
    const current = data ?? {
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
    };
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
