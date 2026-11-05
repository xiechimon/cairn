export function stepActivityAt(row: {
  lastHeartbeatAt: number | null;
  claimedAt: number | null;
  createdAt: number;
}): number {
  return row.lastHeartbeatAt ?? row.claimedAt ?? row.createdAt;
}

export const QUOTA_HOLD_BACKOFF_MS: readonly [number, number, number] = [60_000, 300_000, 900_000];

export function quotaHoldBackoffMs(holdCount: number): number {
  const [firstHold, secondHold, thirdHold] = QUOTA_HOLD_BACKOFF_MS;
  const step = Math.min(Math.max(holdCount, 1), QUOTA_HOLD_BACKOFF_MS.length);
  if (step <= 1) return firstHold;
  if (step < 3) return secondHold;
  return thirdHold;
}

export function quotaHoldNote(message: string, retryAt: number): string {
  const when = new Date(retryAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `等额度：模型额度用尽，已挂起等待恢复（${message}）。下次尝试 ${when}，额度恢复后将自动继续，无需人工重跑。`;
}
