import { type AskUserAnswer, type TranscriptRow, transcriptRowSchema } from '@cairn/shared';
import { replaceEqualDeep, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { activityStore } from '../api/activity.js';
import { isCoordinatorNotReady, toastCoordinatorNotReady } from '../api/coordinator-not-ready.js';
import {
  keepNewestMessagesPage,
  useApiMutations,
  useChief,
  useChiefThreads,
  useConversationMessages,
  useMachines,
  useNotifications,
  useProjects,
  useWarmConversationMessages,
} from '../api/hooks.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import { chiefTurnErrorOfContent, mapChief } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { useConversationStream } from '../api/sse.js';
import { THREAD_PARAM } from '../board/thread-copy.js';
import type { EarlierPages } from '../components/chat/earlier-loader.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import { chiefDefault } from '../fixtures/fixtures.js';
import type { ChiefContent, FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  type ChiefView,
  ensureGestureKeys,
  type GestureEvent,
  getGestureStore,
} from '../overlay/gesture-machine.js';
import { settingsHref } from '../settings/settings-href.js';
import {
  type CoordinatorLoad,
  coordinatorLoad,
  globalCoordinatorThread,
} from './coordinator-load.js';
import { needsMachineName } from './needs-machine-name.js';
import { chiefOutbox, type OutboxEntry, type UnsentSends, unlandedItems } from './outbox.js';
import {
  questionActionThread,
  questionDraftKey,
  questionDraftStore,
  questionSubmitStore,
} from './question-drafts.js';

export type { ChiefView };

export interface ChiefSurface {
  load: CoordinatorLoad;
  earlier?: EarlierPages;
  retry: () => void;
  chiefView: ChiefView;
  setChiefView: (view: ChiefView) => void;
  chiefData: ChiefContent;
  chiefUnread: number;
  chiefBusy: boolean;
  chiefFresh: boolean;
  onSend?: (text: string, projectId: string | null) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onAnswerQuestion?: (input: {
    requestId: string;
    answers: AskUserAnswer[];
    threadId?: string;
  }) => void;
  onCancelQuestion?: (requestId: string, threadId?: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  unsent?: UnsentSends;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
}

export interface ChiefDeepLink {
  threadId: string | null;
  onConsumed: () => void;
}

function placeOf(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('chief');
  params.delete(THREAD_PARAM);
  return `${pathname}?${params.toString()}`;
}

export function useChiefSurface(fixture: FixtureSet, deepLink: ChiefDeepLink): ChiefSurface {
  const { live, teamId } = useLiveData();
  const navigate = useNavigate();
  const machines = useMachines(teamId, live).data;
  const routingRules = useRoutingSettings(teamId, live).data?.rules;
  const { t } = useI18n();
  const chiefQ = useChief(teamId, live);
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const notificationsQ = useNotifications(teamId, live);
  const mutations = useApiMutations(teamId);

  const chief = fixture.chief;
  getGestureStore(chief?.view ?? 'none');
  const chiefView = useSyncExternalStore(
    (listener) => getGestureStore().subscribe(listener),
    () => getGestureStore().getState().chief,
    () => getGestureStore().getState().chief,
  );
  const setChiefView = useCallback((view: ChiefView) => {
    const type: GestureEvent['type'] = view === 'settings' ? 'chief/settings' : 'chief/minimize';
    getGestureStore().dispatch({ type });
  }, []);
  useLayoutEffect(() => {
    ensureGestureKeys();
  }, []);

  const { pathname, search } = useLocation();
  const place = placeOf(pathname, search);
  const [linked, setLinked] = useState<{ threadId: string; place: string } | null>(null);
  const linkedThreadId = linked?.place === place ? linked.threadId : null;
  useEffect(() => {
    if (linked !== null && linked.place !== place) setLinked(null);
  }, [linked, place]);
  const liveThreads = chiefThreadsQ.data ?? [];
  const channel = new URLSearchParams(search).get('project');
  const channelThread =
    channel === null
      ? globalCoordinatorThread(liveThreads)
      : (liveThreads.find((thread) => thread.projectId === channel) ?? null);
  const activeThread = live
    ? (liveThreads.find((thread) => thread.id === linkedThreadId) ?? channelThread)
    : null;
  const openChannel = mutations.chiefOpenChannel.mutate;
  const openedChannels = useRef(new Set<string>());
  const channelProject = projectsQ.data?.find((row) => row.id === channel);
  const channelMissing =
    live &&
    channel !== null &&
    chiefThreadsQ.isSuccess &&
    channelThread === null &&
    channelProject !== undefined &&
    channelProject.archivedAt == null;
  useEffect(() => {
    if (!channelMissing || channel === null || openedChannels.current.has(channel)) return;
    openedChannels.current.add(channel);
    openChannel(channel);
  }, [channelMissing, channel, openChannel]);
  const deepLinkId = deepLink.threadId;
  const onDeepLinkConsumed = deepLink.onConsumed;
  useEffect(() => {
    if (deepLinkId === 'settings') {
      setChiefView('settings');
      onDeepLinkConsumed();
      return;
    }
    if (!live || deepLinkId === null || !chiefThreadsQ.isSuccess) return;
    if (liveThreads.some((thread) => thread.id === deepLinkId)) {
      setLinked({ threadId: deepLinkId, place });
      setChiefView('none');
    }
    onDeepLinkConsumed();
  }, [
    live,
    deepLinkId,
    chiefThreadsQ.isSuccess,
    liveThreads,
    onDeepLinkConsumed,
    setChiefView,
    place,
  ]);
  const [shownChannel, setShownChannel] = useState(channel);
  const [newestPageOnly, setNewestPageOnly] = useState(false);
  const { query: chiefMessagesQ, messages: loadedChiefMessages } = useConversationMessages(
    live ? (activeThread?.id ?? null) : null,
    live,
  );
  if (shownChannel !== channel) {
    setShownChannel(channel);
    setNewestPageOnly(channel === null && (chiefMessagesQ.data?.pages.length ?? 0) > 1);
  }
  const newestPage = chiefMessagesQ.data?.pages[0];
  const chiefMessages = useMemo(
    () => (newestPageOnly ? (newestPage?.messages ?? []) : loadedChiefMessages),
    [newestPageOnly, newestPage, loadedChiefMessages],
  );
  const queryClient = useQueryClient();
  const activeThreadId = live ? (activeThread?.id ?? null) : null;
  useWarmConversationMessages(
    live ? (globalCoordinatorThread(liveThreads)?.id ?? null) : null,
    channel !== null,
  );
  useEffect(() => {
    if (!newestPageOnly) return;
    const trimmed =
      activeThreadId === null
        ? Promise.resolve()
        : keepNewestMessagesPage(queryClient, activeThreadId);
    void trimmed.finally(() => setNewestPageOnly(false));
  }, [newestPageOnly, activeThreadId, queryClient]);
  const streamHandlers = useMemo(
    () => ({
      onMessage: (row: TranscriptRow) => {
        const reason = chiefTurnErrorOfContent(row.content);
        if (reason === null) return;
        toast.error(t('Coordinator 本轮执行失败'), { description: reason });
      },
    }),
    [t],
  );
  useConversationStream(live ? (activeThread?.id ?? undefined) : undefined, live, streamHandlers);
  const knownChiefIds = useMemo(() => new Set(chiefMessages.map((m) => m.id)), [chiefMessages]);
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
  const hasEarlier = chiefMessagesQ.hasNextPage;
  const liveChief = useMemo(() => {
    if (!live || !chiefQ.data) return null;
    return {
      ...mapChief(chiefQ.data, {
        threads: liveThreads,
        activeThreadId: activeThread?.id ?? null,
        messages: chiefMessages,
        liveText,
        liveThinking,
        activity,
      }),
      hasEarlier,
    };
  }, [
    live,
    chiefQ.data,
    liveThreads,
    activeThread,
    chiefMessages,
    hasEarlier,
    liveText,
    liveThinking,
    activity,
  ]);
  const outbox = useSyncExternalStore(chiefOutbox.subscribe, chiefOutbox.entries);
  useEffect(() => {
    if (live) chiefOutbox.settle(activeThreadId, knownChiefIds);
  }, [live, outbox, activeThreadId, knownChiefIds]);
  const liveChiefWithUnsent = useMemo(() => {
    if (liveChief === null) return null;
    const unlanded = unlandedItems(outbox, activeThreadId, knownChiefIds);
    return unlanded.length === 0
      ? liveChief
      : { ...liveChief, stream: [...(liveChief.stream ?? []), ...unlanded] };
  }, [liveChief, outbox, activeThreadId, knownChiefIds]);
  const { fetchNextPage, isFetchingNextPage, isFetchNextPageError } = chiefMessagesQ;
  const loadEarlier = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const earlier: EarlierPages | undefined = live
    ? { loading: isFetchingNextPage, failed: isFetchNextPageError, onLoad: loadEarlier }
    : undefined;

  const fixtureChief = chief ?? chiefDefault;
  const fixtureChannel = channel === null ? null : fixture.chiefChannels?.[channel];
  const fixtureData = useMemo(
    () =>
      channel === null
        ? fixtureChief
        : (fixtureChannel ?? { ...fixtureChief, stream: [], streamAt: [], hasEarlier: false }),
    [channel, fixtureChief, fixtureChannel],
  );
  const freshChiefData = live ? (liveChiefWithUnsent ?? chiefDefault) : fixtureData;
  const sharedStreamRef = useRef(freshChiefData.stream);
  const sharedStream = replaceEqualDeep(sharedStreamRef.current, freshChiefData.stream);
  useLayoutEffect(() => {
    sharedStreamRef.current = sharedStream;
  });
  const chiefData = useMemo(
    () =>
      sharedStream === freshChiefData.stream
        ? freshChiefData
        : { ...freshChiefData, stream: sharedStream },
    [freshChiefData, sharedStream],
  );
  const liveUnread = live
    ? (notificationsQ.data?.unreadThreadIds ?? []).filter((id) => id.startsWith('chief-')).length
    : 0;
  const chiefUnread = live ? liveUnread : (fixture.chiefUnread ?? 0);
  const chiefBusy = live
    ? liveThreads.some((thread) => thread.activeRun != null)
    : fixture.chiefBusy === true;
  const chiefFresh =
    !live ||
    activeThread === null ||
    (activeThread.activeRun == null && activeThread.lastTurnAt == null);

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
    ? (input: { requestId: string; answers: AskUserAnswer[]; threadId?: string }) => {
        const threadId = questionActionThread(input.threadId, activeThread?.id ?? null);
        if (threadId === null) return;
        const key = questionDraftKey({
          teamId: teamId ?? 'local',
          conversationId: threadId,
          requestId: input.requestId,
        });
        questionSubmitStore.patch(key, { submitting: true, error: null });
        mutations.chiefAnswerQuestion.mutate(
          { threadId, requestId: input.requestId, answers: input.answers },
          {
            onSuccess: () => {
              questionDraftStore.clear(key);
              questionSubmitStore.clear(key);
            },
            onError: (e) => {
              questionSubmitStore.patch(key, {
                submitting: false,
                error: t('提交回答失败，草稿还在，请再试一次。'),
              });
              toastError(t('提交回答失败，请重试。'), e);
            },
          },
        );
      }
    : undefined;
  const onCancelQuestion = live
    ? (requestId: string, threadId?: string) => {
        const id = questionActionThread(threadId, activeThread?.id ?? null);
        if (id === null) return;
        mutations.chiefCancelQuestion.mutate(
          { threadId: id, requestId },
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
            toastError(t('撤回失败，Coordinator 可能已经开始处理这条了。'), error);
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

  const deliver = (entry: OutboxEntry) =>
    mutations.chiefSend
      .mutateAsync({
        threadId: entry.threadId,
        content: entry.text,
        projectId: entry.projectId,
        clientMessageId: entry.key,
      })
      .then(
        (result) => ({
          threadId: result.thread.id,
          messageId: transcriptRowSchema.safeParse(result.message).data?.id ?? null,
        }),
        (error: unknown) => {
          if (isCoordinatorNotReady(error))
            toastCoordinatorNotReady(
              t('Coordinator 还不能回答'),
              t('点输入框下方的按钮，把模型来源、机器和 Coordinator 接上，再发一次。'),
            );
          else toastError(t('发送失败，请重试。'), error);
          throw error;
        },
      );
  const unsent = useMemo<UnsentSends | undefined>(
    () =>
      live
        ? {
            failed: outbox.filter((entry) => entry.state === 'failed'),
            discard: (outboxKey) => chiefOutbox.discard(outboxKey)?.text ?? null,
          }
        : undefined,
    [live, outbox],
  );
  const onSend = live
    ? (text: string, projectId: string | null) => {
        const sessionMachineId = routingRules?.find((rule) => rule.use === 'session')?.machineId;
        if (activeThread == null && needsMachineName(machines, sessionMachineId)) {
          toast.warning(t('先选择机器'), {
            description: t('多台机器在线时，开工前要在规则里点名一台。'),
            action: {
              label: t('去选择'),
              onClick: () => navigate(settingsHref('work-routing')),
            },
          });
          return Promise.reject(new Error('Name a machine first'));
        }
        chiefOutbox.enqueue({ threadId: activeThread?.id ?? null, projectId, text }, deliver);
        return Promise.resolve();
      }
    : DEMO_MODE
      ? () => {
          blockDemoWrite();
        }
      : undefined;

  const wasReadyRef = useRef(false);
  const load: CoordinatorLoad = live
    ? coordinatorLoad({
        chief: chiefQ,
        coordinator: chiefThreadsQ,
        messages: chiefMessagesQ,
        hasThread: activeThread !== null,
        wasReady: wasReadyRef.current,
      })
    : 'ready';
  const channelLoad: CoordinatorLoad =
    load === 'ready' && channelMissing
      ? mutations.chiefOpenChannel.isError
        ? 'error'
        : 'loading'
      : load;
  if (activeThread === null && chiefQ.isSuccess && chiefThreadsQ.isSuccess)
    wasReadyRef.current = true;
  else if (activeThread !== null && !chiefMessagesQ.isPending) wasReadyRef.current = false;
  const retry = () => {
    if (channelMissing && channel !== null) openChannel(channel);
    void chiefQ.refetch();
    void chiefThreadsQ.refetch();
    if (activeThread !== null) void chiefMessagesQ.refetch();
  };

  return {
    load: channelLoad,
    earlier,
    retry,
    chiefView,
    setChiefView,
    chiefData,
    chiefUnread,
    chiefBusy,
    chiefFresh,
    onSend,
    onRewind,
    onAnswerQuestion,
    onCancelQuestion,
    onWithdraw,
    ...(unsent !== undefined ? { unsent } : {}),
    onSteer,
    onStop,
  };
}
