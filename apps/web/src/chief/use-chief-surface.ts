import type { AskUserAnswer, TranscriptRow } from '@cairn/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { toast } from 'sonner';
import { activityStore } from '../api/activity.js';
import {
  useApiMutations,
  useChief,
  useChiefThreads,
  useMessages,
  useNotifications,
} from '../api/hooks.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import { chiefTurnErrorOfContent, mapChief } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useConversationStream } from '../api/sse.js';
import { toastError } from '../components/ui/toaster.js';
import { chiefDefault } from '../fixtures/fixtures.js';
import type { ChiefContent, FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  type ChiefView,
  ensureGestureKeys,
  type GestureEvent,
  getGestureStore,
} from '../overlay/gesture-machine.js';

export type { ChiefView };

export interface ChiefSurface {
  chiefView: ChiefView;
  setChiefView: (view: ChiefView) => void;
  chiefData: ChiefContent;
  chiefUnread: number;
  chiefBusy: boolean;
  onSend?: (text: string) => void | Promise<void>;
  onThread?: (title: string, index: number) => void;
  onNewThread?: () => void;
  onRewind?: (messageId: string) => void;
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancelQuestion?: (requestId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
}

const NEW_THREAD = -1;

export interface ChiefDeepLink {
  threadId: string | null;
  onConsumed: () => void;
}

export const CHIEF_OPEN_STORAGE_KEY = 'cairn.chief-open';

function readStoredChiefOpen(): boolean {
  try {
    return localStorage.getItem(CHIEF_OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useChiefSurface(
  fixture: FixtureSet,
  deepLink?: ChiefDeepLink,
  onHome = false,
): ChiefSurface {
  const { live, teamId } = useLiveData();
  const { t } = useI18n();
  const chiefQ = useChief(teamId, live);
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const notificationsQ = useNotifications(teamId, live);
  const mutations = useApiMutations(teamId);

  const chief = fixture.chief;
  const initialChief: ChiefView =
    chief?.view ?? (live && readStoredChiefOpen() ? 'drawer' : 'none');
  getGestureStore(initialChief);
  const chiefView = useSyncExternalStore(
    (listener) => getGestureStore().subscribe(listener),
    () => getGestureStore().getState().chief,
    () => getGestureStore().getState().chief,
  );
  const setChiefView = useCallback((view: ChiefView) => {
    const type: GestureEvent['type'] =
      view === 'none' ? 'chief/minimize' : view === 'settings' ? 'chief/settings' : 'chief/open';
    getGestureStore().dispatch({ type });
  }, []);
  useLayoutEffect(() => {
    ensureGestureKeys();
  }, []);
  const chiefViewOpen = chiefView === 'drawer';
  useEffect(() => {
    if (!live || onHome) return;
    try {
      localStorage.setItem(CHIEF_OPEN_STORAGE_KEY, chiefView === 'drawer' ? '1' : '0');
    } catch {}
  }, [live, onHome, chiefView]);

  const [activeThreadIdx, setActiveThreadIdx] = useState<number | null>(null);
  const liveThreads = chiefThreadsQ.data ?? [];
  const activeThread =
    live && liveThreads.length > 0 && activeThreadIdx !== NEW_THREAD
      ? (liveThreads[activeThreadIdx ?? 0] ?? null)
      : null;
  const deepLinkId = deepLink?.threadId ?? null;
  const onDeepLinkConsumed = deepLink?.onConsumed;
  useEffect(() => {
    if (deepLinkId === 'settings') {
      setChiefView('settings');
      onDeepLinkConsumed?.();
      return;
    }
    if (!live || deepLinkId === null || !chiefThreadsQ.isSuccess) return;
    const idx = liveThreads.findIndex((thread) => thread.id === deepLinkId);
    if (idx >= 0) {
      setActiveThreadIdx(idx);
      if (!onHome) setChiefView('drawer');
    }
    onDeepLinkConsumed?.();
  }, [
    live,
    deepLinkId,
    chiefThreadsQ.isSuccess,
    liveThreads,
    onDeepLinkConsumed,
    setChiefView,
    onHome,
  ]);
  const chiefMessagesQ = useMessages(live ? (activeThread?.id ?? null) : null, live);
  const streamHandlers = useMemo(
    () => ({
      onMessage: (row: TranscriptRow) => {
        const reason = chiefTurnErrorOfContent(row.content);
        if (reason === null) return;
        toast.error(t('总管本轮执行失败'), { description: reason });
      },
    }),
    [t],
  );
  useConversationStream(
    live ? (activeThread?.id ?? undefined) : undefined,
    live && (chiefViewOpen || onHome),
    streamHandlers,
  );
  const activeThreadId = live ? (activeThread?.id ?? null) : null;
  const chiefMessagesData = chiefMessagesQ.data;
  const knownChiefIds = useMemo(
    () => new Set((chiefMessagesData?.messages ?? []).map((m) => m.id)),
    [chiefMessagesData],
  );
  const liveText = useSyncExternalStore(liveTextStore.subscribe, () =>
    activeThreadId !== null ? liveTextStore.getVisible(activeThreadId, knownChiefIds) : '',
  );
  const liveThinking = useSyncExternalStore(liveThinkingStore.subscribe, () =>
    activeThreadId !== null ? liveThinkingStore.getVisible(activeThreadId, knownChiefIds) : '',
  );
  useEffect(() => {
    if (activeThreadId !== null) {
      liveTextStore.prune(activeThreadId, knownChiefIds);
      liveThinkingStore.prune(activeThreadId, knownChiefIds);
    }
  }, [activeThreadId, knownChiefIds]);
  const activity = useSyncExternalStore(activityStore.subscribe, () =>
    activeThreadId !== null ? activityStore.get(activeThreadId) : null,
  );
  const liveChief = useMemo(() => {
    if (!live || !chiefQ.data) return null;
    return mapChief(chiefQ.data, {
      threads: liveThreads,
      activeThreadId: activeThread?.id ?? null,
      messages: chiefMessagesQ.data?.messages ?? [],
      liveText,
      liveThinking,
      activity,
    });
  }, [
    live,
    chiefQ.data,
    liveThreads,
    activeThread,
    chiefMessagesQ.data,
    liveText,
    liveThinking,
    activity,
  ]);

  const chiefData = live ? (liveChief ?? chiefDefault) : (chief ?? chiefDefault);
  const liveUnread = live
    ? (notificationsQ.data?.unreadThreadIds ?? []).filter((id) => id.startsWith('chief-')).length
    : 0;
  const chiefUnread = live ? liveUnread : (fixture.chiefUnread ?? 0);
  const chiefBusy = live
    ? liveThreads.some((thread) => thread.activeRun != null)
    : fixture.chiefBusy === true;

  const onRewind = live
    ? (messageId: string) => {
        if (activeThread === null) return;
        mutations.chiefRewind.mutate(
          { threadId: activeThread.id, messageId },
          { onError: (e) => toastError(t('恢复失败，请重试。'), e) },
        );
      }
    : undefined;
  const onAnswerQuestion = live
    ? (input: { requestId: string; answers: AskUserAnswer[] }) => {
        if (activeThread === null) return;
        mutations.chiefAnswerQuestion.mutate(
          { threadId: activeThread.id, ...input },
          { onError: (e) => toastError(t('提交回答失败，请重试。'), e) },
        );
      }
    : undefined;
  const onCancelQuestion = live
    ? (requestId: string) => {
        if (activeThread === null) return;
        mutations.chiefCancelQuestion.mutate(
          { threadId: activeThread.id, requestId },
          { onError: (e) => toastError(t('取消提问失败，请重试。'), e) },
        );
      }
    : undefined;

  const onWithdraw = live
    ? (messageId: string) => {
        if (activeThread === null) return Promise.resolve();
        return mutations.chiefWithdraw
          .mutateAsync({ threadId: activeThread.id, messageId })
          .then(() => undefined)
          .catch((error: unknown) => {
            toastError(t('撤回失败，总管可能已经开始处理这条了。'), error);
            throw error;
          });
      }
    : undefined;
  const onSteer = live
    ? (messageId: string) => {
        if (activeThread === null) return;
        mutations.chiefSteer.mutate(
          { threadId: activeThread.id, messageId },
          { onError: (e) => toastError(t('插话失败，请重试。'), e) },
        );
      }
    : undefined;
  const onStop = live
    ? () => {
        if (activeThread === null) return;
        mutations.chiefStop.mutate(
          { threadId: activeThread.id },
          { onError: (e) => toastError(t('停止失败，请重试。'), e) },
        );
      }
    : undefined;

  const onSend = live
    ? (text: string) => {
        return mutations.chiefSend
          .mutateAsync({ threadId: activeThread?.id ?? null, content: text })
          .then(() => {
            if (activeThread === null) setActiveThreadIdx(0);
          })
          .catch((error: unknown) => {
            toastError(t('发送失败，请重试。'), error);
            throw error;
          });
      }
    : undefined;
  const onThread = live ? (_title: string, index: number) => setActiveThreadIdx(index) : undefined;
  const onNewThread = live ? () => setActiveThreadIdx(NEW_THREAD) : undefined;

  return {
    chiefView,
    setChiefView,
    chiefData,
    chiefUnread,
    chiefBusy,
    onSend,
    onThread,
    onNewThread,
    onRewind,
    onAnswerQuestion,
    onCancelQuestion,
    onWithdraw,
    onSteer,
    onStop,
  };
}
