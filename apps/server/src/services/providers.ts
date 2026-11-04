import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  type ModelSource,
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
import type { Db } from '../db/client.js';
import { machine, provider } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { mergedCatalogModels } from './model-liveness.js';

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

const CLAUDE_MODEL_SLOT_PATTERN = /^ANTHROPIC_([A-Z0-9_]+)_MODEL$/;

export function claudeCodeModelSource(homeDir: string): ModelSource {
  const host = hostname();
  const notInstalled: ModelSource = {
    runtime: 'claude-code',
    installed: false,
    hostname: host,
    models: [],
  };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf8'));
  } catch {
    return notInstalled;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return notInstalled;
  const settings = raw as { model?: unknown; env?: unknown };
  const models: ModelSourceModel[] = [];
  if (typeof settings.model === 'string' && settings.model !== '') {
    models.push({ id: settings.model, name: settings.model, slot: 'default' });
  }
  const env = settings.env;
  if (typeof env === 'object' && env !== null && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env)) {
      const match = CLAUDE_MODEL_SLOT_PATTERN.exec(key);
      const slot = match?.[1];
      if (slot === undefined || typeof value !== 'string' || value === '') continue;
      models.push({ id: value, name: value, slot: slot.toLowerCase().replace(/_/g, '-') });
    }
  }
  return { runtime: 'claude-code', installed: true, hostname: host, models };
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
          ...(report.auth !== undefined ? { auth: report.auth } : {}),
        },
      ];
    });
}

export function getModelSources(deps: ProviderDeps, teamId: string): ModelSourcesEnvelope {
  const catalog = mergedCatalogModels();
  const catalogIds = new Set(catalog.map((m) => m.id));
  const piModels: ModelSourceModel[] = [...catalog];
  for (const p of listProviders(deps, teamId)) {
    for (const m of p.models) {
      if (m.id === '' || catalogIds.has(m.id)) continue;
      piModels.push({
        id: m.id,
        name: m.name !== '' ? m.name : m.id,
        liveness: 'unknown',
      });
    }
  }
  return {
    sources: [
      { runtime: 'pi', installed: true, hostname: hostname(), models: piModels },
      ...listClaudeCodeSources(deps.db, teamId),
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
