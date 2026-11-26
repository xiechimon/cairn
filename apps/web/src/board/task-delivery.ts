import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { type ApiMutations, useApiMutations, useSession } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { announceUnsent, dismissUnsent, reportedByOutbox } from '../chief/announce-unsent.js';
import type { Deliver, SendFailed } from '../chief/outbox.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { describeError } from '../lib/error-copy.js';
import {
  markTaskReadyToSettle,
  taskIsWatched,
  taskOutbox,
  taskOutboxErrors,
  watchTask,
} from './task-outbox.js';

let announceTaskFailure: SendFailed | null = null;

export function taskDelivery(mutations: ApiMutations, qc: QueryClient): Deliver {
  return async (entry, signal) => {
    const { task, threadId: buildId } = entry;
    if (task === undefined || buildId === null) throw new Error('Not a task send');
    if (task.mode !== 'reply') {
      await mutations.sendSteer.mutateAsync({
        conversationId: buildId,
        content: entry.text,
        mode: 'queue',
        deliverAfterStop: task.mode === 'stop-and-send',
        clientMessageId: entry.key,
        signal,
      });
      return { threadId: buildId, messageId: null };
    }
    const result = await mutations.messageThread.mutateAsync({
      todoId: task.todoId,
      conversationId: buildId,
      content: entry.text,
      clientMessageId: entry.key,
      signal,
    });
    const targetId = result?.conversationId ?? buildId;
    markTaskReadyToSettle(entry.key);
    if (targetId === buildId) {
      void qc.refetchQueries(
        { queryKey: ['messages', targetId, 'pages'], type: 'active' },
        { cancelRefetch: false },
      );
    }
    return { threadId: targetId, messageId: null };
  };
}

export function taskSendFailed(t: TFunc): SendFailed {
  return (entry, error) => {
    if (entry.task === undefined) return;
    taskOutboxErrors.set(entry.task.todoId, describeError(error, t) ?? t('发送失败，请重试。'));
  };
}

const unsentToastId = (todoId: string) => `unsent-task-${todoId}`;

export function openTaskChat(todoId: string): () => void {
  dismissUnsent(unsentToastId(todoId));
  return watchTask(todoId);
}

export function liveTaskDelivery(deliver: Deliver): Deliver {
  return (entry, signal) => deliver(entry, signal).catch(reportedByOutbox);
}

export function liveTaskSendFailed(t: TFunc): SendFailed {
  return (entry, error, repeat) => {
    taskSendFailed(t)(entry, error);
    if (repeat !== true && entry.task !== undefined && !taskIsWatched(entry.task.todoId))
      announceTaskFailure?.(entry, error);
  };
}

export function useTaskOutboxResume(): void {
  const { live, teamId } = useLiveData();
  const userId = useSession(live).data?.id;
  const mutations = useApiMutations(teamId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const latest = useRef({ mutations, qc, navigate, t });
  latest.current = { mutations, qc, navigate, t };
  const account = userId !== undefined && teamId !== undefined ? `${userId}/${teamId}` : null;
  useEffect(() => {
    const announce: SendFailed = (entry, error) => {
      const { t, navigate } = latest.current;
      const todoId = entry.task?.todoId;
      if (todoId === undefined) return;
      announceUnsent(error, t, () => navigate(`/app/todo/${todoId}`), unsentToastId(todoId));
    };
    announceTaskFailure = announce;
    return () => {
      if (announceTaskFailure === announce) announceTaskFailure = null;
    };
  }, []);
  useEffect(() => {
    if (!live || account === null) return;
    void taskOutbox.resume(
      account,
      liveTaskDelivery((entry, signal) =>
        taskDelivery(latest.current.mutations, latest.current.qc)(entry, signal),
      ),
      {
        awaitRefetch: (entry) => entry.task?.mode === 'reply',
        onFailed: (entry, error, repeat) =>
          liveTaskSendFailed(latest.current.t)(entry, error, repeat),
      },
    );
  }, [live, account]);
}
