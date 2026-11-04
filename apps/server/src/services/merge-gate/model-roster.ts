export interface RosterModel {
  id: string;
  lab?: string;
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

export interface RosterCatalog {
  provider: string;
  models: readonly RosterModel[];
}

export interface ModelRoster {
  vendors: Readonly<Record<string, string>>;
  aliases: Readonly<Record<string, string>>;
}

export const SINGLE_LAB_PROVIDERS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI',
  google: 'Google',
  'google-vertex': 'Google',
  moonshotai: 'Moonshot',
  'moonshotai-cn': 'Moonshot',
  'kimi-coding': 'Moonshot',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  zai: 'Z.ai',
  'zai-coding-cn': 'Z.ai',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax',
  meta: 'Meta',
  xiaomi: 'Xiaomi',
  'xiaomi-token-plan-ams': 'Xiaomi',
  'xiaomi-token-plan-cn': 'Xiaomi',
  'xiaomi-token-plan-sgp': 'Xiaomi',
  'ant-ling': 'Ant Ling',
};

const LAB_VENDORS: Readonly<Record<string, string>> = {
  Anthropic: 'Anthropic',
  OpenAI: 'OpenAI',
  Google: 'Google',
  Moonshot: 'Moonshot',
  'Moonshot AI': 'Moonshot',
  xAI: 'xAI',
  DeepSeek: 'DeepSeek',
  'Z.ai': 'Z.ai',
  Mistral: 'Mistral',
  MiniMax: 'MiniMax',
  Meta: 'Meta',
  Xiaomi: 'Xiaomi',
  'Ant Ling': 'Ant Ling',
};

export function rosterBareId(id: string): string {
  const slash = id.lastIndexOf('/');
  return (slash === -1 ? id : id.slice(slash + 1)).toLowerCase();
}

function costSignature(model: RosterModel): string {
  const cost = model.cost;
  return [
    model.lab ?? '',
    cost?.input ?? '',
    cost?.output ?? '',
    cost?.cacheRead ?? '',
    cost?.cacheWrite ?? '',
    model.contextWindow ?? '',
    model.maxTokens ?? '',
  ].join('\0');
}

function sortedRecord(entries: readonly (readonly [string, string])[]): Record<string, string> {
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
}

export function deriveModelRoster(catalogs: readonly RosterCatalog[]): ModelRoster {
  const assigned = new Map<string, string | null>();
  const assign = (id: string, vendor: string) => {
    const makerId = id.replace(/^zai-/u, '').replaceAll('.', '-');
    if (makerId.startsWith('glm-')) vendor = 'Z.ai';
    const prev = assigned.get(id);
    if (prev === undefined) assigned.set(id, vendor);
    else if (prev !== vendor) assigned.set(id, null);
  };
  for (const catalog of catalogs) {
    const vendor = SINGLE_LAB_PROVIDERS[catalog.provider];
    if (vendor === undefined) continue;
    for (const model of catalog.models) assign(rosterBareId(model.id), vendor);
  }
  const radius = catalogs.find((catalog) => catalog.provider === 'radius');
  if (radius !== undefined) {
    for (const model of radius.models) {
      const vendor = model.lab === undefined ? undefined : LAB_VENDORS[model.lab];
      if (vendor !== undefined) assign(rosterBareId(model.id), vendor);
    }
  }
  const vendors = sortedRecord(
    [...assigned.entries()].flatMap(([id, vendor]) => (vendor === null ? [] : [[id, vendor]])),
  );
  const aliases = new Map<string, string>();
  for (const id of Object.keys(vendors)) {
    const canonical = id.replace(/^(?:zai-)?glm-(\d+)-(\d+)(.*)$/u, 'glm-$1.$2$3');
    if (canonical !== id && vendors[canonical] === vendors[id]) aliases.set(id, canonical);
  }
  if (radius !== undefined) {
    const groups = new Map<string, string[]>();
    for (const model of radius.models) {
      const id = rosterBareId(model.id);
      const group = groups.get(costSignature(model)) ?? [];
      if (!group.includes(id)) group.push(id);
      groups.set(costSignature(model), group);
    }
    for (const ids of groups.values()) {
      const routes = ids.filter((id) => /^[a-z]+$/u.test(id));
      const upstream = ids.filter((id) => !/^[a-z]+$/u.test(id));
      if (routes.length === 0 || upstream.length !== 1) continue;
      const canonical = upstream[0];
      if (canonical === undefined) continue;
      for (const route of routes) {
        if (route !== canonical) aliases.set(route, canonical);
      }
    }
  }
  return { vendors, aliases: sortedRecord([...aliases.entries()]) };
}
