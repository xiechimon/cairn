import { columnName } from '@cairn/shared';
import Papa from 'papaparse';
import { useMemo } from 'react';
import { useI18n } from '../../../i18n/provider.js';

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
  return (
    <div data-testid="artifact-sheet" className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <table className="w-full border-collapse text-ui tabular-nums">
        <thead className="sticky top-0 z-1 bg-background">
          <tr>
            {columns.map((index) => (
              <th
                key={index}
                scope="col"
                data-cell={`${columnName(index)}1`}
                className="h-11 border-b border-border px-4 text-left font-normal whitespace-nowrap text-content-secondary"
              >
                {head[index] ?? ''}
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
                  className="h-11 max-w-80 truncate px-4 text-foreground"
                >
                  {row[index] ?? ''}
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
