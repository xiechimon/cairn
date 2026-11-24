import { z } from 'zod';
import type { DocumentDiffFile } from './document-diff.js';

export const GLANCE_MAX_LINES = 10;
const OTHER_FILES_SHOWN_ALL = 4;
const OTHER_FILES_SHOWN_CAPPED = 3;

export const glanceLineSchema = z.object({
  kind: z.enum(['context', 'add', 'del', 'gap']),
  old: z.number().int().optional(),
  new: z.number().int().optional(),
  text: z.string(),
});
export type GlanceLine = z.infer<typeof glanceLineSchema>;

export const glanceFileSchema = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  lines: z.array(glanceLineSchema).optional(),
});
export type GlanceFile = z.infer<typeof glanceFileSchema>;

export const diffGlanceSchema = z.object({
  files: z.array(glanceFileSchema).min(1),
  more: z
    .object({ count: z.number().int(), additions: z.number().int(), deletions: z.number().int() })
    .optional(),
});
export type DiffGlance = z.infer<typeof diffGlanceSchema>;

export const glanceFocusSchema = z.object({
  path: z.string(),
  start: z.number().int().optional(),
  end: z.number().int().optional(),
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
    entry.start === undefined ? [] : [{ start: entry.start, end: entry.end ?? entry.start }],
  );
  const out: GlanceLine[] = [];
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
      if (shown === GLANCE_MAX_LINES) return out;
      if (!open && out.length > 0) out.push({ kind: 'gap', text: '' });
      open = true;
      out.push({
        kind: line.kind,
        text: line.text,
        ...(line.old === undefined ? {} : { old: line.old }),
        ...(line.new === undefined ? {} : { new: line.new }),
      });
      shown++;
    }
  }
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
  const others = files.filter((file) => file !== key);
  const capped = others.length > OTHER_FILES_SHOWN_ALL;
  const listed = capped ? others.slice(0, OTHER_FILES_SHOWN_CAPPED) : others;
  const hidden = capped ? others.slice(OTHER_FILES_SHOWN_CAPPED) : [];
  const stat = (file: DocumentDiffFile): GlanceFile => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
  });
  return {
    files: [
      {
        ...stat(key),
        lines: keyLines(
          key,
          focus.filter((entry) => entry.path === key.path),
        ),
      },
      ...listed.map(stat),
    ],
    ...(hidden.length === 0
      ? {}
      : {
          more: {
            count: hidden.length,
            additions: hidden.reduce((sum, file) => sum + file.additions, 0),
            deletions: hidden.reduce((sum, file) => sum + file.deletions, 0),
          },
        }),
  };
}

const stat = (entry: { additions: number; deletions: number }) =>
  `+${entry.additions} -${entry.deletions}`;

const LINE_MARK: Record<GlanceLine['kind'], string> = { add: '+', del: '-', context: ' ', gap: '' };

export function diffGlanceMarkdown(glance: DiffGlance): string {
  const [key, ...others] = glance.files;
  if (key === undefined) return '';
  const body = (key.lines ?? []).map((line) =>
    line.kind === 'gap' ? '⋯' : `${LINE_MARK[line.kind]}${line.text}`,
  );
  return [
    `${key.path} ${stat(key)}`,
    '```diff',
    ...body,
    '```',
    ...others.map((file) => `${file.path} ${stat(file)}`),
    ...(glance.more === undefined ? [] : [`+${glance.more.count} files ${stat(glance.more)}`]),
  ].join('\n');
}
