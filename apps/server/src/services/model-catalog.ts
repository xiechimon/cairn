import type { ChiefUsageModelEntry } from '@cairn/shared';
import {
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_CLAUDE_CODE_MODELS,
  DEFAULT_DEVIN_MODELS,
  formatModelDisplayName,
  parseModelKey,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  antigravitySubscription,
  claudeSubscription,
  devinSubscription,
  machine,
  provider,
} from '../db/schema.js';
import { stepRuntimeFor } from './dispatch-eligibility.js';

export interface TeamModelCatalog {
  providers: Map<string, { label: string; models: Map<string, string> }>;
  devinModels: Map<string, string>;
  antigravityModels: Map<string, string>;
  claudeModels: Map<string, string>;
}

function addModels(target: Map<string, string>, rows: readonly { id: string; name: string }[]) {
  for (const row of rows) {
    if (row.id !== '' && row.name !== '') target.set(row.id, row.name);
  }
}

export function loadTeamModelCatalog(
  db: Db,
  teamId: string,
  options: { includeBuiltins?: boolean } = {},
): TeamModelCatalog {
  const includeBuiltins = options.includeBuiltins ?? true;
  const providers = new Map<string, { label: string; models: Map<string, string> }>();
  for (const row of db
    .select({ providerId: provider.providerId, label: provider.label, models: provider.models })
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .all()) {
    const models = new Map<string, string>();
    addModels(models, row.models);
    providers.set(row.providerId, { label: row.label, models });
  }

  const devinModels = new Map<string, string>();
  const antigravityModels = new Map<string, string>();
  const claudeModels = new Map<string, string>();
  if (includeBuiltins) {
    addModels(devinModels, DEFAULT_DEVIN_MODELS);
    addModels(antigravityModels, DEFAULT_ANTIGRAVITY_MODELS);
    addModels(claudeModels, DEFAULT_CLAUDE_CODE_MODELS);
  }

  for (const row of db
    .select({ capabilities: machine.capabilities, claudeCodeReport: machine.claudeCodeReport })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), isNull(machine.retiredAt)))
    .all()) {
    addModels(devinModels, row.capabilities?.devin?.models ?? []);
    addModels(antigravityModels, row.capabilities?.antigravity?.models ?? []);
    addModels(claudeModels, row.claudeCodeReport?.models ?? []);
  }

  for (const row of db
    .select({ models: devinSubscription.models })
    .from(devinSubscription)
    .where(eq(devinSubscription.teamId, teamId))
    .all()) {
    addModels(devinModels, row.models);
  }
  for (const row of db
    .select({ models: antigravitySubscription.models })
    .from(antigravitySubscription)
    .where(eq(antigravitySubscription.teamId, teamId))
    .all()) {
    addModels(antigravityModels, row.models);
  }
  for (const row of db
    .select({ models: claudeSubscription.models })
    .from(claudeSubscription)
    .where(eq(claudeSubscription.teamId, teamId))
    .all()) {
    addModels(claudeModels, row.models ?? []);
  }

  return { providers, devinModels, antigravityModels, claudeModels };
}

function inferProviderFromModelId(catalog: TeamModelCatalog, modelId: string): string | null {
  if (catalog.devinModels.has(modelId) || /^swe-/i.test(modelId)) return 'devin';
  if (catalog.antigravityModels.has(modelId)) return 'antigravity';
  if (catalog.claudeModels.has(modelId)) return 'claude-code';
  return null;
}

const RUNTIME_PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  devin: 'Devin',
  antigravity: 'Antigravity',
  pi: 'Cairn',
  gemini: 'Gemini',
};

export function resolveTeamModelEntry(
  catalog: TeamModelCatalog,
  raw: string,
  fallbackProvider: string | null = null,
  options: { formatFallback?: boolean } = {},
): ChiefUsageModelEntry {
  const formatFallback = options.formatFallback ?? true;
  const { provider: prefix, modelId } = parseModelKey(raw);
  const resolvedProvider = prefix ?? fallbackProvider ?? inferProviderFromModelId(catalog, modelId);
  const runtime = resolvedProvider !== null ? stepRuntimeFor(resolvedProvider) : null;
  const providerRow =
    resolvedProvider !== null ? catalog.providers.get(resolvedProvider) : undefined;
  const providerLabel =
    providerRow?.label ??
    (resolvedProvider !== null
      ? (RUNTIME_PROVIDER_LABELS[resolvedProvider] ?? resolvedProvider)
      : null);
  const catalogName =
    providerRow?.models.get(modelId) ??
    (runtime === 'devin'
      ? catalog.devinModels.get(modelId)
      : runtime === 'antigravity'
        ? catalog.antigravityModels.get(modelId)
        : runtime === 'claude-code'
          ? catalog.claudeModels.get(modelId)
          : undefined);
  const modelName =
    catalogName !== undefined && catalogName !== '' && catalogName !== modelId
      ? catalogName
      : formatFallback
        ? formatModelDisplayName(modelId)
        : modelId;
  return {
    raw,
    provider: resolvedProvider,
    providerLabel,
    modelId,
    modelName,
    runtime,
  };
}
