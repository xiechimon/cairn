import type { ProviderConfig } from '@cairn/shared';
import { InMemoryCredentialStore, type Provider } from '@earendil-works/pi-ai';
import { createModels, type MutableModels } from '@earendil-works/pi-ai/models';
import { type KeyResolver, stepProvider } from './provider.js';

export interface CoordinatorModels {
  models: MutableModels;
  setApiKey(providerId: string, key: string): Promise<void>;
  useStepProvider(config: ProviderConfig): void;
  useProvider(config: ProviderConfig, resolveKey: KeyResolver): void;
}

export function createCoordinatorModels(providers: readonly Provider[] = []): CoordinatorModels {
  const fixed = new Set(providers.map((p) => p.id));
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials });
  for (const provider of providers) models.setProvider(provider);
  return {
    models,
    setApiKey: async (providerId, key) => {
      await credentials.modify(providerId, async () => ({ type: 'api_key', key }));
    },
    useStepProvider: (config) => {
      const provider = stepProvider(config);
      if (provider !== null) models.setProvider(provider);
    },
    useProvider: (config, resolveKey) => {
      if (fixed.has(config.providerId)) return;
      const provider = stepProvider(config, resolveKey);
      if (provider !== null) models.setProvider(provider);
    },
  };
}
