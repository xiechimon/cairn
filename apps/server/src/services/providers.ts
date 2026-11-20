import { hostname } from 'node:os';
import {
  canonicalClaudeModels,
  claudeCodeThinkingDefault,
  claudeCodeThinkingLevels,
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_DEVIN_MODELS,
  type ModelSourceModel,
  type ModelSourcesEnvelope,
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
  build,
  chiefThread,
  chiefTurnUsage,
  machine,
  project,
  provider,
  routingRule,
  step,
  stepRoute,
  stepUsage,
  teamTopModels,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  enabledAntigravitySubscriptionModels,
  hasActiveAntigravitySubscription,
} from './antigravity-subscriptions.js';
import { enabledClaudeSubscriptionModels } from './claude-subscriptions.js';
import {
  enabledDevinSubscriptionModels,
  hasActiveDevinSubscription,
} from './devin-subscriptions.js';
import { getModelLiveness } from './model-liveness.js';

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
    compat: row.compat,
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
): { presets: ProviderPreset[]; providers: ProviderRecord[] } {
  return { presets: providerPresets(), providers: listProviders(deps, teamId) };
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
          ).map((model) => ({
            ...model,
            ...asTask({
              levels: claudeCodeThinkingLevels(model.id),
              resolvesTo: claudeCodeThinkingDefault(model.id),
            }),
          })),
          ...(report.bin !== undefined ? { bin: report.bin } : {}),
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
  }));
}

export function listAntigravitySources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  const provisionable = hasActiveAntigravitySubscription({ db }, teamId);
  const machines = db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .filter((row) => {
      const antigravity = row.capabilities?.antigravity;
      return antigravity?.installed === true || (provisionable && antigravity !== undefined);
    });
  const reported = machines.flatMap((row) => row.capabilities?.antigravity?.models ?? []);
  const merged = withKnownThinkingLevels(
    uniqueModels([...enabledAntigravitySubscriptionModels({ db }, teamId), ...reported]),
    [...reported, ...DEFAULT_ANTIGRAVITY_MODELS],
  );
  const models: ModelSourceModel[] =
    merged.length > 0
      ? merged.map((model) => ({ ...model, slot: 'builtin' }))
      : [...DEFAULT_ANTIGRAVITY_MODELS];
  return machines.map((row) => ({
    runtime: 'antigravity' as const,
    installed: row.capabilities?.antigravity?.installed === true,
    hostname: row.name,
    machineId: row.id,
    models,
  }));
}

export function getModelSources(deps: ProviderDeps, teamId: string): ModelSourcesEnvelope {
  const piSources: ModelSourcesEnvelope['sources'] = listProviders(deps, teamId).map((p) => {
    const stored = p.models.filter((m) => m.id !== '');
    const models =
      stored.length > 0
        ? stored.map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id }))
        : [...builtinModelIds(p.providerId)].map((id) => ({ id, name: id }));
    return {
      runtime: 'pi' as const,
      provider: p.providerId,
      providerLabel: p.label,
      installed: true,
      hostname: hostname(),
      models: models.map((m) => ({
        ...m,
        liveness: getModelLiveness(teamId, p.providerId, m.id),
        ...asTask(piThinking(p.providerId, m.id)),
        ...asInServer(inServerThinking(p, m.id)),
      })),
    };
  });
  return {
    sources: [
      ...(piSources.length > 0
        ? piSources
        : [{ runtime: 'pi' as const, installed: true, hostname: hostname(), models: [] }]),
      ...listClaudeCodeSources(deps.db, teamId),
      ...listDevinSources(deps.db, teamId),
      ...listAntigravitySources(deps.db, teamId),
    ],
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
      compat: body.compat ?? { supportsDeveloperRole: false },
      models: body.models ?? [],
      apiKeyCipher: body.apiKey ? deps.box.seal(body.apiKey) : null,
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
        ...(patch.compat !== undefined ? { compat: patch.compat } : {}),
        ...(patch.models !== undefined ? { models: patch.models } : {}),
        ...(patch.apiKey !== undefined
          ? { apiKeyCipher: patch.apiKey === null ? null : deps.box.seal(patch.apiKey) }
          : {}),
        updatedAt: nowMs(),
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
      updatedAt: nowMs(),
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
  return { row, apiKey: row.apiKeyCipher === null ? null : deps.box.open(row.apiKeyCipher) };
}
