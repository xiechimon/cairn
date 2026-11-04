import {
  type MentionKind,
  type MentionToken,
  parseMentionSegments,
  serializeMention,
} from './mention-token.js';

export interface MentionRegistry {
  byDisplay: Map<string, { wire: string; kind: MentionKind }>;
}

export function createMentionRegistry(): MentionRegistry {
  return { byDisplay: new Map() };
}

export function displayOf(token: MentionToken): string {
  return token.kind === 'todo' ? serializeMention(token) : `@${token.label}`;
}

export function registerMention(registry: MentionRegistry, token: MentionToken): string {
  const display = displayOf(token);
  registry.byDisplay.set(display, { wire: serializeMention(token), kind: token.kind });
  return display;
}

export function toDisplay(wire: string, registry: MentionRegistry): string {
  let out = '';
  for (const seg of parseMentionSegments(wire)) {
    out += seg.kind === 'text' ? seg.text : registerMention(registry, seg.token);
  }
  return out;
}

const BOUNDARY = /[\s.,;:!?()[\]{}"'`，。；：！？、]/;

function bounded(text: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : (text[start - 1] ?? '');
  const after = end >= text.length ? '' : (text[end] ?? '');
  return (before === '' || BOUNDARY.test(before)) && (after === '' || BOUNDARY.test(after));
}

export interface DisplayMention {
  start: number;
  end: number;
  kind: MentionKind;
  wire: string;
}

export function findDisplayMentions(display: string, registry: MentionRegistry): DisplayMention[] {
  const keys = [...registry.byDisplay.keys()]
    .filter((key) => key.startsWith('@'))
    .sort((a, b) => b.length - a.length);
  const hits: DisplayMention[] = [];
  for (const key of keys) {
    const entry = registry.byDisplay.get(key);
    if (entry === undefined) continue;
    let from = 0;
    for (;;) {
      const at = display.indexOf(key, from);
      if (at === -1) break;
      from = at + key.length;
      const end = at + key.length;
      if (!bounded(display, at, end)) continue;
      if (hits.some((h) => at < h.end && h.start < end)) continue;
      hits.push({ start: at, end, kind: entry.kind, wire: entry.wire });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export function toWire(display: string, registry: MentionRegistry): string {
  let out = '';
  let cursor = 0;
  for (const hit of findDisplayMentions(display, registry)) {
    out += display.slice(cursor, hit.start) + hit.wire;
    cursor = hit.end;
  }
  return out + display.slice(cursor);
}

export function insertMentionDisplay(
  value: string,
  token: MentionToken,
  registry: MentionRegistry,
  at: number | null,
  replaceEnd?: number,
): { value: string; caret: number } {
  const display = registerMention(registry, token);
  if (at == null || at < 0 || at > value.length) {
    const piece = ` ${display} `;
    return { value: value + piece, caret: value.length + piece.length };
  }
  const end = replaceEnd != null && replaceEnd > at ? Math.min(replaceEnd, value.length) : at;
  const before = value.slice(0, at);
  const after = value.slice(end);
  const head = before.length === 0 || /\s/.test(before[before.length - 1] ?? '') ? '' : ' ';
  const tail = after.length > 0 && /^\s/.test(after) ? '' : ' ';
  return {
    value: before + head + display + tail + after,
    caret: before.length + head.length + display.length + tail.length,
  };
}
