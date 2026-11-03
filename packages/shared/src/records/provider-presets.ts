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

const PI_PROVIDER_ID: Partial<Record<string, string>> = {
  'z-ai': 'zai',
  'z-ai-coding-cn': 'zai-coding-cn',
};

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
  return {
    baseUrl: route.baseUrl,
    api: route.api,
    authHeader: false,
    models: AGGREGATOR_PRESET_IDS.includes(presetId)
      ? []
      : route.models.map(presetModel).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)),
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
