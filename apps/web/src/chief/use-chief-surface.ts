import {
  type AskUserAnswer,
  CHIEF_MESSAGE_MERGED,
  CHIEF_MESSAGE_READ,
  NOTHING_TO_STOP,
  type TranscriptRow,
  transcriptRowSchema,
} from '@cairn/shared';
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
import { ApiError } from '../api/client.js';
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
  useSession,
  useWarmConversationMessages,
} from '../api/hooks.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import { mapChief } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { useConversationStream } from '../api/sse.js';
import { THREAD_PARAM } from '../board/thread-copy.js';
import type { EarlierPages } from '../components/chat/earlier-loader.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import { chiefDefault } from '../fixtures/chief.js';
import type { ChiefContent, FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { markErrorSurfaced } from '../lib/mutation-error-report.js';
import { ensureGestureKeys } from '../overlay/gesture-machine.js';
import { settingsHref } from '../settings/settings-href.js';
import { announceUnsent, reportedByOutbox } from './announce-unsent.js';
import { isApprovalRequest } from './approval-card-model.js';
import {
  type CoordinatorLoad,
  coordinatorLoad,
  globalCoordinatorThread,
} from './coordinator-load.js';
import { needsMachineName } from './needs-machine-name.js';
import {
  chiefOutbox,
  failedOutboxForChannel,
  keepSentKeys,
  type OutboxEntry,
  type UnsentSends,
  unlandedItems,
} from './outbox.js';
import {
  questionActionThread,
  questionDraftKey,
  questionDraftStore,
  questionSubmitStore,
} from './question-drafts.js';

export interface ChiefSurface {
  load: CoordinatorLoad;
  earlier?: EarlierPages;
  retry: () => void;
  chiefData: ChiefContent;
  chiefUnread: number;
  chiefBusy: boolean;
  chiefFresh: boolean;
  onSend?: (
    text: string,
    projectId: string | null,
    designCommentIds?: readonly string[],
  ) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onRetryGreeting?: () => void;
  onAnswerQuestion?: (input: {
    requestId: string;
    answers: AskUserAnswer[];
    threadId?: string;
  }) => void;
  onCancelQuestion?: (requestId: string, threadId?: string) => Promise<void>;
  onWithdraw?: (messageId: string) => Promise<void>;
  unsent?: UnsentSends;
  onStop?: () => void;
}

export interface ChiefDeepLink {
  threadId: string | null;
  onConsumed: () => void;
}

export type ChiefActionErrorKind = 'answer' | 'cancel' | 'rewind' | 'retry-greeting';

export type ChiefActionErrorResolution =
  | { kind: 'not-ready'; title: string; hint: string; inline: string }
  | { kind: 'specific'; title: string; inline: string };

export function chiefActionErrorCopy(
  error: unknown,
  action: ChiefActionErrorKind,
  requestId?: string,
): ChiefActionErrorResolution | null {
  if (isCoordinatorNotReady(error)) {
    return {
      kind: 'not-ready',
      title: 'Coordinator 暂无可用模型',
      hint: '请先在设置里配置模型来源后再重试。',
      inline: 'Coordinator 暂无可用模型，请先在设置里配置模型来源。',
    };
  }
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const message = error.message;
  if (action === 'answer' || action === 'cancel') {
    const approval = requestId !== undefined && isApprovalRequest(requestId);
    if (approval && /expired|已过期/i.test(message)) {
      return {
        kind: 'specific',
        title: '这条审批已过期，未能执行。',
        inline: '这条审批已过期，未能执行。',
      };
    }
    if (approval && /not pending|already /i.test(message)) {
      return {
        kind: 'specific',
        title: '这条审批已处理或已过期。',
        inline: '这条审批已处理或已过期。',
      };
    }
    if (/already (?:answered|cancelled)/i.test(message)) {
      return {
        kind: 'specific',
        title: '这条提问已结束，无需重复提交。',
        inline: '这条提问已结束，无需重复提交。',
      };
    }
  }
  if (action === 'rewind' && /in flight|回合中/i.test(message)) {
    return {
      kind: 'specific',
      title: 'Coordinator 正在运行，请停止后再重试。',
      inline: 'Coordinator 正在运行，请停止后再重试。',
    };
  }
  return null;
}

function placeOf(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('chief');
  params.delete(THREAD_PARAM);
  return `${pathname}?${params.toString()}`;
}

function unsentCoordinatorHref(entry: OutboxEntry): string {
  const params = new URLSearchParams();
  if (entry.projectId !== null) params.set('project', entry.projectId);
  else if (entry.threadId !== null) params.set('chief', entry.threadId);
  const query = params.toString();
  return query === '' ? '/app' : `/app?${query}`;
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
  const userId = useSession(live).data?.id;
  const mutations = useApiMutations(teamId);

  const chief = fixture.chief;
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
    if (!live || deepLinkId === null || !chiefThreadsQ.isSuccess) return;
    if (liveThreads.some((thread) => thread.id === deepLinkId)) {
      setLinked({ threadId: deepLinkId, place });
    }
    onDeepLinkConsumed();
  }, [live, deepLinkId, chiefThreadsQ.isSuccess, liveThreads, onDeepLinkConsumed, place]);
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
    live ? liveThreads.map((thread) => thread.id) : [],
    live && channel !== null ? (globalCoordinatorThread(liveThreads)?.id ?? null) : null,
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
      onMessage: (row: TranscriptRow, clientMessageId?: string) => {
        if (row.role === 'user' && clientMessageId !== undefined)
          chiefOutbox.land(clientMessageId, row.id);
      },
    }),
    [],
  );
  useConversationStream(live ? (activeThread?.id ?? undefined) : undefined, live, streamHandlers);
  const knownChiefIds = useMemo(() => new Set(chiefMessages.map((m) => m.id)), [chiefMessages]);
  const knownClientIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of chiefMessages) {
      if (m.role === 'user' && m.clientMessageId != null) map.set(m.clientMessageId, m.id);
    }
    return map;
  }, [chiefMessages]);
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
  const globalThreadId = live ? (globalCoordinatorThread(liveThreads)?.id ?? null) : null;
  useEffect(() => {
    if (!live) return;
    if (knownClientIds.size > 0) chiefOutbox.landKnown(knownClientIds);
    chiefOutbox.settle(activeThreadId, knownChiefIds);
  }, [live, outbox, activeThreadId, knownChiefIds, knownClientIds]);
  const liveChiefWithUnsent = useMemo(() => {
    if (liveChief === null) return null;
    const unlanded = unlandedItems(
      outbox,
      activeThreadId,
      knownChiefIds,
      globalThreadId,
      channel,
      knownClientIds,
    );
    return {
      ...liveChief,
      stream: [...keepSentKeys(liveChief.stream ?? [], chiefOutbox), ...unlanded],
    };
  }, [liveChief, outbox, activeThreadId, knownChiefIds, knownClientIds, globalThreadId, channel]);
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

  const reportChiefActionError = (
    error: unknown,
    action: ChiefActionErrorKind,
    fallbackTitle: string,
    requestId?: string,
  ): string => {
    const resolved = chiefActionErrorCopy(error, action, requestId);
    if (resolved?.kind === 'not-ready') {
      toastCoordinatorNotReady(t(resolved.title), t(resolved.hint), error);
      return t(resolved.inline);
    }
    if (resolved?.kind === 'specific') {
      markErrorSurfaced(error);
      toast.error(t(resolved.title));
      return t(resolved.inline);
    }
    toastError(t(fallbackTitle), error);
    return t(fallbackTitle);
  };
  const retryGreetingStepId = activeThread?.retryGreetingStepId;
  const onRetryGreeting =
    live && activeThread !== null && retryGreetingStepId != null
      ? () => {
          if (mutations.chiefRetryGreeting.isPending) return;
          mutations.chiefRetryGreeting.mutate(
            { threadId: activeThread.id, stepId: retryGreetingStepId },
            {
              onError: (e) =>
                void reportChiefActionError(e, 'retry-greeting', '恢复失败，请重试。'),
            },
          );
        }
      : undefined;
  const onRewind = live
    ? (messageId: string) => {
        if (activeThread === null) return;
        mutations.chiefRewind.mutate(
          { threadId: activeThread.id, messageId },
          { onError: (e) => void reportChiefActionError(e, 'rewind', '重试失败，请稍后重试。') },
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
              const resolved = chiefActionErrorCopy(e, 'answer', input.requestId);
              if (resolved?.kind === 'not-ready') {
                questionSubmitStore.patch(key, { submitting: false, error: t(resolved.inline) });
                toastCoordinatorNotReady(t(resolved.title), t(resolved.hint), e);
                return;
              }
              if (resolved?.kind === 'specific') {
                questionSubmitStore.patch(key, { submitting: false, error: t(resolved.inline) });
                markErrorSurfaced(e);
                toast.error(t(resolved.title));
                return;
              }
              questionSubmitStore.patch(key, {
                submitting: false,
                error: t('提交回答失败，草稿已保留，请重试。'),
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
        if (id === null) return Promise.resolve();
        return mutations.chiefCancelQuestion
          .mutateAsync({ threadId: id, requestId })
          .then(() => undefined)
          .catch((e) => {
            reportChiefActionError(e, 'cancel', '取消提问失败，请重试。', requestId);
            throw e;
          });
      }
    : undefined;

  const onWithdraw = live
    ? (messageId: string) => {
        if (activeThread === null) return Promise.resolve();
        return mutations.chiefWithdraw
          .mutateAsync({ threadId: activeThread.id, messageId })
          .then(() => undefined)
          .catch((error: unknown) => {
            const alreadyGone =
              error instanceof ApiError &&
              (error.status === 404 || error.reason === NOTHING_TO_STOP);
            const reason = error instanceof ApiError ? error.reason : undefined;
            if (reason === CHIEF_MESSAGE_READ)
              toastError(t('撤回失败，Coordinator 已经读到这条了。'), null);
            else if (reason === CHIEF_MESSAGE_MERGED) toastError(t('撤回失败。'), error);
            else if (!alreadyGone) toastError(t('撤回失败，请重试。'), error);
            throw error;
          });
      }
    : undefined;
  const onStop = live
    ? (messageId?: string) => {
        if (activeThread === null) return;
        mutations.chiefStop.mutate(
          { threadId: activeThread.id, messageId },
          { onError: (e) => toastError(t('停止失败，请重试。'), e) },
        );
      }
    : undefined;

  const deliver = (entry: OutboxEntry, signal?: AbortSignal) =>
    mutations.chiefSend
      .mutateAsync({
        threadId: entry.threadId,
        content: entry.text,
        projectId: entry.projectId,
        clientMessageId: entry.key,
        ...(entry.designCommentIds !== undefined
          ? { designCommentIds: entry.designCommentIds }
          : {}),
        ...(signal !== undefined ? { signal } : {}),
      })
      .then(
        (result) => ({
          threadId: result.thread.id,
          messageId: transcriptRowSchema.safeParse(result.message).data?.id ?? null,
        }),
        reportedByOutbox,
      );
  const sendFailed = (_entry: OutboxEntry, error: unknown) => {
    if (isCoordinatorNotReady(error))
      toastCoordinatorNotReady(t('Coordinator 还不能回答'), t('先接入模型来源，再发一次。'), error);
    else toastError(t('发送失败，请重试。'), error);
  };
  const outboxScope = userId !== undefined && teamId !== undefined ? `${userId}/${teamId}` : null;
  const resumeRef = useRef({ deliver, t, navigate });
  resumeRef.current = { deliver, t, navigate };
  useEffect(() => {
    if (live && outboxScope !== null)
      void chiefOutbox.resume(
        outboxScope,
        (entry, signal) => resumeRef.current.deliver(entry, signal),
        {
          onFailed: (entry, error, repeat) => {
            if (repeat !== true)
              announceUnsent(error, resumeRef.current.t, () =>
                resumeRef.current.navigate(unsentCoordinatorHref(entry)),
              );
          },
        },
      );
  }, [live, outboxScope]);
  const unsent = useMemo<UnsentSends | undefined>(
    () =>
      live
        ? {
            failed: failedOutboxForChannel(outbox, activeThreadId, channel),
            discard: (outboxKey) => chiefOutbox.discard(outboxKey)?.text ?? null,
            onArrivedLate: (listener) => chiefOutbox.subscribeLateArrival(listener),
          }
        : undefined,
    [live, outbox, activeThreadId, channel],
  );
  const onSend = live
    ? (text: string, projectId: string | null, designCommentIds?: readonly string[]) => {
        const sessionMachineId = routingRules?.find((rule) => rule.use === 'session')?.machineId;
        if (activeThread == null && needsMachineName(machines, sessionMachineId)) {
          toast.warning(t('先选择执行机'), {
            description: t('多台执行机在线时，开工前要在规则里点名一台。'),
            action: {
              label: t('去选择'),
              onClick: () => navigate(settingsHref('routing')),
            },
          });
          const refusal = new Error('Name a machine first');
          markErrorSurfaced(refusal);
          return Promise.reject(refusal);
        }
        chiefOutbox.enqueue(
          {
            scope: outboxScope,
            threadId: activeThread?.id ?? null,
            globalThreadId,
            projectId,
            text,
            ...(designCommentIds !== undefined && designCommentIds.length > 0
              ? { designCommentIds }
              : {}),
          },
          deliver,
          { onFailed: sendFailed },
        );
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
    chiefData,
    chiefUnread,
    chiefBusy,
    chiefFresh,
    onSend,
    onRewind,
    onRetryGreeting,
    onAnswerQuestion,
    onCancelQuestion,
    onWithdraw,
    ...(unsent !== undefined ? { unsent } : {}),
    onStop,
  };
}
