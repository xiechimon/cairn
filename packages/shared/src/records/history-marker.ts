import { trimEndChars } from '../linear-text.js';

const HISTORY_MARKER_RE = /\[history id: ([^\]\s]+)\]\s*$/;

export function findHistoryMarker(
  text: string,
): { index: number; id: string; line: string } | null {
  const match = HISTORY_MARKER_RE.exec(text);
  if (match === null || match[1] === undefined) return null;
  return {
    index: trimEndChars(text.slice(0, match.index), '\n').length,
    id: match[1],
    line: match[0].trim(),
  };
}
