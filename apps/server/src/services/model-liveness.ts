import type { ModelSourceModel, SecretBox } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { provider } from '../db/schema.js';

interface CachedModel {
  at: number;
  liveness: 'alive' | 'dead' | 'unknown';
}

interface ProviderLivenessCache {
  fetchedAt: number;
  models: Map<string, CachedModel>;
}

const catalogCache = new Map<string, ProviderLivenessCache>();
const minProbeCache = new Map<string, CachedModel>();

export const CATALOG_CACHE_TTL_MS = 60_000;
const MIN_PROBE_TTL_MS = 10 * 60_000;
const DEAD_TTL_MS = MIN_PROBE_TTL_MS;

export async function refreshRelayCatalog(
  deps: {
    db: Db;
    box: SecretBox;
  },
  teamId: string,
  providerId: string,
): Promise<void> {
  let apiKey: string | null = null;
  try {
    const { openProviderKey } = await import('./providers.js');
    const result = openProviderKey(deps, teamId, providerId);
    apiKey = result?.apiKey ?? null;
  } catch {
    return;
  }
  if (apiKey === null) return;

  const providerRow = deps.db
    .select({ baseUrl: provider.baseUrl })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();

  const baseUrl = providerRow?.baseUrl;
  if (!baseUrl) return;

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;
    const raw = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };

    const models = new Map<string, CachedModel>();
    const now = Date.now();
    for (const item of raw.data ?? []) {
      if (typeof item.id === 'string' && item.id !== '') {
        const prev = catalogCache.get(providerId)?.models.get(item.id);
        if (prev?.liveness === 'dead' && now - prev.at < DEAD_TTL_MS) {
          models.set(item.id, prev);
        } else {
          models.set(item.id, { at: now, liveness: 'alive' });
        }
      }
    }
    catalogCache.set(providerId, { fetchedAt: now, models });
  } catch {}
}

export function markModelDead(providerId: string, modelId: string): void {
  const now = Date.now();
  const cached = catalogCache.get(providerId);
  if (cached !== undefined) {
    cached.models.set(modelId, { at: now, liveness: 'dead' });
  }
  minProbeCache.set(`${providerId}/${modelId}`, { at: now, liveness: 'dead' });
}

export function getModelLiveness(
  providerId: string,
  modelId: string,
): 'alive' | 'dead' | 'unknown' {
  const cacheKey = `${providerId}/${modelId}`;
  const mpCached = minProbeCache.get(cacheKey);
  if (mpCached !== undefined && Date.now() - mpCached.at < MIN_PROBE_TTL_MS) {
    if (mpCached.liveness === 'dead' && Date.now() - mpCached.at >= DEAD_TTL_MS) {
      return 'unknown';
    }
    return mpCached.liveness;
  }
  const catCached = catalogCache.get(providerId)?.models.get(modelId);
  if (catCached === undefined) return 'unknown';
  if (catCached.liveness === 'dead' && Date.now() - catCached.at >= DEAD_TTL_MS) {
    return 'unknown';
  }
  return catCached.liveness;
}

export function mergedCatalogModels(): ModelSourceModel[] {
  const merged = new Map<
    string,
    { id: string; name: string; liveness: 'alive' | 'dead' | 'unknown' }
  >();
  const now = Date.now();
  for (const [_providerId, cache] of catalogCache) {
    if (now - cache.fetchedAt >= CATALOG_CACHE_TTL_MS) continue;
    for (const [id, entry] of cache.models) {
      let liveness: 'alive' | 'dead' | 'unknown' = entry.liveness;
      if (liveness === 'dead' && now - entry.at >= DEAD_TTL_MS) liveness = 'unknown';
      const existing = merged.get(id);
      if (existing === undefined) {
        merged.set(id, { id, name: id, liveness });
      } else if (liveness === 'dead' && existing.liveness !== 'dead') {
        existing.liveness = 'dead';
      }
    }
  }
  return [...merged.values()];
}

export async function refreshAllRelayCatalogs(
  deps: { db: Db; box: SecretBox },
  teamId: string,
): Promise<void> {
  const providers = deps.db
    .select({ providerId: provider.providerId })
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .all();
  await Promise.allSettled(providers.map((p) => refreshRelayCatalog(deps, teamId, p.providerId)));
}
