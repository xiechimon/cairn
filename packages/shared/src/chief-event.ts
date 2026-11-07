import { ISSUE_FENCE_OPEN } from './records/prompts.js';

export const CHIEF_EVENT_SHORT_MAX_CHARS = 400;

const EVENT_HEADER_RE = /^\[wake:(\w+)\](?:[ \t]+provenance=(\S+)[ \t]*\n?|\s*)/;
const HISTORY_MARKER_RE = /\n*\[history id: ([^\]\s]+)\]\s*$/;

export function withHistoryMarker(prompt: string, rowId: string): string {
  return `${prompt}\n\n[history id: ${rowId}]`;
}

export function shortEvent(text: string, rowId?: string): string | null {
  const header = EVENT_HEADER_RE.exec(text);
  if (header === null) return null;
  const marker = HISTORY_MARKER_RE.exec(text);
  const id = rowId ?? marker?.[1];
  const raw = text.slice(header[0].length, marker === null ? undefined : marker.index);
  const fenceAt = raw.indexOf(ISSUE_FENCE_OPEN);
  const fenceNote = fenceAt < 0 ? '' : ` ${ISSUE_FENCE_OPEN}\u3011 third-party text omitted`;
  const body = (fenceAt < 0 ? raw : raw.slice(0, fenceAt)).replace(/\s+/g, ' ').trim();
  const chars = Array.from(body);
  const kept = chars.slice(0, CHIEF_EVENT_SHORT_MAX_CHARS).join('');
  const cut = chars.length > CHIEF_EVENT_SHORT_MAX_CHARS;
  const pointer =
    id !== undefined
      ? `read_history ids ["${id}"]`
      : header[2] !== undefined
        ? `search_history "${header[2]}"`
        : null;
  const tail = pointer === null ? '' : ` [${cut ? 'cut; ' : ''}full text: ${pointer}]`;
  return `[event ${header[1]}] ${kept}${cut && pointer === null ? ' [cut]' : ''}${fenceNote}${tail}`;
}
