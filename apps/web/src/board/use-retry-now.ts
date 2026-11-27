import { useEffect, useRef, useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { toastError } from '../components/ui/toaster.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { randomId } from '../lib/random-id.js';

function retryTargetKey(todo: TodoRecord): string | null {
  if (todo.latestBuildId == null) return null;
  if (todo.quotaWait != null || todo.waitingOn?.on === 'quota') {
    return `${todo.latestBuildId}:quota:${todo.quotaWait?.probeAt ?? ''}`;
  }
  if (todo.phase === 'failed') {
    return `${todo.latestBuildId}:failed:${todo.phaseAt}`;
  }
  return null;
}

export function useRetryBuildNow(teamId: string | undefined, todo: TodoRecord) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const targetKey = retryTargetKey(todo);
  const pendingTargetRef = useRef<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const clientIdRef = useRef<{ target: string; id: string } | null>(null);

  useEffect(() => {
    if (targetKey !== pendingTargetRef.current) {
      pendingTargetRef.current = null;
      setPendingTarget(null);
    }
    if (targetKey !== clientIdRef.current?.target) {
      clientIdRef.current = null;
    }
  }, [targetKey]);

  const retryNow = (buildId: string) => {
    const key = targetKey ?? buildId;
    if (pendingTargetRef.current === key || mutations.retryBuildNow.isPending) return;
    const clientMessageId =
      clientIdRef.current?.target === key ? clientIdRef.current.id : randomId();
    clientIdRef.current = { target: key, id: clientMessageId };
    pendingTargetRef.current = key;
    setPendingTarget(key);
    mutations.retryBuildNow.mutate(
      { buildId, clientMessageId },
      {
        onError: (error) => {
          pendingTargetRef.current = null;
          setPendingTarget(null);
          toastError(t('立即重试失败，请重试。'), error);
        },
      },
    );
  };

  return {
    retryNow,
    pending:
      mutations.retryBuildNow.isPending || (targetKey !== null && pendingTarget === targetKey),
  };
}
