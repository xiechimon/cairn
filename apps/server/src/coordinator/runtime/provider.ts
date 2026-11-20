import {
  distinctThinkingLevels,
  type ProviderConfig,
  resolveModelInput,
  type ThinkingLevel,
} from '@cairn/shared';
import type { Api, Model, Provider, ProviderStreams } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import {
  clampThinkingLevel,
  createProvider,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai/models';
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

export function isBuiltinProvider(providerId: string): providerId is BuiltinProvider {
  const builtin: readonly string[] = getBuiltinProviders();
  return builtin.includes(providerId);
}

export function builtinModelIds(providerId: string): ReadonlySet<string> {
  if (!isBuiltinProvider(providerId)) return new Set();
  return new Set(getBuiltinModels(providerId).map((model) => model.id));
}

export function catalogContextWindow(providerId: string, modelId: string): number {
  if (!isBuiltinProvider(providerId)) return DEFAULT_CONTEXT_WINDOW;
  return (
    getBuiltinModels(providerId).find((model) => model.id === modelId)?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function catalogModel(
  providerId: string,
  modelId: string,
  subscription: boolean,
): Model<Api> | undefined {
  const catalogId = subscription ? CODEX_PROVIDER_ID : providerId;
  return isBuiltinProvider(catalogId)
    ? getBuiltinModels(catalogId).find((model) => model.id === modelId)
    : undefined;
}

function isCodexSubscription(config: Pick<ProviderConfig, 'providerId' | 'baseUrl'>): boolean {
  return (
    config.providerId === CODEX_PROVIDER_ID &&
    (!config.baseUrl || config.baseUrl === CODEX_BASE_URL)
  );
}

function catalogThinkingLevels(entry: Model<Api> | undefined): ThinkingLevel[] {
  if (entry?.reasoning !== true) return [];
  return distinctThinkingLevels(getSupportedThinkingLevels(entry), entry.thinkingLevelMap ?? {});
}

const RUNNER_DEFAULT_THINKING: ThinkingLevel = 'medium';

export interface ThinkingChoice {
  levels: ThinkingLevel[];
  resolvesTo?: ThinkingLevel;
}

export function piThinking(providerId: string, modelId: string): ThinkingChoice {
  const entry = catalogModel(providerId, modelId, false);
  const levels = catalogThinkingLevels(entry);
  if (entry === undefined || levels.length === 0) return { levels };
  return { levels, resolvesTo: clampThinkingLevel(entry, RUNNER_DEFAULT_THINKING) };
}

export function inServerThinking(
  config: Pick<ProviderConfig, 'providerId' | 'baseUrl'>,
  modelId: string,
): ThinkingChoice {
  if (!isCodexSubscription(config)) return { levels: [] };
  const entry = catalogModel(config.providerId, modelId, true);
  const levels = catalogThinkingLevels(entry).filter((level) => level !== 'off');
  return entry?.thinkingLevelMap?.off === null ? { levels } : { levels, resolvesTo: 'off' };
}

export type KeyResolver = () => string | null | Promise<string | null>;

export function stepProvider(config: ProviderConfig, resolveKey?: KeyResolver): Provider | null {
  const subscription = isCodexSubscription(config);
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
    input: resolveModelInput(m),
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: subscription,
    thinkingLevelMap: subscription
      ? catalogModel(config.providerId, m.id, true)?.thinkingLevelMap
      : undefined,
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
