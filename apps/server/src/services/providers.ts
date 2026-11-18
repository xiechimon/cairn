import { hostname } from 'node:os';
import {
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
} from '@cairn/shared';
import { and, asc, eq } from 'drizzle-orm';
import { builtinModelIds } from '../coordinator/runtime/provider.js';
import type { Db } from '../db/client.js';
import { machine, provider } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { enabledDevinSubscriptionModels } from './devin-subscriptions.js';
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
          models: report.models,
          ...(report.bin !== undefined ? { bin: report.bin } : {}),
        },
      ];
    });
}

export function listDevinSources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  const machines = db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .filter((row) => row.online && row.capabilities?.devin?.installed === true);
  const seen = new Set<string>();
  const merged = [
    ...enabledDevinSubscriptionModels({ db }, teamId),
    ...machines.flatMap((row) => row.capabilities?.devin?.models ?? []),
  ].filter((model) => {
    if (model.id === '' || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
  const models: ModelSourceModel[] = merged.length > 0 ? merged : [...DEFAULT_DEVIN_MODELS];
  return machines.map((row) => ({
    runtime: 'devin' as const,
    installed: true,
    hostname: row.name,
    machineId: row.id,
    models: models.map((model) => ({ ...model })),
  }));
}

export function listAntigravitySources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .flatMap((row) => {
      const report = row.capabilities?.antigravity;
      if (!row.online || report?.installed !== true) return [];
      const models =
        report.models !== undefined && report.models.length > 0
          ? report.models.map((m) => ({ id: m.id, name: m.name, slot: 'builtin' }))
          : [...DEFAULT_ANTIGRAVITY_MODELS];
      return [
        {
          runtime: 'antigravity' as const,
          installed: true,
          hostname: row.name,
          machineId: row.id,
          models,
        },
      ];
    });
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
      models: models.map((m) => ({ ...m, liveness: getModelLiveness(p.providerId, m.id) })),
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

export function updateProvider(
  deps: ProviderDeps,
  teamId: string,
  id: string,
  patch: Partial<ProviderBody>,
): ProviderRecord {
  const row = getRow(deps, teamId, id);
  if (!row) throw notFound(`provider ${id}`);
  if (patch.providerId !== undefined && patch.providerId !== row.providerId) {
    assertProviderIdFree(deps, teamId, patch.providerId, id);
  }
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
