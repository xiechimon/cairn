// 模型活性探活服务（#1288）：server 侧直连 relay /v1/models 探活 +
// 运行时 404 回填 dead。密钥触达面 = openProviderKey（providers.ts 既有先例）。
//
// 三态：alive（目录在 + 未报死）/ dead（运行时 404 回填）/ unknown（未探过
// 或探活失败，fail-open 不置灰）。
//
// 架构决策（调研 r16 §3）：
// - 探活在 server 侧：relay 是 server 侧 custom provider 资产（apiKeyCipher
//   在 server），探测权在 server，不下沉 daemon（避免密钥暴露面扩大）。
// - 缓存 60s：对齐 Multica cachedDiscovery 60s（r13:154），presence 30s
//   节拍不必触发探活。
// - fail-open：探不到 = 标 unknown，绝不标 dead——死判定只靠运行时 404 回填。
// - /v1/models 列出 ≠ 可调通（上游下架未同步目录），死模型靠运行时 404 回填。
// - dead 标注带 TTL（10min）：过期后下次使用重探复活。
// - 指派时最小探活（max_tokens=1，5s 超时，失败重试一次再判死）：对真 relay
//   发最小 completion 验证模型可调通性。结果缓存 TTL 10min。

import type { ModelSourceModel, SecretBox } from '@pacman/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { provider } from '../db/schema.js';

// —— 缓存形态 ——————————————————————————————————————————————————————————————

interface CachedModel {
  at: number;
  liveness: 'alive' | 'dead' | 'unknown';
}

interface ProviderLivenessCache {
  fetchedAt: number;
  /** modelId → 活性 */
  models: Map<string, CachedModel>;
}

// —— 进程内存缓存 ——————————————————————————————————————————————————————————

const catalogCache = new Map<string, ProviderLivenessCache>();
const minProbeCache = new Map<string, CachedModel>();

/** 目录缓存 TTL（60s，对齐 Multica cachedDiscovery r13:154）。 */
export const CATALOG_CACHE_TTL_MS = 60_000;
const MIN_PROBE_TTL_MS = 10 * 60_000; // 10min
const DEAD_TTL_MS = MIN_PROBE_TTL_MS;
const MIN_PROBE_TIMEOUT_MS = 5_000;

// —— 公开 API ——————————————————————————————————————————————————————————————

/** 读缓存：取单 provider 的目录模型清单（带 liveness）。不触发网络请求——
 *  只读缓存，缓存为空则返回空清单（consumers 标 unknown，fail-open）。 */
export function getRelayCatalogModels(providerId: string): ModelSourceModel[] {
  const cached = catalogCache.get(providerId);
  if (cached === undefined) return [];
  const now = Date.now();
  if (now - cached.fetchedAt >= CATALOG_CACHE_TTL_MS) return [];
  const out: ModelSourceModel[] = [];
  for (const [id, entry] of cached.models) {
    let liveness: 'alive' | 'dead' | 'unknown' = entry.liveness;
    if (liveness === 'dead' && now - entry.at >= DEAD_TTL_MS) {
      liveness = 'unknown';
    }
    out.push({ id, name: id, liveness });
  }
  return out;
}

/** 异步刷新单 provider 的目录缓存：调用方 fire-and-forget（不阻塞 API 响应）。
 *  - fail-open：fetch 失败不清缓存，上次成功结果继续服刑至过期。
 *  - 密钥损坏/null provider → 不探。 */
export async function refreshRelayCatalog(
  deps: {
    db: Db;
    box: SecretBox;
  },
  teamId: string,
  providerId: string,
): Promise<void> {
  // 打开密钥：失败 = 不探（该 provider 可能没有 apiKey / SecretBox 损坏）
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
    if (!res.ok) return; // fail-open：不清缓存
    const raw = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };

    const models = new Map<string, CachedModel>();
    const now = Date.now();
    for (const item of raw.data ?? []) {
      if (typeof item.id === 'string' && item.id !== '') {
        // 保留旧缓存里的 dead 标注（运行时 404 回填比目录拉取更权威）
        const prev = catalogCache.get(providerId)?.models.get(item.id);
        if (prev?.liveness === 'dead' && now - prev.at < DEAD_TTL_MS) {
          models.set(item.id, prev);
        } else {
          models.set(item.id, { at: now, liveness: 'alive' });
        }
      }
    }
    catalogCache.set(providerId, { fetchedAt: now, models });
  } catch {
    // 网络错误 / 超时 → fail-open：不清缓存
  }
}

/** 运行时回填：step 撞 /v1/messages 404 → markModelDead。dead 标注带 TTL，
 *  过期后下次使用自动标 unknown（复活窗口）。幂等。 */
export function markModelDead(providerId: string, modelId: string): void {
  const now = Date.now();
  const cached = catalogCache.get(providerId);
  if (cached !== undefined) {
    cached.models.set(modelId, { at: now, liveness: 'dead' });
  }
  minProbeCache.set(`${providerId}/${modelId}`, { at: now, liveness: 'dead' });
}

/** 指派时最小探活：max_tokens=1 最小 completion（5s 超时、失败重试一次
 *  再判死）。结果缓存 TTL 10min。返回 'alive' | 'dead' | 'unknown'。
 *  调用前先查缓存——命中缓存时恒同步返回（不发请求）。 */
export async function minProbeModel(
  deps: {
    db: Db;
    box: SecretBox;
  },
  teamId: string,
  providerId: string,
  modelId: string,
): Promise<'alive' | 'dead' | 'unknown'> {
  const cacheKey = `${providerId}/${modelId}`;
  const cached = minProbeCache.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.at < MIN_PROBE_TTL_MS) {
    return cached.liveness === 'dead' && Date.now() - cached.at >= DEAD_TTL_MS
      ? 'unknown'
      : cached.liveness;
  }

  // 查 catalog 缓存
  const catCached = catalogCache.get(providerId)?.models.get(modelId);
  if (catCached?.liveness === 'dead' && Date.now() - catCached.at < DEAD_TTL_MS) {
    minProbeCache.set(cacheKey, catCached);
    return 'dead';
  }

  // 拿到密钥
  let apiKey: string | null = null;
  try {
    const { openProviderKey } = await import('./providers.js');
    const result = openProviderKey(deps, teamId, providerId);
    apiKey = result?.apiKey ?? null;
  } catch {
    return 'unknown';
  }
  if (apiKey === null) return 'unknown';

  const providerRow = deps.db
    .select({ baseUrl: provider.baseUrl })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();

  const baseUrl = providerRow?.baseUrl;
  if (!baseUrl) return 'unknown';

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(MIN_PROBE_TIMEOUT_MS),
      });

      if (!res.ok) {
        if (res.status === 404) {
          minProbeCache.set(cacheKey, { at: Date.now(), liveness: 'dead' });
          markModelDead(providerId, modelId);
          return 'dead';
        }
        if (attempt === 0) continue;
        return 'unknown';
      }

      minProbeCache.set(cacheKey, { at: Date.now(), liveness: 'alive' });
      return 'alive';
    } catch {
      if (attempt === 0) continue;
    }
  }

  minProbeCache.set(cacheKey, { at: Date.now(), liveness: 'unknown' });
  return 'unknown';
}

/** 取单模型的活性（纯读缓存，不触发网络）。 */
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

/** 合并目录（跨所有已探测 provider 的 /v1/models 结果，按 model id 合并，
 *  活性取严——任一 provider 标 dead 则 dead）。供闸与选值面消费。
 *  返回空数组 = 尚未探测任何 provider（缓存全冷）。 */
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
        // 活性取严：任一 provider 标 dead → dead
        existing.liveness = 'dead';
      }
    }
  }
  return [...merged.values()];
}

/** 异步刷新所有自定义 provider 的目录缓存。调用方 fire-and-forget。
 *  并发探测、各自 10s 超时、失败跳过不清缓存。 */
export async function refreshAllRelayCatalogs(
  deps: { db: Db; box: SecretBox },
  teamId: string,
): Promise<void> {
  // 收集所有 custom provider 的 providerId
  const providers = deps.db
    .select({ providerId: provider.providerId })
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .all();
  // 并发探测
  await Promise.allSettled(providers.map((p) => refreshRelayCatalog(deps, teamId, p.providerId)));
}
