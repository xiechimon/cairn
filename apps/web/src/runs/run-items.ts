import type { RunTraceItem } from '@cairn/shared';

type ToolItem = Extract<RunTraceItem, { kind: 'tool' }>;

export type RunRow =
  | { type: 'item'; key: string; item: RunTraceItem; recovered: boolean }
  | { type: 'tools'; key: string; tools: ToolItem[] };

export const FOLD_MIN_TOOLS = 3;

const isQuietTool = (item: RunTraceItem): item is ToolItem => item.kind === 'tool' && !item.isError;

export function isProblem(item: RunTraceItem): boolean {
  return item.kind === 'error' || (item.kind === 'tool' && item.isError);
}

export function runRows(items: readonly RunTraceItem[], problemsOnly: boolean): RunRow[] {
  const recoveredAt = (index: number) => {
    const item = items[index];
    if (item?.kind !== 'tool' || !item.isError) return false;
    return items
      .slice(index + 1)
      .some(
        (later) => later.kind === 'tool' || later.kind === 'reply' || later.kind === 'thinking',
      );
  };
  if (problemsOnly)
    return items.flatMap((item, index) =>
      isProblem(item)
        ? [{ type: 'item' as const, key: item.id, item, recovered: recoveredAt(index) }]
        : [],
    );
  const rows: RunRow[] = [];
  let run: ToolItem[] = [];
  const close = () => {
    if (run.length >= FOLD_MIN_TOOLS)
      rows.push({ type: 'tools', key: `tools-${run[0]?.id}`, tools: run });
    else
      for (const tool of run)
        rows.push({ type: 'item', key: tool.id, item: tool, recovered: false });
    run = [];
  };
  items.forEach((item, index) => {
    if (isQuietTool(item)) {
      run.push(item);
      return;
    }
    close();
    rows.push({ type: 'item', key: item.id, item, recovered: recoveredAt(index) });
  });
  close();
  return rows;
}

export function oneLine(value: unknown): string {
  return fullText(value).replace(/\s+/g, ' ').trim();
}

export function fullText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((part) => typeof part?.text === 'string'))
    return value.map((part) => part.text as string).join('\n');
  return JSON.stringify(value, null, 2);
}
