import { z } from 'zod';
import type { DocumentDiffFile } from './document-diff.js';

export const GLANCE_MAX_LINES = 10;
export const GLANCE_NOTE_MAX_CHARS = 120;

export const glanceLineSchema = z.object({
  kind: z.enum(['context', 'add', 'del', 'gap', 'note']),
  old: z.number().int().optional(),
  new: z.number().int().optional(),
  text: z.string(),
});
export type GlanceLine = z.infer<typeof glanceLineSchema>;

export const diffGlanceSchema = z.object({
  todoId: z.string().optional(),
  path: z.string(),
  lines: z.array(glanceLineSchema),
});
export type DiffGlance = z.infer<typeof diffGlanceSchema>;

export const glanceFocusSchema = z.object({
  path: z.string(),
  start: z.number().int().optional(),
  end: z.number().int().optional(),
  note: z.string().trim().min(1).max(GLANCE_NOTE_MAX_CHARS).optional(),
});
export type GlanceFocus = z.infer<typeof glanceFocusSchema>;

const HUNK_START = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface NumberedLine {
  kind: 'context' | 'add' | 'del';
  old?: number;
  new?: number;
  anchor: number;
  text: string;
}

function numbered(hunk: DocumentDiffFile['hunks'][number]): NumberedLine[] {
  const match = HUNK_START.exec(hunk.header);
  let old = match === null ? 1 : Number(match[1]);
  let next = match === null ? 1 : Number(match[2]);
  return hunk.lines.map((raw) => {
    const text = raw.slice(1);
    if (raw.startsWith('+')) return { kind: 'add', new: next, anchor: next++, text };
    if (raw.startsWith('-')) return { kind: 'del', old: old++, anchor: next, text };
    return { kind: 'context', old: old++, new: next, anchor: next++, text };
  });
}

function pickAround(lines: NumberedLine[]): boolean[] {
  const keep = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.kind === 'context') return;
    for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep[j] = true;
  });
  return keep;
}

function keyLines(file: DocumentDiffFile, focus: GlanceFocus[]): GlanceLine[] {
  const ranges = focus.flatMap((entry) =>
    entry.start === undefined
      ? []
      : [{ start: entry.start, end: entry.end ?? entry.start, note: entry.note }],
  );
  const out: GlanceLine[] = [];
  const lastIn = ranges.map(() => -1);
  let shown = 0;
  for (const hunk of file.hunks) {
    const lines = numbered(hunk);
    const keep =
      ranges.length > 0
        ? lines.map((line) =>
            ranges.some((range) => line.anchor >= range.start && line.anchor <= range.end),
          )
        : pickAround(lines);
    let open = false;
    for (const [i, line] of lines.entries()) {
      if (!keep[i]) {
        open = false;
        continue;
      }
      if (shown === GLANCE_MAX_LINES) break;
      if (!open && out.length > 0) out.push({ kind: 'gap', text: '' });
      open = true;
      out.push({
        kind: line.kind,
        text: line.text,
        ...(line.old === undefined ? {} : { old: line.old }),
        ...(line.new === undefined ? {} : { new: line.new }),
      });
      ranges.forEach((range, r) => {
        if (line.anchor >= range.start && line.anchor <= range.end) lastIn[r] = out.length - 1;
      });
      shown++;
    }
  }
  const notes = ranges
    .map((range, r) => ({ at: lastIn[r] ?? -1, text: range.note }))
    .filter(
      (entry): entry is { at: number; text: string } => entry.at >= 0 && entry.text !== undefined,
    )
    .sort((x, y) => y.at - x.at);
  for (const { at, text } of notes) out.splice(at + 1, 0, { kind: 'note', text });
  return out;
}

const weight = (file: DocumentDiffFile) => file.additions + file.deletions;

export function glanceOf(files: DocumentDiffFile[], focus: GlanceFocus[] = []): DiffGlance | null {
  const named = focus.find((entry) => files.some((file) => file.path === entry.path));
  const key =
    files.find((file) => file.path === named?.path) ??
    files.reduce<DocumentDiffFile | undefined>(
      (best, file) => (best === undefined || weight(file) > weight(best) ? file : best),
      undefined,
    );
  if (key === undefined) return null;
  return {
    path: key.path,
    lines: keyLines(
      key,
      focus.filter((entry) => entry.path === key.path),
    ),
  };
}

const LINE_MARK: Record<GlanceLine['kind'], string> = {
  add: '+',
  del: '-',
  context: ' ',
  gap: '',
  note: '',
};

export function diffGlanceMarkdown(glance: DiffGlance): string {
  const body: string[] = [];
  const notes: string[] = [];
  for (const line of glance.lines) {
    if (line.kind === 'note') notes.push(line.text);
    else body.push(line.kind === 'gap' ? '⋯' : `${LINE_MARK[line.kind]}${line.text}`);
  }
  return [glance.path, '```diff', ...body, '```', ...notes].join('\n');
}
