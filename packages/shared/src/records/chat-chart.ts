import { z } from 'zod';

export const CHART_MAX_SERIES = 5;
export const CHART_MAX_CATEGORIES = 24;

export const chartSeriesSchema = z.object({
  name: z.string().min(1).max(40),
  values: z.array(z.number().finite()),
  role: z.enum(['before', 'after']).optional(),
});

export const chatChartSchema = z
  .object({
    type: z.enum(['bar', 'line']),
    title: z.string().min(1).max(120),
    unit: z.string().max(20).optional(),
    categories: z.array(z.string().min(1).max(40)).min(1).max(CHART_MAX_CATEGORIES),
    series: z.array(chartSeriesSchema).min(1).max(CHART_MAX_SERIES),
    summary: z.string().max(400).optional(),
  })
  .superRefine((chart, ctx) => {
    chart.series.forEach((series, index) => {
      if (series.values.length !== chart.categories.length)
        ctx.addIssue({
          code: 'custom',
          path: ['series', index, 'values'],
          message: `series "${series.name}" has ${series.values.length} values for ${chart.categories.length} categories`,
        });
    });
  });
export type ChatChart = z.infer<typeof chatChartSchema>;

const FREE_SLOTS = [1, 3, 5, 4, 2] as const;

export function chartSlots(chart: Pick<ChatChart, 'series'>): number[] {
  const taken = new Set<number>(
    chart.series.flatMap((series) =>
      series.role === 'after' ? [1] : series.role === 'before' ? [2] : [],
    ),
  );
  const free = FREE_SLOTS.filter((slot) => !taken.has(slot));
  let next = 0;
  return chart.series.map((series) => {
    if (series.role === 'after') return 1;
    if (series.role === 'before') return 2;
    return free[next++ % free.length] ?? 3;
  });
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function chartTableMarkdown(chart: ChatChart): string {
  const unit = chart.unit === undefined ? '' : ` (${chart.unit})`;
  const head = `|  | ${chart.series.map((series) => cell(`${series.name}${unit}`)).join(' | ')} |`;
  const rule = `|---|${chart.series.map(() => '---:').join('|')}|`;
  const rows = chart.categories.map(
    (category, i) =>
      `| ${cell(category)} | ${chart.series.map((series) => String(series.values[i] ?? '')).join(' | ')} |`,
  );
  return [
    `**${cell(chart.title)}**`,
    '',
    head,
    rule,
    ...rows,
    ...(chart.summary === undefined ? [] : ['', chart.summary]),
  ].join('\n');
}
