import { type ProviderConfig, redactSecrets, type SecretBox } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routingRule } from '../db/schema.js';
import { coordinatorRoute, paidClaudeAllowed } from '../services/coordinator-route.js';
import { openProviderKey } from '../services/providers.js';
import { CODEX_PROVIDER_ID, readCodexLogin } from './codex-login.js';

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

function routeOf(
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
): CoordinatorProviders | null {
  const rule = coordinatorRoute(deps.db, teamId);
  if (rule === null) return null;
  const router = routeOf(deps, teamId, rule.provider, rule.modelId, rule.thinkingLevel ?? null);
  if (router === null) return null;
  const compaction = deps.db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'compaction')))
    .get();
  const compactionRoute =
    compaction !== undefined &&
    paidClaudeAllowed(deps.db, teamId, compaction.provider, compaction.modelId)
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
  const opened = openProviderKey(deps, teamId, providerId);
  if (opened === null) return null;
  if (opened.apiKey === null && providerId === CODEX_PROVIDER_ID) return readCodexLogin();
  return opened.apiKey;
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
