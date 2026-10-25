import type {
  ConversationActivityEvent,
  ConversationAgentTodoEvent,
  ConversationStepEvent,
  NotificationRecord,
  TranscriptRow,
} from '@cairn/shared';
import { isChiefConversationId } from '@cairn/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { readNotifyPref } from '../board/notify-pref.js';
import { EN } from '../i18n/en.js';
import { readStoredLocale } from '../i18n/locale.js';
import { translate } from '../i18n/translate.js';
import { safeLocalStorage } from '../safe-storage.js';
import { activityStore } from './activity.js';
import { agentTodoStore } from './agent-todo.js';
import { readStoredToken, useAuth } from './auth.js';
import { invalidateConverged } from './invalidate.js';
import { liveTextStore } from './live-text.js';
import { liveThinkingStore } from './live-thinking.js';
import { textOfContent, thinkingOfContent } from './mappers.js';
import { connect } from './sse-connection.js';
import { streamGuards } from './sse-guards.js';
import { teamEventInvalidations } from './sse-team-events.js';

function streamUrl(path: string): string {
  const token = readStoredToken();
  return token === null ? path : `${path}?token=${encodeURIComponent(token)}`;
}

export function useTeamStream(teamId: string | undefined, enabled: boolean): void {
  const qc = useQueryClient();
  const auth = useAuth();
  useEffect(() => {
    if (teamId === undefined || !enabled || auth.gateOpen) return;
    const resync = () => {
      void invalidateConverged(qc);
    };
    return connect(
      streamUrl(`/api/teams/${teamId}/stream`),
      (ev) => {
        for (const queryKey of teamEventInvalidations(ev, teamId)) {
          void invalidateConverged(qc, { queryKey });
        }
        if (ev.type === 'notification') {
          fireDesktopNotification(ev.notification as NotificationRecord);
        }
      },
      resync,
      streamGuards(qc),
    );
  }, [teamId, enabled, qc, auth]);
}

function notificationHref(record: NotificationRecord): string {
  return record.type === 'chief_message'
    ? `/app?chief=${encodeURIComponent(record.entityId)}`
    : `/app/todo/${encodeURIComponent(record.entityId)}`;
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
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (readNotifyPref(safeLocalStorage()) === 'off') return;
  const t = (source: string) => translate(readStoredLocale(safeLocalStorage()), EN, source);
  const title =
    record.type === 'plan_ready'
      ? t('方案已就绪')
      : record.type === 'build_review'
        ? t('构建待审核')
        : record.type === 'quota_wait'
          ? t('等额度')
          : record.type === 'model_fallback'
            ? t('已换备用模型')
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
    return startConversationStream(conversationId, qc, { onMessage, onStep });
  }, [conversationId, enabled, qc, onMessage, onStep, auth]);
}

export function startConversationStream(
  conversationId: string,
  qc: QueryClient,
  handlers: ConversationStreamHandlers,
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
    streamUrl(`/api/conversations/${conversationId}/stream`),
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
          if (row.role === 'assistant' && textOfContent(row.content).trim() !== '') {
            liveTextStore.noteSettled(conversationId, row.id);
          }
          if (row.role === 'assistant' && thinkingOfContent(row.content) !== null) {
            liveThinkingStore.noteSettled(conversationId, row.id);
          }
          void invalidateConverged(qc, { queryKey: ['messages', conversationId] });
          void invalidateConverged(qc, { queryKey: ['plans'] });
          onMessage?.(row);
          break;
        }
        case 'step': {
          const step = (ev as ConversationStepEvent).step;
          if (step.status === 'done' || step.status === 'failed' || step.status === 'stopped') {
            liveTextStore.clear(conversationId);
            liveThinkingStore.clear(conversationId);
            activityStore.clear(conversationId);
            agentTodoStore.clear(conversationId);
          }
          void invalidateConverged(qc, { queryKey: ['steps', conversationId] });
          void invalidateConverged(qc, { queryKey: ['build', conversationId] });
          void invalidateConverged(qc, { queryKey: ['changes', conversationId] });
          void invalidateConverged(qc, { queryKey: ['plans'] });
          if (isChiefConversationId(conversationId)) {
            void invalidateConverged(qc, { queryKey: ['chiefThreads'] });
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
