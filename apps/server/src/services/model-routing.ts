import {
  ROUTING_USES,
  type RoutingConnection,
  type RoutingQuota,
  resolveRouting,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claudeSubscription, machine, provider, team } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export function isClaudeModel(providerId: string | null, modelId: string | null): boolean {
  return (
    providerId === 'anthropic' || providerId === 'claude-code' || /claude/i.test(modelId ?? '')
  );
}

export function getModelRouting(db: Db, teamId: string) {
  const now = nowMs();
  const settings = db.select().from(team).where(eq(team.id, teamId)).get();
  const connections: RoutingConnection[] = [];
  const quota: RoutingQuota[] = [];
  for (const row of db
    .select()
    .from(claudeSubscription)
    .where(eq(claudeSubscription.teamId, teamId))
    .all()) {
    connections.push({
      id: row.id,
      vendor: 'anthropic',
      kind: 'subscription',
      models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
      available: row.expiresAt === null || row.expiresAt > now,
    });
  }
  for (const row of db.select().from(provider).where(eq(provider.teamId, teamId)).all()) {
    for (const vendor of ['anthropic', 'openai'] as const) {
      const models = row.models
        .filter((model) =>
          vendor === 'anthropic'
            ? isClaudeModel(row.providerId, model.id) || row.api === 'anthropic-messages'
            : !isClaudeModel(row.providerId, model.id) && row.api !== 'anthropic-messages',
        )
        .map((model) => model.id);
      if (models.length === 0) continue;
      connections.push({
        id: row.id,
        vendor,
        kind: row.providerId === 'openai-codex' ? 'subscription' : 'api-key',
        models,
        available: !row.authHeader || row.apiKeyCipher !== null,
      });
    }
  }
  for (const row of db.select().from(machine).where(eq(machine.teamId, teamId)).all()) {
    const report = row.claudeCodeReport;
    if (!report?.installed && (row.claudeRateLimits?.length ?? 0) === 0) continue;
    const id = `machine:${row.id}`;
    const paid = /api[-_ ]?key/i.test(report?.auth?.method ?? '');
    connections.push({
      id,
      vendor: 'anthropic',
      kind: paid ? 'api-key' : 'subscription',
      models: (report?.models ?? [])
        .filter((model) => model.liveness !== 'dead')
        .map((model) => model.id),
      available:
        report?.installed === true &&
        row.online &&
        row.enabledRuntimes.includes('claude-code') &&
        report?.auth?.state !== 'not-logged-in' &&
        report?.login?.state !== 'expired',
    });
    const windows: RoutingQuota['windows'][number][] = [];
    for (const window of row.claudeRateLimits ?? []) {
      const period =
        window.subscription === 'five_hour' || window.subscription === '5h'
          ? '5h'
          : window.subscription === 'seven_day' || window.subscription === 'week'
            ? 'week'
            : null;
      if (period === null) continue;
      windows.push({
        window: period,
        usedPercent: window.utilization === null ? null : window.utilization * 100,
        resetsAt: window.resetsAt,
        reportedAt: window.reportedAt,
      });
    }
    if (windows.length > 0) quota.push({ connectionId: id, windows });
  }
  const routingSettings = { claudeUsage: settings?.claudeUsage ?? ('subscription-only' as const) };
  return {
    ...resolveRouting(
      ROUTING_USES.map((use) => ({ use })),
      connections,
      quota,
      routingSettings,
    ),
    connections,
    quota,
    settings: routingSettings,
  };
}
