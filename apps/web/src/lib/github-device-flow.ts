import { useEffect, useRef } from 'react';
import type { TFunc } from '../i18n/translate.js';

export type GithubDeviceEndReason = 'expired' | 'denied' | 'failed' | 'conflict' | 'start';

export function openGithubWindow(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function githubDeviceEndedCopy(
  t: TFunc,
  reason: GithubDeviceEndReason,
): { title: string; body: string } {
  if (reason === 'expired') {
    return { title: t('代码已过期'), body: t('重新开始拿一个新代码。') };
  }
  if (reason === 'denied') {
    return {
      title: t('已取消授权'),
      body: t('你在 GitHub 上取消了授权，这次什么都没有保存。'),
    };
  }
  if (reason === 'start') {
    return {
      title: t('未能开始连接 GitHub'),
      body: t('暂时无法连接 GitHub，请稍后重试。'),
    };
  }
  if (reason === 'conflict') {
    return {
      title: t('连接失败'),
      body: t('授权期间这个连接有了变动，这次授权没有保存，重新开始一次。'),
    };
  }
  return {
    title: t('连接失败'),
    body: t('GitHub 没有完成授权，稍后重新开始一次。'),
  };
}

export function useGithubDevicePoll<Result>({
  enabled,
  attemptId,
  intervalSeconds,
  pollKey,
  poll,
  onResult,
  onError,
}: {
  enabled: boolean;
  attemptId: string | null;
  intervalSeconds: number;
  pollKey: unknown;
  poll: (attemptId: string) => Promise<Result>;
  onResult: (result: Result) => void;
  onError: (error: unknown) => void;
}): void {
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled || attemptId === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      poll(attemptId)
        .then((result) => {
          if (!cancelled) onResultRef.current(result);
        })
        .catch((error: unknown) => {
          if (!cancelled) onErrorRef.current(error);
        });
    }, intervalSeconds * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, attemptId, intervalSeconds, pollKey, poll]);
}
