import type {
  ConversationActivityEvent,
  ConversationAgentTodoEvent,
  ConversationStepEvent,
  NotificationRecord,
  TranscriptRow,
} from '@cairn/shared';
import {
  conversationMessageEventSchema,
  isChiefConversationId,
  SILENT_NOTIFICATION_TYPES,
} from '@cairn/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { readNotifyPref } from '../board/notify-pref.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { EN } from '../i18n/en.js';
import { readStoredLocale } from '../i18n/locale.js';
import { translate } from '../i18n/translate.js';
import { safeLocalStorage } from '../safe-storage.js';
import { activityStore } from './activity.js';
import { agentTodoStore } from './agent-todo.js';
import { useAuth } from './auth.js';
import { computerFeedStore } from './computer-feed.js';
import { computerQueryKeys } from './computer-query-scope.js';
import { invalidateConverged } from './invalidate.js';
import { liveTextStore } from './live-text.js';
import { liveThinkingStore } from './live-thinking.js';
import { textOfContent, thinkingOfContent } from './mappers.js';
import { cacheUserMessage } from './message-cache.js';
import { connect } from './sse-connection.js';
import { streamGuards } from './sse-guards.js';
import { teamEventInvalidations } from './sse-team-events.js';

async function streamUrl(path: string): Promise<string> {
  if (DEMO_MODE) return path;
  const res = await fetch('/api/auth/stream-ticket', { method: 'POST' });
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
    if (teamId === undefined || !enabled || auth.gateOpen) {
      computerFeedStore.clear();
      return;
    }
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
  computerFeedStore.clear();
  const resync = () => {
    computerFeedStore.clear();
    void invalidateConverged(qc);
  };
  const guards = streamGuards(qc);
  const disconnect = connect(
    resolvePath ?? withTicket(`/api/teams/${teamId}/stream`, ticket),
    (ev) => {
      for (const queryKey of teamEventInvalidations(ev, teamId)) {
        void invalidateConverged(qc, { queryKey });
      }
      if (ev.type === 'computer.command') {
        const prior = computerFeedStore.snapshot();
        computerFeedStore.push(ev.command);
        if (computerFeedStore.snapshot() !== prior) {
          void invalidateConverged(qc, { queryKey: ['computers', teamId] });
        }
      }
      if (
        ev.type === 'computer.state' &&
        (ev.state === 'stopped' ||
          ev.state === 'starting' ||
          ev.state === 'running' ||
          ev.state === 'failed')
      ) {
        void invalidateConverged(qc, { queryKey: ['computers', teamId] });
      }
      if (ev.type === 'notification') {
        fireDesktopNotification(ev.notification as NotificationRecord);
      }
    },
    resync,
    {
      ...guards,
      reconcile: () => {
        computerFeedStore.clear();
        guards.reconcile();
        void invalidateConverged(qc, { queryKey: ['computers', teamId] });
        void invalidateConverged(qc, { queryKey: ['computer-commands'] });
      },
    },
  );
  return () => {
    disconnect();
    computerFeedStore.clear();
    for (const queryKey of Object.values(computerQueryKeys(teamId, generation))) {
      qc.removeQueries({ queryKey });
    }
  };
}

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
  if (!document.hidden) return;
  if (record.readAt !== null || SILENT_NOTIFICATION_TYPES.includes(record.type)) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (readNotifyPref(safeLocalStorage()) === 'off') return;
  const t = (source: string) => translate(readStoredLocale(safeLocalStorage()), EN, source);
  const title =
    record.type === 'plan_ready'
      ? t('方案已就绪')
      : record.type === 'coordinator_handoff'
        ? t('需要你决定')
        : record.type === 'build_review'
          ? t('构建待审核')
          : record.type === 'quota_wait'
            ? t('等额度')
            : record.type === 'model_fallback'
              ? t('已换备用模型')
              : record.type === 'no_machine'
                ? t('没有机器能跑')
                : record.entityRef.title;
  const body =
    record.snippet ??
    (record.entityRef.seqNum !== null
      ? `#${record.entityRef.seqNum} ${record.entityRef.title}`
      : record.entityRef.title);
  const href = notificationHref(record);
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
  onMessage?: (row: TranscriptRow) => void;
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
    const stop = startConversationStream(conversationId, qc, { onMessage, onStep }, null, () =>
      streamUrl(`/api/conversations/${conversationId}/stream`),
    );
    return () => {
      stop();
    };
  }, [conversationId, enabled, qc, onMessage, onStep, auth]);
}

export function startConversationStream(
  conversationId: string,
  qc: QueryClient,
  handlers: ConversationStreamHandlers,
  ticket: string | null = null,
  resolvePath: (() => Promise<string>) | null = null,
): () => void {
  const onMessage = handlers.onMessage;
  const onStep = handlers.onStep;
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
  return connect(
    resolvePath ?? withTicket(`/api/conversations/${conversationId}/stream`, ticket),
    (ev) => {
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
          onMessage?.(row);
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
            if (step.status === 'claimed') {
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
    resync,
    streamGuards(qc),
  );
}
