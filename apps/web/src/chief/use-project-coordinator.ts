import type { AskUserAnswer, TranscriptRow } from '@cairn/shared';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { activityStore } from '../api/activity.js';
import { ApiError } from '../api/client.js';
import { useApiMutations, useChief, useMessages, useProjectCoordinator } from '../api/hooks.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import { chiefTurnErrorOfContent, mapChief } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useConversationStream } from '../api/sse.js';
import { toastError } from '../components/ui/toaster.js';
import { chiefDefault } from '../fixtures/fixtures.js';
import type { ChiefContent, FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export interface ProjectCoordinator {
  chiefData: ChiefContent;
  loading: boolean;
  sendError: string | null;
  onSend: (text: string) => Promise<void>;
  onRewind?: (messageId: string) => void;
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancelQuestion?: (requestId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
}

export function useProjectCoordinatorSurface(
  projectId: string | undefined,
  fixture: FixtureSet,
): ProjectCoordinator {
  const { live, teamId } = useLiveData();
  const { t } = useI18n();
  const chiefQ = useChief(teamId, live);
  const coordinatorQ = useProjectCoordinator(projectId, live);
  const mutations = useApiMutations(teamId);
  const [sendError, setSendError] = useState<string | null>(null);
  const thread = live ? (coordinatorQ.data?.thread ?? null) : null;
  const threadId = thread?.id ?? null;
  const messagesQ = useMessages(threadId, live);
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
  useConversationStream(threadId ?? undefined, live, streamHandlers);
  const messagesData = messagesQ.data;
  const knownIds = useMemo(
    () => new Set((messagesData?.messages ?? []).map((m) => m.id)),
    [messagesData],
  );
  const liveText = useSyncExternalStore(liveTextStore.subscribe, () =>
    threadId !== null ? liveTextStore.getVisible(threadId, knownIds) : '',
  );
  const liveThinking = useSyncExternalStore(liveThinkingStore.subscribe, () =>
    threadId !== null ? liveThinkingStore.getVisible(threadId, knownIds) : '',
  );
  useEffect(() => {
    if (threadId === null) return;
    liveTextStore.prune(threadId, knownIds);
    liveThinkingStore.prune(threadId, knownIds);
  }, [threadId, knownIds]);
  const activity = useSyncExternalStore(activityStore.subscribe, () =>
    threadId !== null ? activityStore.get(threadId) : null,
  );
  const liveChief = useMemo(() => {
    if (!live || !chiefQ.data) return null;
    return mapChief(chiefQ.data, {
      threads: thread === null ? [] : [thread],
      activeThreadId: threadId,
      messages: messagesData?.messages ?? [],
      liveText,
      liveThinking,
      activity,
    });
  }, [live, chiefQ.data, thread, threadId, messagesData, liveText, liveThinking, activity]);

  if (!live) {
    const failure = fixture.projectHome?.sendError;
    return {
      chiefData: fixture.chief ?? chiefDefault,
      loading: false,
      sendError: failure?.message ?? null,
      onSend: () => Promise.resolve(),
    };
  }

  const withThread =
    <A extends unknown[]>(run: (threadId: string, ...args: A) => void) =>
    (...args: A) => {
      if (threadId !== null) run(threadId, ...args);
    };

  return {
    chiefData: { ...(liveChief ?? chiefDefault), examples: undefined },
    loading: chiefQ.isLoading || coordinatorQ.isLoading,
    sendError,
    onSend: (text: string) => {
      if (projectId === undefined) return Promise.resolve();
      setSendError(null);
      return mutations.projectCoordinatorSend
        .mutateAsync({ projectId, content: text })
        .then(() => undefined)
        .catch((error: unknown) => {
          setSendError(
            error instanceof ApiError && error.status === 409
              ? t('项目已归档，取消归档后才能发送。')
              : t('连不上 Coordinator，消息已保留，请重试。'),
          );
          throw error;
        });
    },
    onRewind: withThread((id, messageId: string) =>
      mutations.chiefRewind.mutate(
        { threadId: id, messageId },
        { onError: (e) => toastError(t('恢复失败，请重试。'), e) },
      ),
    ),
    onAnswerQuestion: withThread((id, input: { requestId: string; answers: AskUserAnswer[] }) =>
      mutations.chiefAnswerQuestion.mutate(
        { threadId: id, ...input },
        { onError: (e) => toastError(t('提交回答失败，请重试。'), e) },
      ),
    ),
    onCancelQuestion: withThread((id, requestId: string) =>
      mutations.chiefCancelQuestion.mutate(
        { threadId: id, requestId },
        { onError: (e) => toastError(t('取消提问失败，请重试。'), e) },
      ),
    ),
    onWithdraw: (messageId: string) =>
      threadId === null
        ? Promise.resolve()
        : mutations.chiefWithdraw
            .mutateAsync({ threadId, messageId })
            .then(() => undefined)
            .catch((error: unknown) => {
              toastError(t('撤回失败，总管可能已经开始处理这条了。'), error);
              throw error;
            }),
    onSteer: withThread((id, messageId: string) =>
      mutations.chiefSteer.mutate(
        { threadId: id, messageId },
        { onError: (e) => toastError(t('插话失败，请重试。'), e) },
      ),
    ),
    onStop: withThread((id) =>
      mutations.chiefStop.mutate(
        { threadId: id },
        { onError: (e) => toastError(t('停止失败，请重试。'), e) },
      ),
    ),
  };
}
