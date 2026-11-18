import { and, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { step } from '../db/schema.js';

const USED_STATUSES = ['claimed', 'done', 'failed', 'stopped'] as const;

export interface SubscriptionUsage {
  lastUsedAt: number;
  stepsLast24h: number;
}

export function subscriptionUsageStats(
  db: Pick<Db, 'select'>,
  column:
    | typeof step.claudeSubscriptionId
    | typeof step.devinSubscriptionId
    | typeof step.antigravitySubscriptionId,
  ids: readonly string[],
  since: number,
): Map<string, SubscriptionUsage> {
  const stats = new Map<string, SubscriptionUsage>();
  if (ids.length === 0) return stats;
  const rows = db
    .select({
      subscriptionId: column,
      lastUsedAt: sql<number>`max(${step.claimedAt})`,
      stepsLast24h: sql<number>`sum(case when ${step.claimedAt} >= ${since} then 1 else 0 end)`,
    })
    .from(step)
    .where(
      and(
        inArray(column, [...ids]),
        isNotNull(step.claimedAt),
        inArray(step.status, [...USED_STATUSES]),
      ),
    )
    .groupBy(column)
    .all();
  for (const row of rows) {
    if (typeof row.subscriptionId !== 'string') continue;
    stats.set(row.subscriptionId, {
      lastUsedAt: row.lastUsedAt,
      stepsLast24h: row.stepsLast24h,
    });
  }
  return stats;
}
