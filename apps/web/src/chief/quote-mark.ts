import { useEffect } from 'react';

export const QUOTE_MARK_HIGHLIGHT = 'cairn-quote';

function quoteMarks(): Highlight | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined')
    return null;
  const existing = CSS.highlights.get(QUOTE_MARK_HIGHLIGHT);
  if (existing !== undefined) return existing;
  const created = new Highlight();
  CSS.highlights.set(QUOTE_MARK_HIGHLIGHT, created);
  return created;
}

export function useQuoteMarks(ranges: readonly Range[]): void {
  useEffect(() => {
    if (ranges.length === 0) return;
    const marks = quoteMarks();
    if (marks === null) return;
    for (const range of ranges) marks.add(range);
    return () => {
      for (const range of ranges) marks.delete(range);
    };
  }, [ranges]);
}
