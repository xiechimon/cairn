import { type DiffGlance, type DocumentDiffFile, type GlanceLine, glanceOf } from '@cairn/shared';
import { cn } from 'cn';
import { parsePatch } from 'diff';
import { SquareArrowOutUpRight } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { threadHrefFrom } from '../../board/thread-copy.js';
import { DiffFileBody } from '../../detail/docpane.js';
import type { DiffFile, DiffHunk, DiffLine } from '../../fixtures/records.js';
import { useI18n } from '../../i18n/provider.js';
import { FileGlyph } from '../file-glyph.js';
import { IconTooltip } from '../icon-tooltip.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';

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

export function fenceGlances(text: string): DiffGlance[] {
  return fenceDiffFiles(text).flatMap((file) => {
    const glance = glanceOf([file]);
    return glance === null ? [] : [glance];
  });
}

export function fencePath(text: string): string | null {
  const path = /^\+\+\+ (?:b\/)?(\S+)/m.exec(text)?.[1];
  return path === undefined || path === '/dev/null' ? null : path;
}

const FRAME_CLS =
  'w-full min-w-0 overflow-hidden rounded-(--radius-code) bg-card font-sans ring-1 ring-border';
const HEAD_CLS = 'flex h-9 items-center gap-2 border-b border-border pr-1.5 pl-3';

function FileHead({ path, todoId }: { path: string; todoId?: string }) {
  const { t } = useI18n();
  const { search } = useLocation();
  const cut = path.lastIndexOf('/');
  const dir = cut > 0 ? path.slice(0, cut) : '';
  return (
    <div className={HEAD_CLS} data-testid="glance-head">
      <span className="flex flex-none text-(--text-tertiary)">
        <FileGlyph name={path} />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-meta whitespace-nowrap">
        <span className="flex-none font-medium text-foreground">{path.slice(cut + 1)}</span>
        {dir !== '' && (
          <span className="min-w-0 truncate text-left text-(--text-tertiary) [direction:rtl]">
            <bdi className="[direction:ltr]">{dir}</bdi>
          </span>
        )}
      </span>
      {todoId !== undefined && (
        <IconTooltip
          label={t('在面板打开')}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="glance-open"
              aria-label={t('在面板打开')}
              render={<Link to={threadHrefFrom(todoId, search)} />}
            />
          }
        >
          <SquareArrowOutUpRight aria-hidden className="size-4" />
        </IconTooltip>
      )}
    </div>
  );
}

function glanceDiffFile(path: string, glanceLines: GlanceLine[]): DiffFile {
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
  for (const line of glanceLines) {
    if (line.kind === 'gap' || line.kind === 'note') {
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
  const added = glanceLines.filter((line) => line.kind === 'add').length;
  const removed = glanceLines.filter((line) => line.kind === 'del').length;
  return { path, added, removed, hunks };
}

type Part = { note: string } | { lines: GlanceLine[] };

function partsOf(lines: GlanceLine[]): Part[] {
  const parts: Part[] = [];
  let run: GlanceLine[] = [];
  for (const line of lines) {
    if (line.kind !== 'note') {
      run.push(line);
      continue;
    }
    if (run.length > 0) parts.push({ lines: run });
    parts.push({ note: line.text });
    run = [];
  }
  if (run.length > 0) parts.push({ lines: run });
  return parts;
}

export function DiffGlanceBlock({ glance }: { glance: DiffGlance }) {
  return (
    <div className={FRAME_CLS} data-testid="diff-glance">
      <FileHead
        path={glance.path}
        {...(glance.todoId === undefined ? {} : { todoId: glance.todoId })}
      />
      <div className="py-1" data-testid="glance-lines">
        {partsOf(glance.lines).map((part, i) =>
          'note' in part ? (
            <p
              key={i}
              data-testid="glance-note"
              className="my-1.5 mr-3 ml-8 w-fit max-w-[calc(100%-2.75rem)] rounded-(--radius-control) bg-background px-2.5 py-1.5 text-meta text-foreground shadow-(--e1)"
            >
              {part.note}
            </p>
          ) : (
            <DiffFileBody
              key={i}
              file={glanceDiffFile(glance.path, part.lines)}
              buildId={null}
              showFull={false}
              glance
            />
          ),
        )}
      </div>
    </div>
  );
}

const SKELETON_WIDTHS = ['w-[62%]', 'w-[48%]', 'w-[70%]', 'w-[55%]', 'w-[80%]', 'w-[66%]'];

export function DiffGlanceSkeleton({ path, rows = 6 }: { path: string | null; rows?: number }) {
  const { t } = useI18n();
  return (
    <div
      className={FRAME_CLS}
      data-testid="diff-glance-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('正在生成改动')}
    >
      {path === null ? (
        <div className={HEAD_CLS}>
          <Skeleton className="h-3 w-2/5 rounded-full" />
        </div>
      ) : (
        <FileHead path={path} />
      )}
      <div className="flex flex-col py-1">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-5 items-center pr-3 pl-8">
            <Skeleton
              className={cn('h-3 rounded-full', SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])}
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
  const glances = useMemo(() => (open ? [] : fenceGlances(text)), [open, text]);
  const path = useMemo(() => (open ? fencePath(text) : null), [open, text]);
  if (open) return path === null ? fallback : <DiffGlanceSkeleton path={path} />;
  if (glances.length === 0) return fallback;
  return (
    <div className="flex flex-col gap-3">
      {glances.map((glance) => (
        <DiffGlanceBlock key={glance.path} glance={glance} />
      ))}
    </div>
  );
}
