export interface TicketDedupeInput {
  category: string;
  paths: readonly string[];
}

const MARKER_HEAD = '<!-- cairn-dedupe: ';
const MARKER_TAIL = ' -->';

export function ticketDedupeKey(input: TicketDedupeInput): string {
  const category = input.category.trim().toLowerCase().replace(/\s+/g, '-');
  if (category === '') throw new Error('ticket dedupe category must not be empty');
  const paths = [
    ...new Set(
      input.paths
        .map((p) => p.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
        .filter((p) => p !== ''),
    ),
  ].sort();
  return [category, ...paths].join('|');
}

export function ticketDedupeMarker(key: string): string {
  return `${MARKER_HEAD}${key}${MARKER_TAIL}`;
}

export function parseTicketDedupeKey(body: string | null | undefined): string | null {
  if (body == null) return null;
  const at = body.indexOf(MARKER_HEAD);
  if (at < 0) return null;
  const end = body.indexOf(MARKER_TAIL, at + MARKER_HEAD.length);
  if (end < 0) return null;
  return body.slice(at + MARKER_HEAD.length, end);
}

export function findDuplicateTicket<T extends { state: string; body?: string | null }>(
  key: string,
  issues: readonly T[],
): T | null {
  return (
    issues.find((i) => i.state.toLowerCase() === 'open' && parseTicketDedupeKey(i.body) === key) ??
    null
  );
}
