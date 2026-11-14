import { z } from 'zod';
import { ASK_USER_QUESTION_KIND } from './message.js';

export const QUICK_REPLIES_KIND = 'quick_replies';
export const QUICK_REPLIES_ROW_ID_PREFIX = 'quick-replies-';
export const SUGGEST_REPLIES_TOOL_NAME = 'suggest_replies';
export const QUICK_REPLIES_MAX = 3;
export const QUICK_REPLY_MAX_CHARS = 80;

const quickReplySchema = z
  .string()
  .min(1)
  .refine((text) => [...text].length <= QUICK_REPLY_MAX_CHARS && !/[\r\n]/.test(text));

export const quickRepliesContentSchema = z.object({
  kind: z.literal(QUICK_REPLIES_KIND),
  stepId: z.string().min(1),
  replies: z.array(quickReplySchema).min(1).max(QUICK_REPLIES_MAX),
});
export type QuickRepliesContent = z.infer<typeof quickRepliesContentSchema>;

export function quickRepliesRowId(stepId: string): string {
  return `${QUICK_REPLIES_ROW_ID_PREFIX}${stepId}`;
}

export type QuickRepliesSanitized =
  | { ok: true; replies: string[] }
  | { ok: false; problem: string };

const IRREVERSIBLE =
  /删除|删掉|删了|合并|关闭|归档|撤销|回滚|丢弃|覆盖|清空|重置|卸载|退订|取消订阅|\b(?:delete|remove|merge|close|archive|revert|discard|overwrite|reset|uninstall|unsubscribe)\b/i;

export function sanitizeQuickReplies(raw: unknown): QuickRepliesSanitized {
  if (!Array.isArray(raw)) return { ok: false, problem: 'replies must be an array of strings' };
  if (raw.length > QUICK_REPLIES_MAX) {
    return {
      ok: false,
      problem: `${raw.length} replies given; offer at most ${QUICK_REPLIES_MAX}`,
    };
  }
  const replies: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (typeof item !== 'string') {
      return { ok: false, problem: `replies[${index}] is not a string` };
    }
    const text = item
      .replace(/\p{Cc}+/gu, ' ')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/[`*~#>[\]<|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text === '') continue;
    const length = [...text].length;
    if (length > QUICK_REPLY_MAX_CHARS) {
      return {
        ok: false,
        problem: `replies[${index}] is ${length} characters; keep each under ${QUICK_REPLY_MAX_CHARS + 1}`,
      };
    }
    const key = text.toLocaleLowerCase();
    if (seen.has(key) || IRREVERSIBLE.test(text)) continue;
    seen.add(key);
    replies.push(text);
  }
  if (replies.length === 0) return { ok: false, problem: 'no reply text left after cleaning' };
  return { ok: true, replies };
}

export interface QuickRepliesRow {
  id: string;
  role: string;
  content: unknown;
}

function parsedContent(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  if (!content.startsWith('{')) return content;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function kindOf(content: unknown): unknown {
  const parsed = parsedContent(content);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { kind?: unknown }).kind
    : undefined;
}

function isPendingQuestion(row: QuickRepliesRow): boolean {
  const parsed = parsedContent(row.content);
  return (
    kindOf(parsed) === ASK_USER_QUESTION_KIND &&
    (parsed as { status?: unknown }).status === 'pending'
  );
}

function hasReplyText(content: unknown): boolean {
  if (typeof content === 'string') return kindOf(content) === undefined && content.trim() !== '';
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block !== null &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string' &&
      (block as { text: string }).text.trim() !== '',
  );
}

export function liveQuickReplies(
  rows: readonly QuickRepliesRow[],
  state: { running: boolean; runningStepId?: string | null },
): string[] {
  if (rows.some(isPendingQuestion)) return [];
  const at = rows.findLastIndex((row) => kindOf(row.content) === QUICK_REPLIES_KIND);
  if (at < 0) return [];
  const content = quickRepliesContentSchema.safeParse(parsedContent(rows[at]?.content));
  if (!content.success) return [];
  if (state.running && state.runningStepId !== content.data.stepId) return [];
  const after = rows.slice(at + 1);
  if (after.some((row) => row.role !== 'assistant')) return [];
  const turnStart = rows.slice(0, at).findLastIndex((row) => row.role === 'user');
  const turnRows = rows.slice(turnStart + 1);
  const answered = turnRows.some((row) => row.role === 'assistant' && hasReplyText(row.content));
  return answered ? content.data.replies : [];
}
