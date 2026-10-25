import { fuzzyFilter } from './completion.js';

export type MentionKind = 'todo' | 'skill' | 'agent' | 'project' | 'machine';

export interface FileMentionEntry {
  path: string;
  type: 'blob' | 'tree';
}

export interface InlineCompletionRow {
  kind: MentionKind | 'file';
  id: string;
  label: string;
  subtitle?: string;
  fileType?: 'blob' | 'tree';
  seq?: number;
}

export type InlineRosterGroups = Record<
  MentionKind,
  { id: string; label: string; subtitle?: string; seq?: number }[]
>;

export function buildInlineRows(
  query: string,
  groups: InlineRosterGroups,
  files?: readonly FileMentionEntry[],
): InlineCompletionRow[] {
  const rows: InlineCompletionRow[] = [
    ...groups.agent.map(
      (a): InlineCompletionRow => ({
        kind: 'agent',
        id: a.id,
        label: a.label,
        ...(a.subtitle !== undefined ? { subtitle: a.subtitle } : {}),
      }),
    ),
    ...groups.todo.map(
      (t): InlineCompletionRow => ({
        kind: 'todo',
        id: t.id,
        label: t.label,
        ...(t.subtitle !== undefined ? { subtitle: t.subtitle } : {}),
        ...(t.seq !== undefined ? { seq: t.seq } : {}),
      }),
    ),
    ...groups.skill.map(
      (s): InlineCompletionRow => ({
        kind: 'skill',
        id: s.id,
        label: s.label,
        ...(s.subtitle !== undefined ? { subtitle: s.subtitle } : {}),
      }),
    ),
    ...groups.project.map(
      (p): InlineCompletionRow => ({
        kind: 'project',
        id: p.id,
        label: p.label,
        ...(p.subtitle !== undefined ? { subtitle: p.subtitle } : {}),
      }),
    ),
    ...groups.machine.map(
      (m): InlineCompletionRow => ({
        kind: 'machine',
        id: m.id,
        label: m.label,
        ...(m.subtitle !== undefined ? { subtitle: m.subtitle } : {}),
      }),
    ),
    ...(files ?? []).map(
      (f): InlineCompletionRow => ({
        kind: 'file',
        id: f.path,
        label: f.type === 'tree' ? `${f.path}/` : f.path,
        fileType: f.type,
      }),
    ),
  ];
  return fuzzyFilter(query, rows, (r) => r.label);
}

export interface MentionToken {
  kind: MentionKind;
  label: string;
  id: string;
  seq?: number;
}

const SCHEME_PREFIX: Record<MentionKind, string> = {
  todo: 'todo',
  skill: 'skill',
  agent: 'agent',
  project: 'project',
  machine: 'machine',
};

function escapeLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

export function unescapeLabel(label: string): string {
  let out = '';
  for (let i = 0; i < label.length; i += 1) {
    if (label[i] === '\\' && i + 1 < label.length) {
      out += label[i + 1];
      i += 1;
    } else {
      out += label[i];
    }
  }
  return out;
}

export function serializeMention(token: MentionToken): string {
  const safeLabel = escapeLabel(token.label);
  if (token.kind === 'todo') {
    return `#${token.seq ?? ''}`.trimEnd() || `#${token.label}`;
  }
  if (token.kind === 'agent') {
    return `[${safeLabel}](${SCHEME_PREFIX.agent}:${token.id})`;
  }
  if (token.kind === 'project') {
    return `[${safeLabel}](${SCHEME_PREFIX.project}:${token.id})`;
  }
  if (token.kind === 'skill') {
    return `[${safeLabel}](${SCHEME_PREFIX.skill}:${token.id})`;
  }
  return `[${safeLabel}](${SCHEME_PREFIX.machine}:${token.id})`;
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; token: MentionToken; start: number; end: number };

const SCHEME_REGEX = /\[([^\]\n]+?)\]\((agent|skill|project|machine|todo):([A-Za-z0-9_-]+)\)/g;

export function parseMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;
  SCHEME_REGEX.lastIndex = 0;
  for (;;) {
    const match = SCHEME_REGEX.exec(text) as RegExpExecArray | null;
    if (match === null) break;
    const [full, rawLabel, rawKind, id] = match;
    if (match.index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    const kind = rawKind as MentionKind;
    const label = unescapeLabel(rawLabel ?? '');
    const seqDigits = kind === 'todo' && label.startsWith('#') ? label.slice(1) : '';
    const seq = /^\d+$/.test(seqDigits) ? Number(seqDigits) : undefined;
    segments.push({
      kind: 'mention',
      token: {
        kind,
        label,
        id: id ?? '',
        ...(seq !== undefined ? { seq } : {}),
      },
      start: match.index,
      end: match.index + full.length,
    });
    cursor = match.index + full.length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

export function formatFileInsert(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

export function insertFileText(
  value: string,
  path: string,
  at: number | null,
  replaceEnd?: number,
): { value: string; caret: number } {
  const serialized = formatFileInsert(path);
  if (at == null || at < 0 || at > value.length) {
    const piece = ` ${serialized} `;
    return { value: value + piece, caret: value.length + piece.length };
  }
  const end = replaceEnd != null && replaceEnd > at ? Math.min(replaceEnd, value.length) : at;
  const before = value.slice(0, at);
  const after = value.slice(end);
  const head = before.length === 0 || /\s/.test(before[before.length - 1] ?? '') ? '' : ' ';
  const tail = after.length > 0 && /^\s/.test(after) ? '' : ' ';
  return {
    value: before + head + serialized + tail + after,
    caret: before.length + head.length + serialized.length + tail.length,
  };
}
export function insertMentionText(
  value: string,
  token: MentionToken,
  at: number | null,
  replaceEnd?: number,
): { value: string; caret: number } {
  const piece = ` ${serializeMention(token)} `;
  if (at == null || at < 0 || at > value.length) {
    return { value: value + piece, caret: value.length + piece.length };
  }
  const end = replaceEnd != null && replaceEnd > at ? Math.min(replaceEnd, value.length) : at;
  const before = value.slice(0, at);
  const after = value.slice(end);
  const serialized = serializeMention(token);
  const head = before.length === 0 || /\s/.test(before[before.length - 1] ?? '') ? '' : ' ';
  const tail = after.length > 0 && /^\s/.test(after) ? '' : ' ';
  return {
    value: before + head + serialized + tail + after,
    caret: before.length + head.length + serialized.length + tail.length,
  };
}

export interface DraftChip {
  kind: MentionKind | 'file';
  id: string;
  label: string;
  start: number;
  end: number;
}

function scanFileChips(draft: string, files: readonly FileMentionEntry[]): DraftChip[] {
  const hits: DraftChip[] = [];
  for (const f of files) {
    const label = f.type === 'tree' ? `${f.path}/` : f.path;
    const serialized = formatFileInsert(label);
    let from = 0;
    for (;;) {
      const at = draft.indexOf(serialized, from);
      if (at === -1) break;
      from = at + serialized.length;
      const before = at === 0 ? '' : (draft[at - 1] ?? '');
      const after =
        at + serialized.length >= draft.length ? '' : (draft[at + serialized.length] ?? '');
      const bounded = (before === '' || /\s/.test(before)) && (after === '' || /\s/.test(after));
      if (bounded) {
        hits.push({ kind: 'file', id: f.path, label, start: at, end: at + serialized.length });
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: DraftChip[] = [];
  for (const h of hits) {
    if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

export function parseDraftChips(draft: string, files?: readonly FileMentionEntry[]): DraftChip[] {
  const chips: DraftChip[] = [];
  for (const seg of parseMentionSegments(draft)) {
    if (seg.kind !== 'mention') continue;
    chips.push({
      kind: seg.token.kind,
      id: seg.token.id,
      label: seg.token.label,
      start: seg.start,
      end: seg.end,
    });
  }
  if (files !== undefined) chips.push(...scanFileChips(draft, files));
  chips.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: DraftChip[] = [];
  for (const c of chips) {
    if (!kept.some((k) => c.start < k.end && k.start < c.end)) kept.push(c);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}
