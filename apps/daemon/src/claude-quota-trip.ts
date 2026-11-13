import type { ClaudeRateLimitNotice, ClaudeRateLimitReport } from '@cairn/shared';
import { normalizeClaudeResetsAt, subscriptionKeyOf } from '@cairn/shared';

export interface QuotaTrip {
  kind: 'quota' | 'capacity';
  reason: string;
  retryAfterMs: number | null;
}

export function claudeRateLimitReport(
  machineId: string,
  notice: ClaudeRateLimitNotice,
): ClaudeRateLimitReport {
  return {
    machineId,
    status: notice.status,
    ...(notice.rateLimitType !== undefined ? { rateLimitType: notice.rateLimitType } : {}),
    ...(notice.utilization !== undefined ? { utilization: notice.utilization } : {}),
    ...(notice.resetsAt !== undefined ? { resetsAt: notice.resetsAt } : {}),
  };
}

export interface ClaudeRateLimitSink {
  reportClaudeRateLimit?(body: ClaudeRateLimitReport): Promise<void>;
}

export function forwardClaudeRateLimit(
  sink: ClaudeRateLimitSink,
  machineId: string | null,
  notice: ClaudeRateLimitNotice,
  log: (line: string) => void,
): void {
  if (machineId === null) return;
  void sink
    .reportClaudeRateLimit?.(claudeRateLimitReport(machineId, notice))
    .catch((err: unknown) => {
      log(`claude rate limit report failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function claudeQuotaTrip(notice: ClaudeRateLimitNotice, nowMs: number): QuotaTrip | null {
  if (notice.status !== 'rejected') return null;
  const until = normalizeClaudeResetsAt(notice.resetsAt);
  return {
    kind: 'quota',
    reason: `Claude subscription ${subscriptionKeyOf(notice.rateLimitType)} rejected`,
    retryAfterMs: until !== null && until > nowMs ? Math.max(1, until - nowMs) : null,
  };
}
