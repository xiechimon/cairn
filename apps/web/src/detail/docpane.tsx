import type { DiffFileContent } from '@cairn/shared';
import { cn } from 'cn';
import { useMemo } from 'react';
import { useBuildChangeFile } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import type { DiffFile, DocBlock } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Segments } from './segments.js';
import { computeHunkWordDiff } from './word-diff.js';

const HUNK_RANGE = /^@@ -(\d+)(?:,(\d+))? /;

function oldRange(header: string): { start: number; length: number } | null {
  const match = HUNK_RANGE.exec(header);
  if (match == null) return null;
  return { start: Number(match[1]), length: match[2] === undefined ? 1 : Number(match[2]) };
}

export function unmodifiedBefore(hunks: readonly { header: string }[], index: number): number {
  const current = oldRange(hunks[index]?.header ?? '');
  if (current == null) return 0;
  if (index === 0) return Math.max(current.start - 1, 0);
  const previous = oldRange(hunks[index - 1]?.header ?? '');
  if (previous == null) return 0;
  return Math.max(current.start - (previous.start + previous.length), 0);
}

const DIFF_LINE =
  'flex items-center font-mono text-code leading-5 text-(--foreground) [font-variant-ligatures:none]';
const DIFF_NO = 'w-8 flex-none pr-2 text-right text-(--text-tertiary) select-none';
const DIFF_KIND_SKIN: Record<string, string> = {
  add: 'bg-(--diff-add-bg) shadow-[inset_2px_0_0_var(--diff-add-fg)]',
  del: 'bg-(--diff-del-bg) shadow-[inset_2px_0_0_var(--destructive)]',
  marker: 'bg-transparent text-(--text-tertiary)',
  context: '',
};
const WORD_SKIN: Record<string, string> = {
  add: 'bg-(--diff-add-word-bg)',
  del: 'bg-(--diff-del-word-bg)',
};

type FullFileView =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'binary' }
  | { kind: 'text'; content: string };

function deriveFullFileView(
  fetchLive: boolean,
  showFull: boolean,
  fixtureContent: string | null,
  file: { isError: boolean; data: DiffFileContent | undefined },
): FullFileView {
  if (!showFull) return { kind: 'hidden' };
  if (!fetchLive) {
    return fixtureContent !== null ? { kind: 'text', content: fixtureContent } : { kind: 'binary' };
  }
  if (file.isError) return { kind: 'error' };
  if (file.data === undefined) return { kind: 'loading' };
  return file.data.encoding === 'base64'
    ? { kind: 'binary' }
    : { kind: 'text', content: file.data.content };
}

export function DiffFileBody({
  file,
  buildId,
  showFull,
  wrap = false,
}: {
  file: DiffFile;
  buildId: string | null;
  showFull: boolean;
  wrap?: boolean;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const fetchLive = live && buildId != null;
  const fullQ = useBuildChangeFile(buildId, showFull ? file.path : null, fetchLive);
  const full = deriveFullFileView(fetchLive, showFull, file.fullContent ?? null, fullQ);
  const wordDiffs = useMemo(
    () => file.hunks.map((hunk) => computeHunkWordDiff(hunk.lines)),
    [file.hunks],
  );
  const lineText = wrap
    ? 'min-w-0 pl-2 whitespace-pre-wrap [overflow-wrap:anywhere]'
    : 'pl-2 whitespace-pre';
  const lineRow = wrap ? `${DIFF_LINE} items-start` : DIFF_LINE;
  return (
    <>
      {full.kind === 'hidden' &&
        file.hunks.map((hunk, hi) => {
          const wordDiff = wordDiffs[hi];
          return (
            <div key={hunk.header}>
              {unmodifiedBefore(file.hunks, hi) > 0 && (
                <div
                  className="flex h-7 items-center pl-3 text-meta text-(--text-tertiary)"
                  data-testid="diff-fold"
                >
                  {t('{n} 行未改动', { n: unmodifiedBefore(file.hunks, hi) })}
                </div>
              )}
              <div
                className={cn(
                  'bg-(--secondary) pl-18 font-mono text-code leading-6 text-(--text-tertiary) [font-variant-ligatures:none]',
                  wrap && 'truncate pr-3',
                )}
              >
                {hunk.header}
              </div>
              {hunk.lines.map((line, i) => {
                const segs = wordDiff?.segments.get(i);
                const isCapped = wordDiff?.capped.has(i) === true;
                return (
                  <div
                    key={i}
                    className={`diff-line--${line.kind} ${lineRow} ${
                      DIFF_KIND_SKIN[line.kind] ?? ''
                    }`}
                    data-kind={line.kind}
                    data-word={isCapped ? 'capped' : undefined}
                    title={isCapped ? t('行过长，已退回整行高亮') : undefined}
                  >
                    <span data-no="old" className={`${DIFF_NO} w-5`}>
                      {line.oldNo ?? ''}
                    </span>
                    <span data-no="new" className={`${DIFF_NO} w-5`}>
                      {line.newNo ?? ''}
                    </span>
                    <span className="sr-only">
                      {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}
                    </span>
                    <span className={lineText}>
                      {segs == null
                        ? line.text
                        : segs.map((seg, si) =>
                            seg.changed ? (
                              <span key={si} data-word={line.kind} className={WORD_SKIN[line.kind]}>
                                {seg.text}
                              </span>
                            ) : (
                              seg.text
                            ),
                          )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      {full.kind === 'text' && (
        <div data-testid="diff-full">
          {full.content
            .replace(/\n$/, '')
            .split('\n')
            .map((text, i) => (
              <div key={i} className={lineRow} data-kind="context">
                <span data-no="old" className={`${DIFF_NO} w-5`} />
                <span data-no="new" className={`${DIFF_NO} w-5`}>
                  {i + 1}
                </span>
                <span className={lineText}>{text}</span>
              </div>
            ))}
        </div>
      )}
      {(full.kind === 'loading' || full.kind === 'error' || full.kind === 'binary') && (
        <div className="py-2 pr-3 pl-18 font-mono text-code leading-4 text-(--text-tertiary)">
          {full.kind === 'loading'
            ? t('加载中…')
            : full.kind === 'error'
              ? t('文件加载失败')
              : t('二进制文件暂不支持预览')}
        </div>
      )}
    </>
  );
}

function docBlockClass(kind: string, first: boolean): string {
  const base = 'text-card-title break-words text-(--foreground)';
  if (kind === 'para') return `${base}${first ? '' : ' mt-2'}`;
  if (kind === 'bullet') return `${base} relative mt-1 pl-4`;
  return `${base} ${first ? 'mt-0' : 'mt-6'} mb-1.5 text-meta font-medium text-(--text-tertiary)`;
}

export function DocPane({ doc }: { doc: DocBlock[] | undefined }) {
  const { t } = useI18n();
  return (
    <section className="doc-pane flex min-h-0 flex-1 flex-col" data-testid="doc-pane">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3.5 pt-2 pb-4" data-testid="doc-body">
          {doc == null ? (
            <div className="flex h-24 items-center justify-center text-meta text-(--text-tertiary)">
              {t('暂无方案')}
            </div>
          ) : (
            doc.map((block, i) => (
              <p
                key={i}
                className={cn(`doc-block--${block.kind}`, docBlockClass(block.kind, i === 0))}
              >
                {block.kind === 'bullet' && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2.5 left-1 size-1 rounded-full bg-(--text-tertiary)"
                  />
                )}
                <Segments segments={block.segments} codeClassName="doc-code" />
              </p>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
