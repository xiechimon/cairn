import type { ProviderConfig } from '@cairn/shared';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { stepProvider } from './provider.js';

export async function probeProvider(input: {
  config: ProviderConfig;
  apiKey: string | null;
  model: string;
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
}): Promise<string | null> {
  const configured = input.config.models?.find((model) => model.id === input.model);
  const provider = stepProvider(
    { ...input.config, models: [configured ?? { id: input.model, name: input.model }] },
    () => input.apiKey,
  );
  if (provider === null) return 'The provider protocol or base URL is unavailable.';
  const models = createModels({ credentials: new InMemoryCredentialStore() });
  models.setProvider(provider);
  const model = models.getModel(input.config.providerId, input.model);
  if (model === undefined) return 'The configured model is unavailable.';
  const signal = AbortSignal.timeout(input.timeoutMs);
  const reply = await models.complete(
    model,
    { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
    { fetch: input.fetch, signal, timeoutMs: input.timeoutMs, maxRetries: 0, maxTokens: 8 },
  );
  if (signal.aborted) return 'The provider did not answer in time. Try again.';
  if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {
    return 'The provider request failed. Check the key, model and connection settings.';
  }
  if (reply.content.length === 0 && reply.usage.output === 0) {
    return 'The provider returned an invalid response. Check the connection settings.';
  }
  return null;
}
