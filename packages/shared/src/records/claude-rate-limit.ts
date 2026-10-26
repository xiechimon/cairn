import { z } from 'zod';
import { recordId } from './common.js';

export const CLAUDE_RATE_LIMIT_STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const;
export type ClaudeRateLimitStatus = (typeof CLAUDE_RATE_LIMIT_STATUSES)[number];

export const CLAUDE_RATE_LIMIT_UNSPECIFIED = 'unspecified';
export const CLAUDE_SUBSCRIPTION_PROVIDER_ID = 'claude-code';
export const CLAUDE_RATE_LIMIT_UNKNOWN_PROBE_MS = 7 * 24 * 60 * 60 * 1000;

const RESETS_AT_SECONDS_FLOOR = 1_000_000_000;
const RESETS_AT_MS_THRESHOLD = 1e11;

export interface ClaudeRateLimitWindow {
  subscription: string;
  status: ClaudeRateLimitStatus;
  utilization: number | null;
  resetsAt: number | null;
  reportedAt: number;
}

export interface ClaudeRateLimitNotice {
  status: ClaudeRateLimitStatus;
  rateLimitType?: string;
  utilization?: number;
  resetsAt?: number;
}

export interface ClaudeRateBlock {
  until: number | null;
  subscription: string;
}

export const claudeRateLimitReportSchema = z.object({
  machineId: recordId,
  status: z.enum(CLAUDE_RATE_LIMIT_STATUSES),
  rateLimitType: z.string().min(1).max(64).optional(),
  utilization: z.number().finite().optional(),
  resetsAt: z.number().finite().positive().optional(),
});
export type ClaudeRateLimitReport = z.infer<typeof claudeRateLimitReportSchema>;

export function normalizeClaudeResetsAt(raw: number | undefined): number | null {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return null;
  if (raw >= RESETS_AT_SECONDS_FLOOR && raw < RESETS_AT_MS_THRESHOLD) return Math.round(raw * 1000);
  return Math.round(raw);
}

export function subscriptionKeyOf(rateLimitType: string | undefined): string {
  const trimmed = rateLimitType?.trim() ?? '';
  return trimmed === '' ? CLAUDE_RATE_LIMIT_UNSPECIFIED : trimmed;
}

export function applyClaudeRateLimit(
  windows: readonly ClaudeRateLimitWindow[],
  notice: ClaudeRateLimitNotice,
  reportedAt: number,
): ClaudeRateLimitWindow[] {
  const next: ClaudeRateLimitWindow = {
    subscription: subscriptionKeyOf(notice.rateLimitType),
    status: notice.status,
    utilization:
      typeof notice.utilization === 'number' && Number.isFinite(notice.utilization)
        ? notice.utilization
        : null,
    resetsAt: normalizeClaudeResetsAt(notice.resetsAt),
    reportedAt,
  };
  const index = windows.findIndex((window) => window.subscription === next.subscription);
  if (index < 0) return [...windows, next];
  const copy = windows.slice();
  copy[index] = next;
  return copy;
}

export function claudeRateBlock(
  windows: readonly ClaudeRateLimitWindow[],
  now: number,
): ClaudeRateBlock | null {
  const active = windows.filter(
    (window) => window.status === 'rejected' && (window.resetsAt === null || window.resetsAt > now),
  );
  if (active.length === 0) return null;
  const unknown = active.find((window) => window.resetsAt === null);
  if (unknown) return { until: null, subscription: unknown.subscription };
  let best = active[0];
  if (best === undefined) return null;
  for (const window of active) {
    if ((window.resetsAt ?? 0) > (best.resetsAt ?? 0)) best = window;
  }
  return { until: best.resetsAt, subscription: best.subscription };
}

export function claudeRateProbeAt(block: ClaudeRateBlock, now: number): number {
  return block.until === null ? now + CLAUDE_RATE_LIMIT_UNKNOWN_PROBE_MS : block.until;
}
