import { columnName } from '@cairn/shared';
import Papa from 'papaparse';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/provider.js';
import { CommentPin } from '../../design/design-comment-list.js';
import { useCommentLayer } from '../file-comments.js';

interface Cell {
  r: number;
  c: number;
}

interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

function cellAt(target: EventTarget | null): Cell | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-r]') : null;
  if (element === null) return null;
  return { r: Number(element.dataset.r), c: Number(element.dataset.c) };
}

function rangeOf(a: Cell, b: Cell): Range {
  return {
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

function inRange(range: Range | null, r: number, c: number): boolean {
  return range !== null && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
}

function useCellPicking(table: HTMLTableElement | null) {
  const layer = useCommentLayer();
  const commenting = layer?.commenting ?? false;
  const pick = layer?.pick;
  const [range, setRange] = useState<Range | null>(null);
  useEffect(() => {
    if (table === null || !commenting || pick === undefined) {
      setRange(null);
      return;
    }
    let start: Cell | null = null;
    let current: Range | null = null;
    const down = (event: PointerEvent) => {
      start = cellAt(event.target);
      if (start === null) return;
      event.preventDefault();
      current = rangeOf(start, start);
      setRange(current);
    };
    const move = (event: PointerEvent) => {
      if (start === null) return;
      const cell = cellAt(document.elementFromPoint(event.clientX, event.clientY));
      if (cell === null) return;
      current = rangeOf(start, cell);
      setRange(current);
    };
    const up = (event: PointerEvent) => {
      if (start === null || current === null) return;
      start = null;
      pick({
        anchor: { type: 'cells', ...current },
        point: { x: event.clientX, y: event.clientY },
      });
    };
    table.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      table.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [table, commenting, pick]);
  const pins = new Map<string, { id: string; pin: number; status: 'open' | 'sent' | 'resolved' }>();
  for (const comment of layer?.comments ?? [])
    if (comment.anchor?.type === 'cells')
      pins.set(`${comment.anchor.r1}:${comment.anchor.c1}`, comment);
  return { layer, commenting, range, pins };
}

const MAX_ROWS = 5000;

export function parseSheet(text: string, name: string): string[][] {
  const tsv = name.toLowerCase().endsWith('.tsv');
  const parsed = Papa.parse<string[]>(text.replace(/\n$/, ''), {
    delimiter: tsv ? '\t' : '',
    skipEmptyLines: 'greedy',
  });
  return parsed.data;
}

export function SheetViewer({ name, text }: { name: string; text: string }) {
  const { t } = useI18n();
  const rows = useMemo(() => parseSheet(text, name), [text, name]);
  const [head = [], ...body] = rows;
  const shown = body.slice(0, MAX_ROWS);
  const width = Math.max(head.length, ...shown.map((row) => row.length));
  const columns = Array.from({ length: width }, (_, index) => index);
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const { layer, commenting, range, pins } = useCellPicking(table);
  const report = layer?.report;
  useEffect(() => report?.({ rows: body.length + 1, cols: width }), [report, body.length, width]);
  const cellClass = (r: number, c: number) =>
    `relative ${commenting ? 'cursor-cell select-none' : ''} ${inRange(range, r, c) ? 'bg-(--focus-ring)/10 outline-1 -outline-offset-1 outline-(--focus-ring)' : ''}`;
  const pinOf = (r: number, c: number) => {
    const comment = pins.get(`${r}:${c}`);
    return comment === undefined || layer === null ? null : (
      <span className="absolute top-6 right-3">
        <CommentPin
          pin={comment.pin}
          status={comment.status}
          onClick={() => layer.focus(comment.id)}
        />
      </span>
    );
  };
  return (
    <div data-testid="artifact-sheet" className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <table ref={setTable} className="w-full border-collapse text-ui tabular-nums">
        <thead className="sticky top-0 z-1 bg-background">
          <tr>
            {columns.map((index) => (
              <th
                key={index}
                scope="col"
                data-cell={`${columnName(index)}1`}
                data-r={0}
                data-c={index}
                className={`h-11 border-b border-border px-4 text-left font-normal whitespace-nowrap text-content-secondary ${cellClass(0, index)}`}
              >
                {head[index] ?? ''}
                {pinOf(0, index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border">
              {columns.map((index) => (
                <td
                  key={index}
                  data-cell={`${columnName(index)}${rowIndex + 2}`}
                  data-r={rowIndex + 1}
                  data-c={index}
                  className={`h-11 max-w-80 truncate px-4 text-foreground ${cellClass(rowIndex + 1, index)}`}
                >
                  {row[index] ?? ''}
                  {pinOf(rowIndex + 1, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > MAX_ROWS && (
        <p className="m-0 px-4 py-3 text-meta text-content-tertiary">
          {t('只显示前 {n} 行，下载查看全部', { n: MAX_ROWS })}
        </p>
      )}
    </div>
  );
}
