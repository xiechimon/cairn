interface ListMarker {
  lineStart: number;
  indent: string;
  number: number;
  markerEnd: number;
  lineEnd: number;
}

function markerAtCaret(value: string, caret: number): ListMarker | null {
  const clamped = Math.max(0, Math.min(caret, value.length));
  const lineStart = value.lastIndexOf('\n', clamped - 1) + 1;
  const nl = value.indexOf('\n', clamped);
  const lineEnd = nl === -1 ? value.length : nl;
  const line = value.slice(lineStart, lineEnd);
  const match = /^([ \t]*)(\d+)\. +/.exec(line);
  if (match === null) return null;
  const indent = match[1] ?? '';
  const number = Number.parseInt(match[2] ?? '0', 10);
  if (!Number.isSafeInteger(number)) return null;
  const markerEnd = lineStart + (match[0]?.length ?? 0);
  if (clamped < markerEnd) return null;
  return { lineStart, indent, number, markerEnd, lineEnd };
}

function sameIndentMarker(
  line: string,
  indent: string,
): { number: number; contentStart: number; markerLength: number } | null {
  const match = /^([ \t]*)(\d+)\. +(.*)$/.exec(line);
  if (match === null) return null;
  if ((match[1] ?? '') !== indent) return null;
  return {
    number: Number.parseInt(match[2] ?? '0', 10),
    contentStart: (match[1] ?? '').length + (match[2] ?? '').length + 2,
    markerLength: match[0].length - (match[3] ?? '').length,
  };
}

export interface OrderedListEnter {
  value: string;
  caret: number;
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

  const nextNumber = marker.number + 1;
  const insert = `\n${marker.indent}${nextNumber}. `;
  const head = value.slice(0, clamped);
  let tail = value.slice(clamped);
  const nextCaret = clamped + insert.length;

  const tailLines = tail.split('\n');
  let renumber = nextNumber + 1;
  for (let i = 1; i < tailLines.length; i += 1) {
    const line = tailLines[i];
    if (line === undefined || line.trim() === '') break;
    const sibling = sameIndentMarker(line, marker.indent);
    if (sibling === null || !Number.isSafeInteger(sibling.number)) break;
    tailLines[i] = `${marker.indent}${renumber}. ${line.slice(sibling.contentStart)}`;
    renumber += 1;
  }
  tail = tailLines.join('\n');

  return { value: head + insert + tail, caret: nextCaret };
}
