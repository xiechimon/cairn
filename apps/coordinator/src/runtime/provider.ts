import type { ProviderConfig } from '@cairn/shared';
import type { Api, Model, Provider, ProviderStreams } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { createProvider } from '@earendil-works/pi-ai/models';

const STREAMS: Record<string, () => ProviderStreams> = {
  'anthropic-messages': anthropicMessagesApi,
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
};

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 8_192;
const KEYLESS_PLACEHOLDER = 'cairn-keyless';

export function stepProvider(config: ProviderConfig): Provider | null {
  const api = config.api;
  const streams = api === undefined ? undefined : STREAMS[api];
  if (api === undefined || streams === undefined || config.baseUrl === undefined) return null;
  const baseUrl = config.baseUrl;
  const models: Model<Api>[] = (config.models ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    api,
    provider: config.providerId,
    baseUrl,
    input: m.input ?? ['text'],
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: m.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: m.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(config.compat === undefined ? {} : { compat: config.compat }),
  }));
  return createProvider({
    id: config.providerId,
    name: config.label ?? config.providerId,
    baseUrl,
    auth: {
      apiKey: {
        name: `${config.providerId} key from the claimed Coordinator step`,
        resolve: async ({ credential }) =>
          credential?.key
            ? { auth: { apiKey: credential.key }, source: 'cairn step token' }
            : { auth: { apiKey: KEYLESS_PLACEHOLDER }, source: 'no key on the provider' },
      },
    },
    models,
    api: { [api]: streams() },
  });
}
