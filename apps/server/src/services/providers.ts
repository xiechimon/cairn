import { hostname } from 'node:os';
import {
  canonicalClaudeModels,
  claudeCodeThinkingDefault,
  claudeCodeThinkingLevels,
  claudeCodeUpdateRequired,
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_DEVIN_MODELS,
  type ModelSourceModel,
  type ModelSourcesEnvelope,
  orderByKeys,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  PROVIDER_XAI_PRESET,
  type ProviderCompat,
  type ProviderPreset,
  type ProviderRecord,
  type SecretBox,
  topModelsSchema,
} from '@cairn/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  builtinModelIds,
  inServerThinking,
  piThinking,
  type ThinkingChoice,
} from '../coordinator/runtime/provider.js';
import type { Db } from '../db/client.js';
import {
  antigravitySubscription,
  build,
  chiefThread,
  chiefTurnUsage,
  claudeSubscription,
  devinSubscription,
  machine,
  project,
  provider,
  routingRule,
  step,
  stepRoute,
  stepUsage,
  team,
  teamTopModels,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { activeAntigravitySource } from './antigravity-subscriptions.js';
import { enabledClaudeSubscriptionModels } from './claude-subscriptions.js';
import {
  enabledDevinSubscriptionModels,
  hasActiveDevinSubscription,
} from './devin-subscriptions.js';
import { getModelLiveness } from './model-liveness.js';
import {
  nextProviderVersion,
  providerConfigurationFingerprint,
  providerCredentialId,
  publicProviderCompat,
  replaceProviderCredential,
  withProviderCredentialId,
} from './provider-configuration.js';

export interface ProviderDeps {
  db: Db;
  box: SecretBox;
}

type ProviderRow = typeof provider.$inferSelect;

export function providerPresets(): ProviderPreset[] {
  const oauthIds: readonly string[] = PROVIDER_OAUTH_PRESET_IDS;
  return PROVIDER_PRESET_IDS.map((id) => ({
    id,
    auth: oauthIds.includes(id) ? ('oauth' as const) : ('api_key' as const),
    ...(id === PROVIDER_XAI_PRESET.id ? { oauthLabel: PROVIDER_XAI_PRESET.oauthLabel } : {}),
  }));
}

export function toProviderRecord(row: ProviderRow): ProviderRecord {
  return {
    kind: 'custom',
    providerId: row.providerId,
    label: row.label,
    baseUrl: row.baseUrl,
    api: row.api,
    authHeader: row.authHeader,
    compat: publicProviderCompat(row.compat),
    configurationFingerprint: providerConfigurationFingerprint(row),
    models: row.models,
    id: row.id,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ProviderBody {
  providerId: string;
  label: string;
  baseUrl: string;
  api: ProviderRecord['api'];
  authHeader?: boolean;
  compat?: ProviderCompat;
  models?: { id: string; name: string }[];
  apiKey?: string | null;
}

function getRow(deps: ProviderDeps, teamId: string, id: string): ProviderRow | undefined {
  return deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.id, id), eq(provider.teamId, teamId)))
    .get();
}

function assertProviderIdFree(
  deps: ProviderDeps,
  teamId: string,
  providerId: string,
  exceptId?: string,
): void {
  const dup = deps.db
    .select({ id: provider.id })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .all()
    .find((r) => r.id !== exceptId);
  if (dup) throw conflict(`provider ${providerId} already exists`);
}

export function listProviders(deps: ProviderDeps, teamId: string): ProviderRecord[] {
  return deps.db
    .select()
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .orderBy(asc(provider.createdAt))
    .all()
    .map(toProviderRecord);
}

export function getProvidersEnvelope(
  deps: ProviderDeps,
  teamId: string,
): { presets: ProviderPreset[]; providers: ProviderRecord[]; order: string[] | null } {
  return {
    presets: providerPresets(),
    providers: listProviders(deps, teamId),
    order: readProviderOrder(deps.db, teamId),
  };
}

export function listClaudeCodeSources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  const picked = enabledClaudeSubscriptionModels({ db }, teamId);
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .flatMap((row) => {
      const report = row.claudeCodeReport;
      if (report === null) return [];
      return [
        {
          runtime: 'claude-code' as const,
          installed: report.installed,
          hostname: report.hostname,
          machineId: row.id,
          models: (picked === null
            ? canonicalClaudeModels(report.models)
            : picked.map((model) => ({ ...model, slot: 'builtin' }))
          ).map((model) => {
            const updateRequired = claudeCodeUpdateRequired(model.id, report.bin?.version);
            const thinking = {
              customBackend: picked === null && report.customBackend === true,
            };
            return {
              ...model,
              ...asTask({
                levels: claudeCodeThinkingLevels(model.id, thinking),
                resolvesTo: claudeCodeThinkingDefault(model.id, thinking),
              }),
              ...(updateRequired !== null ? { updateRequired } : {}),
            };
          }),
          ...(report.bin !== undefined ? { bin: report.bin } : {}),
          ...(report.bin?.version != null ? { version: report.bin.version } : {}),
          ...(report.update !== undefined ? { runtimeUpdate: report.update } : {}),
        },
      ];
    });
}

function uniqueModels<T extends { id: string }>(models: readonly T[]): T[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (model.id === '' || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function asTask({ levels, resolvesTo }: ThinkingChoice) {
  return resolvesTo === undefined
    ? { thinkingLevels: levels }
    : { thinkingLevels: levels, thinkingDefault: resolvesTo };
}

function asInServer({ levels, resolvesTo }: ThinkingChoice) {
  return resolvesTo === undefined
    ? { inServerThinkingLevels: levels }
    : { inServerThinkingLevels: levels, inServerThinkingDefault: resolvesTo };
}

function withKnownThinkingLevels(
  models: readonly ModelSourceModel[],
  known: readonly ModelSourceModel[],
): ModelSourceModel[] {
  return models.map((model) => {
    const learned = known.find(
      (entry) => entry.id === model.id && entry.thinkingLevels !== undefined,
    );
    if (learned?.thinkingLevels === undefined) return model;
    return {
      ...model,
      ...asTask({ levels: learned.thinkingLevels, resolvesTo: learned.thinkingDefault }),
    };
  });
}

export function listDevinSources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  const provisionable = hasActiveDevinSubscription({ db }, teamId);
  const machines = db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .filter((row) => {
      const devin = row.capabilities?.devin;
      return devin?.installed === true || (provisionable && devin !== undefined);
    });
  const reported = machines.flatMap((row) => row.capabilities?.devin?.models ?? []);
  const merged = withKnownThinkingLevels(
    uniqueModels([...enabledDevinSubscriptionModels({ db }, teamId), ...reported]),
    [...reported, ...DEFAULT_DEVIN_MODELS],
  );
  const models: ModelSourceModel[] = merged.length > 0 ? merged : [...DEFAULT_DEVIN_MODELS];
  return machines.map((row) => ({
    runtime: 'devin' as const,
    installed: row.capabilities?.devin?.installed === true,
    hostname: row.name,
    machineId: row.id,
    models: models.map((model) => ({ ...model })),
    ...(row.capabilities?.devin?.version !== undefined
      ? { version: row.capabilities.devin.version }
      : {}),
    ...(row.capabilities?.devin?.update !== undefined
      ? { runtimeUpdate: row.capabilities.devin.update }
      : {}),
  }));
}

export function listGeminiSources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .flatMap((row) => {
      const gemini = row.capabilities?.gemini;
      if (gemini === undefined || (!gemini.installed && gemini.update === undefined)) return [];
      return [
        {
          runtime: 'gemini' as const,
          installed: gemini.installed,
          hostname: row.name,
          machineId: row.id,
          models: [],
          ...(gemini.version !== undefined ? { version: gemini.version } : {}),
          ...(gemini.update !== undefined ? { runtimeUpdate: gemini.update } : {}),
        },
      ];
    });
}

export function listAntigravitySources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  const source = activeAntigravitySource(db, teamId);
  if (source.kind === 'host') {
    if (source.login.status !== 'ok') return [];
    const reported = source.login.models;
    const picked = source.models.filter((model) => reported.some((entry) => entry.id === model.id));
    const models = withKnownThinkingLevels(uniqueModels([...picked, ...reported]), [
      ...reported,
      ...DEFAULT_ANTIGRAVITY_MODELS,
    ]);
    return [
      {
        runtime: 'antigravity',
        installed: true,
        hostname: source.login.hostname,
        machineId: source.login.runnerId,
        models: models.map((model) => ({ ...model, slot: 'builtin' })),
      },
    ];
  }
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .flatMap((row) => {
      const report = row.capabilities?.antigravity;
      if (report === undefined || (!report.installed && source.kind === 'none')) return [];
      const models = withKnownThinkingLevels(
        uniqueModels(
          source.kind === 'token' || source.kind === 'oauth-personal'
            ? source.models
            : (report.models ?? []),
        ),
        DEFAULT_ANTIGRAVITY_MODELS,
      );
      return [
        {
          runtime: 'antigravity' as const,
          installed: report.installed,
          hostname: row.name,
          machineId: row.id,
          models:
            models.length > 0
              ? models.map((model) => ({ ...model, slot: 'builtin' as const }))
              : [...DEFAULT_ANTIGRAVITY_MODELS],
        },
      ];
    });
}

export function readProviderOrder(db: Db, teamId: string): string[] | null {
  const stored = db
    .select({ order: team.providerOrder })
    .from(team)
    .where(eq(team.id, teamId))
    .get()?.order;
  return Array.isArray(stored) && stored.every((key) => typeof key === 'string') ? stored : null;
}

export function writeProviderOrder(db: Db, teamId: string, order: string[]): string[] {
  db.update(team).set({ providerOrder: order }).where(eq(team.id, teamId)).run();
  return order;
}

function subscriptionKeys(db: Db, teamId: string) {
  const keysOf = (rows: { id: string }[]) => rows.map((row) => `subscription:${row.id}`);
  return {
    'claude-code': keysOf(
      db
        .select({ id: claudeSubscription.id })
        .from(claudeSubscription)
        .where(eq(claudeSubscription.teamId, teamId))
        .all(),
    ),
    devin: keysOf(
      db
        .select({ id: devinSubscription.id })
        .from(devinSubscription)
        .where(eq(devinSubscription.teamId, teamId))
        .all(),
    ),
    antigravity: keysOf(
      db
        .select({ id: antigravitySubscription.id })
        .from(antigravitySubscription)
        .where(eq(antigravitySubscription.teamId, teamId))
        .all(),
    ),
  } satisfies Partial<Record<ModelSourcesEnvelope['sources'][number]['runtime'], string[]>>;
}

type ModelSource = ModelSourcesEnvelope['sources'][number];

export function getModelSources(deps: ProviderDeps, teamId: string): ModelSourcesEnvelope {
  const piSources = listProviders(deps, teamId).map((p): { key: string; source: ModelSource } => {
    const stored = p.models.filter((m) => m.id !== '');
    const models =
      stored.length > 0
        ? stored.map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id }))
        : [...builtinModelIds(p.providerId)].map((id) => ({ id, name: id }));
    return {
      key: `provider:${p.id}`,
      source: {
        runtime: 'pi' as const,
        provider: p.providerId,
        providerLabel: p.label,
        installed: true,
        hostname: hostname(),
        models: models.map((m) => ({
          ...m,
          liveness: getModelLiveness(teamId, p.providerId, m.id),
          ...asTask(piThinking(p, m.id)),
          ...asInServer(inServerThinking(p, m.id)),
        })),
      },
    };
  });
  const subscriptions = subscriptionKeys(deps.db, teamId);
  const providerKeys = new Map(piSources.map(({ key, source }) => [source, key]));
  const keysOf = (source: ModelSource): readonly string[] => {
    const key = providerKeys.get(source);
    if (key !== undefined) return [key];
    return source.runtime === 'claude-code' ||
      source.runtime === 'devin' ||
      source.runtime === 'antigravity'
      ? subscriptions[source.runtime]
      : [];
  };
  return {
    sources: orderByKeys(
      [
        ...(piSources.length > 0
          ? piSources.map(({ source }) => source)
          : [{ runtime: 'pi' as const, installed: true, hostname: hostname(), models: [] }]),
        ...listClaudeCodeSources(deps.db, teamId),
        ...listDevinSources(deps.db, teamId),
        ...listGeminiSources(deps.db, teamId),
        ...listAntigravitySources(deps.db, teamId),
      ],
      keysOf,
      readProviderOrder(deps.db, teamId),
    ),
  };
}

export function createProvider(
  deps: ProviderDeps,
  input: { teamId: string; body: ProviderBody; createdBy: string },
): ProviderRecord {
  const { body } = input;
  assertProviderIdFree(deps, input.teamId, body.providerId);
  const now = nowMs();
  const id = newRecordId();
  deps.db
    .insert(provider)
    .values({
      id,
      teamId: input.teamId,
      kind: 'custom',
      providerId: body.providerId,
      label: body.label,
      baseUrl: body.baseUrl,
      api: body.api,
      authHeader: body.authHeader ?? true,
      ...replaceProviderCredential(
        body.compat ?? { supportsDeveloperRole: false },
        body.apiKey ? deps.box.seal(body.apiKey) : null,
      ),
      models: body.models ?? [],
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = getRow(deps, input.teamId, id);
  if (!row) throw new Error('provider missing after insert');
  return toProviderRecord(row);
}

function renamedModelKey(model: string, from: string, to: string): string | null {
  const prefix = `${from}/`;
  return model.startsWith(prefix) ? `${to}/${model.slice(prefix.length)}` : null;
}

function sumCost(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

function renameTokenUsageKeys(db: Db, scopeIds: readonly string[], from: string, to: string): void {
  if (scopeIds.length === 0) return;
  const rows = db
    .select()
    .from(tokenUsage)
    .where(inArray(tokenUsage.buildId, [...scopeIds]))
    .all()
    .filter((row) => renamedModelKey(row.model, from, to) !== null);
  for (const row of rows) {
    const model = renamedModelKey(row.model, from, to);
    if (model === null) continue;
    const existing = db
      .select()
      .from(tokenUsage)
      .where(and(eq(tokenUsage.buildId, row.buildId), eq(tokenUsage.model, model)))
      .get();
    if (existing === undefined) {
      db.update(tokenUsage)
        .set({ model })
        .where(and(eq(tokenUsage.buildId, row.buildId), eq(tokenUsage.model, row.model)))
        .run();
      continue;
    }
    db.update(tokenUsage)
      .set({
        input: existing.input + row.input,
        output: existing.output + row.output,
        cacheRead: existing.cacheRead + row.cacheRead,
        cacheWrite: existing.cacheWrite + row.cacheWrite,
        costInput: sumCost(existing.costInput, row.costInput),
        costOutput: sumCost(existing.costOutput, row.costOutput),
        costCacheRead: sumCost(existing.costCacheRead, row.costCacheRead),
        costCacheWrite: sumCost(existing.costCacheWrite, row.costCacheWrite),
        costTotal: sumCost(existing.costTotal, row.costTotal),
      })
      .where(and(eq(tokenUsage.buildId, row.buildId), eq(tokenUsage.model, model)))
      .run();
    db.delete(tokenUsage)
      .where(and(eq(tokenUsage.buildId, row.buildId), eq(tokenUsage.model, row.model)))
      .run();
  }
}

function renameStepUsageKeys(db: Db, stepIds: readonly string[], from: string, to: string): void {
  if (stepIds.length === 0) return;
  const rows = db
    .select()
    .from(stepUsage)
    .where(inArray(stepUsage.stepId, [...stepIds]))
    .all()
    .filter((row) => renamedModelKey(row.model, from, to) !== null);
  for (const row of rows) {
    const model = renamedModelKey(row.model, from, to);
    if (model === null) continue;
    const existing = db
      .select()
      .from(stepUsage)
      .where(and(eq(stepUsage.stepId, row.stepId), eq(stepUsage.model, model)))
      .get();
    if (existing === undefined) {
      db.update(stepUsage)
        .set({ model })
        .where(and(eq(stepUsage.stepId, row.stepId), eq(stepUsage.model, row.model)))
        .run();
      continue;
    }
    db.update(stepUsage)
      .set({
        input: existing.input + row.input,
        output: existing.output + row.output,
        cacheRead: existing.cacheRead + row.cacheRead,
        cacheWrite: existing.cacheWrite + row.cacheWrite,
        cacheWrite1h: existing.cacheWrite1h + row.cacheWrite1h,
        mirroredTokens: existing.mirroredTokens + row.mirroredTokens,
        contextTokens: existing.contextTokens ?? row.contextTokens,
        contextWindow: existing.contextWindow ?? row.contextWindow,
        compactAt: existing.compactAt ?? row.compactAt,
      })
      .where(and(eq(stepUsage.stepId, row.stepId), eq(stepUsage.model, model)))
      .run();
    db.delete(stepUsage)
      .where(and(eq(stepUsage.stepId, row.stepId), eq(stepUsage.model, row.model)))
      .run();
  }
}

function renameChiefTurnUsageKeys(
  db: Db,
  stepIds: readonly string[],
  from: string,
  to: string,
): void {
  if (stepIds.length === 0) return;
  const rows = db
    .select()
    .from(chiefTurnUsage)
    .where(inArray(chiefTurnUsage.stepId, [...stepIds]))
    .all()
    .filter((row) => renamedModelKey(row.model, from, to) !== null);
  for (const row of rows) {
    const model = renamedModelKey(row.model, from, to);
    if (model === null) continue;
    const existing = db
      .select()
      .from(chiefTurnUsage)
      .where(and(eq(chiefTurnUsage.stepId, row.stepId), eq(chiefTurnUsage.model, model)))
      .get();
    if (existing === undefined) {
      db.update(chiefTurnUsage)
        .set({ model })
        .where(and(eq(chiefTurnUsage.stepId, row.stepId), eq(chiefTurnUsage.model, row.model)))
        .run();
      continue;
    }
    db.update(chiefTurnUsage)
      .set({
        input: existing.input + row.input,
        output: existing.output + row.output,
        cacheRead: existing.cacheRead + row.cacheRead,
        cacheWrite: existing.cacheWrite + row.cacheWrite,
        cacheWrite1h: existing.cacheWrite1h + row.cacheWrite1h,
        ttftMs: existing.ttftMs ?? row.ttftMs,
        contextTokens: existing.contextTokens ?? row.contextTokens,
        contextWindow: existing.contextWindow ?? row.contextWindow,
        compactAt: existing.compactAt ?? row.compactAt,
      })
      .where(and(eq(chiefTurnUsage.stepId, row.stepId), eq(chiefTurnUsage.model, model)))
      .run();
    db.delete(chiefTurnUsage)
      .where(and(eq(chiefTurnUsage.stepId, row.stepId), eq(chiefTurnUsage.model, row.model)))
      .run();
  }
}

function renameProviderReferences(db: Db, teamId: string, from: string, to: string): void {
  for (const rule of db.select().from(routingRule).where(eq(routingRule.teamId, teamId)).all()) {
    const fallbackModels = rule.fallbackModels?.map((m) =>
      m.provider === from ? { ...m, provider: to } : m,
    );
    const fallbackChanged = rule.fallbackModels?.some((m) => m.provider === from) ?? false;
    if (rule.provider === from || fallbackChanged) {
      db.update(routingRule)
        .set({
          ...(rule.provider === from ? { provider: to } : {}),
          ...(fallbackChanged ? { fallbackModels: fallbackModels ?? null } : {}),
          updatedAt: nowMs(),
        })
        .where(eq(routingRule.id, rule.id))
        .run();
    }
  }

  for (const row of db
    .select({ id: project.id, modelOverrides: project.modelOverrides })
    .from(project)
    .where(eq(project.teamId, teamId))
    .all()) {
    const overrides = row.modelOverrides;
    if (overrides === null || overrides === undefined) continue;
    const coordinator =
      overrides.coordinator?.provider === from
        ? { ...overrides.coordinator, provider: to }
        : overrides.coordinator;
    if (coordinator === overrides.coordinator) continue;
    db.update(project)
      .set({ modelOverrides: { ...overrides, coordinator } })
      .where(eq(project.id, row.id))
      .run();
  }

  db.update(stepRoute)
    .set({ provider: to })
    .where(and(eq(stepRoute.teamId, teamId), eq(stepRoute.provider, from)))
    .run();

  const scopeIds = [
    ...db
      .select({ id: build.id })
      .from(build)
      .innerJoin(todo, eq(build.todoId, todo.id))
      .where(eq(todo.teamId, teamId))
      .all(),
    ...db
      .select({ id: chiefThread.id })
      .from(chiefThread)
      .where(eq(chiefThread.teamId, teamId))
      .all(),
  ].map((row) => row.id);
  if (scopeIds.length > 0) {
    const steps = db
      .select({ id: step.id, fallback: step.fallback, quotaBlock: step.quotaBlock })
      .from(step)
      .where(inArray(step.buildId, scopeIds))
      .all();
    for (const row of steps) {
      const stored = row.fallback;
      let fallback: typeof stored | undefined;
      if (stored !== null && stored !== undefined) {
        const model =
          stored.model?.provider === from
            ? { provider: to, modelId: stored.model.modelId }
            : stored.model;
        const tried = stored.tried.map((key) => renamedModelKey(key, from, to) ?? key);
        if (model !== stored.model || tried.some((key, i) => key !== stored.tried[i])) {
          fallback = { ...stored, model, tried };
        }
      }
      const quotaBlock =
        row.quotaBlock !== null && row.quotaBlock.providerId === from
          ? { ...row.quotaBlock, providerId: to }
          : undefined;
      if (fallback === undefined && quotaBlock === undefined) continue;
      db.update(step)
        .set({
          ...(fallback !== undefined ? { fallback } : {}),
          ...(quotaBlock !== undefined ? { quotaBlock } : {}),
        })
        .where(eq(step.id, row.id))
        .run();
    }

    renameTokenUsageKeys(db, scopeIds, from, to);
    const stepIds = steps.map((row) => row.id);
    renameStepUsageKeys(db, stepIds, from, to);
    renameChiefTurnUsageKeys(db, stepIds, from, to);
  }

  const topModelsRow = db
    .select({ models: teamTopModels.models })
    .from(teamTopModels)
    .where(eq(teamTopModels.teamId, teamId))
    .get();
  if (topModelsRow !== undefined) {
    const parsed = topModelsSchema.safeParse(JSON.parse(topModelsRow.models));
    if (parsed.success && parsed.data.some((m) => m.provider === from)) {
      db.update(teamTopModels)
        .set({
          models: JSON.stringify(
            parsed.data.map((m) => (m.provider === from ? { ...m, provider: to } : m)),
          ),
        })
        .where(eq(teamTopModels.teamId, teamId))
        .run();
    }
  }
}

export function updateProvider(
  deps: ProviderDeps,
  teamId: string,
  id: string,
  patch: Partial<ProviderBody>,
): ProviderRecord {
  const row = getRow(deps, teamId, id);
  if (!row) throw notFound(`provider ${id}`);
  const renameTo =
    patch.providerId !== undefined && patch.providerId !== row.providerId ? patch.providerId : null;
  if (renameTo !== null) assertProviderIdFree(deps, teamId, renameTo, id);
  deps.db.transaction(() => {
    deps.db
      .update(provider)
      .set({
        ...(patch.providerId !== undefined ? { providerId: patch.providerId } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
        ...(patch.api !== undefined ? { api: patch.api } : {}),
        ...(patch.authHeader !== undefined ? { authHeader: patch.authHeader } : {}),
        ...(patch.models !== undefined ? { models: patch.models } : {}),
        ...(patch.apiKey !== undefined
          ? replaceProviderCredential(
              patch.compat ?? row.compat,
              patch.apiKey === null ? null : deps.box.seal(patch.apiKey),
            )
          : patch.compat === undefined
            ? {}
            : { compat: withProviderCredentialId(patch.compat, providerCredentialId(row)) }),
        updatedAt: nextProviderVersion(),
      })
      .where(eq(provider.id, id))
      .run();
    if (renameTo !== null) renameProviderReferences(deps.db, teamId, row.providerId, renameTo);
  });
  const updated = getRow(deps, teamId, id);
  if (!updated) throw new Error('provider missing after update');
  return toProviderRecord(updated);
}

export function markProviderModelTextOnly(
  deps: ProviderDeps,
  teamId: string,
  providerId: string,
  modelId: string,
): void {
  const row = deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  if (!row?.models.some((m) => m.id === modelId)) return;
  deps.db
    .update(provider)
    .set({
      models: row.models.map((m) => (m.id === modelId ? { ...m, input: ['text' as const] } : m)),
      updatedAt: nextProviderVersion(),
    })
    .where(eq(provider.id, row.id))
    .run();
}

export function deleteProvider(deps: ProviderDeps, teamId: string, id: string): boolean {
  const row = getRow(deps, teamId, id);
  if (!row) return false;
  deps.db.delete(provider).where(eq(provider.id, id)).run();
  return true;
}

export function openProviderKey(
  deps: ProviderDeps,
  teamId: string,
  providerId: string,
): { row: ProviderRow; apiKey: string | null } | null {
  const row = deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  if (!row) return null;
  return {
    row: { ...row, compat: publicProviderCompat(row.compat) },
    apiKey: row.apiKeyCipher === null ? null : deps.box.open(row.apiKeyCipher),
  };
}
