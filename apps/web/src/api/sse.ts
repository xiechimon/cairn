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
} from '@cairn/shared';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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
  resyncConversations,
  subscribeConversation,
} from './conversation-subscriptions.js';
import { invalidateConverged } from './invalidate.js';
import { liveTextStore } from './live-text.js';
import { liveThinkingStore } from './live-thinking.js';
import { textOfContent, thinkingOfContent } from './mappers.js';
import { cacheUserMessage } from './message-cache.js';
import { connect } from './sse-connection.js';
import { streamGuards } from './sse-guards.js';
import { teamEventInvalidations } from './sse-team-events.js';
import { applyTeamStreamEvent, notePatchedEvent } from './team-stream-cache.js';

async function streamUrl(path: string): Promise<string> {
  if (DEMO_MODE) return path;
  const res = await fetchWithSession('/api/auth/stream-ticket', { method: 'POST' });
  if (!res.ok) return path;
  const body = (await res.json()) as { ticket?: string };
  if (body.ticket === undefined || body.ticket === '') return path;
  return `${path}?ticket=${encodeURIComponent(body.ticket)}`;
}

function withTicket(path: string, ticket: string | null): string {
  if (ticket === null || ticket === '') return path;
  return `${path}?ticket=${encodeURIComponent(ticket)}`;
}

export function useTeamStream(teamId: string | undefined, enabled: boolean): void {
  const qc = useQueryClient();
  const auth = useAuth();
  useEffect(() => {
    if (teamId === undefined || !enabled || auth.gateOpen) return;
    const stop = startTeamStream(teamId, qc, auth.generation, null, () =>
      streamUrl(`/api/teams/${teamId}/stream`),
    );
    return () => {
      stop();
    };
  }, [teamId, enabled, qc, auth]);
}

export function startTeamStream(
  teamId: string,
  qc: QueryClient,
  generation = 0,
  ticket: string | null = null,
  resolvePath: (() => Promise<string>) | null = null,
): () => void {
  const resync = () => {
    detachConnection();
    resyncConversations();
    void invalidateConverged(qc);
  };
  const guards = streamGuards(qc);
  const connection = connectionStore.attach();
  const disconnect = connect(
    resolvePath ?? withTicket(`/api/teams/${teamId}/stream`, ticket),
    (ev) => {
      if (ev.type === 'hello') {
        attachConnection(ev.connectionId as string);
        return;
      }
      if (ev.type === 'conversation') {
        deliverConversationEvent(ev.conversationId as string, ev.event as Record<string, unknown>);
        return;
      }
      const patched = applyTeamStreamEvent(qc, teamId, ev);
      for (const queryKey of teamEventInvalidations(ev, teamId)) {
        void invalidateConverged(qc, { queryKey });
      }
      if (patched) {
        notePatchedEvent(qc, teamId);
      }
      if (ev.type === 'computer.state') {
        void invalidateConverged(qc, { queryKey: ['computers', teamId] });
      }
      if (ev.type === 'notification') {
        fireDesktopNotification(ev.notification as NotificationRecord);
      }
    },
    resync,
    {
      inFlight: () => guards.inFlight() || conversationsInFlight(),
      reconcile: () => {
        void reconcileConversations(() => guards.reconcile());
        void invalidateConverged(qc, { queryKey: ['computers', teamId] });
      },
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

/** Desktop-notification titles per record type; each value is a `t()` source
 *  key the EN dict must carry (the i18n-coverage gate checks every entry). */
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
  onMessage?: (row: TranscriptRow, clientMessageId?: string) => void;
  onStep?: (step: ConversationStepEvent['step']) => void;
}

export function useConversationStream(
  conversationId: string | undefined,
  enabled: boolean,
  handlers: ConversationStreamHandlers,
): void {
  const qc = useQueryClient();
  const onMessage = handlers.onMessage;
  const onStep = handlers.onStep;
  const auth = useAuth();
  useEffect(() => {
    if (conversationId === undefined || !enabled || auth.gateOpen) return;
    const stop = startConversationStream(conversationId, qc, { onMessage, onStep });
    return () => {
      stop();
    };
  }, [conversationId, enabled, qc, onMessage, onStep, auth]);
}

export function startConversationStream(
  conversationId: string,
  qc: QueryClient,
  handlers: ConversationStreamHandlers,
): () => void {
  const onMessage = handlers.onMessage;
  const onStep = handlers.onStep;
  const guards = streamGuards(qc);
  const messagesKey = ['messages', conversationId, 'pages'];
  let businessRevision = 0;
  let disposed = false;
  liveTextStore.clear(conversationId);
  liveThinkingStore.clear(conversationId);
  activityStore.clear(conversationId);
  agentTodoStore.clear(conversationId);
  const resync = () => {
    liveTextStore.clear(conversationId);
    liveThinkingStore.clear(conversationId);
    activityStore.clear(conversationId);
    agentTodoStore.clear(conversationId);
    void invalidateConverged(qc);
  };
  const disconnect = subscribeConversation(conversationId, {
    onEvent: (ev) => {
      businessRevision++;
      switch (ev.type) {
        case 'text_delta':
          liveTextStore.append(conversationId, ev.text as string);
          break;
        case 'thinking_delta':
          liveThinkingStore.append(conversationId, ev.text as string);
          break;
        case 'activity': {
          const activity = (ev as ConversationActivityEvent).activity;
          if (activity.resetLive === true) {
            liveTextStore.clear(conversationId);
            liveThinkingStore.clear(conversationId);
          }
          activityStore.set(conversationId, activity);
          break;
        }
        case 'agent_todo': {
          const todo = (ev as ConversationAgentTodoEvent).todo;
          agentTodoStore.set(conversationId, todo);
          break;
        }
        case 'message': {
          const row = ev.message as TranscriptRow;
          const targetConversationId =
            conversationMessageEventSchema.shape.conversationId.safeParse(ev.conversationId).data ??
            conversationId;
          cacheUserMessage(
            qc,
            targetConversationId,
            row,
            conversationMessageEventSchema.shape.deliveredQueue.safeParse(ev.deliveredQueue).data,
          );
          if (row.role === 'assistant' && textOfContent(row.content).trim() !== '') {
            liveTextStore.noteSettled(conversationId, row.id);
          }
          if (row.role === 'assistant' && thinkingOfContent(row.content) !== null) {
            liveThinkingStore.noteSettled(conversationId, row.id);
          }
          void invalidateConverged(qc, { queryKey: ['messages', conversationId] });
          if (targetConversationId !== conversationId)
            void invalidateConverged(qc, { queryKey: ['messages', targetConversationId] });
          void invalidateConverged(qc, { queryKey: ['plans'] });
          if (isChiefConversationId(conversationId)) {
            void invalidateConverged(qc, { queryKey: ['tasks'] });
          }
          const clientMessageId = conversationMessageEventSchema.shape.clientMessageId.safeParse(
            ev.clientMessageId,
          ).data;
          if (clientMessageId === undefined) onMessage?.(row);
          else onMessage?.(row, clientMessageId);
          break;
        }
        case 'step': {
          const step = (ev as ConversationStepEvent).step;
          if (step.status === 'done' || step.status === 'failed' || step.status === 'stopped') {
            liveTextStore.clearUnlessSettling(conversationId);
            liveThinkingStore.clear(conversationId);
            activityStore.clear(conversationId);
            agentTodoStore.clear(conversationId);
          }
          void invalidateConverged(qc, { queryKey: ['steps', conversationId] });
          void invalidateConverged(qc, { queryKey: ['build', conversationId] });
          void invalidateConverged(qc, { queryKey: ['changes', conversationId] });
          void invalidateConverged(qc, { queryKey: ['plans'] });
          if (isChiefConversationId(conversationId)) {
            if (
              step.status === 'claimed' ||
              step.status === 'done' ||
              step.status === 'failed' ||
              step.status === 'stopped'
            ) {
              void invalidateConverged(qc, { queryKey: ['messages', conversationId] });
            }
            void invalidateConverged(qc, { queryKey: ['chiefThreads'] });
            if (step.status === 'done' || step.status === 'failed' || step.status === 'stopped') {
              void invalidateConverged(qc, { queryKey: ['chief'] });
            }
          }
          onStep?.(step);
          break;
        }
        default:
          break;
      }
    },
    onResync: resync,
    inFlight: () =>
      guards.inFlight() ||
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
