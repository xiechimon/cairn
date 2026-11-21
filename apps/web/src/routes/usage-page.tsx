import type { DailyUsage } from '@cairn/shared';
import { cn } from 'cn';
import { ChartColumn, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTeams } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useDailyUsage } from '../api/usage-daily.js';
import { useNarrow } from '../board/use-narrow.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { RouteDialog } from '../overlay/route-dialog.js';
import {
  formatTokens,
  localDay,
  shiftDay,
  USAGE_FETCH_DAYS,
  USAGE_NARROW_WEEKS,
  USAGE_WEEKS,
  type UsageCell,
  type UsageGrid,
  type UsageSummary,
  usageGrid,
  usageSummary,
} from '../usage/usage-model.js';

const LEVEL_BG = [
  'bg-(--heat-0)',
  'bg-(--heat-1)',
  'bg-(--heat-2)',
  'bg-(--heat-3)',
  'bg-(--heat-4)',
] as const;
const TYPE_INKS = ['bg-(--heat-4)', 'bg-(--heat-3)', 'bg-(--heat-2)', 'bg-(--heat-1)'] as const;
const CARD_CLS = 'rounded-(--radius-card) bg-card shadow-(--e1)';

function useDateLabels() {
  const { locale } = useI18n();
  const intl = locale === 'zh' ? 'zh-CN' : 'en-US';
  const format = (options: Intl.DateTimeFormatOptions) => {
    const f = new Intl.DateTimeFormat(intl, { ...options, timeZone: 'UTC' });
    return (date: string) => f.format(new Date(`${date}T00:00:00Z`));
  };
  return {
    day: format({ month: 'long', day: 'numeric', weekday: 'short' }),
    short: format({ month: 'numeric', day: 'numeric' }),
    month: format({ month: 'short' }),
    weekday: format({ weekday: 'short' }),
  };
}

const percent = (share: number) =>
  share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`;
const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;

function Swatch({ ink }: { ink: string }) {
  return <i aria-hidden className={cn('block size-2 flex-none rounded-(--cds-radius-xs)', ink)} />;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-5 py-4 max-sm:px-4 max-sm:py-3">
      <span className="text-meta text-content-tertiary">{label}</span>
      <span className="voice-title text-brand text-foreground tabular-nums">{value}</span>
      {note !== undefined && (
        <span className="truncate text-meta text-content-tertiary tabular-nums">{note}</span>
      )}
    </div>
  );
}

function Stats({ summary, days }: { summary: UsageSummary; days: number }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="usage-stats"
      className={cn(
        'grid grid-cols-4 gap-px overflow-hidden bg-border max-sm:grid-cols-2',
        CARD_CLS,
      )}
    >
      <Stat
        label={t('过去一年')}
        value={`${formatTokens(summary.total)} token`}
        note={
          summary.total > 0
            ? t('Coordinator {a} · 任务 {b}', {
                a: percent(summary.coordinator / summary.total),
                b: percent(summary.tasks / summary.total),
              })
            : undefined
        }
      />
      <Stat
        label={t('用了')}
        value={t('{n} 天', { n: summary.usedDays })}
        note={t('共 {n} 天', { n: days })}
      />
      <Stat
        label={t('日均')}
        value={formatTokens(
          summary.usedDays === 0 ? 0 : Math.round(summary.total / summary.usedDays),
        )}
        note={t('按用了的天算')}
      />
      <Stat
        label={t('缓存命中')}
        value={summary.cacheHit === null ? '0%' : percent(summary.cacheHit)}
        note={summary.cost === null ? undefined : t('按标价 {cost}', { cost: usd(summary.cost) })}
      />
    </div>
  );
}

function TokenMix({ summary }: { summary: UsageSummary }) {
  const { t } = useI18n();
  const parts = [
    [t('输入'), summary.input],
    [t('输出'), summary.output],
    [t('缓存读取'), summary.cacheRead],
    [t('缓存写入'), summary.cacheWrite],
  ] as const;
  return (
    <div data-testid="usage-mix" className="flex flex-col gap-2">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-full">
        {parts.map(([label, tokens], i) =>
          tokens > 0 ? (
            <i key={label} className={cn('block', TYPE_INKS[i])} style={{ flexGrow: tokens }} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-content-tertiary">
        {parts.map(([label, tokens], i) => (
          <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Swatch ink={TYPE_INKS[i] ?? ''} />
            {label}
            <span className="text-foreground tabular-nums">{formatTokens(tokens)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface MonthTotals {
  total: number;
  coordinator: number;
  tasks: number;
}

function Readout({ cell, month }: { cell: UsageCell | null; month: MonthTotals }) {
  const { t } = useI18n();
  const labels = useDateLabels();
  const text =
    cell === null
      ? [
          t('本月'),
          `${formatTokens(month.total)} token`,
          `Coordinator ${formatTokens(month.coordinator)}`,
          `${t('任务')} ${formatTokens(month.tasks)}`,
        ].join(' · ')
      : cell.day === null || cell.total === 0
        ? `${labels.day(cell.date)} · ${t('没有用量')}`
        : [
            labels.day(cell.date),
            `${formatTokens(cell.total)} token`,
            `Coordinator ${formatTokens(cell.day.coordinator)}`,
            `${t('任务')} ${formatTokens(cell.day.tasks)}`,
          ].join(' · ');
  return (
    <p
      data-testid="usage-readout"
      aria-live="polite"
      className="m-0 min-w-0 truncate text-meta text-content-secondary tabular-nums"
    >
      {text}
    </p>
  );
}

function monthOutline(grid: UsageGrid, month: string, pitch: number, gap: number): string | null {
  const spots = grid.weeks.flatMap((week, col) =>
    week
      .filter((cell) => !cell.future && cell.date.startsWith(month))
      .map((cell) => ({ col, row: cell.weekday })),
  );
  const first = spots[0];
  const last = spots.at(-1);
  if (first === undefined || last === undefined) return null;
  const x = (line: number) => line * pitch - gap / 2;
  const y = x;
  const points =
    first.col === last.col
      ? [
          [first.col, first.row],
          [first.col + 1, first.row],
          [first.col + 1, last.row + 1],
          [first.col, last.row + 1],
        ]
      : [
          [first.col, first.row],
          [first.col + 1, first.row],
          [first.col + 1, 0],
          [last.col + 1, 0],
          [last.col + 1, last.row + 1],
          [last.col, last.row + 1],
          [last.col, 7],
          [first.col, 7],
        ];
  return `M${points.map(([c = 0, r = 0]) => `${x(c)},${y(r)}`).join('L')}Z`;
}

function Legend() {
  const { t } = useI18n();
  return (
    <div
      aria-hidden
      data-testid="usage-legend"
      className="flex flex-none items-center gap-1 text-caption text-content-tertiary"
    >
      {t('少')}
      {LEVEL_BG.map((bg) => (
        <i key={bg} className={cn('block size-2.5 rounded-(--cds-radius-xs)', bg)} />
      ))}
      {t('多')}
    </div>
  );
}

function Heatmap({
  grid,
  selected,
  onSelect,
  onHover,
}: {
  grid: UsageGrid;
  selected: string | null;
  onSelect: (date: string | null) => void;
  onHover: (date: string | null) => void;
}) {
  const { t } = useI18n();
  const labels = useDateLabels();
  const narrow = useNarrow();
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = narrow ? 'auto-cols-[16px]' : 'auto-cols-[12px]';
  const rows = narrow ? 'grid-rows-[repeat(7,16px)]' : 'grid-rows-[repeat(7,12px)]';
  const cellSize = narrow ? 'size-4' : 'size-3';
  const cells = grid.weeks.flat().filter((cell) => !cell.future);
  const focusDate = selected ?? cells.at(-1)?.date;

  const move = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const by = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const next = shiftDay(date, by);
    const target = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`);
    if (!target) return;
    onSelect(next);
    target.focus();
  };

  const firstWeek = grid.weeks[0] ?? [];
  const month = cells.at(-1)?.date.slice(0, 7) ?? '';
  const outline = monthOutline(grid, month, narrow ? 20 : 16, 4);
  return (
    <div
      className="grid w-max grid-cols-[auto_auto] gap-x-1.5 gap-y-1"
      onPointerLeave={() => onHover(null)}
    >
      <span />
      <div
        aria-hidden
        className={cn('grid h-3.5 grid-flow-col gap-x-1 text-caption text-content-tertiary', cols)}
      >
        {grid.weeks.map((week, w) => (
          <span
            key={week[0]?.date ?? w}
            className={cn(
              'whitespace-nowrap',
              week.some((cell) => !cell.future && cell.date.startsWith(month)) &&
                grid.monthStarts[w] !== null &&
                'font-medium text-foreground',
            )}
          >
            {grid.monthStarts[w] !== null && week[0] ? labels.month(week[0].date) : ''}
          </span>
        ))}
      </div>
      <div
        aria-hidden
        className={cn('grid gap-y-1 text-caption leading-none text-content-tertiary', rows)}
      >
        {firstWeek.map((cell) => (
          <span key={cell.weekday} className="flex items-center">
            {cell.weekday % 2 === 0 && cell.weekday < 6 ? labels.weekday(cell.date) : ''}
          </span>
        ))}
      </div>
      <div
        ref={gridRef}
        data-testid="usage-heatmap"
        className={cn('relative grid grid-flow-col gap-1', cols, rows)}
      >
        {outline !== null && (
          <svg
            aria-hidden
            data-testid="usage-current-month"
            className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground"
          >
            <path
              d={outline}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="3 2.5"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {grid.weeks
          .flat()
          .map((cell) =>
            cell.future ? (
              <span key={cell.date} />
            ) : (
              <Button
                key={cell.date}
                type="button"
                variant="link"
                size="icon"
                data-day={cell.date}
                data-level={cell.level}
                aria-pressed={cell.date === selected}
                aria-label={
                  cell.total === 0
                    ? `${labels.day(cell.date)}，${t('没有用量')}`
                    : `${labels.day(cell.date)}，${formatTokens(cell.total)} token`
                }
                tabIndex={cell.date === focusDate ? 0 : -1}
                className={cn(
                  cellSize,
                  'rounded-(--cds-radius-xs) border-0 p-0 hover:outline-solid hover:outline-2 hover:outline-offset-1 hover:outline-content-tertiary focus-visible:ring-2 focus-visible:ring-ring',
                  LEVEL_BG[cell.level],
                  cell.date === selected &&
                    'outline-solid outline-2 outline-offset-1 outline-foreground hover:outline-foreground',
                )}
                onPointerEnter={() => onHover(cell.date)}
                onClick={() => onSelect(cell.date === selected ? null : cell.date)}
                onKeyDown={(event) => move(event, cell.date)}
              />
            ),
          )}
      </div>
    </div>
  );
}

function Year({
  grid,
  firstDay,
  selected,
  onSelect,
}: {
  grid: UsageGrid;
  firstDay: string | null;
  selected: string | null;
  onSelect: (date: string | null) => void;
}) {
  const { t } = useI18n();
  const labels = useDateLabels();
  const [hover, setHover] = useState<string | null>(null);
  const cells = grid.weeks.flat();
  const shown = hover ?? selected;
  const cell = shown === null ? null : (cells.find((c) => c.date === shown) ?? null);
  const fresh = firstDay !== null && firstDay > shiftDay(grid.from, 28);
  const thisMonth =
    cells
      .filter((c) => !c.future)
      .at(-1)
      ?.date.slice(0, 7) ?? '';
  const monthCells = cells.filter((c) => !c.future && c.date.startsWith(thisMonth));
  const month = {
    total: monthCells.reduce((sum, c) => sum + c.total, 0),
    coordinator: monthCells.reduce((sum, c) => sum + (c.day?.coordinator ?? 0), 0),
    tasks: monthCells.reduce((sum, c) => sum + (c.day?.tasks ?? 0), 0),
  };
  return (
    <section
      data-testid="usage-year"
      className={cn('flex min-w-0 flex-col gap-3 px-4 pt-3.5 pb-3', CARD_CLS)}
    >
      <div className="flex min-h-5 items-center justify-between gap-4">
        <Readout cell={cell} month={month} />
        <Legend />
      </div>
      <div className="-m-1 flex justify-end overflow-hidden p-1">
        <Heatmap grid={grid} selected={selected} onSelect={onSelect} onHover={setHover} />
      </div>
      {fresh && firstDay !== null && (
        <p data-testid="usage-since" className="m-0 text-meta text-content-tertiary tabular-nums">
          {t('{date} 开始使用', { date: labels.short(firstDay) })}
        </p>
      )}
    </section>
  );
}

function Ranking({
  testId,
  title,
  rows,
  total,
}: {
  testId: string;
  title: string;
  rows: { id: string; name: string; note?: string; tokens: number }[];
  total: number;
}) {
  const top = rows[0]?.tokens ?? 1;
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col">
      <h3 className="m-0 pb-1 text-ui font-medium text-foreground">{title}</h3>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 border-t border-border py-2.5"
        >
          <span className="truncate text-ui text-foreground">
            {row.name}
            {row.note !== undefined && (
              <span className="ml-1.5 text-meta text-content-tertiary">{row.note}</span>
            )}
          </span>
          <span className="font-mono text-meta tabular-nums text-foreground">
            {formatTokens(row.tokens)}
            <span className="ml-2 text-content-tertiary">{percent(row.tokens / total)}</span>
          </span>
          <span className="col-span-2 block h-0.5 rounded-full bg-(--heat-0)">
            <i
              className="block h-full rounded-full bg-(--heat-2)"
              style={{ width: `${(row.tokens / top) * 100}%` }}
            />
          </span>
        </div>
      ))}
    </section>
  );
}

function UsageBody({ usage, today }: { usage: DailyUsage; today: string }) {
  const { t } = useI18n();
  const narrow = useNarrow();
  const [selected, setSelected] = useState<string | null>(null);
  const year = usageGrid(usage.days, today, USAGE_WEEKS);
  const grid = narrow ? usageGrid(usage.days, today, USAGE_NARROW_WEEKS) : year;
  const yearDays = usage.days.filter((day) => day.date >= year.from && day.date <= today);
  const yearSummary = usageSummary(yearDays);
  const picked = selected === null ? null : yearDays.filter((day) => day.date === selected);
  const scoped = picked === null ? yearSummary : usageSummary(picked);
  const models = new Map(usage.models.map((model) => [model.key, model]));
  const projects = new Map(usage.projects.map((project) => [project.id, project.name]));
  const modelName = (key: string) => models.get(key)?.name ?? key;
  const usedDates = yearDays.filter((day) => day.coordinator + day.tasks > 0);
  return (
    <div className="flex flex-col gap-6 px-7 pt-7 pb-8 max-sm:gap-5 max-sm:px-4 max-sm:pt-5">
      <Year
        grid={grid}
        firstDay={usedDates[0]?.date ?? null}
        selected={selected}
        onSelect={setSelected}
      />
      <Stats summary={yearSummary} days={year.days} />
      <TokenMix summary={scoped} />
      <div className="grid grid-cols-2 gap-8 max-sm:grid-cols-1 max-sm:gap-6">
        <Ranking
          testId="usage-models"
          title={t('模型')}
          total={scoped.total}
          rows={scoped.models.map(([key, tokens]) => ({
            id: key,
            name: modelName(key),
            note: models.get(key)?.provider,
            tokens,
          }))}
        />
        {scoped.projects.length > 0 && (
          <Ranking
            testId="usage-projects"
            title={t('项目')}
            total={scoped.tasks}
            rows={scoped.projects.map(([id, tokens]) => ({
              id,
              name: projects.get(id) ?? t('已删除的项目'),
              tokens,
            }))}
          />
        )}
      </div>
    </div>
  );
}

export function UsagePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const { live } = useLiveData();
  const fixture = resolveScenario(params);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDay(live ? Date.now() : fixture.now, tz);
  const teams = useTeams(live);
  const teamId = teams.isSuccess ? teams.data[0]?.id : undefined;
  const query = useDailyUsage(teamId, USAGE_FETCH_DAYS, tz, live);
  const usage = live ? query.data : (fixture.dailyUsage ?? { days: [], models: [], projects: [] });
  const failed = live && (teams.isError || query.isError);

  return (
    <RouteDialog title={t('用量')} size="page" bleed>
      {failed ? (
        <EmptyState
          testId="usage-error"
          icon={TriangleAlert}
          title={t('用量加载失败')}
          description={t('检查网络后再试一次。')}
          action={{
            label: t('重试'),
            onClick: () => void (teams.isError ? teams.refetch() : query.refetch()),
            disabled: teams.isFetching || query.isFetching,
          }}
          className="h-full"
        />
      ) : usage === undefined ? (
        <div className="flex flex-col gap-7 px-7 pt-7" aria-busy="true">
          <span role="status" className="sr-only">
            {t('正在加载用量…')}
          </span>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : usage.days.length === 0 ? (
        <EmptyState
          testId="usage-empty"
          icon={ChartColumn}
          title={t('还没有用量')}
          description={t('和 Coordinator 说第一句话后，这里会按天显示用了多少 token。')}
          className="h-full"
        />
      ) : (
        <UsageBody usage={usage} today={today} />
      )}
    </RouteDialog>
  );
}
