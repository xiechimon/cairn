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

export function useQuoteMark(range: Range | null | undefined): void {
  useEffect(() => {
    if (range == null) return;
    const marks = quoteMarks();
    if (marks === null) return;
    marks.add(range);
    return () => {
      marks.delete(range);
    };
  }, [range]);
}
