export type ListMarkerKind = 'ordered' | 'bullet';

export interface ListMarkerSpan {
  kind: ListMarkerKind;
  lineStart: number;
  start: number;
  end: number;
  text: string;
}

interface ParsedListLine {
  kind: ListMarkerKind;
  indent: string;
  token: string;
  number: number | null;
  markerLength: number;
}

interface ListMarker {
  kind: ListMarkerKind;
  lineStart: number;
  indent: string;
  number: number | null;
  markerEnd: number;
  lineEnd: number;
}

function parseListLine(line: string): ParsedListLine | null {
  const ordered = /^([ \t]*)(\d+)\. +([^ \r\u2028\u2029].*|)$/.exec(line);
  if (ordered !== null) {
    const indent = ordered[1] ?? '';
    const digits = ordered[2] ?? '0';
    const number = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(number)) return null;
    const token = `${digits}.`;
    return {
      kind: 'ordered',
      indent,
      token,
      number,
      markerLength: ordered[0].length - (ordered[3] ?? '').length,
    };
  }
  const bullet = /^([ \t]*)- +([^ \r\u2028\u2029].*|)$/.exec(line);
  if (bullet !== null) {
    return {
      kind: 'bullet',
      indent: bullet[1] ?? '',
      token: '-',
      number: null,
      markerLength: bullet[0].length - (bullet[2] ?? '').length,
    };
  }
  return null;
}

export function lineStartAt(value: string, caret: number): number {
  const clamped = Math.max(0, Math.min(caret, value.length));
  return value.lastIndexOf('\n', clamped - 1) + 1;
}

function markerAtCaret(value: string, caret: number): ListMarker | null {
  const clamped = Math.max(0, Math.min(caret, value.length));
  const lineStart = lineStartAt(value, clamped);
  const nl = value.indexOf('\n', clamped);
  const lineEnd = nl === -1 ? value.length : nl;
  const parsed = parseListLine(value.slice(lineStart, lineEnd));
  if (parsed === null) return null;
  const markerEnd = lineStart + parsed.markerLength;
  if (clamped < markerEnd) return null;
  return {
    kind: parsed.kind,
    lineStart,
    indent: parsed.indent,
    number: parsed.number,
    markerEnd,
    lineEnd,
  };
}

export function findListMarkers(
  text: string,
  suppressedLineStarts?: ReadonlySet<number> | null,
): ListMarkerSpan[] {
  if (text === '') return [];
  const out: ListMarkerSpan[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    if (suppressedLineStarts == null || !suppressedLineStarts.has(lineStart)) {
      const parsed = parseListLine(text.slice(lineStart, lineEnd));
      if (parsed !== null) {
        const start = lineStart + parsed.indent.length;
        out.push({
          kind: parsed.kind,
          lineStart,
          start,
          end: start + parsed.token.length,
          text: parsed.token,
        });
      }
    }
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  return out;
}

export interface OrderedListEnter {
  value: string;
  caret: number;
}

export function applyOrderedListBackspace(value: string, caret: number): OrderedListEnter | null {
  const marker = markerAtCaret(value, caret);
  if (marker === null) return null;
  const clamped = Math.max(0, Math.min(caret, value.length));
  if (clamped !== marker.markerEnd) return null;
  const caretAfter = marker.lineStart + marker.indent.length;
  return {
    value: value.slice(0, caretAfter) + value.slice(marker.markerEnd),
    caret: caretAfter,
  };
}

export function applyOrderedListEnter(value: string, caret: number): OrderedListEnter | null {
  const marker = markerAtCaret(value, caret);
  if (marker === null) return null;
  const clamped = Math.max(0, Math.min(caret, value.length));

  const restOfLine = value.slice(marker.markerEnd, marker.lineEnd);
  if (restOfLine.trim() === '') {
    const next =
      value.slice(0, marker.lineStart + marker.indent.length) + value.slice(marker.lineEnd);
    return { value: next, caret: marker.lineStart + marker.indent.length };
  }

  const head = value.slice(0, clamped);
  let tail = value.slice(clamped);

  if (marker.kind === 'bullet' || marker.number === null) {
    const insert = `\n${marker.indent}- `;
    return { value: head + insert + tail, caret: clamped + insert.length };
  }

  const nextNumber = marker.number + 1;
  const insert = `\n${marker.indent}${nextNumber}. `;
  const nextCaret = clamped + insert.length;

  const tailLines = tail.split('\n');
  let renumber = nextNumber + 1;
  for (let i = 1; i < tailLines.length; i += 1) {
    const line = tailLines[i];
    if (line === undefined || line.trim() === '') break;
    const sibling = parseListLine(line);
    if (
      sibling === null ||
      sibling.kind !== 'ordered' ||
      sibling.indent !== marker.indent ||
      sibling.number === null
    ) {
      break;
    }
    tailLines[i] = `${marker.indent}${renumber}. ${line.slice(sibling.markerLength)}`;
    renumber += 1;
  }
  tail = tailLines.join('\n');

  return { value: head + insert + tail, caret: nextCaret };
}
