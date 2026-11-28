import {
  AGGREGATOR_PRESET_IDS,
  distinctThinkingLevels,
  type ModelCostRates,
  type ProviderConfig,
  piCatalogFallbackOrder,
  piCatalogProviderId,
  resolveModelInput,
  strippedCatalogModelId,
  type ThinkingLevel,
} from '@cairn/shared';
import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  Provider,
  ProviderStreams,
} from '@earendil-works/pi-ai';
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
  const catalogId = piCatalogProviderId(providerId);
  if (!isBuiltinProvider(catalogId)) return new Set();
  return new Set(getBuiltinModels(catalogId).map((model) => model.id));
}

export function catalogContextWindow(providerId: string, modelId: string): number {
  const catalogId = piCatalogProviderId(providerId);
  if (!isBuiltinProvider(catalogId)) return DEFAULT_CONTEXT_WINDOW;
  return (
    getBuiltinModels(catalogId).find((model) => model.id === modelId)?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function findBuiltinModel(
  providers: readonly string[],
  api: string | undefined,
  predicate: (model: Model<Api>) => boolean,
): Model<Api> | undefined {
  for (const id of providers) {
    if (!isBuiltinProvider(id)) continue;
    const hit = getBuiltinModels(id).find(
      (model) => (api === undefined || model.api === api) && predicate(model),
    );
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function catalogModel(
  providerId: string,
  modelId: string,
  subscription: boolean,
  api?: string,
): Model<Api> | undefined {
  const catalogId = subscription ? CODEX_PROVIDER_ID : piCatalogProviderId(providerId);
  if (isBuiltinProvider(catalogId)) {
    return getBuiltinModels(catalogId).find(
      (model) => model.id === modelId && (api === undefined || model.api === api),
    );
  }
  const providers = piCatalogFallbackOrder(getBuiltinProviders(), api);
  const exact = findBuiltinModel(providers, api, (model) => model.id === modelId);
  if (exact !== undefined) return exact;
  const bare = strippedCatalogModelId(modelId);
  if (bare === undefined) return undefined;
  return findBuiltinModel(
    providers,
    api,
    (model) => model.id === bare || strippedCatalogModelId(model.id) === bare,
  );
}

const CANONICAL_COST_PROVIDERS: readonly string[] = [
  'anthropic',
  'openai',
  'openai-codex',
  'google',
  'deepseek',
  'xai',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'kimi-coding',
  'zai',
  'zai-coding-cn',
  'xiaomi',
  'ant-ling',
];

function orderedCostProviders(): BuiltinProvider[] {
  const all = getBuiltinProviders();
  const seen = new Set<string>();
  const out: BuiltinProvider[] = [];
  const push = (id: string) => {
    if (!seen.has(id) && isBuiltinProvider(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const id of CANONICAL_COST_PROVIDERS) push(id);
  for (const id of all) {
    if (!AGGREGATOR_PRESET_IDS.includes(id)) push(id);
  }
  for (const id of all) push(id);
  return out;
}

function toCostRates(entry: Model<Api> | undefined): ModelCostRates | undefined {
  if (entry?.cost === undefined) return undefined;
  return {
    input: entry.cost.input,
    output: entry.cost.output,
    cacheRead: entry.cost.cacheRead,
    cacheWrite: entry.cost.cacheWrite,
  };
}

export function catalogModelMetadata(
  providerId: string,
  modelId: string,
  api?: string,
):
  | { cost?: ModelCostRates; contextWindow?: number; maxTokens?: number; reasoning?: boolean }
  | undefined {
  const entry = catalogModel(providerId, modelId, false, api);
  const cost = toCostRates(entry) ?? catalogModelCost(providerId, modelId, api);
  if (entry === undefined && cost === undefined) return undefined;
  return {
    ...(cost !== undefined ? { cost } : {}),
    ...(entry?.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry?.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
    ...(entry?.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
  };
}

export function catalogModelCost(
  providerId: string,
  modelId: string,
  api?: string,
): ModelCostRates | undefined {
  const catalogId = piCatalogProviderId(providerId);
  if (isBuiltinProvider(catalogId)) {
    const models = getBuiltinModels(catalogId);
    const exact =
      (api !== undefined ? models.find((m) => m.id === modelId && m.api === api) : undefined) ??
      models.find((m) => m.id === modelId);
    const rates = toCostRates(exact);
    if (rates !== undefined) return rates;
  }
  const stripped = modelId.includes('/') ? modelId.split('/').at(-1) : undefined;
  const candidates = stripped !== undefined && stripped !== '' ? [modelId, stripped] : [modelId];
  const providers = orderedCostProviders();
  for (const id of candidates) {
    if (api !== undefined) {
      for (const p of providers) {
        const match = getBuiltinModels(p).find((m) => m.id === id && m.api === api);
        const rates = toCostRates(match);
        if (rates !== undefined) return rates;
      }
    }
    for (const p of providers) {
      const match = getBuiltinModels(p).find((m) => m.id === id);
      const rates = toCostRates(match);
      if (rates !== undefined) return rates;
    }
  }
  return undefined;
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

export function piThinking(
  provider: Pick<ProviderConfig, 'providerId' | 'api' | 'baseUrl'>,
  modelId: string,
): ThinkingChoice {
  const subscription = isCodexSubscription(provider);
  const entry = catalogModel(
    provider.providerId,
    modelId,
    subscription,
    subscription ? CODEX_API : (provider.api ?? 'openai-completions'),
  );
  const levels = catalogThinkingLevels(entry);
  if (entry === undefined || levels.length === 0) return { levels };
  return { levels, resolvesTo: clampThinkingLevel(entry, RUNNER_DEFAULT_THINKING) };
}

// pi-ai never sends an explicit effort for an anthropic-messages model without
// supportsMidConvoEffort, so the provider default is unknowable here; with the
// flag the reply markers carry `options.effort ?? 'high'`.
function inServerNoChoiceDefault(entry: Model<Api>): ThinkingLevel | undefined {
  return entry.api === 'anthropic-messages' &&
    (entry.compat as AnthropicMessagesCompat | undefined)?.supportsMidConvoEffort === true
    ? 'high'
    : undefined;
}

export function inServerThinking(
  config: Pick<ProviderConfig, 'providerId' | 'baseUrl' | 'api'>,
  modelId: string,
): ThinkingChoice {
  const subscription = isCodexSubscription(config);
  const api = subscription ? CODEX_API : config.api;
  const entry = catalogModel(config.providerId, modelId, subscription, api);
  const levels = catalogThinkingLevels(entry).filter((level) => level !== 'off');
  if (entry === undefined || levels.length === 0) return { levels };
  if (entry.thinkingLevelMap?.off === null) {
    const resolvesTo = inServerNoChoiceDefault(entry);
    return resolvesTo === undefined ? { levels } : { levels, resolvesTo };
  }
  return { levels, resolvesTo: 'off' };
}

export type KeyResolver = () => string | null | Promise<string | null>;

export function stepProvider(config: ProviderConfig, resolveKey?: KeyResolver): Provider | null {
  const subscription = isCodexSubscription(config);
  const api = subscription ? CODEX_API : config.api;
  const streams = api === undefined ? undefined : STREAMS[api];
  const baseUrl = subscription ? CODEX_BASE_URL : config.baseUrl;
  if (api === undefined || streams === undefined || baseUrl === undefined) return null;
  const models: Model<Api>[] = (config.models ?? []).map((m) => {
    const entry = catalogModel(config.providerId, m.id, subscription, api);
    const compat = {
      ...(entry?.compat as Record<string, unknown> | undefined),
      ...(config.compat ?? {}),
    };
    return {
      id: m.id,
      name: m.name,
      api,
      provider: config.providerId,
      baseUrl,
      input: resolveModelInput(m),
      cost: m.cost ?? entry?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: subscription || entry?.reasoning === true,
      thinkingLevelMap: entry?.thinkingLevelMap,
      contextWindow: m.contextWindow ?? entry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: m.maxTokens ?? entry?.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(Object.keys(compat).length === 0 ? {} : { compat: compat as Model<Api>['compat'] }),
    };
  });
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
