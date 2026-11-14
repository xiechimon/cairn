import type { ProviderConfig } from '@cairn/shared';
import type { Api, Model, Provider, ProviderStreams } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { createProvider } from '@earendil-works/pi-ai/models';
import {
  type BuiltinProvider,
  getBuiltinModels,
  getBuiltinProviders,
} from '@earendil-works/pi-ai/providers/all';
import { CODEX_API, CODEX_BASE_URL, CODEX_PROVIDER_ID } from '../codex-login.js';

const STREAMS: Record<string, () => ProviderStreams> = {
  'anthropic-messages': anthropicMessagesApi,
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'openai-codex-responses': openAICodexResponsesApi,
};

export const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 8_192;
const KEYLESS_PLACEHOLDER = 'cairn-keyless';

function isBuiltinProvider(providerId: string): providerId is BuiltinProvider {
  const builtin: readonly string[] = getBuiltinProviders();
  return builtin.includes(providerId);
}

export function catalogContextWindow(providerId: string, modelId: string): number {
  if (!isBuiltinProvider(providerId)) return DEFAULT_CONTEXT_WINDOW;
  return (
    getBuiltinModels(providerId).find((model) => model.id === modelId)?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
}

export type KeyResolver = () => string | null | Promise<string | null>;

export function stepProvider(config: ProviderConfig, resolveKey?: KeyResolver): Provider | null {
  const subscription = config.providerId === CODEX_PROVIDER_ID && !config.baseUrl;
  const api = subscription ? CODEX_API : config.api;
  const streams = api === undefined ? undefined : STREAMS[api];
  const baseUrl = subscription ? CODEX_BASE_URL : config.baseUrl;
  if (api === undefined || streams === undefined || baseUrl === undefined) return null;
  const models: Model<Api>[] = (config.models ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    api,
    provider: config.providerId,
    baseUrl,
    input: m.input ?? ['text', 'image'],
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: subscription,
    contextWindow: m.contextWindow ?? catalogContextWindow(config.providerId, m.id),
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
        resolve: async ({ credential }) => {
          const key = resolveKey === undefined ? credential?.key : await resolveKey();
          const resolvedKey = key || KEYLESS_PLACEHOLDER;
          return {
            auth:
              config.authHeader && !subscription
                ? { headers: { Authorization: `Bearer ${resolvedKey}` } }
                : { apiKey: resolvedKey },
            source: key ? 'cairn step token' : 'no key on the provider',
          };
        },
      },
    },
    models,
    api: { [api]: streams() },
  });
}
