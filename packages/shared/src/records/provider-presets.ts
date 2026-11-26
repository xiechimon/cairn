import {
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  type ProviderApi,
  type ProviderModel,
  providerApiSchema,
} from './provider.js';

export interface ProviderPresetDefaults {
  baseUrl: string;
  api: ProviderApi;
  authHeader: boolean;
  models: ProviderModel[];
  picks: string[];
}

export interface PresetCatalogModel {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  type?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  cost?: ProviderModel['cost'];
}

export interface PresetCatalog {
  provider: string;
  models: PresetCatalogModel[];
}

export const PI_PROVIDER_ID: Partial<Record<string, string>> = {
  'z-ai': 'zai',
  'z-ai-coding-cn': 'zai-coding-cn',
};

export function piCatalogProviderId(providerId: string): string {
  return PI_PROVIDER_ID[providerId] ?? providerId;
}

const API_PREFERRED_CATALOG_PROVIDERS: Partial<Record<string, readonly string[]>> = {
  'anthropic-messages': ['anthropic'],
  'openai-responses': ['openai'],
  'openai-codex-responses': ['openai-codex'],
};

const SECONDARY_CATALOG_PROVIDERS = new Set([
  'amazon-bedrock',
  'azure',
  'baseten',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'fireworks',
  'github-copilot',
  'google-vertex',
  'groq',
  'huggingface',
  'nvidia',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'qwen-token-plan-individual',
  'radius',
  'together',
  'typesafe',
  'vercel-ai-gateway',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
]);

export function piCatalogFallbackOrder(
  builtinProviders: readonly string[],
  api?: string,
): string[] {
  const preferred = (api === undefined ? undefined : API_PREFERRED_CATALOG_PROVIDERS[api]) ?? [];
  const primary = builtinProviders.filter(
    (id) => !preferred.includes(id) && !SECONDARY_CATALOG_PROVIDERS.has(id),
  );
  const secondary = builtinProviders.filter(
    (id) => !preferred.includes(id) && SECONDARY_CATALOG_PROVIDERS.has(id),
  );
  return [...preferred.filter((id) => builtinProviders.includes(id)), ...primary, ...secondary];
}

export function strippedCatalogModelId(modelId: string): string | undefined {
  if (!modelId.includes('/')) return undefined;
  const bare = modelId.split('/').pop()?.trim();
  return bare && bare !== modelId ? bare : undefined;
}

export const AGGREGATOR_PRESET_IDS: readonly string[] = [
  'cloudflare-ai-gateway',
  'vercel-ai-gateway',
  'openrouter',
  'opencode',
  'opencode-go',
];

const API_ORDER: readonly string[] = providerApiSchema.options;

function isProviderApi(api: string): api is ProviderApi {
  return API_ORDER.includes(api);
}

function presetModel(model: PresetCatalogModel): ProviderModel {
  const input = model.input?.filter((kind) => kind === 'text' || kind === 'image');
  const cost = model.cost;
  return {
    id: model.id,
    name: model.name,
    ...(cost !== undefined
      ? {
          cost: {
            input: cost.input,
            output: cost.output,
            cacheRead: cost.cacheRead,
            cacheWrite: cost.cacheWrite,
          },
        }
      : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(input !== undefined && input.length > 0 ? { input } : {}),
  };
}

export const MAX_DEFAULT_PICKS = 8;

function modelFamily(id: string): string {
  return id
    .toLowerCase()
    .split('-')
    .map((token) => token.replace(/\d+(\.\d+)*/g, '#'))
    .filter((token) => token !== '#')
    .join('-');
}

export function newestPerFamily(models: readonly ProviderModel[]): string[] {
  const newest = new Map<string, string>();
  for (const { id } of models) {
    const family = modelFamily(id);
    const current = newest.get(family);
    if (current === undefined || id.localeCompare(current, 'en', { numeric: true }) > 0) {
      newest.set(family, id);
    }
  }
  const picked = new Set(newest.values());
  return models.map((model) => model.id).filter((id) => picked.has(id));
}

function defaultPicks(catalog: readonly ProviderModel[]): string[] {
  const picks = newestPerFamily(catalog);
  return picks.length <= MAX_DEFAULT_PICKS ? picks : [];
}

function presetDefaults(
  presetId: string,
  models: readonly PresetCatalogModel[],
): ProviderPresetDefaults | undefined {
  const routes = new Map<
    string,
    { api: ProviderApi; baseUrl: string; models: PresetCatalogModel[] }
  >();
  for (const model of models) {
    if ((model.type ?? 'chat') !== 'chat' || !isProviderApi(model.api)) continue;
    const key = `${model.api} ${model.baseUrl}`;
    const route = routes.get(key) ?? { api: model.api, baseUrl: model.baseUrl, models: [] };
    route.models.push(model);
    routes.set(key, route);
  }
  const route = [...routes.values()].sort(
    (a, b) =>
      b.models.length - a.models.length ||
      API_ORDER.indexOf(a.api) - API_ORDER.indexOf(b.api) ||
      a.baseUrl.localeCompare(b.baseUrl),
  )[0];
  if (route === undefined) return undefined;
  const catalog = route.models
    .map(presetModel)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return {
    baseUrl: route.baseUrl,
    api: route.api,
    authHeader: false,
    models: catalog,
    picks: AGGREGATOR_PRESET_IDS.includes(presetId) ? [] : defaultPicks(catalog),
  };
}

export function derivePresetDefaults(
  catalogs: readonly PresetCatalog[],
): Record<string, ProviderPresetDefaults> {
  const byProvider = new Map(catalogs.map((catalog) => [catalog.provider, catalog.models]));
  const oauth: readonly string[] = PROVIDER_OAUTH_PRESET_IDS;
  const out: Record<string, ProviderPresetDefaults> = {};
  for (const presetId of PROVIDER_PRESET_IDS) {
    if (oauth.includes(presetId)) continue;
    const defaults = presetDefaults(
      presetId,
      byProvider.get(PI_PROVIDER_ID[presetId] ?? presetId) ?? [],
    );
    if (defaults !== undefined) out[presetId] = defaults;
  }
  return out;
}
