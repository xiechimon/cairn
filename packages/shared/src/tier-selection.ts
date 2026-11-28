import { isInternalAntigravityModelId } from './antigravity-subscription.js';
import type { Difficulty } from './capability-routing.js';

export const BANNED_PREFIXES = [
  'gpt-5.6',
  'gpt-6-astra',
  'minimax-m3',
  'deepseek-v4-flash',
] as const;

export function isBannedModelId(modelId: string): boolean {
  return BANNED_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

export interface CatalogTierModel {
  id: string;
  name?: string;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinkingLevels?: readonly string[];
}

export interface SourceTiers {
  easy: string;
  standard: string;
  hard: string;
  ordered: readonly string[];
}

const UTILITY_MODEL_RE =
  /\b(?:embed|embedding|embeddings|tts|whisper|moderation|rerank|dall-e|imagen|audio|speech|transcribe|orchestrator)\b|^(?:auto|adaptive)$|\/auto(?:-|$)/i;

const NEGATIVE_2_TOKENS = new Set(['nano', 'micro', 'tiny', '1b', '3b', '4b', '7b', '8b', '9b']);
const NEGATIVE_1_TOKENS = new Set([
  'mini',
  'small',
  'flash',
  'fast',
  'haiku',
  'instant',
  'turbo',
  'air',
  'spark',
  'scout',
  'swift',
  'speed',
  'lite',
]);
const POSITIVE_1_TOKENS = new Set([
  'pro',
  'large',
  'heavy',
  'reasoner',
  'thinking',
  'deep',
  'max',
  'codex',
]);
const POSITIVE_2_TOKENS = new Set(['opus', 'fable', 'ultra', 'flagship', 'frontier']);
const THINKING_SUFFIX_TOKENS = new Set(['low', 'medium', 'high', 'xhigh', 'minimal']);
const PARAM_TOKEN_RE = /^a?\d+(?:\.\d+)?[bt]$/i;
const DATE_OR_TAG_RE = /^(?:20\d{6}|latest|preview)$/i;
const STANDALONE_VERSION_RE = /^\d+(?:\.\d+)*$/;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isUtilityOrMetaModel(id: string): boolean {
  return isInternalAntigravityModelId(id) || UTILITY_MODEL_RE.test(id);
}

export function tierFamilyKey(id: string): string {
  const tokens = id
    .toLowerCase()
    .split('-')
    .filter((token) => token !== '' && !DATE_OR_TAG_RE.test(token))
    .map((token) => {
      if (PARAM_TOKEN_RE.test(token)) return token;
      if (STANDALONE_VERSION_RE.test(token)) return '';
      return token.replace(/\d+(?:\.\d+)*/g, '#');
    })
    .filter((token) => token !== '' && token !== '#');
  return tokens.join('-') || id.toLowerCase();
}

function collapseNewestPerFamily(models: readonly CatalogTierModel[]): CatalogTierModel[] {
  const best = new Map<string, { index: number; model: CatalogTierModel }>();
  for (const [index, model] of models.entries()) {
    const key = tierFamilyKey(model.id);
    const current = best.get(key);
    if (
      current === undefined ||
      model.id.localeCompare(current.model.id, 'en', { numeric: true }) > 0
    ) {
      best.set(key, { index, model });
    }
  }
  const kept = new Set([...best.values()].map((entry) => entry.model.id));
  return models.filter((model) => kept.has(model.id));
}

function blendedCost(model: CatalogTierModel): number | null {
  if (model.cost === undefined) return null;
  return model.cost.input * 0.25 + model.cost.output * 0.75;
}

function classSignal(model: CatalogTierModel): number {
  const raw = `${model.id} ${model.name ?? ''}`.toLowerCase();
  const tokens = raw.split(/[^a-z0-9.]+/).filter(Boolean);
  let score = 0;
  for (const [idx, token] of tokens.entries()) {
    if (idx === tokens.length - 1 && THINKING_SUFFIX_TOKENS.has(token)) continue;
    if (NEGATIVE_2_TOKENS.has(token)) score -= 2;
    else if (NEGATIVE_1_TOKENS.has(token)) score -= 1;
    else if (POSITIVE_2_TOKENS.has(token)) score += 2;
    else if (POSITIVE_1_TOKENS.has(token)) score += 1;
  }
  return score;
}

function paramSignal(model: CatalogTierModel): number {
  const text = `${model.id} ${model.name ?? ''}`.toLowerCase();
  let maxBillions = 0;
  for (const match of text.matchAll(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)([tb])(?=$|[^a-z0-9])/g)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const billions = match[2] === 't' ? amount * 1000 : amount;
    if (billions > maxBillions) maxBillions = billions;
  }
  if (maxBillions <= 0) return 0;
  return clamp(Math.log10(maxBillions / 70), -1.5, 1.5);
}

function reasoningSignal(model: CatalogTierModel): number {
  const levels = model.thinkingLevels ?? [];
  if (levels.includes('xhigh') || levels.includes('max')) {
    return 0.7 + 0.05 * Math.min(levels.length, 6);
  }
  if (model.reasoning === true || levels.length > 0) return 0.3;
  return 0;
}

function contextSignal(model: CatalogTierModel): number {
  if (model.contextWindow === undefined) return 0;
  return clamp(Math.log2(model.contextWindow / 128_000) * 0.2, -0.3, 0.3);
}

function versionSignal(id: string): number {
  const match = /(\d+(?:\.\d+)?)/.exec(id);
  if (match === null) return 0;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? 0.02 * clamp(numeric, 0, 20) : 0;
}

function hasDifferentiatingSignal(models: readonly CatalogTierModel[]): boolean {
  const costs = models.map(blendedCost).filter((value): value is number => value !== null);
  if (costs.length >= 2 && new Set(costs).size > 1) return true;
  if (new Set(models.map(reasoningSignal)).size > 1) return true;
  if (new Set(models.map(paramSignal)).size > 1) return true;
  const contexts = models
    .map((model) => model.contextWindow)
    .filter((value): value is number => value !== undefined);
  if (contexts.length >= 2 && new Set(contexts).size > 1) return true;
  const classes = models.map(classSignal);
  return classes.some((value) => value !== 0) && new Set(classes).size > 1;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface ScoredModel {
  model: CatalogTierModel;
  index: number;
  cost: number | null;
  cls: number;
  param: number;
  reason: number;
  ctx: number;
  ver: number;
  primary: number;
}

function scoreCandidates(candidates: readonly CatalogTierModel[]): ScoredModel[] {
  const priced = candidates
    .map((model) => blendedCost(model))
    .filter((value): value is number => value !== null);
  const usePricePrimary = priced.length >= Math.ceil(candidates.length * 0.8) && priced.length >= 2;
  const positiveLogs = priced.filter((value) => value > 0).map((value) => Math.log10(value));
  const minPositiveLog = positiveLogs.length > 0 ? Math.min(...positiveLogs) : -4;
  const medianLog = positiveLogs.length > 0 ? median(positiveLogs) : 0;

  return candidates
    .map((model, index): ScoredModel => {
      const cost = blendedCost(model);
      const cls = classSignal(model);
      const param = paramSignal(model);
      const reason = reasoningSignal(model);
      const ctx = contextSignal(model);
      const ver = versionSignal(model.id);
      let primary: number;
      if (usePricePrimary) {
        if (cost === null) {
          primary = medianLog + cls * 0.4 + reason * 0.3;
        } else if (cost === 0) {
          primary = minPositiveLog - 1 + cls * 0.1;
        } else {
          primary = Math.log10(cost);
        }
      } else {
        const priceHint =
          cost === null ? 0 : cost === 0 ? -1 : clamp(Math.log10(cost / 3), -1.2, 1.2) * 0.6;
        primary = cls + param + reason + priceHint + ctx + ver;
      }
      return { model, index, cost, cls, param, reason, ctx, ver, primary };
    })
    .sort(
      (a, b) =>
        a.primary - b.primary ||
        a.reason - b.reason ||
        a.ctx - b.ctx ||
        a.ver - b.ver ||
        a.index - b.index,
    );
}

export function selectSourceTiers(
  models: readonly CatalogTierModel[],
  preferredDefaultId?: string | null,
): SourceTiers | null {
  const seen = new Set<string>();
  const unique = models.filter((model) => {
    if (model.id === '' || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
  const chat = unique.filter((model) => !isUtilityOrMetaModel(model.id));
  const allowed = chat.filter((model) => !isBannedModelId(model.id));
  if (allowed.length === 0) return null;

  let pool = collapseNewestPerFamily(allowed);
  if (pool.some((model) => (model.contextWindow ?? 0) >= 32_000)) {
    pool = pool.filter(
      (model) => model.contextWindow === undefined || model.contextWindow >= 32_000,
    );
  }
  if (pool.length > 6 && pool.some((model) => (blendedCost(model) ?? 0) > 0)) {
    pool = pool.filter((model) => {
      const cost = blendedCost(model);
      return cost === null || cost > 0;
    });
  }
  if (pool.length === 0) return null;

  if (pool.length === 1) {
    const sole = pool[0]!.id;
    return { easy: sole, standard: sole, hard: sole, ordered: [sole] };
  }

  if (!hasDifferentiatingSignal(pool)) {
    const fallbackId =
      preferredDefaultId != null && pool.some((model) => model.id === preferredDefaultId)
        ? preferredDefaultId
        : pool[0]!.id;
    return { easy: fallbackId, standard: fallbackId, hard: fallbackId, ordered: [fallbackId] };
  }

  const asc = scoreCandidates(pool);
  if (asc.length === 2) {
    const low = asc[0]!;
    const high = asc[1]!;
    const standard = low.cls < 0 ? high.model.id : low.model.id;
    return {
      easy: low.model.id,
      standard,
      hard: high.model.id,
      ordered: [low.model.id, high.model.id],
    };
  }

  const lowIdx = asc.length > 10 ? Math.floor(asc.length * 0.1) : 0;
  const highIdx =
    asc.length > 10 ? Math.min(asc.length - 1, Math.floor(asc.length * 0.9)) : asc.length - 1;
  const easy = asc[lowIdx]!;
  const hard = asc[highIdx]!;
  const middle = asc.slice(lowIdx + 1, highIdx);
  let standard = asc[Math.floor((lowIdx + highIdx) / 2)]!;
  if (
    easy.cost !== null &&
    easy.cost > 0 &&
    hard.cost !== null &&
    hard.cost > 0 &&
    middle.length > 0
  ) {
    const pricedMiddle = middle.filter((entry) => entry.cost !== null && entry.cost > 0);
    if (pricedMiddle.length > 0) {
      const targetLog = (Math.log10(easy.cost) + Math.log10(hard.cost)) / 2;
      standard = pricedMiddle.reduce((best, entry) =>
        Math.abs(Math.log10(entry.cost!) - targetLog) < Math.abs(Math.log10(best.cost!) - targetLog)
          ? entry
          : best,
      );
    }
  }
  return {
    easy: easy.model.id,
    standard: standard.model.id,
    hard: hard.model.id,
    ordered: asc.map((entry) => entry.model.id),
  };
}

export function tierFallbackOrder(tiers: SourceTiers, difficulty: Difficulty): string[] {
  const raw =
    difficulty === 'easy'
      ? [tiers.easy, tiers.standard, tiers.hard]
      : difficulty === 'standard'
        ? [tiers.standard, tiers.hard, tiers.easy]
        : [tiers.hard, tiers.standard, tiers.easy];
  return [...new Set(raw)];
}
