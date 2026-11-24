import type {
  ConversationActivityEvent,
  ConversationAgentTodoEvent,
  ConversationMessagesResponse,
  ConversationStepEvent,
  NotificationRecord,
  TranscriptRow,
} from '@cairn/shared';
import {
  conversationMessageEventSchema,
  DESKTOP_TRAY_PATH,
  isChiefConversationId,
  SILENT_NOTIFICATION_TYPES,
  streamHelloEventSchema,
} from '@cairn/shared';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { readNotifyPref } from '../board/notify-pref.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { desktopNotify } from '../desktop-shell.js';
import { EN } from '../i18n/en.js';
import { readStoredLocale } from '../i18n/locale.js';
import { translate } from '../i18n/translate.js';
import { safeLocalStorage } from '../safe-storage.js';
import { activityStore } from './activity.js';
import { agentTodoStore } from './agent-todo.js';
import { fetchWithSession, useAuth } from './auth.js';
import { computerQueryKeys } from './computer-query-scope.js';
import { connectionStore } from './connection-state.js';
import {
  attachConnection,
  conversationsInFlight,
  deliverConversationEvent,
  detachConnection,
  reconcileConversations,
  subscribeConversation,
} from './conversation-subscriptions.js';
import { invalidateEventQueries, recoverQueries, refreshQueries } from './invalidate.js';
import { liveTextStore } from './live-text.js';
import { liveThinkingStore } from './live-thinking.js';
import { textOfContent, thinkingOfContent } from './mappers.js';
import { cacheUserMessage, trackQueueConfirmations } from './message-cache.js';
import { connect, SSE_SILENCE_WATCHDOG_MS } from './sse-connection.js';
import { hasInFlightWork } from './sse-guards.js';
import { applyTeamStreamEvent } from './team-stream-cache.js';

async function streamUrl(path: string): Promise<string> {
  if (DEMO_MODE) return path;
  const res = await fetchWithSession('/api/auth/stream-ticket', {
    method: 'POST',
    signal: AbortSignal.timeout(SSE_SILENCE_WATCHDOG_MS),
  });
  if (!res.ok) return path;
  const body = (await res.json()) as { ticket?: string };
  if (body.ticket === undefined || body.ticket === '') return path;
  return `${path}?ticket=${encodeURIComponent(body.ticket)}`;
}

function withTicket(path: string, ticket: string | null): string {
  if (ticket === null || ticket === '') return path;
  return `${path}?ticket=${encodeURIComponent(ticket)}`;
}

export function useTeamStream(teamId: string | undefined, enabled: boolean): boolean {
  const qc = useQueryClient();
  const auth = useAuth();
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    setReconnecting(false);
    if (teamId === undefined || !enabled || auth.gateOpen) return;
    return startTeamStream(
      teamId,
      qc,
      auth.generation,
      null,
      () => streamUrl(`/api/teams/${teamId}/stream`),
      setReconnecting,
    );
  }, [teamId, enabled, qc, auth]);
  return enabled && !auth.gateOpen && reconnecting;
}

export function startTeamStream(
  teamId: string,
  qc: QueryClient,
  generation = 0,
  ticket: string | null = null,
  resolvePath: (() => Promise<string>) | null = null,
  onReconnecting?: (reconnecting: boolean) => void,
): () => void {
  const connection = connectionStore.attach();
  trackQueueConfirmations(qc);
  const disconnect = connect(
    resolvePath ?? withTicket(`/api/teams/${teamId}/stream`, ticket),
    (ev, attachment) => {
      if (ev.type === 'hello') {
        const hello = streamHelloEventSchema.safeParse(ev);
        if (!hello.success) return;
        attachment.establish();
        attachConnection(
          hello.data.connectionId,
          hello.data.followRevision === true,
          (isCurrent, followedIds) => {
            const recovering = attachment.acknowledge(isCurrent, (signal) =>
              recoverQueries(qc, signal),
            );
            const streams = conversationStreams.get(qc);
            if (streams === undefined) return;
            for (const id of followedIds) {
              const stream = streams.get(id);
              if (stream === undefined || !stream.pendingInitialRefresh) continue;
              stream.pendingInitialRefresh = false;
              if (!recovering) void refreshQueries(qc, { queryKey: ['messages', id] });
            }
          },
          attachment.replace,
        );
        return;
      }
      if (ev.type === 'conversation') {
        deliverConversationEvent(
          teamId,
          ev.conversationId as string,
          ev.event as Record<string, unknown>,
        );
        return;
      }
      const notification = applyTeamStreamEvent(qc, teamId, ev);
      if (notification !== undefined) fireDesktopNotification(notification);
    },
    {
      onReconnecting,
      onTransportLost: detachConnection,
      inFlight: () => hasInFlightWork(qc) || conversationsInFlight(),
      reconcile: () =>
        reconcileConversations(() => invalidateEventQueries(qc, { type: 'reconcile', teamId })),
    },
    {
      onConnectionChange: connection.setConnected,
      onOnlineHint: connectionStore.onOnlineHint,
    },
  );
  return () => {
    disconnect();
    connection.detach();
    detachConnection();
    for (const queryKey of Object.values(computerQueryKeys(teamId, generation))) {
      qc.removeQueries({ queryKey });
    }
  };
}

export const NOTIFICATION_TITLES: Partial<Record<NotificationRecord['type'], string>> = {
  plan_ready: '方案已就绪',
  coordinator_handoff: '需要你决定',
  build_review: '构建待审核',
  quota_wait: '等额度',
  model_fallback: '已换备用模型',
  no_machine: '没有可运行的执行机',
};

function notificationHref(record: NotificationRecord): string {
  return record.type === 'chief_message'
    ? `/app?chief=${encodeURIComponent(record.entityId)}`
    : `/app?thread=${encodeURIComponent(record.entityId)}`;
}

async function showViaServiceWorker(
  title: string,
  body: string,
  tag: string,
  href: string,
): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (registration === null) return false;
    await registration.showNotification(title, { body, tag, data: { href } });
    return true;
  } catch {
    return false;
  }
}

function fireDesktopNotification(record: NotificationRecord): void {
  if (window.location.pathname === DESKTOP_TRAY_PATH) return;
  if (record.readAt !== null || SILENT_NOTIFICATION_TYPES.includes(record.type)) return;
  if (readNotifyPref(safeLocalStorage()) === 'off') return;
  const t = (source: string) => translate(readStoredLocale(safeLocalStorage()), EN, source);
  const titleSource = NOTIFICATION_TITLES[record.type];
  const title = titleSource === undefined ? record.entityRef.title : t(titleSource);
  const body = record.snippet ?? record.entityRef.title;
  const href = notificationHref(record);
  const desktop = desktopNotify();
  if (desktop !== null) {
    desktop.show({ title, body, href, tag: record.id });
    return;
  }
  if (!document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  void showViaServiceWorker(title, body, record.id, href).then((shown) => {
    if (shown) return;
    try {
      const fallback = new Notification(title, { body, tag: record.id });
      fallback.onclick = () => {
        window.focus();
        window.location.assign(href);
      };
    } catch {}
  });
}

export interface ConversationStreamHandlers {
  todoId?: string;
  onMessage?: (row: TranscriptRow, clientMessageId?: string) => void;
  onStep?: (step: ConversationStepEvent['step']) => void;
}

export function useConversationStream(
  conversationId: string | undefined,
  enabled: boolean,
  handlers: ConversationStreamHandlers,
): void {
  const qc = useQueryClient();
  const { onMessage, onStep, todoId } = handlers;
  const auth = useAuth();
  useEffect(() => {
    if (conversationId === undefined || !enabled || auth.gateOpen) return;
    return startConversationStream(conversationId, qc, {
      onMessage,
      onStep,
      ...(todoId === undefined ? {} : { todoId }),
    });
  }, [conversationId, enabled, qc, onMessage, onStep, todoId, auth]);
}

type SharedConversationStream = {
  listeners: Set<ConversationStreamHandlers>;
  stop: () => void;
  pendingInitialRefresh: boolean;
};

const conversationStreams = new WeakMap<QueryClient, Map<string, SharedConversationStream>>();

export function startConversationStream(
  conversationId: string,
  qc: QueryClient,
  handlers: ConversationStreamHandlers,
): () => void {
  let streams = conversationStreams.get(qc);
  if (streams === undefined) {
    streams = new Map();
    conversationStreams.set(qc, streams);
  }
  let stream = streams.get(conversationId);
  if (stream === undefined) {
    const listeners = new Set<ConversationStreamHandlers>();
    const pendingInitialRefresh = qc
      .getQueryCache()
      .findAll({ queryKey: ['messages', conversationId] })
      .some((query) => query.state.data !== undefined);
    stream = {
      listeners,
      stop: connectConversation(conversationId, qc, listeners),
      pendingInitialRefresh,
    };
    streams.set(conversationId, stream);
  }
  const listener = { ...handlers };
  stream.listeners.add(listener);
  const current = stream;
  const owned = streams;
  return () => {
    if (!current.listeners.delete(listener) || current.listeners.size !== 0) return;
    queueMicrotask(() => {
      if (current.listeners.size !== 0 || owned.get(conversationId) !== current) return;
      owned.delete(conversationId);
      current.stop();
    });
  };
}

function connectConversation(
  conversationId: string,
  qc: QueryClient,
  listeners: ReadonlySet<ConversationStreamHandlers>,
): () => void {
  const messagesKey = ['messages', conversationId, 'pages'];
  let businessRevision = 0;
  let disposed = false;
  const resync = () => {
    businessRevision++;
    liveTextStore.clear(conversationId);
    liveThinkingStore.clear(conversationId);
    activityStore.clear(conversationId);
    agentTodoStore.clear(conversationId);
  };
  const disconnect = subscribeConversation(conversationId, {
    onEvent: (ev, legacy, teamId) => {
      businessRevision++;
      switch (ev.type) {
        case 'text_delta':
          if (!legacy) liveTextStore.append(conversationId, ev.text as string);
          break;
        case 'thinking_delta':
          if (!legacy) liveThinkingStore.append(conversationId, ev.text as string);
          break;
        case 'activity': {
          if (legacy) break;
          const activity = (ev as ConversationActivityEvent).activity;
          if (activity.resetLive === true) {
            liveTextStore.clear(conversationId);
            liveThinkingStore.clear(conversationId);
          }
          activityStore.set(conversationId, activity);
          break;
        }
        case 'agent_todo': {
          if (legacy) break;
          const todo = (ev as ConversationAgentTodoEvent).todo;
          agentTodoStore.set(conversationId, todo);
          break;
        }
        case 'message': {
          const row = ev.message as TranscriptRow;
          const targetConversationId =
            conversationMessageEventSchema.shape.conversationId.safeParse(ev.conversationId).data ??
            conversationId;
          const delivered = conversationMessageEventSchema.shape.deliveredQueue.safeParse(
            ev.deliveredQueue,
          ).data;
          if (!legacy) {
            if (row.role === 'assistant' && textOfContent(row.content).trim() !== '') {
              liveTextStore.noteSettled(conversationId, row.id);
            }
            if (row.role === 'assistant' && thinkingOfContent(row.content) !== null) {
              liveThinkingStore.noteSettled(conversationId, row.id);
            }
          }
          void invalidateEventQueries(
            qc,
            {
              type: 'message',
              teamId,
              conversationId,
              targetId: targetConversationId,
              deliveredFromId: delivered?.conversationId,
              todoId: [...listeners].find((listener) => listener.todoId !== undefined)?.todoId,
            },
            legacy ? undefined : () => cacheUserMessage(qc, targetConversationId, row, delivered),
          );
          const clientMessageId = conversationMessageEventSchema.shape.clientMessageId.safeParse(
            ev.clientMessageId,
          ).data;
          for (const { onMessage } of listeners) {
            if (clientMessageId === undefined) onMessage?.(row);
            else onMessage?.(row, clientMessageId);
          }
          break;
        }
        case 'step': {
          const step = (ev as ConversationStepEvent).step;
          if (
            !legacy &&
            (step.status === 'done' || step.status === 'failed' || step.status === 'stopped')
          ) {
            liveTextStore.clearUnlessSettling(conversationId);
            liveThinkingStore.clear(conversationId);
            activityStore.clear(conversationId);
            agentTodoStore.clear(conversationId);
          }
          void invalidateEventQueries(qc, {
            type: 'step',
            teamId,
            conversationId,
            status: step.status,
            todoId: [...listeners].find((listener) => listener.todoId !== undefined)?.todoId,
          });
          for (const { onStep } of listeners) onStep?.(step);
          break;
        }
        default:
          break;
      }
    },
    onResync: resync,
    inFlight: () =>
      hasInFlightWork(qc) ||
      liveTextStore.get(conversationId) !== '' ||
      liveThinkingStore.get(conversationId) !== '',
    reconcile: async (refetch) => {
      const revision = businessRevision;
      const before = qc.getQueryState(messagesKey)?.dataUpdateCount;
      await refetch();
      const read = qc.getQueryState<InfiniteData<ConversationMessagesResponse>>(messagesKey);
      if (
        disposed ||
        !isChiefConversationId(conversationId) ||
        revision !== businessRevision ||
        read?.dataUpdateCount === before ||
        read?.isInvalidated !== false ||
        read.data?.pages[0]?.activeRun !== null
      )
        return;
      liveTextStore.clear(conversationId);
      liveThinkingStore.clear(conversationId);
      activityStore.clear(conversationId);
      agentTodoStore.clear(conversationId);
    },
  });
  return () => {
    disposed = true;
    disconnect();
  };
}
