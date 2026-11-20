// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { cn } from 'cn';
import { useEffect, useMemo, useState } from 'react';
import { type CodeToken, highlightCode } from '../../detail/code-highlight.js';
import { useI18n } from '../../i18n/provider.js';

export const CODE_VIEWER_MAX_LINES = 5000;
const HIGHLIGHT_MAX_LINES = 1500;

type DiffLine = 'add' | 'del' | 'hunk' | null;

const DIFF_ROW: Record<Exclude<DiffLine, null>, string> = {
  add: 'bg-(--diff-add-bg) text-(--diff-add-fg)',
  del: 'bg-(--diff-del-bg)',
  hunk: 'text-content-tertiary',
};

export function codeLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

function diffLineOf(line: string): DiffLine {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'del';
  return null;
}

function useLineTokens(text: string, lang: string | undefined, lineCount: number) {
  const [result, setResult] = useState<{ text: string; lines: CodeToken[][] } | null>(null);
  const highlightable = lang !== undefined && lineCount <= HIGHLIGHT_MAX_LINES;
  useEffect(() => {
    if (!highlightable || lang === undefined) return;
    let live = true;
    void highlightCode(text, lang).then((lines) => {
      if (live && lines !== null) setResult({ text, lines });
    });
    return () => {
      live = false;
    };
  }, [text, lang, highlightable]);
  return highlightable && result?.text === text ? result.lines : null;
}

function LineContent({ line, tokens }: { line: string; tokens: CodeToken[] | undefined }) {
  if (tokens === undefined || tokens.length === 0) return line === '' ? '​' : line;
  return tokens.map((token, col) =>
    token.color === undefined ? (
      token.content
    ) : (
      <span key={col} style={{ color: token.color }}>
        {token.content}
      </span>
    ),
  );
}

export function CodeWithLines({
  text,
  lang,
  diff = false,
}: {
  text: string;
  lang?: string | undefined;
  diff?: boolean;
}) {
  const { t } = useI18n();
  const lines = useMemo(() => codeLines(text), [text]);
  const shown = useMemo(() => lines.slice(0, CODE_VIEWER_MAX_LINES), [lines]);
  const shownText = useMemo(() => shown.join('\n'), [shown]);
  const tokens = useLineTokens(shownText, diff ? undefined : lang, shown.length);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4">
      <div
        data-testid="file-preview-text"
        className="grid flex-none grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded-(--radius-tile) bg-(--card) font-mono text-code text-foreground inset-ring-1 inset-ring-(--border)"
      >
        <span aria-hidden className="h-2 border-r border-(--border)" />
        <span aria-hidden className="h-2" />
        {shown.map((line, index) => {
          const kind = diff ? diffLineOf(line) : null;
          const row = kind === null ? undefined : DIFF_ROW[kind];
          return (
            <div
              key={index}
              data-slot="file-line"
              {...(kind !== null ? { 'data-diff': kind } : {})}
              className="contents"
            >
              <span
                aria-hidden
                className={cn(
                  'min-w-10 border-r border-(--border) pr-2 pl-3 text-right text-content-tertiary tabular-nums select-none',
                  row,
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn('min-w-0 px-3 whitespace-pre-wrap [overflow-wrap:anywhere]', row)}
              >
                <LineContent line={line} tokens={tokens?.[index]} />
              </span>
            </div>
          );
        })}
        <span aria-hidden className="h-2 border-r border-(--border)" />
        <span aria-hidden className="h-2" />
      </div>
      {lines.length > shown.length && (
        <p
          data-testid="file-preview-truncated"
          className="m-0 px-1 pt-2 text-meta text-content-tertiary"
        >
          {t('只显示前 {n} 行，下载查看完整文件', { n: CODE_VIEWER_MAX_LINES })}
        </p>
      )}
    </div>
  );
}
