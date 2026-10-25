import type { ChiefThread } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { inflightOrchestrationFor } from './orchestration-inflight.js';

export interface OrchestrateStart {
  orchestrate: (todo: { id: string; seqNum: number }, opts?: { savedTitle?: string }) => void;
  pendingId: string | null;
}

export function useOrchestrateStart(): OrchestrateStart {
  const { live, teamId } = useLiveData();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutations = useApiMutations(teamId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const inFlight = useRef(false);

  const orchestrate = useCallback(
    (todo: { id: string; seqNum: number }, opts?: { savedTitle?: string }) => {
      if (!live || inFlight.current) return;
      const existing = inflightOrchestrationFor(
        queryClient.getQueryData<ChiefThread[]>(['chiefThreads', teamId]),
        todo.seqNum,
      );
      if (existing !== null) {
        toast.warning(t('总管正在编排这张任务，等这一轮结束再发起。'), {
          description: t('重复发起只会多排一轮编排，不会更快开始。'),
          action: {
            label: t('查看会话'),
            onClick: () => navigate(`/app?chief=${encodeURIComponent(existing.id)}`),
          },
        });
        return;
      }
      inFlight.current = true;
      setPendingId(todo.id);
      mutations.orchestrateTodo.mutate(todo.id, {
        onSuccess: (res) => {
          queryClient.setQueryData<ChiefThread[]>(['chiefThreads', teamId], (old) =>
            old === undefined
              ? [res.thread]
              : [res.thread, ...old.filter((x) => x.id !== res.thread.id)],
          );
          const threadId = res.thread.id;
          toast.success(opts?.savedTitle ?? t('已交给总管编排'), {
            description: t('总管将直接规划，并按活的类型派发执行。'),
            action: {
              label: t('查看会话'),
              onClick: () => navigate(`/app?chief=${encodeURIComponent(threadId)}`),
            },
          });
        },
        onError: (error) => toastError(t('未能开始编排'), error),
        onSettled: () => {
          inFlight.current = false;
          setPendingId(null);
        },
      });
    },
    [live, teamId, mutations.orchestrateTodo, queryClient, navigate, t],
  );

  return { orchestrate, pendingId };
}
