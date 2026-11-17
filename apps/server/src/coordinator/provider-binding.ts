import type { SecretBox } from '@cairn/shared';
import type { Db } from '../db/client.js';
import { materializeCodexAccessToken } from '../services/codex-device-login.js';
import { CODEX_PROVIDER_ID } from './codex-login.js';
import { type CoordinatorModelRoute, coordinatorApiKey } from './credentials.js';
import type { ProviderBinding } from './runtime/server-runtime.js';

export function providerBinding(
  deps: { db: Db; box: SecretBox },
  teamId: string,
  route: CoordinatorModelRoute,
): ProviderBinding {
  return {
    config: route.config,
    modelId: route.modelId,
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
