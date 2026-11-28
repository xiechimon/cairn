import { type ProviderConfig, redactSecrets, type SecretBox } from '@cairn/shared';
import { isLoopbackHost } from '@cairn/shared/loopback';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routingRule } from '../db/schema.js';
import { coordinatorRoute } from '../services/coordinator-route.js';
import { stepRuntimeFor } from '../services/dispatch-eligibility.js';
import { openProviderKey } from '../services/providers.js';
import {
  defaultCoordinatorChoice,
  keylessEndpoint,
  resolveRuleProvider,
} from '../services/routing-rules.js';

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
  return routeFromOpened(opened, provider, modelId, thinkingLevel);
}

function routeFromOpened(
  opened: NonNullable<ReturnType<typeof openProviderKey>>,
  provider: string,
  modelId: string,
  thinkingLevel: string | null,
): CoordinatorModelRoute {
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

function explicitCompactionRule(db: Db, teamId: string) {
  const stored = db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'compaction')))
    .get();
  return stored === undefined ? null : resolveRuleProvider(db, stored, true);
}

export function idleSummaryRoute(
  deps: CredentialDeps,
  teamId: string,
  projectId: string | null,
): CoordinatorModelRoute | null {
  const openedByProvider = new Map<string, ReturnType<typeof openProviderKey>>();
  const usable = (
    provider: string,
    modelId: string,
    thinkingLevel: string | null,
    automatic = false,
  ): CoordinatorModelRoute | null => {
    if (stepRuntimeFor(provider) !== 'pi' || modelId === '') return null;
    if (!openedByProvider.has(provider)) {
      try {
        openedByProvider.set(provider, openProviderKey(deps, teamId, provider));
      } catch {
        openedByProvider.set(provider, null);
      }
    }
    const opened = openedByProvider.get(provider);
    if (!opened?.row.models.some((model) => model.id === modelId)) return null;
    if (!opened.apiKey) {
      if (!keylessEndpoint(provider)) return null;
      if (automatic) {
        try {
          if (!isLoopbackHost(new URL(opened.row.baseUrl).hostname)) return null;
        } catch {
          return null;
        }
      }
    }
    return routeFromOpened(opened, provider, modelId, thinkingLevel);
  };
  const rule = explicitCompactionRule(deps.db, teamId);
  if (rule !== null) {
    const explicit = usable(rule.provider, rule.modelId, rule.thinkingLevel ?? null);
    if (explicit !== null) return explicit;
  }
  const chat = coordinatorRoute(deps.db, teamId, projectId);
  const current = chat === null ? null : usable(chat.provider, chat.modelId, null);
  if (current !== null) return current;
  const fallback = defaultCoordinatorChoice(
    deps.db,
    teamId,
    (provider, modelId) => usable(provider, modelId, null, true) !== null,
  );
  return fallback !== null &&
    (fallback.reason === 'anthropic-key' || fallback.reason === 'provider')
    ? usable(fallback.provider, fallback.modelId, null, true)
    : null;
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
  const compaction = explicitCompactionRule(deps.db, teamId);
  const compactionRoute =
    compaction === null
      ? null
      : routeOf(
          deps,
          teamId,
          compaction.provider,
          compaction.modelId,
          compaction.thinkingLevel ?? null,
        );
  const summary = compactionRoute ?? { ...router, thinkingLevel: null };
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
