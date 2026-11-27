import { type ChiefNoticeContent, chiefNoticeContentSchema } from './records/message.js';
import { orchestratedTodoIdOf, TRANSCRIPT_PROMPT_ROW_ID_PREFIX } from './records/prompts.js';
import { stripSkillRouteSection } from './skill-route.js';
import { stripTurnContext } from './turn-context.js';

const WAKE_MARKER_PREFIX_RE = /^\[wake:\w+\]\s*/;
const RAW_API_ERROR_RE = /^API Error: /;

export function isChiefPromptEcho(row: { id: string; origin?: string | null }): boolean {
  if (row.origin === 'user') return false;
  return (
    row.origin === 'task-prompt' ||
    row.origin === 'synthetic' ||
    row.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)
  );
}

export function cleanChiefUserText(raw: string): string {
  return stripTurnContext(stripSkillRouteSection(raw.replace(WAKE_MARKER_PREFIX_RE, ''))).trim();
}

export function extractPlainMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block !== null && typeof block === 'object') {
          const b = block as { type?: string; text?: string };
          if (b.type === 'text' && typeof b.text === 'string') return b.text;
        }
        return '';
      })
      .join('');
  }
  if (content !== null && typeof content === 'object') {
    const b = content as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') return b.text;
  }
  return '';
}

export function isSearchableNotice(notice: ChiefNoticeContent): boolean {
  return !notice.provenance.startsWith('retry-parking:') && notice.runtimeUpdate === undefined;
}

export function visibleChiefMessageText(row: {
  id: string;
  role: string;
  origin?: string | null;
  content: unknown;
}): { role: 'user' | 'assistant'; text: string } | null {
  if (row.role === 'user') {
    if (isChiefPromptEcho(row)) return null;
    const raw = extractPlainMessageText(row.content).trim();
    if (raw === '' || orchestratedTodoIdOf(raw) !== null) return null;
    const text = cleanChiefUserText(raw);
    return text === '' ? null : { role: 'user', text };
  }
  if (row.role === 'assistant') {
    const raw = extractPlainMessageText(row.content).trim();
    if (raw === '' || RAW_API_ERROR_RE.test(raw)) return null;
    return { role: 'assistant', text: raw };
  }
  if (row.role === 'system') {
    let parsed: unknown = null;
    if (typeof row.content === 'string') {
      try {
        parsed = JSON.parse(row.content);
      } catch {
        parsed = null;
      }
    } else if (row.content !== null && typeof row.content === 'object') {
      parsed = row.content;
    }
    const notice = chiefNoticeContentSchema.safeParse(parsed);
    if (!notice.success || !isSearchableNotice(notice.data)) return null;
    const text = notice.data.message.trim();
    return text === '' ? null : { role: 'assistant', text };
  }
  return null;
}
