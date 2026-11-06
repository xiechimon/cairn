import { type ProviderConfig, redactSecrets, type SecretBox } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routingRule } from '../db/schema.js';
import { coordinatorRoute } from '../services/coordinator-route.js';
import { openProviderKey } from '../services/providers.js';

export interface CoordinatorModelRoute {
  provider: string;
  modelId: string;
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

function routeOf(
  deps: CredentialDeps,
  teamId: string,
  provider: string,
  modelId: string,
): CoordinatorModelRoute | null {
  const opened = openProviderKey(deps, teamId, provider);
  if (opened === null) return null;
  return {
    provider,
    modelId,
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
): CoordinatorProviders | null {
  const rule = coordinatorRoute(deps.db, teamId);
  if (rule === null) return null;
  const router = routeOf(deps, teamId, rule.provider, rule.modelId);
  if (router === null) return null;
  const compaction = deps.db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'compaction')))
    .get();
  const summary =
    compaction === undefined
      ? router
      : (routeOf(deps, teamId, compaction.provider, compaction.modelId) ?? router);
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
