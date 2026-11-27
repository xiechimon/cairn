import type { DailyUsage } from '@cairn/shared';
import { cn } from 'cn';
import { ChartColumn, TriangleAlert } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router';
import { useConnectionOutage } from '../api/connection-state.js';
import { useTeams } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useDailyUsage } from '../api/usage-daily.js';
import { useNarrow } from '../board/use-narrow.js';
import { EmptyState } from '../components/empty-state.js';
import { ModelMark, resolveModelClientEntry } from '../components/model-identity.js';
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
const CELL_GAP = 0.2;

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

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 bg-card px-5 py-4 text-center max-sm:px-4 max-sm:py-3">
      <span className="text-meta text-content-tertiary">{label}</span>
      <span className="voice-title text-brand text-foreground tabular-nums">{value}</span>
      <span className="max-w-full truncate text-meta text-content-tertiary tabular-nums">
        {note}
      </span>
    </div>
  );
}

function Stats({ summary, days }: { summary: UsageSummary; days: number }) {
  const { t } = useI18n();
  const splitNote =
    summary.total > 0
      ? t('Coordinator {a} · 任务 {b}', {
          a: percent(summary.coordinator / summary.total),
          b: percent(summary.tasks / summary.total),
        })
      : t('没有用量');
  const totalNote =
    summary.cost === null
      ? splitNote
      : `${splitNote} · ${t('按标价 {cost}', { cost: usd(summary.cost) })}`;
  return (
    <div
      data-testid="usage-stats"
      className={cn(
        'grid grid-cols-4 gap-px overflow-hidden bg-border max-sm:grid-cols-2',
        CARD_CLS,
      )}
    >
      <Stat label={t('过去一年')} value={`${formatTokens(summary.total)} token`} note={totalNote} />
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
        note={t('缓存读取 {n}', { n: formatTokens(summary.cacheRead) })}
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

type Point = readonly [number, number];

function monthLoops(grid: UsageGrid, month: string): Point[][] {
  const inMonth = new Set(
    grid.weeks.flatMap((week, col) =>
      week
        .filter((cell) => !cell.future && cell.date.startsWith(month))
        .map((cell) => `${col},${cell.weekday}`),
    ),
  );
  const has = (col: number, row: number) => inMonth.has(`${col},${row}`);
  const edges = new Map<string, Point[]>();
  const add = (from: Point, to: Point) => {
    const key = `${from[0]},${from[1]}`;
    edges.set(key, [...(edges.get(key) ?? []), to]);
  };
  for (const spot of inMonth) {
    const [c = 0, r = 0] = spot.split(',').map(Number);
    if (!has(c, r - 1)) add([c, r], [c + 1, r]);
    if (!has(c + 1, r)) add([c + 1, r], [c + 1, r + 1]);
    if (!has(c, r + 1)) add([c + 1, r + 1], [c, r + 1]);
    if (!has(c - 1, r)) add([c, r + 1], [c, r]);
  }
  const loops: Point[][] = [];
  for (const [key, targets] of edges) {
    while (targets.length > 0) {
      const [x0 = 0, y0 = 0] = key.split(',').map(Number);
      const loop: Point[] = [[x0, y0]];
      let at: Point = [x0, y0];
      let heading: Point | null = null;
      for (;;) {
        const atKey = `${at[0]},${at[1]}`;
        const out = edges.get(atKey) ?? [];
        const turn = (to: Point) => {
          if (heading === null) return 0;
          const dx = to[0] - at[0];
          const dy = to[1] - at[1];
          return heading[0] * dy - heading[1] * dx;
        };
        const pick = out.reduce<number>(
          (best, to, i) => (turn(to) > turn(out[best] ?? to) ? i : best),
          0,
        );
        const next = out.splice(pick, 1)[0];
        if (next === undefined) break;
        heading = [next[0] - at[0], next[1] - at[1]];
        at = next;
        if (at[0] === x0 && at[1] === y0) break;
        loop.push(at);
      }
      loops.push(
        loop.filter((point, i) => {
          const prev = loop[(i + loop.length - 1) % loop.length] ?? point;
          const next = loop[(i + 1) % loop.length] ?? point;
          return (
            (point[0] - prev[0]) * (next[1] - point[1]) !==
            (point[1] - prev[1]) * (next[0] - point[0])
          );
        }),
      );
    }
  }
  return loops;
}

function roundedLoop(loop: Point[], pitch: number, gap: number, radius: number): string {
  const at = (i: number) => {
    const [c = 0, r = 0] = loop[(i + loop.length) % loop.length] ?? [];
    return [c * pitch - gap / 2, r * pitch - gap / 2] as const;
  };
  const corners = loop.map((_, i) => {
    const [px, py] = at(i - 1);
    const [x, y] = at(i);
    const [nx, ny] = at(i + 1);
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const [ix, iy] = [(x - px) / inLen, (y - py) / inLen];
    const [ox, oy] = [(nx - x) / outLen, (ny - y) / outLen];
    return {
      enter: `${x - ix * r},${y - iy * r}`,
      leave: `${x + ox * r},${y + oy * r}`,
      arc: `A${r},${r} 0 0 ${ix * oy - iy * ox > 0 ? 1 : 0} `,
    };
  });
  const start = corners.at(-1)?.leave ?? '0,0';
  return `M${start}${corners.map((c) => `L${c.enter}${c.arc}${c.leave}`).join('')}Z`;
}

function useCellMetrics(ref: RefObject<HTMLDivElement | null>) {
  const [metrics, setMetrics] = useState<{ pitch: number; radius: number } | null>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const measure = () => {
      const cell = grid.querySelector('[data-day]');
      const radius = cell ? Number.parseFloat(getComputedStyle(cell).borderTopLeftRadius) : 0;
      setMetrics({ pitch: grid.clientHeight / (7 - CELL_GAP), radius });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [ref]);
  return metrics;
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
  const cols = 'auto-cols-(--cell) gap-x-(--gap)';
  const rows = 'grid-rows-[repeat(7,var(--cell))] gap-y-(--gap)';
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
  const metrics = useCellMetrics(gridRef);
  const outline =
    metrics === null || metrics.pitch === 0
      ? null
      : monthLoops(grid, month)
          .map((loop) =>
            roundedLoop(
              loop,
              metrics.pitch,
              metrics.pitch * CELL_GAP,
              metrics.radius + (metrics.pitch * CELL_GAP) / 2,
            ),
          )
          .join('');
  const weeks = grid.weeks.length;
  return (
    <div
      data-testid="usage-heatmap-frame"
      style={{ '--weeks': weeks } as CSSProperties}
      className={cn(
        'grid grid-cols-[2rem_auto] gap-x-1.5 gap-y-1 [--cell:calc(var(--pitch)*0.8)] [--gap:calc(var(--pitch)*0.2)]',
        narrow
          ? 'w-max [--pitch:1.25rem]'
          : 'w-full [--pitch:min(calc((100cqw-2.375rem)/var(--weeks)),1.5rem)]',
      )}
      onPointerLeave={() => onHover(null)}
    >
      <span />
      <div
        aria-hidden
        className={cn('grid h-3.5 grid-flow-col text-caption text-content-tertiary', cols)}
      >
        {grid.weeks.map((week, w) => (
          <span
            key={week[0]?.date ?? w}
            className={cn(
              'whitespace-nowrap',
              week.some((cell) => !cell.future && cell.date.startsWith(month)) &&
                grid.monthStarts[w] !== null &&
                '-ml-[calc(var(--gap)/2)] font-medium text-foreground',
            )}
          >
            {grid.monthStarts[w] !== null && week[0] ? labels.month(week[0].date) : ''}
          </span>
        ))}
      </div>
      <div aria-hidden className={cn('grid text-caption leading-none text-content-tertiary', rows)}>
        {firstWeek.map((cell) => (
          <span key={cell.weekday} className="flex items-center">
            {cell.weekday % 2 === 0 && cell.weekday < 6 ? labels.weekday(cell.date) : ''}
          </span>
        ))}
      </div>
      <div
        ref={gridRef}
        data-testid="usage-heatmap"
        className={cn('relative grid grid-flow-col', cols, rows)}
      >
        {outline !== null && outline !== '' && (
          <svg
            aria-hidden
            data-testid="usage-current-month"
            className="pointer-events-none absolute top-0 left-0 size-px overflow-visible text-input"
          >
            <path d={outline} fill="none" stroke="currentColor" />
          </svg>
        )}
        {grid.weeks.flat().map((cell) => {
          if (cell.future) return <span key={cell.date} />;
          const label =
            cell.total === 0
              ? `${labels.day(cell.date)}，${t('没有用量')}`
              : `${labels.day(cell.date)}，${formatTokens(cell.total)} token`;
          return (
            <Button
              key={cell.date}
              type="button"
              variant="link"
              size="icon"
              data-day={cell.date}
              data-level={cell.level}
              aria-pressed={cell.date === selected}
              aria-label={label}
              title={label}
              tabIndex={cell.date === focusDate ? 0 : -1}
              className={cn(
                'size-(--cell) rounded-(--cds-radius-xs) border-0 p-0 hover:outline-solid hover:outline-2 hover:outline-offset-1 hover:outline-content-tertiary focus-visible:ring-2 focus-visible:ring-ring',
                LEVEL_BG[cell.level],
                cell.date === selected &&
                  'outline-solid outline-2 outline-offset-1 outline-foreground hover:outline-foreground',
              )}
              onPointerEnter={() => onHover(cell.date)}
              onClick={() => onSelect(cell.date === selected ? null : cell.date)}
              onKeyDown={(event) => move(event, cell.date)}
            />
          );
        })}
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
      <div className="@container -m-1 flex justify-end overflow-hidden p-1">
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
  rows: { id: string; name: string; lead?: ReactNode; note?: string; tokens: number }[];
  total: number;
}) {
  const top = rows[0]?.tokens ?? 1;
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col">
      <h3 className="m-0 pb-1 text-ui font-medium text-foreground">{title}</h3>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-border py-2.5"
        >
          <span className="inline-flex min-w-0 items-center gap-2 text-ui text-foreground">
            {row.lead}
            <span className="min-w-0 truncate">
              {row.name}
              {row.note !== undefined && (
                <span className="ml-1.5 text-meta text-content-tertiary">{row.note}</span>
              )}
            </span>
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
  const labels = useDateLabels();
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
      {selected !== null && (
        <div
          data-testid="usage-date-filter"
          className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) bg-muted/60 px-3 py-1.5 text-meta text-content-secondary"
        >
          <span>{t('已筛选：{date}', { date: labels.day(selected) })}</span>
          <Button
            variant="ghost"
            size="xs"
            className="h-6 px-2 text-meta"
            onClick={() => setSelected(null)}
          >
            {t('查看全年')}
          </Button>
        </div>
      )}
      <TokenMix summary={scoped} />
      <div className="grid grid-cols-2 gap-8 max-sm:grid-cols-1 max-sm:gap-6">
        <Ranking
          testId="usage-models"
          title={t('模型')}
          total={scoped.total}
          rows={scoped.models.map(([key, tokens]) => {
            const entry = models.get(key);
            const resolved = resolveModelClientEntry(key, {
              providerHint: entry?.provider ?? null,
            });
            return {
              id: key,
              name: entry?.name ?? resolved.modelName,
              lead: (
                <ModelMark
                  modelId={resolved.modelId}
                  provider={entry?.provider ?? resolved.provider}
                />
              ),
              note: entry?.provider,
              tokens,
            };
          })}
        />
        {scoped.projects.length > 0 && (
          <Ranking
            testId="usage-projects"
            title={t('项目')}
            total={scoped.projects.reduce((sum, [, tokens]) => sum + tokens, 0)}
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
  const { connected, retryNow } = useConnectionOutage();
  const fixture = resolveScenario(params);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDay(live ? Date.now() : fixture.now, tz);
  const teams = useTeams(live);
  const teamId = teams.isSuccess ? teams.data[0]?.id : undefined;
  const query = useDailyUsage(teamId, USAGE_FETCH_DAYS, tz, live);
  const usage = live ? query.data : (fixture.dailyUsage ?? { days: [], models: [], projects: [] });
  const failed = live && usage === undefined && (teams.isError || query.isError);
  const wasDisconnectedRef = useRef(false);
  useEffect(() => {
    if (!connected) {
      wasDisconnectedRef.current = true;
      return;
    }
    if (!wasDisconnectedRef.current) return;
    wasDisconnectedRef.current = false;
    if (failed) void (teams.isError ? teams.refetch() : query.refetch());
  }, [connected, failed, query, teams]);

  return (
    <RouteDialog title={t('用量')} size="page" bleed>
      {failed ? (
        <EmptyState
          testId="usage-error"
          icon={TriangleAlert}
          title={t('用量加载失败')}
          description={t('请检查网络后重试。')}
          action={{
            label: t('重试'),
            onClick: () => {
              if (!connected) retryNow();
              void (teams.isError ? teams.refetch() : query.refetch());
            },
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
          title={t('暂无用量')}
          className="h-full"
        />
      ) : (
        <UsageBody usage={usage} today={today} />
      )}
    </RouteDialog>
  );
}
