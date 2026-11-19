import { type ProviderConfig, redactSecrets, type SecretBox } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routingRule } from '../db/schema.js';
import { coordinatorRoute } from '../services/coordinator-route.js';
import { openProviderKey } from '../services/providers.js';
import { resolveRuleProvider } from '../services/routing-rules.js';

export interface CoordinatorModelRoute {
  provider: string;
  modelId: string;
  thinkingLevel: string | null;
  config: ProviderConfig;
}

export interface CoordinatorProviders {
  router: CoordinatorModelRoute;
  summary: CoordinatorModelRoute;
}

interface CredentialDeps {
  db: Db;
  box: SecretBox;
}

export function routeOf(
  deps: CredentialDeps,
  teamId: string,
  provider: string,
  modelId: string,
  thinkingLevel: string | null,
): CoordinatorModelRoute | null {
  const opened = openProviderKey(deps, teamId, provider);
  if (opened === null) return null;
  return {
    provider,
    modelId,
    thinkingLevel,
    config: {
      kind: 'http',
      providerId: opened.row.providerId,
      label: opened.row.label,
      baseUrl: opened.row.baseUrl,
      api: opened.row.api,
      authHeader: opened.row.authHeader,
      compat: opened.row.compat,
      models: opened.row.models,
    },
  };
}

export function coordinatorProviders(
  deps: CredentialDeps,
  teamId: string,
  projectId: string | null = null,
  stepModel: { provider: string; modelId: string; thinkingLevel?: string | null } | null = null,
): CoordinatorProviders | null {
  const rule = coordinatorRoute(deps.db, teamId, projectId);
  const router =
    stepModel !== null
      ? routeOf(
          deps,
          teamId,
          stepModel.provider,
          stepModel.modelId,
          stepModel.thinkingLevel ?? null,
        )
      : rule === null
        ? null
        : routeOf(deps, teamId, rule.provider, rule.modelId, rule.thinkingLevel ?? null);
  if (router === null) return null;
  const storedCompaction = deps.db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'compaction')))
    .get();
  const compaction =
    storedCompaction === undefined
      ? undefined
      : resolveRuleProvider(deps.db, storedCompaction, true);
  const compactionRoute =
    compaction !== undefined
      ? routeOf(
          deps,
          teamId,
          compaction.provider,
          compaction.modelId,
          compaction.thinkingLevel ?? null,
        )
      : null;
  const summary = compactionRoute ?? router;
  return { router, summary };
}

export function coordinatorApiKey(
  deps: CredentialDeps,
  teamId: string,
  providerId: string,
): string | null {
  return openProviderKey(deps, teamId, providerId)?.apiKey ?? null;
}

export function scrubProviderError(
  deps: CredentialDeps,
  teamId: string,
  providerIds: readonly string[],
  message: string,
): string {
  let text = message;
  for (const providerId of providerIds) {
    const key = coordinatorApiKey(deps, teamId, providerId);
    if (key !== null && key !== '') text = text.split(key).join('[redacted]');
  }
  return String(redactSecrets(text).value);
}
