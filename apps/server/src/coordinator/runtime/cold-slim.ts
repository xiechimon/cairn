import { ENV_VARS } from '@cairn/shared';
import type { ImageContent, Message, TextContent, ToolResultMessage } from '@earendil-works/pi-ai';

export const COLD_RECENT_EXCHANGES = 8;
export const TOOL_RESULT_KEEP_FULL = 3;
export const TOOL_RESULT_MAX_CHARS = 1024;
export const SHORT_RETENTION_MS = 5 * 60_000;
export const LONG_RETENTION_ANTHROPIC_MS = 60 * 60_000;
export const LONG_RETENTION_OPENAI_MS = 24 * 60 * 60_000;
export const COLD_CACHE_MISS_MIN_TOKENS = 4_000;

const TOOL_RESULT_EXEMPT = new Set(['read_history', 'search_history']);

export type CacheRetentionTier = 'short' | 'long';

export interface TurnUsageSnapshot {
  createdAt: number;
  cacheRead: number;
  input: number;
  contextTokens: number | null;
  model: string;
}

export function resolveCacheRetentionTier(
  env: NodeJS.ProcessEnv = process.env,
): CacheRetentionTier {
  return env[ENV_VARS.piCacheRetention] === 'long' ? 'long' : 'short';
}

export function retentionMsFor(
  tiers: CacheRetentionTier,
  model: string | null | undefined,
): number {
  if (tiers !== 'long') return SHORT_RETENTION_MS;
  const id = (model ?? '').toLowerCase();
  if (id.includes('anthropic') || id.startsWith('claude') || id.includes('/claude')) {
    return LONG_RETENTION_ANTHROPIC_MS;
  }
  return LONG_RETENTION_OPENAI_MS;
}

export function isColdResume(args: {
  now: number;
  lastUsage: TurnUsageSnapshot | null;
  retentionMs: number;
}): boolean {
  const { lastUsage, now, retentionMs } = args;
  if (lastUsage === null) return false;
  if (now - lastUsage.createdAt >= retentionMs) return true;
  const size = lastUsage.contextTokens ?? lastUsage.input;
  return lastUsage.cacheRead === 0 && size >= COLD_CACHE_MISS_MIN_TOKENS;
}

function toolResultText(message: ToolResultMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

function withToolResultText(message: ToolResultMessage, text: string): ToolResultMessage {
  const rest = message.content.filter((block) => block.type !== 'text');
  return {
    ...message,
    content: [{ type: 'text', text }, ...rest],
  };
}

export function truncateOldToolResults(
  messages: readonly Message[],
  options?: { keepFull?: number; maxChars?: number },
): Message[] {
  const keepFull = options?.keepFull ?? TOOL_RESULT_KEEP_FULL;
  const maxChars = options?.maxChars ?? TOOL_RESULT_MAX_CHARS;
  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'toolResult') toolIndexes.push(i);
  }
  const keep = new Set(toolIndexes.slice(-keepFull));
  return messages.map((message, index) => {
    if (message.role !== 'toolResult' || keep.has(index)) return message;
    if (TOOL_RESULT_EXEMPT.has(message.toolName)) return message;
    const text = toolResultText(message);
    if (text.length <= maxChars) return message;
    return withToolResultText(
      message,
      `${text.slice(0, maxChars)}\n[read; shortened from ${text.length} characters]`,
    );
  });
}

function omitImageBlocks(
  content: readonly (TextContent | ImageContent)[],
  note: string,
): (TextContent | ImageContent)[] | null {
  let replaced = false;
  const next = content.map((block) => {
    if (block.type !== 'image') return block;
    replaced = true;
    return { type: 'text' as const, text: note };
  });
  return replaced ? next : null;
}

export function stripConsumedImages(
  messages: readonly Message[],
  options?: { keepRecentMessages?: number },
): Message[] {
  const keepRecent = options?.keepRecentMessages ?? 1;
  const cutoff = Math.max(0, messages.length - keepRecent);
  const note = '[Image omitted after use; reopen via attachment id / read_history if needed.]';
  return messages.map((message, index) => {
    if (index >= cutoff) return message;
    if (message.role === 'user' && typeof message.content !== 'string') {
      const content = omitImageBlocks(message.content, note);
      return content === null ? message : { ...message, content };
    }
    if (message.role === 'toolResult') {
      const content = omitImageBlocks(message.content, note);
      return content === null ? message : { ...message, content };
    }
    return message;
  });
}

function isWakeOnlyUser(message: Message): boolean {
  if (message.role !== 'user') return false;
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
  const trimmed = text.trim();
  return /^\[wake:/i.test(trimmed) || /^wake:/i.test(trimmed);
}

function isSummaryUser(message: Message): boolean {
  if (message.role !== 'user') return false;
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
  return text.includes('<summary>') && text.includes('compacted');
}

export function selectColdMessageWindow(
  messages: readonly Message[],
  recentExchanges = COLD_RECENT_EXCHANGES,
): Message[] {
  const system = messages.filter((message) => message.role === 'system');
  const summaries = messages.filter(isSummaryUser);
  const body = messages.filter((message) => message.role !== 'system' && !isSummaryUser(message));
  const kept: Message[] = [];
  let exchanges = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const message = body[i];
    if (message === undefined) continue;
    if (message.role === 'user' && isWakeOnlyUser(message)) continue;
    kept.push(message);
    if (message.role === 'user') {
      exchanges += 1;
      if (exchanges >= recentExchanges) {
        for (let j = i - 1; j >= 0; j--) {
          const prior = body[j];
          if (prior?.role === 'toolResult') kept.push(prior);
          else break;
        }
        break;
      }
    }
  }
  kept.reverse();
  while (kept[0]?.role === 'toolResult') kept.shift();
  return [...system, ...summaries.slice(-1), ...kept];
}

export function injectSummaryHint(messages: readonly Message[], summary: string): Message[] {
  const text = summary.trim();
  if (text === '') return [...messages];
  if (messages.some(isSummaryUser)) return [...messages];
  const hint: Message = {
    role: 'user',
    content: `Earlier turns were compacted into the following summary:\n\n<summary>\n${text}\n</summary>\n\nOlder detail is in the summary, todos, and read_history.`,
    timestamp: Date.now(),
  };
  const firstNonSystem = messages.findIndex((message) => message.role !== 'system');
  if (firstNonSystem < 0) return [...messages, hint];
  return [...messages.slice(0, firstNonSystem), hint, ...messages.slice(firstNonSystem)];
}

export function projectColdMessages(
  messages: readonly Message[],
  options?: { summaryHint?: string | null; recentExchanges?: number },
): Message[] {
  const windowed = selectColdMessageWindow(messages, options?.recentExchanges);
  const withSummary = injectSummaryHint(windowed, options?.summaryHint ?? '');
  return stripConsumedImages(truncateOldToolResults(withSummary), { keepRecentMessages: 1 });
}

export function projectWarmMessages(messages: readonly Message[]): Message[] {
  return stripConsumedImages(truncateOldToolResults(messages), { keepRecentMessages: 2 });
}
