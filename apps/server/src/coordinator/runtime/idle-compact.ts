import { compactionWindow } from './compaction.js';

/** How close to its prompt-cache expiry a conversation still gets compacted while the cache is warm. */
export const CACHE_EXPIRY_LEAD_MS = 90_000;
/** Below this summarized history no automatic compaction is worth its summary request. */
export const MIN_IDLE_COMPACT_TOKENS = 32_768;
export const IDLE_COMPACT_TIMEOUT_MS = 3 * 60_000;
const SUMMARY_ROOM_TOKENS = 16_384;

export type CompactionTrigger = 'idle' | 'cache-expiry';

export interface IdleCompactFacts {
  now: number;
  idleAfterMs: number;
  lastActivityAt: number | null;
  contextTokens: number | null;
  contextWindow: number;
  warm: boolean;
  cacheExpiresAt: number | null;
}

/**
 * Prompt tokens a conversation may carry and still compact while nobody waits: half of the point
 * the turn path would compact at, never below the reserve that keeps a summary useful. A window
 * too small for that reserve never idle-compacts, because the turn path clears it first anyway.
 */
export function idleCompactAt(contextWindow: number): number {
  const { backgroundAt } = compactionWindow(contextWindow);
  return Math.max(MIN_IDLE_COMPACT_TOKENS, Math.floor(backgroundAt / 2));
}

/** A prompt cache belongs to one provider/model pair, so a summary elsewhere reads none of it. */
export function reusesPromptCache(summaryModel: string, lastTurnModel: string): boolean {
  return summaryModel === lastTurnModel;
}

export function compactionTrigger(facts: IdleCompactFacts): CompactionTrigger | null {
  const tokens = facts.contextTokens;
  if (tokens === null || tokens <= 0) return null;
  if (tokens < idleCompactAt(facts.contextWindow)) return null;
  if (facts.lastActivityAt !== null && facts.now - facts.lastActivityAt >= facts.idleAfterMs) {
    return 'idle';
  }
  if (facts.warm && facts.cacheExpiresAt !== null) {
    const left = facts.cacheExpiresAt - facts.now;
    if (left > 0 && left <= CACHE_EXPIRY_LEAD_MS) return 'cache-expiry';
  }
  return null;
}

/** The output budget of a summary of `tokens` prompt tokens on a model of `contextWindow`. */
export function summaryOutputBudget(
  tokens: number,
  contextWindow: number,
  maxTokens: number,
): number | null {
  const room = contextWindow - SUMMARY_ROOM_TOKENS - tokens;
  if (room <= 0) return null;
  return Math.max(1_024, Math.min(maxTokens > 0 ? maxTokens : room, room));
}
