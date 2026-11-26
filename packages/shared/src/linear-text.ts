export function trimStartChars(text: string, chars: string): string {
  let start = 0;
  while (start < text.length && chars.includes(text.charAt(start))) start++;
  return text.slice(start);
}

export function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text.charAt(end - 1))) end--;
  return text.slice(0, end);
}

export function lastLineStart(text: string): number {
  let start = 0;
  for (const lineBreak of text.matchAll(/(?!.)[\s\S]/g)) start = lineBreak.index + 1;
  return start;
}

export function cutTailOfLastLine(text: string, marker: RegExp): string {
  const flags = marker.flags.includes('g') ? marker.flags : `${marker.flags}g`;
  const finder = new RegExp(marker.source, flags);
  finder.lastIndex = lastLineStart(text);
  const found = finder.exec(text);
  return found === null ? text : text.slice(0, found.index);
}

export interface DelimitedSpanRule {
  open: RegExp;
  close: (openMatch: RegExpExecArray) => string;
  ignoreCase?: boolean;
}

export function replaceDelimitedSpans(
  text: string,
  rule: DelimitedSpanRule,
  replace: (span: string, openMatch: RegExpExecArray) => string,
): string {
  const flags = rule.open.flags.includes('g') ? rule.open.flags : `${rule.open.flags}g`;
  const open = new RegExp(rule.open.source, flags);
  const unclosed = new Set<string>();
  let out = '';
  let copied = 0;
  for (let match = open.exec(text); match !== null; match = open.exec(text)) {
    const closer = rule.close(match);
    if (unclosed.has(closer.toLowerCase())) {
      open.lastIndex = match.index + 1;
      continue;
    }
    const from = match.index + match[0].length;
    let closeAt: number;
    if (rule.ignoreCase === true) {
      const search = new RegExp(closer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      search.lastIndex = from;
      closeAt = search.exec(text)?.index ?? -1;
    } else {
      closeAt = text.indexOf(closer, from);
    }
    if (closeAt < 0) {
      unclosed.add(closer.toLowerCase());
      open.lastIndex = match.index + 1;
      continue;
    }
    const end = closeAt + closer.length;
    out += text.slice(copied, match.index) + replace(text.slice(match.index, end), match);
    copied = end;
    open.lastIndex = end;
  }
  return out + text.slice(copied);
}

export function matchesInOrderWithinSegment(
  separator: RegExp,
  parts: readonly RegExp[],
): { test(text: string): boolean } {
  const sticky = parts.map(
    (part) => new RegExp(part.source, part.flags.includes('g') ? part.flags : `${part.flags}g`),
  );
  return {
    test(text) {
      return text.split(separator).some((segment) => {
        let from = 0;
        return sticky.every((part) => {
          part.lastIndex = from;
          const match = part.exec(segment);
          if (match === null) return false;
          from = match.index + match[0].length;
          return true;
        });
      });
    },
  };
}

export function replaceTags(text: string, replacement: string): string {
  return replaceDelimitedSpans(text, { open: /</, close: () => '>' }, () => replacement);
}

export interface BracketLinkShape {
  opener: RegExp;
  labelEnd: RegExp;
  head: string;
  targetEnd: RegExp;
}

export interface BracketLink {
  start: number;
  end: number;
  label: string;
  target: string;
}

export function nextIndexFinder(text: string, pattern: RegExp): (from: number) => number {
  let found = -1;
  return (from) => {
    if (found < from) {
      pattern.lastIndex = from;
      found = pattern.exec(text)?.index ?? Number.POSITIVE_INFINITY;
    }
    return found;
  };
}

export function findBracketLinks(
  text: string,
  shape: BracketLinkShape,
  accepts: (label: string, target: string) => boolean = () => true,
): BracketLink[] {
  const opener = new RegExp(shape.opener.source, 'g');
  const labelEndAt = nextIndexFinder(text, new RegExp(shape.labelEnd.source, 'g'));
  const targetEndAt = nextIndexFinder(text, new RegExp(shape.targetEnd.source, 'g'));
  const links: BracketLink[] = [];
  for (let match = opener.exec(text); match !== null; match = opener.exec(text)) {
    const labelStart = match.index + match[0].length;
    const labelEnd = labelEndAt(labelStart);
    if (labelEnd === Number.POSITIVE_INFINITY) break;
    opener.lastIndex = labelEnd;
    if (!text.startsWith(shape.head, labelEnd)) continue;
    const targetStart = labelEnd + shape.head.length;
    const targetEnd = targetEndAt(targetStart);
    if (text.charAt(targetEnd) !== ')') continue;
    const label = text.slice(labelStart, labelEnd);
    const target = text.slice(targetStart, targetEnd);
    if (!accepts(label, target)) continue;
    links.push({ start: match.index, end: targetEnd + 1, label, target });
    opener.lastIndex = targetEnd + 1;
  }
  return links;
}

export function replaceBracketLinks(
  text: string,
  shape: BracketLinkShape,
  replace: (link: BracketLink) => string,
  accepts?: (label: string, target: string) => boolean,
): string {
  let out = '';
  let copied = 0;
  for (const link of findBracketLinks(text, shape, accepts)) {
    out += text.slice(copied, link.start) + replace(link);
    copied = link.end;
  }
  return out + text.slice(copied);
}
