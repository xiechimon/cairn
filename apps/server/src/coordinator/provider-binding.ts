import { type SecretBox, thinkingLevelSchema } from '@cairn/shared';
import type { Db } from '../db/client.js';
import { unifiedRateLimitNotices } from '../services/claude-subscription-verification.js';
import {
  claudeSubscriptionIdForToken,
  recordClaudeQuotaNotices,
} from '../services/claude-subscriptions.js';
import { materializeCodexAccessToken } from '../services/codex-device-login.js';
import { CODEX_PROVIDER_ID } from './codex-login.js';
import { type CoordinatorModelRoute, coordinatorApiKey } from './credentials.js';
import type { ProviderBinding } from './runtime/server-runtime.js';

function quotaObserver(
  deps: { db: Db; box: SecretBox },
  teamId: string,
  route: CoordinatorModelRoute,
): ProviderBinding['observe'] {
  if (route.config.api !== 'anthropic-messages') return undefined;
  let subscriptionId: string | null | undefined;
  return (response: { status: number; headers: Record<string, string> }) => {
    try {
      if (subscriptionId === undefined) {
        const key = coordinatorApiKey(deps, teamId, route.provider);
        subscriptionId = key === null ? null : claudeSubscriptionIdForToken(deps, teamId, key);
      }
      if (subscriptionId === null) return;
      const notices = unifiedRateLimitNotices(new Headers(response.headers));
      recordClaudeQuotaNotices(deps, teamId, subscriptionId, notices);
    } catch {
      return;
    }
  };
}

export function providerBinding(
  deps: { db: Db; box: SecretBox },
  teamId: string,
  route: CoordinatorModelRoute,
): ProviderBinding {
  const observe = quotaObserver(deps, teamId, route);
  const thinkingLevel = thinkingLevelSchema.safeParse(route.thinkingLevel);
  return {
    config: route.config,
    modelId: route.modelId,
    ...(thinkingLevel.success ? { thinkingLevel: thinkingLevel.data } : {}),
    ...(observe === undefined ? {} : { observe }),
    resolveKey: async () => {
      const key = coordinatorApiKey(deps, teamId, route.provider);
      if (key === null || route.provider !== CODEX_PROVIDER_ID || !key.startsWith('{')) return key;
      return materializeCodexAccessToken(
        { db: deps.db, box: deps.box, fetch: globalThis.fetch, states: new Map() },
        teamId,
      );
    },
  };
}
