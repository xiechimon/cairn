import {
  type CandidateHarness,
  type CatalogTierModel,
  canonicalClaudeModels,
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_CLAUDE_CODE_MODELS,
  DEFAULT_DEVIN_MODELS,
  type Difficulty,
  devinInferredThinking,
  devinWireModel,
  isInternalAntigravityModelId,
  type ModelRef,
  orderByKeys,
  PROVIDER_PRESET_IDS,
  type SourceTiers,
  selectSourceTiers,
  tierFallbackOrder,
} from '@cairn/shared';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  builtinModelIds,
  catalogModelMetadata,
  isBuiltinProvider,
} from '../coordinator/runtime/provider.js';
import type { Db } from '../db/client.js';
import {
  antigravitySubscription,
  claudeSubscription,
  devinSubscription,
  doubaoSubscription,
  machine,
  provider,
  team,
} from '../db/schema.js';
import { activeAntigravitySource } from './antigravity-subscriptions.js';
import { enabledClaudeSubscriptionModels } from './claude-subscriptions.js';
import { enabledDevinSubscriptionModels } from './devin-subscriptions.js';
import { antigravityUsable, claudeCodeUsable, devinUsable } from './dispatch-eligibility.js';
import { activeDoubaoSource, DEFAULT_DOUBAO_FALLBACK_MODELS } from './doubao-subscriptions.js';

export interface ConnectedTierSource {
  key: string;
  provider: string;
  runtime: CandidateHarness;
  models: CatalogTierModel[];
  tiers: SourceTiers;
}

export function isKeylessEndpoint(providerId: string): boolean {
  const presets: readonly string[] = PROVIDER_PRESET_IDS;
  return !presets.includes(providerId) && !isBuiltinProvider(providerId);
}

function enrichCatalogModel(
  providerId: string,
  model: CatalogTierModel,
  api?: string,
): CatalogTierModel {
  const meta = catalogModelMetadata(providerId, model.id, api);
  if (meta === undefined) return model;
  return {
    ...model,
    ...(model.cost !== undefined ? {} : meta.cost !== undefined ? { cost: meta.cost } : {}),
    ...(model.contextWindow !== undefined
      ? {}
      : meta.contextWindow !== undefined
        ? { contextWindow: meta.contextWindow }
        : {}),
    ...(model.maxTokens !== undefined
      ? {}
      : meta.maxTokens !== undefined
        ? { maxTokens: meta.maxTokens }
        : {}),
    ...(model.reasoning !== undefined
      ? {}
      : meta.reasoning !== undefined
        ? { reasoning: meta.reasoning }
        : {}),
  };
}

function claudeTierModels(db: Pick<Db, 'select'>, teamId: string): CatalogTierModel[] {
  const picked = enabledClaudeSubscriptionModels({ db }, teamId);
  const machines = db
    .select({ claudeCodeReport: machine.claudeCodeReport })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all();
  const reported = canonicalClaudeModels(
    machines.flatMap((row) => row.claudeCodeReport?.models ?? []),
  );
  const base =
    picked !== null
      ? picked
      : reported.length > 0
        ? reported
        : DEFAULT_CLAUDE_CODE_MODELS.map((m) => ({ ...m }));
  return base.map((m) =>
    enrichCatalogModel('anthropic', { id: m.id, name: m.name }, 'anthropic-messages'),
  );
}

function antigravityTierModels(db: Pick<Db, 'select'>, teamId: string): CatalogTierModel[] {
  const source = activeAntigravitySource(db, teamId);
  if (source.kind === 'none') return [];
  const raw =
    source.models.length > 0
      ? source.models
      : source.kind === 'host' && source.login.status === 'ok' && source.login.models.length > 0
        ? source.login.models
        : DEFAULT_ANTIGRAVITY_MODELS;
  const defaults = new Map(DEFAULT_ANTIGRAVITY_MODELS.map((m) => [m.id, m]));
  const machineThinking = new Map(
    db
      .select({ capabilities: machine.capabilities })
      .from(machine)
      .where(eq(machine.teamId, teamId))
      .all()
      .flatMap((row) => row.capabilities?.antigravity?.models ?? [])
      .map((m) => [m.id, m.thinkingLevels] as const),
  );
  return raw
    .filter((m) => m.id !== '' && !isInternalAntigravityModelId(m.id))
    .map((m) => {
      const known = defaults.get(m.id);
      const thinkingLevels =
        'thinkingLevels' in m && Array.isArray(m.thinkingLevels)
          ? m.thinkingLevels
          : (machineThinking.get(m.id) ?? known?.thinkingLevels);
      return enrichCatalogModel('antigravity', {
        id: m.id,
        name: m.name,
        ...(thinkingLevels !== undefined ? { thinkingLevels } : {}),
      });
    });
}

function devinTierModels(db: Pick<Db, 'select'>, teamId: string): CatalogTierModel[] {
  const picked = enabledDevinSubscriptionModels({ db }, teamId);
  const reported = db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .flatMap((row) => row.capabilities?.devin?.models ?? []);
  const defaults = new Map(DEFAULT_DEVIN_MODELS.map((m) => [m.id, m]));
  const raw = picked.length > 0 ? picked : reported.length > 0 ? reported : DEFAULT_DEVIN_MODELS;
  return raw
    .filter((m) => m.id !== '')
    .map((m) => {
      const inferred = devinInferredThinking(m.id);
      const known = defaults.get(m.id);
      const thinkingLevels =
        ('thinkingLevels' in m && Array.isArray(m.thinkingLevels) ? m.thinkingLevels : undefined) ??
        known?.thinkingLevels ??
        inferred.thinkingLevels;
      return {
        id: devinWireModel('devin', m.id, m.thinkingDefault) ?? m.id,
        name: m.name,
        ...(thinkingLevels !== undefined ? { thinkingLevels } : {}),
      };
    });
}

function doubaoTierModels(db: Pick<Db, 'select'>, teamId: string): CatalogTierModel[] {
  const source = activeDoubaoSource(db, teamId);
  if (source.kind === 'none') return [];
  const reported = db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .flatMap((row) => row.capabilities?.doubao?.models ?? []);
  const raw =
    source.models.length > 0
      ? source.models
      : reported.length > 0
        ? reported
        : DEFAULT_DOUBAO_FALLBACK_MODELS;
  return raw
    .filter((m) => m.id !== '')
    .map((m) => ({
      id: m.id,
      name: m.name,
      ...('thinkingLevels' in m && Array.isArray(m.thinkingLevels)
        ? { thinkingLevels: m.thinkingLevels }
        : {}),
    }));
}

function subscriptionKeysFor(
  db: Pick<Db, 'select'>,
  teamId: string,
): Record<'claude-code' | 'antigravity' | 'devin' | 'doubao', string[]> {
  return {
    'claude-code': db
      .select({ id: claudeSubscription.id })
      .from(claudeSubscription)
      .where(eq(claudeSubscription.teamId, teamId))
      .all()
      .map((r) => `subscription:${r.id}`),
    antigravity: db
      .select({ id: antigravitySubscription.id })
      .from(antigravitySubscription)
      .where(eq(antigravitySubscription.teamId, teamId))
      .all()
      .map((r) => `subscription:${r.id}`),
    devin: db
      .select({ id: devinSubscription.id })
      .from(devinSubscription)
      .where(eq(devinSubscription.teamId, teamId))
      .all()
      .map((r) => `subscription:${r.id}`),
    doubao: db
      .select({ id: doubaoSubscription.id })
      .from(doubaoSubscription)
      .where(eq(doubaoSubscription.teamId, teamId))
      .all()
      .map((r) => `subscription:${r.id}`),
  };
}

export function listConnectedTierSources(
  db: Pick<Db, 'select'>,
  teamId: string,
  primaryProvider: string | null,
  preferredModelId: string | null = null,
): ConnectedTierSource[] {
  const apiProviders = db
    .select({
      id: provider.id,
      providerId: provider.providerId,
      api: provider.api,
      models: provider.models,
      keyed: sql<number>`${provider.apiKeyCipher} is not null`,
    })
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .orderBy(asc(provider.createdAt), asc(provider.id))
    .all()
    .filter((row) => row.keyed === 1 || isKeylessEndpoint(row.providerId));

  const rawSources: Array<{
    keys: string[];
    key: string;
    provider: string;
    runtime: CandidateHarness;
    models: CatalogTierModel[];
  }> = apiProviders.map((row) => {
    const baseModels: CatalogTierModel[] =
      row.models.length > 0
        ? row.models
            .filter((m) => m.id !== '')
            .map((m) => ({
              id: m.id,
              name: m.name || m.id,
              ...(m.cost !== undefined ? { cost: m.cost } : {}),
              ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
              ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
            }))
        : [...builtinModelIds(row.providerId)].map((id) => ({ id, name: id }));
    return {
      keys: [`provider:${row.id}`],
      key: `provider:${row.id}`,
      provider: row.providerId,
      runtime: 'pi',
      models: baseModels.map((m) => enrichCatalogModel(row.providerId, m, row.api)),
    };
  });

  const subKeys = subscriptionKeysFor(db, teamId);
  if (claudeCodeUsable(db, teamId)) {
    rawSources.push({
      keys: subKeys['claude-code'],
      key: 'claude-code',
      provider: 'claude-code',
      runtime: 'claude-code',
      models: claudeTierModels(db, teamId),
    });
  }
  if (antigravityUsable(db, teamId)) {
    rawSources.push({
      keys: subKeys.antigravity,
      key: 'antigravity',
      provider: 'antigravity',
      runtime: 'antigravity',
      models: antigravityTierModels(db, teamId),
    });
  }
  if (devinUsable(db, teamId)) {
    rawSources.push({
      keys: subKeys.devin,
      key: 'devin',
      provider: 'devin',
      runtime: 'devin',
      models: devinTierModels(db, teamId),
    });
  }
  if (activeDoubaoSource(db, teamId).kind === 'host') {
    rawSources.push({
      keys: subKeys.doubao,
      key: 'doubao',
      provider: 'doubao',
      runtime: 'doubao',
      models: doubaoTierModels(db, teamId),
    });
  }

  const storedOrder = db
    .select({ order: team.providerOrder })
    .from(team)
    .where(eq(team.id, teamId))
    .get()?.order;
  const ordered = orderByKeys(
    rawSources,
    (s) => s.keys,
    Array.isArray(storedOrder) && storedOrder.every((k) => typeof k === 'string')
      ? storedOrder
      : null,
  );
  const prioritized =
    primaryProvider === null
      ? ordered
      : [
          ...ordered.filter((s) => s.provider === primaryProvider),
          ...ordered.filter((s) => s.provider !== primaryProvider),
        ];

  const out: ConnectedTierSource[] = [];
  for (const source of prioritized) {
    const tiers = selectSourceTiers(
      source.models,
      source.provider === primaryProvider ? preferredModelId : null,
    );
    if (tiers === null) continue;
    out.push({
      key: source.key,
      provider: source.provider,
      runtime: source.runtime,
      models: source.models,
      tiers,
    });
  }
  return out;
}

export function tierFallbackChain(
  sources: readonly ConnectedTierSource[],
  difficulty: Difficulty,
  explicitFallbacks: readonly ModelRef[] | null | undefined,
): ModelRef[] {
  const out: ModelRef[] = [];
  const seen = new Set<string>();
  const push = (ref: ModelRef) => {
    const key = `${ref.provider}\0${ref.modelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  for (const ref of explicitFallbacks ?? []) push(ref);
  const [primary, ...rest] = sources;
  if (primary !== undefined) {
    for (const modelId of tierFallbackOrder(primary.tiers, difficulty).slice(1)) {
      push({ provider: primary.provider, modelId });
    }
  }
  for (const source of rest) {
    for (const modelId of tierFallbackOrder(source.tiers, difficulty)) {
      push({ provider: source.provider, modelId });
    }
  }
  return out;
}

export function antigravityQuotaExhausted(
  db: Pick<Db, 'select'>,
  teamId: string,
  now: number,
): boolean {
  const row = db
    .select({ quotaWindows: antigravitySubscription.quotaWindows })
    .from(antigravitySubscription)
    .where(
      and(eq(antigravitySubscription.teamId, teamId), isNotNull(antigravitySubscription.enabledAt)),
    )
    .get();
  if (row?.quotaWindows == null) return false;
  return row.quotaWindows.some(
    (w) => (w.resetsAt === null || w.resetsAt > now) && w.utilization >= 1,
  );
}
