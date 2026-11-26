import { type ChatChart, chartSlots } from '@cairn/shared';
import { cn } from 'cn';
import { Copy, Table2, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { useCopiedFlash } from '../copy-icon-button.js';
import { SubtreeErrorBoundary } from '../subtree-error-boundary.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';

const SLOT_FILL: Record<number, string> = {
  1: 'fill-(--chart-1)',
  2: 'fill-(--chart-2)',
  3: 'fill-(--chart-3)',
  4: 'fill-(--chart-4)',
  5: 'fill-(--chart-5)',
};
const SLOT_STROKE: Record<number, string> = {
  1: 'stroke-(--chart-1)',
  2: 'stroke-(--chart-2)',
  3: 'stroke-(--chart-3)',
  4: 'stroke-(--chart-4)',
  5: 'stroke-(--chart-5)',
};
const SLOT_BG: Record<number, string> = {
  1: 'bg-(--chart-1)',
  2: 'bg-(--chart-2)',
  3: 'bg-(--chart-3)',
  4: 'bg-(--chart-4)',
  5: 'bg-(--chart-5)',
};
const LINE_DASHES = ['', '5 4', '1.5 3.5', '8 3 2 3', '2 2'];

const PAD = { left: 40, right: 8, top: 8, bottom: 28 };
const PLOT_HEIGHT = { bar: 232, line: 208 } as const;
const MIN_WIDTH = 240;

const FIGURE_CLS = 'relative m-0 w-full max-w-[min(100%,var(--container-reply))] font-sans';
const HEAD_CLS = 'flex items-baseline gap-2 text-ui font-medium text-(--foreground)';
const UNIT_CLS = 'text-meta font-normal text-(--text-tertiary)';
const SUMMARY_CLS = 'mt-1.5 text-meta text-(--text-secondary) tabular-nums text-pretty';
const AXIS_TEXT_CLS = 'fill-(--text-tertiary) font-sans text-caption font-normal tabular-nums';

interface Series {
  index: number;
  name: string;
  values: number[];
  slot: number;
  dash: string;
}

const fmt = (value: number) => value.toLocaleString();

function niceMax(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

function seriesOf(chart: ChatChart): Series[] {
  const slots = chartSlots(chart);
  return chart.series.map((series, index) => ({
    index,
    name: series.name,
    values: series.values,
    slot: slots[index] ?? 3,
    dash: chart.type === 'line' ? (LINE_DASHES[index] ?? '') : '',
  }));
}

function csvOf(chart: ChatChart): string {
  const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  return [
    ['', ...chart.series.map((series) => series.name)].map(cell).join(','),
    ...chart.categories.map((category, i) =>
      [cell(category), ...chart.series.map((series) => String(series.values[i] ?? ''))].join(','),
    ),
  ].join('\n');
}

function ChartHead({ chart }: { chart: ChatChart }) {
  return (
    <>
      {chart.title}
      {chart.unit !== undefined && <span className={UNIT_CLS}>{chart.unit}</span>}
    </>
  );
}

function ChartTable({ chart }: { chart: ChatChart }) {
  return (
    <div className="mt-2 max-w-full overflow-x-auto">
      <table
        className="w-full border-collapse text-meta text-(--foreground) tabular-nums"
        data-testid="chat-chart-table"
      >
        <thead>
          <tr>
            <th className="border-b border-border py-1.5 pr-3 text-left font-medium text-(--text-tertiary)" />
            {chart.series.map((series) => (
              <th
                key={series.name}
                className="border-b border-border py-1.5 pr-3 text-right font-medium text-(--text-tertiary)"
              >
                {chart.unit === undefined ? series.name : `${series.name} (${chart.unit})`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.categories.map((category, i) => (
            <tr key={category}>
              <td className="border-b border-border py-1.5 pr-3">{category}</td>
              {chart.series.map((series) => (
                <td key={series.name} className="border-b border-border py-1.5 pr-3 text-right">
                  {fmt(series.values[i] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartError({ chart }: { chart: ChatChart }) {
  const { t } = useI18n();
  return (
    <figure className={FIGURE_CLS} data-testid="chat-chart-error">
      <div className="flex items-center gap-1.5 text-meta text-(--text-tertiary)">
        <TriangleAlert className="size-4" strokeWidth={1.75} aria-hidden />
        {t('图表画不出来，下面是同一份数据。')}
      </div>
      <div className={cn(HEAD_CLS, 'mt-3')}>
        <ChartHead chart={chart} />
      </div>
      <ChartTable chart={chart} />
      {chart.summary !== undefined && <p className={SUMMARY_CLS}>{chart.summary}</p>}
    </figure>
  );
}

function Swatch({ type, series }: { type: ChatChart['type']; series: Series }) {
  return (
    <svg className="h-2.5! w-3.5! flex-none" viewBox="0 0 14 10" aria-hidden>
      {type === 'bar' ? (
        <rect x="2" y="0" width="10" height="10" rx="2" className={SLOT_FILL[series.slot]} />
      ) : (
        <line
          x1="0"
          y1="5"
          x2="14"
          y2="5"
          strokeWidth="2"
          strokeLinecap="round"
          className={SLOT_STROKE[series.slot]}
          {...(series.dash === '' ? {} : { strokeDasharray: series.dash })}
        />
      )}
    </svg>
  );
}

function useWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, Math.max(MIN_WIDTH, width)] as const;
}

function Plot({
  chart,
  shown,
  width,
  hover,
}: {
  chart: ChatChart;
  shown: Series[];
  width: number;
  hover: number | null;
}) {
  const height = PLOT_HEIGHT[chart.type];
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(1, ...shown.flatMap((series) => series.values)));
  const ticks = max % 4 === 0 && Number.isInteger(max / 4) ? 4 : 5;
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const n = chart.categories.length;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const value = (max * i) / ticks;
    const at = Math.round(y(value)) + 0.5;
    return (
      <g key={i}>
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={at}
          y2={at}
          strokeWidth="1"
          className={i === 0 ? 'stroke-(--input)' : 'stroke-(--border)'}
        />
        <text x={PAD.left - 8} y={at + 4} textAnchor="end" className={AXIS_TEXT_CLS}>
          {fmt(Math.round(value))}
        </text>
      </g>
    );
  });
  if (chart.type === 'bar') {
    const band = plotWidth / n;
    const inner = Math.min(band * 0.72, 28 * shown.length + 6 * (shown.length - 1));
    const gap = shown.length > 1 ? 4 : 0;
    const barWidth = (inner - gap * (shown.length - 1)) / shown.length;
    const base = PAD.top + plotHeight;
    return (
      <>
        {grid}
        {hover !== null && (
          <rect
            x={PAD.left + hover * band + 2}
            y={PAD.top}
            width={band - 4}
            height={plotHeight}
            rx="6"
            className="fill-(--menu-hover)"
          />
        )}
        {chart.categories.map((category, i) => {
          const start = PAD.left + i * band + (band - inner) / 2;
          return (
            <g key={category}>
              {shown.map((series, j) => {
                const top = y(series.values[i] ?? 0);
                const x = start + j * (barWidth + gap);
                const r = Math.min(3, barWidth / 2, base - top);
                return (
                  <path
                    key={series.index}
                    d={`M${x},${base} V${top + r} q0,-${r} ${r},-${r} h${barWidth - 2 * r} q${r},0 ${r},${r} V${base} Z`}
                    className={SLOT_FILL[series.slot]}
                    opacity={hover !== null && hover !== i ? 0.45 : 1}
                  />
                );
              })}
              <text
                x={PAD.left + i * band + band / 2}
                y={height - 8}
                textAnchor="middle"
                className={AXIS_TEXT_CLS}
              >
                {category}
              </text>
            </g>
          );
        })}
      </>
    );
  }
  const step = n > 1 ? plotWidth / (n - 1) : 0;
  const x = (i: number) => PAD.left + i * step;
  const every = step === 0 ? 1 : Math.max(1, Math.ceil(52 / step));
  return (
    <>
      {grid}
      {chart.categories.map((category, i) =>
        i % every === 0 ? (
          <text
            key={category}
            x={x(i)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : 'middle'}
            className={AXIS_TEXT_CLS}
          >
            {category}
          </text>
        ) : null,
      )}
      {hover !== null && (
        <line
          x1={x(hover)}
          x2={x(hover)}
          y1={PAD.top}
          y2={PAD.top + plotHeight}
          strokeWidth="1"
          strokeDasharray="2 3"
          className="stroke-(--text-tertiary)"
        />
      )}
      {shown.map((series) => (
        <g key={series.index}>
          <path
            d={series.values
              .map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`)
              .join(' ')}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            className={SLOT_STROKE[series.slot]}
            {...(series.dash === '' ? {} : { strokeDasharray: series.dash })}
          />
          <circle
            cx={x(n - 1)}
            cy={y(series.values[n - 1] ?? 0)}
            r="3"
            className={SLOT_FILL[series.slot]}
          />
          {hover !== null && (
            <circle
              cx={x(hover)}
              cy={y(series.values[hover] ?? 0)}
              r="4"
              strokeWidth="2"
              className={cn('fill-background', SLOT_STROKE[series.slot])}
            />
          )}
        </g>
      ))}
    </>
  );
}

function Readout({
  chart,
  shown,
  hover,
  width,
}: {
  chart: ChatChart;
  shown: Series[];
  hover: number;
  width: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState(140);
  useEffect(() => {
    if (ref.current !== null) setOwn(ref.current.offsetWidth);
  });
  const n = chart.categories.length;
  const plotWidth = width - PAD.left - PAD.right;
  const at =
    chart.type === 'bar'
      ? PAD.left + (hover + 0.5) * (plotWidth / n)
      : PAD.left + hover * (n > 1 ? plotWidth / (n - 1) : 0);
  let left = at + 16;
  if (left + own > width) left = at - 16 - own;
  if (left < 0) left = Math.max(0, Math.min(width - own, at - own / 2));
  const before = shown.find((series) => chart.series[series.index]?.role === 'before') ?? shown[0];
  const after = shown.find((series) => chart.series[series.index]?.role === 'after') ?? shown[1];
  const from = before?.values[hover];
  const to = after?.values[hover];
  const delta =
    chart.type === 'bar' &&
    shown.length === 2 &&
    from !== undefined &&
    to !== undefined &&
    from !== 0
      ? Math.round((Math.abs(from - to) / from) * 100)
      : null;
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-3 min-w-33 rounded-lg bg-popover px-2.5 py-2 text-meta whitespace-nowrap tabular-nums shadow-(--e2)"
      style={{ left, top: 8 }}
      data-testid="chat-chart-readout"
    >
      <div className="mb-0.5 text-(--text-tertiary)">{chart.categories[hover]}</div>
      {shown.map((series) => (
        <div key={series.index} className="flex items-center gap-2 text-(--foreground)">
          <span className={cn('size-2 flex-none rounded-xs', SLOT_BG[series.slot])} />
          {series.name}
          <b className="ml-auto pl-3 font-medium">
            {fmt(series.values[hover] ?? 0)}
            {chart.unit !== undefined && ` ${chart.unit}`}
          </b>
        </div>
      ))}
      {delta !== null && from !== undefined && to !== undefined && (
        <div className="mt-0.5 text-(--running-text)">
          {to <= from ? t('降了 {n}%', { n: delta }) : t('升了 {n}%', { n: delta })}
        </div>
      )}
    </div>
  );
}

function valueText(chart: ChatChart, shown: Series[], at: number): string {
  const unit = chart.unit === undefined ? '' : ` ${chart.unit}`;
  return `${chart.categories[at] ?? ''}: ${shown
    .map((series) => `${series.name} ${fmt(series.values[at] ?? 0)}${unit}`)
    .join(', ')}`;
}

function ChartView({ chart }: { chart: ChatChart }) {
  const { t } = useI18n();
  const all = seriesOf(chart);
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const { copied, copy: copyText } = useCopiedFlash();
  const [ref, width] = useWidth();
  const shown = all.filter((series) => !off.has(series.index));
  const n = chart.categories.length;
  const height = PLOT_HEIGHT[chart.type];
  const indexAt = (event: PointerEvent<HTMLDivElement>): number | null => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const plotWidth = box.width - PAD.left - PAD.right;
    if (x < PAD.left - 10) return null;
    const raw =
      chart.type === 'bar'
        ? Math.floor((x - PAD.left) / (plotWidth / n))
        : Math.round((x - PAD.left) / (plotWidth / Math.max(1, n - 1)));
    return Math.max(0, Math.min(n - 1, raw));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setHover(null);
      return;
    }
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    setHover((current) => Math.max(0, Math.min(n - 1, (current ?? (delta > 0 ? -1 : n)) + delta)));
  };
  const toggle = (index: number) =>
    setOff((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else if (next.size < all.length - 1) next.add(index);
      return next;
    });
  const copy = () => copyText(csvOf(chart));
  const label = chart.summary === undefined ? chart.title : `${chart.title}。${chart.summary}`;
  return (
    <figure ref={ref} className={FIGURE_CLS} data-testid="chat-chart" data-chart-type={chart.type}>
      <figcaption className={HEAD_CLS}>
        <ChartHead chart={chart} />
      </figcaption>
      {all.length > 1 && (
        <fieldset
          className="m-0 mt-2.5 flex flex-wrap gap-1.5 border-0 p-0"
          aria-label={t('显示哪些数据')}
        >
          {all.map((series) => {
            const on = !off.has(series.index);
            return (
              <Button
                key={series.index}
                variant="ghost"
                size="sm"
                aria-pressed={on}
                data-testid="chat-chart-series"
                className={cn(
                  'cursor-pointer gap-1.5 rounded-full border-border font-normal hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)',
                  on ? 'text-(--text-secondary)' : 'text-(--text-tertiary) [&_svg]:opacity-35',
                )}
                onClick={() => toggle(series.index)}
              >
                <Swatch type={chart.type} series={series} />
                {series.name}
              </Button>
            );
          })}
        </fieldset>
      )}
      <div
        className="relative mt-2 touch-pan-y rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--text-tertiary)"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={hover ?? 0}
        aria-valuetext={hover === null ? chart.title : valueText(chart, shown, hover)}
        data-testid="chat-chart-plot"
        onPointerMove={(event) => setHover(indexAt(event))}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg
          className="block overflow-visible"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden
        >
          <Plot chart={chart} shown={shown} width={width} hover={hover} />
        </svg>
        {hover !== null && shown.length > 0 && (
          <Readout chart={chart} shown={shown} hover={hover} width={width} />
        )}
      </div>
      {chart.summary !== undefined && <p className={SUMMARY_CLS}>{chart.summary}</p>}
      <div className="mt-1.5 -ml-2 flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-(--text-tertiary)"
          aria-expanded={table}
          data-testid="chat-chart-table-toggle"
          onClick={() => setTable((open) => !open)}
        >
          <Table2 strokeWidth={1.75} aria-hidden />
          {table ? t('收起表格') : t('查看表格')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={copied ? 'text-(--running-text)' : 'text-(--text-tertiary)'}
          data-testid="chat-chart-csv"
          onClick={copy}
        >
          <Copy strokeWidth={1.75} aria-hidden />
          {copied ? t('已复制') : t('复制 CSV')}
        </Button>
      </div>
      {table ? (
        <ChartTable chart={chart} />
      ) : (
        <div className="sr-only">
          <ChartTable chart={chart} />
        </div>
      )}
    </figure>
  );
}

export function ChatChartBlock({ chart }: { chart: ChatChart }) {
  return (
    <SubtreeErrorBoundary frame={() => <ChartError chart={chart} />}>
      <ChartView chart={chart} />
    </SubtreeErrorBoundary>
  );
}

export function ChatChartSkeleton() {
  const { t } = useI18n();
  return (
    <figure
      className={FIGURE_CLS}
      role="status"
      aria-busy="true"
      aria-label={t('正在生成图表')}
      data-testid="chat-chart-skeleton"
    >
      <Skeleton className="my-0.5 h-3.5 w-45 rounded-full" />
      <div className="mt-2.5 flex gap-1.5">
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
      <div className="relative mt-2 h-58">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="absolute right-2 left-10 h-px bg-(--border)"
            style={{ top: 8 + i * 49 }}
          />
        ))}
        <div className="absolute top-51 right-2 left-10 h-px bg-(--input)" />
      </div>
      <Skeleton className="mt-2.5 mb-1 h-3 w-4/5 rounded-full" />
      <div className="h-8.5" />
    </figure>
  );
}
