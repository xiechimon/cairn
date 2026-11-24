import {
  type DiffGlance,
  type DocumentDiffFile,
  GLANCE_MAX_LINES,
  type GlanceFile,
  glanceOf,
} from '@cairn/shared';
import { cn } from 'cn';
import { parsePatch } from 'diff';
import { type ReactNode, useMemo } from 'react';
import { DiffFileBody } from '../../detail/docpane.js';
import type { DiffFile, DiffHunk, DiffLine } from '../../fixtures/records.js';
import { useI18n } from '../../i18n/provider.js';

const stripPrefix = (name: string | undefined) => (name ?? '').replace(/^[ab]\//, '');

const HUNK_HEAD = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

const endsHunk = (line: string, next: string | undefined) =>
  line.startsWith('@@') ||
  line.startsWith('diff ') ||
  (line.startsWith('--- ') && next?.startsWith('+++ ') === true);

function recountHunks(text: string): string {
  const lines = text.replace(/\n+$/, '').split('\n');
  return lines
    .map((line, at) => {
      const head = HUNK_HEAD.exec(line);
      if (head === null) return line;
      let old = 0;
      let next = 0;
      for (let i = at + 1; i < lines.length && !endsHunk(lines[i] ?? '', lines[i + 1]); i++) {
        const mark = (lines[i] ?? '')[0];
        if (mark === '-') old++;
        else if (mark === '+') next++;
        else if (mark === ' ' || mark === undefined) {
          old++;
          next++;
        }
      }
      return `@@ -${head[1]},${old} +${head[2]},${next} @@${head[3]}`;
    })
    .join('\n');
}

export function fenceDiffFiles(text: string): DocumentDiffFile[] {
  let patches: ReturnType<typeof parsePatch>;
  try {
    patches = parsePatch(recountHunks(text));
  } catch {
    return [];
  }
  return patches.flatMap((patch) => {
    const path =
      stripPrefix(patch.newFileName) === '/dev/null' || stripPrefix(patch.newFileName) === ''
        ? stripPrefix(patch.oldFileName)
        : stripPrefix(patch.newFileName);
    if (path === '' || path === '/dev/null' || patch.hunks.length === 0) return [];
    const lines = patch.hunks.flatMap((hunk) => hunk.lines);
    return [
      {
        path,
        additions: lines.filter((line) => line.startsWith('+')).length,
        deletions: lines.filter((line) => line.startsWith('-')).length,
        hunks: patch.hunks.map((hunk) => ({
          header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
          lines: hunk.lines.filter((line) => !line.startsWith('\\')),
        })),
      },
    ];
  });
}

export function fenceGlance(text: string): DiffGlance | null {
  return glanceOf(fenceDiffFiles(text));
}

export function fenceHeader(text: string): GlanceFile | null {
  const path = /^\+\+\+ (?:b\/)?(\S+)/m.exec(text)?.[1];
  if (path === undefined || path === '/dev/null') return null;
  const body = text.slice(text.search(/^@@/m) === -1 ? text.length : text.search(/^@@/m));
  return {
    path,
    additions: (body.match(/^\+(?!\+\+ )/gm) ?? []).length,
    deletions: (body.match(/^-(?!-- )/gm) ?? []).length,
  };
}

const FRAME_CLS =
  'w-full min-w-0 overflow-hidden rounded-(--radius-code) bg-background font-sans ring-1 ring-border';
const HEAD_CLS = 'flex h-9 items-center gap-3 border-b border-border bg-card px-3';
const ROW_CLS = 'flex h-8 items-center gap-3 border-t border-border bg-card px-3';
const MONO_CLS =
  'font-mono text-code leading-5 [font-feature-settings:"calt"_0,"liga"_0] [font-variant-ligatures:none]';

function FilePath({ path }: { path: string }) {
  const cut = path.lastIndexOf('/') + 1;
  return (
    <span className={cn('flex min-w-0 flex-1 items-baseline whitespace-nowrap', MONO_CLS)}>
      {cut > 0 && (
        <span className="min-w-0 flex-[0_1_auto] truncate text-(--text-tertiary) [direction:rtl] text-left">
          <bdi className="[direction:ltr]">{path.slice(0, cut)}</bdi>
        </span>
      )}
      <span className="flex-none text-(--foreground)">{path.slice(cut)}</span>
    </span>
  );
}

function Stat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span
      className="flex flex-none gap-1.5 font-mono text-meta tabular-nums"
      data-slot="glance-stat"
    >
      <span className="text-(--diff-add-fg)">+{additions}</span>
      <span className="text-(--destructive)">−{deletions}</span>
    </span>
  );
}

export function glanceDiffFile(file: GlanceFile): DiffFile {
  const hunks: DiffHunk[] = [];
  let lines: DiffLine[] = [];
  const close = () => {
    if (lines.length === 0) return;
    const first = lines[0];
    const oldStart = first?.oldNo ?? first?.newNo ?? 1;
    const newStart = first?.newNo ?? first?.oldNo ?? 1;
    const oldLength = lines.filter((line) => line.kind !== 'add').length;
    const newLength = lines.filter((line) => line.kind !== 'del').length;
    hunks.push({ header: `@@ -${oldStart},${oldLength} +${newStart},${newLength} @@`, lines });
    lines = [];
  };
  for (const line of file.lines ?? []) {
    if (line.kind === 'gap') {
      close();
      continue;
    }
    lines.push({
      kind: line.kind,
      text: line.text,
      ...(line.old === undefined ? {} : { oldNo: line.old }),
      ...(line.new === undefined ? {} : { newNo: line.new }),
    });
  }
  close();
  return { path: file.path, added: file.additions, removed: file.deletions, hunks };
}

function OtherFiles({ glance }: { glance: DiffGlance }) {
  const { t } = useI18n();
  return (
    <>
      {glance.files.slice(1).map((file) => (
        <div key={file.path} className={ROW_CLS} data-testid="glance-file">
          <FilePath path={file.path} />
          <Stat additions={file.additions} deletions={file.deletions} />
        </div>
      ))}
      {glance.more !== undefined && (
        <div className={ROW_CLS} data-testid="glance-more">
          <span className="min-w-0 flex-1 truncate text-meta text-(--text-tertiary)">
            {t('还有 {n} 个文件', { n: glance.more.count })}
          </span>
          <Stat additions={glance.more.additions} deletions={glance.more.deletions} />
        </div>
      )}
    </>
  );
}

export function DiffGlanceBlock({ glance }: { glance: DiffGlance }) {
  const [key] = glance.files;
  if (key === undefined) return null;
  return (
    <div className={FRAME_CLS} data-testid="diff-glance">
      <div className={HEAD_CLS}>
        <FilePath path={key.path} />
        <Stat additions={key.additions} deletions={key.deletions} />
      </div>
      {key.lines !== undefined && key.lines.length > 0 && (
        <div className="py-1" data-testid="glance-lines">
          <DiffFileBody file={glanceDiffFile(key)} buildId={null} showFull={false} glance />
        </div>
      )}
      <OtherFiles glance={glance} />
    </div>
  );
}

const SKELETON_WIDTHS = [
  'w-[62%]',
  'w-[48%]',
  'w-[70%]',
  'w-[55%]',
  'w-[80%]',
  'w-[66%]',
  'w-[72%]',
  'w-[84%]',
  'w-[58%]',
  'w-[40%]',
];

export function DiffGlanceSkeleton({
  head,
  rows = GLANCE_MAX_LINES,
}: {
  head: { path: string; additions?: number; deletions?: number } | null;
  rows?: number;
}) {
  const { t } = useI18n();
  return (
    <div
      className={FRAME_CLS}
      data-testid="diff-glance-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('正在生成改动')}
    >
      <div className={HEAD_CLS}>
        {head === null ? (
          <span className="h-3 w-2/5 animate-pulse rounded-full bg-(--secondary)" />
        ) : (
          <>
            <FilePath path={head.path} />
            {head.additions !== undefined && head.deletions !== undefined && (
              <Stat additions={head.additions} deletions={head.deletions} />
            )}
          </>
        )}
      </div>
      <div className="flex flex-col py-1">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-5 items-center px-3">
            <span
              className={cn(
                'h-3 animate-pulse rounded-full bg-(--secondary)',
                SKELETON_WIDTHS[i % SKELETON_WIDTHS.length],
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DiffFence({
  text,
  open,
  fallback,
}: {
  text: string;
  open: boolean;
  fallback: ReactNode;
}) {
  const glance = useMemo(() => (open ? null : fenceGlance(text)), [open, text]);
  const head = useMemo(() => (open ? fenceHeader(text) : null), [open, text]);
  if (open) return head === null ? fallback : <DiffGlanceSkeleton head={head} />;
  return glance === null ? fallback : <DiffGlanceBlock glance={glance} />;
}
