import {
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_DEVIN_MODELS,
  isInternalAntigravityModelId,
  ROUTING_USES,
  type RoutingConnection,
  type RoutingQuota,
  resolveRouting,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claudeSubscription, devinSubscription, provider } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { listAntigravitySubscriptions } from './antigravity-subscriptions.js';
import { DEFAULT_DOUBAO_FALLBACK_MODELS, listDoubaoSubscriptions } from './doubao-subscriptions.js';

const CLAUDE_ROUTING_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

export function isClaudeModel(providerId: string | null, modelId: string | null): boolean {
  return (
    providerId === 'anthropic' || providerId === 'claude-code' || /claude/i.test(modelId ?? '')
  );
}

export function getModelRouting(db: Db, teamId: string) {
  const now = nowMs();
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
      models: CLAUDE_ROUTING_MODELS,
      available: row.expiresAt === null || row.expiresAt > now,
    });
  }
  for (const row of listAntigravitySubscriptions({ db }, teamId)) {
    const listedModels = row.models ?? [];
    const runnerModels = row.runnerModels ?? [];
    const rawModels =
      listedModels.length > 0
        ? listedModels
        : runnerModels.length > 0
          ? runnerModels
          : DEFAULT_ANTIGRAVITY_MODELS;
    const models = rawModels
      .map((model) => model.id)
      .filter((id) => id !== '' && !isInternalAntigravityModelId(id));
    if (models.length === 0) continue;
    const available = row.hasToken
      ? row.expiresAt === null || row.expiresAt > now
      : row.runnerLogin === 'ok';
    connections.push({
      id: row.id,
      vendor: 'antigravity',
      kind: 'subscription',
      models,
      available,
    });
  }
  for (const row of db
    .select()
    .from(devinSubscription)
    .where(eq(devinSubscription.teamId, teamId))
    .all()) {
    const models = (row.models.length > 0 ? row.models : DEFAULT_DEVIN_MODELS)
      .map((model) => model.id)
      .filter((id) => id !== '');
    if (models.length === 0) continue;
    connections.push({
      id: row.id,
      vendor: 'devin',
      kind: 'subscription',
      models,
      available: row.expiresAt === null || row.expiresAt > now,
    });
  }
  for (const row of listDoubaoSubscriptions({ db }, teamId).subscriptions) {
    const listedModels = row.models ?? [];
    const runnerModels = row.runnerModels ?? [];
    const resolved =
      listedModels.length > 0
        ? listedModels
        : runnerModels.length > 0
          ? runnerModels
          : [...DEFAULT_DOUBAO_FALLBACK_MODELS];
    const models = resolved.map((model) => model.id).filter((id) => id !== '');
    if (models.length === 0) continue;
    connections.push({
      id: row.id,
      vendor: 'doubao',
      kind: 'subscription',
      models,
      available: row.runnerLogin === 'ok',
    });
  }
  for (const row of db.select().from(provider).where(eq(provider.teamId, teamId)).all()) {
    for (const vendor of ['anthropic', 'openai'] as const) {
      const models = row.models
        .filter((model) =>
          vendor === 'anthropic'
            ? isClaudeModel(row.providerId, model.id)
            : !isClaudeModel(row.providerId, model.id),
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
  return {
    ...resolveRouting(
      ROUTING_USES.map((use) => ({ use })),
      connections,
      quota,
    ),
    connections,
    quota,
  };
}
