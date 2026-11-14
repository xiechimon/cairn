import { ENV_VARS, parseAttachmentTokenLines } from '@cairn/shared';
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
} from '@earendil-works/pi-ai';

export const COLD_RECENT_EXCHANGES = 8;
export const TOOL_RESULT_KEEP_FULL = 3;
export const TOOL_RESULT_MAX_CHARS = 1024;
export const SHORT_RETENTION_MS = 5 * 60_000;
export const LONG_RETENTION_ANTHROPIC_MS = 60 * 60_000;
export const LONG_RETENTION_OPENAI_MS = 24 * 60 * 60_000;

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

export type ContextResume = 'warm' | 'cold' | 'compacted' | 'idle';

export function contextResumeOf(args: {
  now: number;
  retentionMs: number;
  lastUsage: TurnUsageSnapshot | null;
  lastColdSlimAt: number | null;
  lastColdSlimStepId?: string | null;
  lastUsageStepId?: string | null;
  activeModel?: string | null;
}): ContextResume {
  if (args.lastUsage === null) return 'idle';
  const slimRecent =
    args.lastColdSlimAt !== null &&
    args.now - args.lastColdSlimAt >= 0 &&
    args.now - args.lastColdSlimAt < args.retentionMs;
  const slimStep = args.lastColdSlimStepId;
  const usageStep = args.lastUsageStepId;
  const slimOwnsLatest =
    slimStep !== undefined &&
    slimStep !== null &&
    slimStep !== '' &&
    usageStep !== undefined &&
    usageStep !== null &&
    usageStep !== ''
      ? slimStep === usageStep
      : args.lastColdSlimAt !== null && args.lastColdSlimAt >= args.lastUsage.createdAt;
  const active = args.activeModel?.trim() ?? '';
  const modelMatches = active === '' || args.lastUsage.model === active;
  if (slimRecent && slimOwnsLatest && modelMatches) return 'compacted';
  if (
    isColdResume({
      lastUsage: args.lastUsage,
      activeModel: args.activeModel,
    })
  ) {
    return 'cold';
  }
  return 'warm';
}

export function resumeExpiresAtOf(args: {
  resume: ContextResume;
  retentionMs: number;
  lastUsageCreatedAt: number;
  lastColdSlimAt: number | null;
}): number | null {
  if (args.resume === 'warm') return args.lastUsageCreatedAt + args.retentionMs;
  if (args.resume === 'compacted' && args.lastColdSlimAt !== null) {
    return args.lastColdSlimAt + args.retentionMs;
  }
  return null;
}

export function isColdResume(args: {
  lastUsage: TurnUsageSnapshot | null;
  activeModel?: string | null;
}): boolean {
  if (args.lastUsage === null) return false;
  const active = args.activeModel?.trim() ?? '';
  return active !== '' && args.lastUsage.model !== active;
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

export function imageOmissionNote(attachmentId: string | null, attachmentKey?: string): string {
  if (attachmentId !== null && attachmentId !== '') {
    const key =
      attachmentKey === undefined || attachmentKey === '' ? '' : ` (attachment:${attachmentKey})`;
    return `[Image omitted after use; attachmentId ${attachmentId}${key}. Use the attachment tool or read_history to reopen.]`;
  }
  return '[Image omitted after use; no attachmentId in this message. Use read_history if needed.]';
}

function attachmentRefsFromContent(content: readonly (TextContent | ImageContent)[]): {
  attachmentId: string;
  key: string;
}[] {
  const refs: { attachmentId: string; key: string }[] = [];
  for (const block of content) {
    if (block.type !== 'text') continue;
    for (const ref of parseAttachmentTokenLines(block.text)) {
      refs.push({ attachmentId: ref.attachmentId, key: ref.key });
    }
  }
  return refs;
}

function idFromImageBlock(block: ImageContent): { attachmentId: string; key?: string } | null {
  const extra = block as ImageContent & {
    attachmentId?: unknown;
    id?: unknown;
    url?: unknown;
  };
  if (typeof extra.attachmentId === 'string' && extra.attachmentId !== '') {
    return { attachmentId: extra.attachmentId };
  }
  if (typeof extra.id === 'string' && extra.id !== '') {
    return { attachmentId: extra.id };
  }
  if (typeof extra.url === 'string' && extra.url !== '') {
    const base = extra.url.split(/[\\/]/).at(-1)?.split('?')[0] ?? '';
    if (base !== '') return { attachmentId: base };
  }
  return null;
}

function omitImageBlocks(
  content: readonly (TextContent | ImageContent)[],
): (TextContent | ImageContent)[] | null {
  const refs = attachmentRefsFromContent(content);
  let refIndex = 0;
  let replaced = false;
  const next = content.map((block) => {
    if (block.type !== 'image') return block;
    replaced = true;
    const fromBlock = idFromImageBlock(block);
    const ref = refs[refIndex++];
    const attachmentId = fromBlock?.attachmentId ?? ref?.attachmentId ?? null;
    const key = fromBlock?.key ?? ref?.key;
    return {
      type: 'text' as const,
      text: imageOmissionNote(attachmentId, key),
    };
  });
  return replaced ? next : null;
}

export function stripConsumedImages(
  messages: readonly Message[],
  options?: { keepRecentMessages?: number },
): Message[] {
  const keepRecent = options?.keepRecentMessages ?? 1;
  const cutoff = Math.max(0, messages.length - keepRecent);
  return messages.map((message, index) => {
    if (index >= cutoff) return message;
    if (message.role === 'user' && typeof message.content !== 'string') {
      const content = omitImageBlocks(message.content);
      return content === null ? message : { ...message, content };
    }
    if (message.role === 'toolResult') {
      const content = omitImageBlocks(message.content);
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

export function isPureToolCallAssistant(message: Message): boolean {
  if (message.role !== 'assistant') return false;
  const assistant = message as AssistantMessage;
  if (!Array.isArray(assistant.content) || assistant.content.length === 0) return false;
  let sawTool = false;
  for (const block of assistant.content) {
    if (block.type === 'toolCall') {
      sawTool = true;
      continue;
    }
    if (block.type === 'text' && block.text.trim() === '') continue;
    return false;
  }
  return sawTool;
}

function priorAssistant(body: readonly Message[], before: number): Message | undefined {
  for (let i = before - 1; i >= 0; i--) {
    const message = body[i];
    if (message?.role === 'assistant') return message;
  }
  return undefined;
}

function isSummaryUser(message: Message): boolean {
  if (message.role !== 'user') return false;
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
  return text.includes('<summary>') && text.includes('compacted');
}

export function activeTurnStartIndex(body: readonly Message[]): number {
  let start = body.findLastIndex((message) => message.role === 'user');
  if (start < 0) return start;
  let sawTrail = false;
  for (let i = start - 1; i >= 0; i--) {
    const message = body[i];
    if (message === undefined) break;
    if (message.role === 'toolResult' || isPureToolCallAssistant(message)) {
      sawTrail = true;
      continue;
    }
    if (message.role === 'user' && sawTrail && !isWakeOnlyUser(message)) start = i;
    break;
  }
  return start;
}

export function selectColdMessageWindow(
  messages: readonly Message[],
  recentExchanges = COLD_RECENT_EXCHANGES,
): Message[] {
  const system = messages.filter((message) => message.role === 'system');
  const summaries = messages.filter(isSummaryUser);
  const body = messages.filter((message) => message.role !== 'system' && !isSummaryUser(message));
  const turnStartIndex = activeTurnStartIndex(body);
  const kept: Message[] = [];
  let exchanges = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const message = body[i];
    if (message === undefined) continue;
    if (
      message.role === 'user' &&
      isWakeOnlyUser(message) &&
      (turnStartIndex < 0 || i < turnStartIndex)
    ) {
      continue;
    }
    const historical = turnStartIndex < 0 || i < turnStartIndex;
    if (historical && isPureToolCallAssistant(message)) continue;
    if (historical && message.role === 'toolResult') {
      const owner = priorAssistant(body, i);
      if (owner !== undefined && isPureToolCallAssistant(owner)) continue;
    }
    kept.push(message);
    if (message.role === 'user') {
      exchanges += 1;
      if (exchanges >= recentExchanges) {
        for (let j = i - 1; j >= 0; j--) {
          const prior = body[j];
          if (prior?.role === 'toolResult') {
            const owner = priorAssistant(body, j);
            if (owner !== undefined && isPureToolCallAssistant(owner)) continue;
            kept.push(prior);
          } else break;
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
  const hint: Message = {
    role: 'user',
    content: `Earlier turns were compacted into the following summary:\n\n<summary>\n${text}\n</summary>\n\nOlder detail is in the summary, todos, and read_history.`,
    timestamp: Date.now(),
  };
  const withoutStale = messages.filter((message) => !isSummaryUser(message));
  const firstNonSystem = withoutStale.findIndex((message) => message.role !== 'system');
  if (firstNonSystem < 0) return [...withoutStale, hint];
  return [...withoutStale.slice(0, firstNonSystem), hint, ...withoutStale.slice(firstNonSystem)];
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

export interface ColdWindowRow {
  at: number;
  rowid: number;
  role: string;
}

export function coldWindowStartFromRows(
  newestFirst: readonly ColdWindowRow[],
  recentExchanges = COLD_RECENT_EXCHANGES,
): { at: number; rowid: number } | null {
  const kept: ColdWindowRow[] = [];
  let exchanges = 0;
  for (const row of newestFirst) {
    kept.push(row);
    if (row.role === 'user') {
      exchanges += 1;
      if (exchanges >= recentExchanges) break;
    }
  }
  const oldest = kept.at(-1);
  return oldest === undefined ? null : { at: oldest.at, rowid: oldest.rowid };
}
