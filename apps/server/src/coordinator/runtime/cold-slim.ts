import { ENV_VARS, parseAttachmentTokenLines } from '@cairn/shared';
import type { ImageContent, Message, TextContent, ToolResultMessage } from '@earendil-works/pi-ai';

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

export type ContextResume = 'warm' | 'cold' | 'idle';

export function contextResumeOf(args: {
  lastUsage: TurnUsageSnapshot | null;
  activeModel?: string | null;
}): ContextResume {
  if (args.lastUsage === null) return 'idle';
  return isColdResume(args) ? 'cold' : 'warm';
}

export function resumeExpiresAtOf(args: {
  resume: ContextResume;
  retentionMs: number;
  lastUsageCreatedAt: number;
}): number | null {
  return args.resume === 'warm' ? args.lastUsageCreatedAt + args.retentionMs : null;
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

export function projectWarmMessages(messages: readonly Message[]): Message[] {
  return stripConsumedImages(truncateOldToolResults(messages), { keepRecentMessages: 2 });
}
