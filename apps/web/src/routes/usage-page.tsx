import type { DailyUsageDay } from '@cairn/shared';
import { cn } from 'cn';
import { ChartColumn, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTeams } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useDailyUsage } from '../api/usage-daily.js';
import { useNarrow } from '../board/use-narrow.js';
import { EmptyState } from '../components/empty-state.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { RouteDialog } from '../overlay/route-dialog.js';
import {
  formatTokens,
  localDay,
  shiftDay,
  USAGE_WEEKS,
  type UsageCell,
  type UsageGrid,
  usageGrid,
  usageWindowDays,
} from '../usage/usage-model.js';

export const USAGE_PATH = '/app/usage';

const LEVEL_BG = [
  'bg-(--heat-0)',
  'bg-(--heat-1)',
  'bg-(--heat-2)',
  'bg-(--heat-3)',
  'bg-(--heat-4)',
] as const;

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function useDateLabels() {
  const { locale } = useI18n();
  const intl = locale === 'zh' ? 'zh-CN' : 'en-US';
  const day = new Intl.DateTimeFormat(intl, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  });
  const month = new Intl.DateTimeFormat(intl, { month: 'short', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' });
  return {
    day: (date: string) => day.format(utcDate(date)),
    month: (date: string) => month.format(utcDate(date)),
    weekday: (date: string) => weekday.format(utcDate(date)),
  };
}

function Dot({ className }: { className?: string }) {
  return <span className={cn('px-1 text-content-tertiary', className)}>{' · '}</span>;
}

function Readout({ cell }: { cell: UsageCell }) {
  const { t } = useI18n();
  const labels = useDateLabels();
  return (
    <p
      data-testid="usage-readout"
      aria-live="polite"
      className="m-0 min-h-5 text-ui text-content-secondary tabular-nums"
    >
      <span className="whitespace-nowrap max-sm:block">{labels.day(cell.date)}</span>
      <Dot className="max-sm:hidden" />
      {cell.total === 0 ? (
        t('没有用量')
      ) : (
        <>
          <span className="whitespace-nowrap">
            <span className="font-medium text-foreground">{formatTokens(cell.total)}</span> token
          </span>
          <Dot />
          <span className="whitespace-nowrap">Coordinator {formatTokens(cell.coordinator)}</span>
          <Dot />
          <span className="whitespace-nowrap">
            {t('任务')} {formatTokens(cell.tasks)}
          </span>
        </>
      )}
    </p>
  );
}

function Heatmap({
  grid,
  selected,
  onSelect,
  onHover,
}: {
  grid: UsageGrid;
  selected: string;
  onSelect: (date: string) => void;
  onHover: (date: string | null) => void;
}) {
  const { t } = useI18n();
  const labels = useDateLabels();
  const narrow = useNarrow();
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = narrow ? 'auto-cols-[16px]' : 'auto-cols-[12px]';
  const rows = narrow ? 'grid-rows-[repeat(7,16px)]' : 'grid-rows-[repeat(7,12px)]';
  const cellSize = narrow ? 'size-4' : 'size-3';

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
  return (
    <div className="flex w-max max-w-full flex-col gap-2">
      <div className="p-0.5">
        <div
          className="grid grid-cols-[auto_auto] gap-x-1.5 gap-y-1"
          onPointerLeave={() => onHover(null)}
        >
          <span />
          <div
            className={cn(
              'grid h-3.5 grid-flow-col gap-x-1 text-caption text-content-tertiary',
              cols,
            )}
          >
            {grid.weeks.map((week, w) => (
              <span key={week[0]?.date ?? w} className="whitespace-nowrap">
                {grid.monthStarts[w] !== null && week[0] ? labels.month(week[0].date) : ''}
              </span>
            ))}
          </div>
          <div className={cn('grid gap-y-1 text-caption leading-none text-content-tertiary', rows)}>
            {firstWeek.map((cell) => (
              <span key={cell.weekday} className="flex items-center">
                {cell.weekday % 2 === 0 && cell.weekday < 6 ? labels.weekday(cell.date) : ''}
              </span>
            ))}
          </div>
          <div
            ref={gridRef}
            data-testid="usage-heatmap"
            className={cn('grid grid-flow-col gap-1', cols, rows)}
          >
            {grid.weeks
              .flat()
              .map((cell) =>
                cell.future ? (
                  <span key={cell.date} />
                ) : (
                  <button
                    key={cell.date}
                    type="button"
                    data-day={cell.date}
                    data-level={cell.level}
                    aria-pressed={cell.date === selected}
                    aria-label={
                      cell.total === 0
                        ? `${labels.day(cell.date)}，${t('没有用量')}`
                        : `${labels.day(cell.date)}，${formatTokens(cell.total)} token`
                    }
                    tabIndex={cell.date === selected ? 0 : -1}
                    className={cn(
                      cellSize,
                      'rounded-[3px] hover:outline-2 hover:outline-offset-1 hover:outline-content-tertiary focus-visible:ring-2 focus-visible:ring-ring',
                      LEVEL_BG[cell.level],
                      cell.date === selected && 'outline-2 outline-offset-1 outline-foreground',
                    )}
                    onPointerEnter={() => onHover(cell.date)}
                    onFocus={() => onHover(null)}
                    onClick={() => onSelect(cell.date)}
                    onKeyDown={(event) => move(event, cell.date)}
                  />
                ),
              )}
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className="flex items-center justify-end gap-1 text-caption text-content-tertiary"
      >
        {t('少')}
        {LEVEL_BG.map((bg) => (
          <i key={bg} className={cn('block size-2.5 rounded-[3px]', bg)} />
        ))}
        {t('多')}
      </div>
    </div>
  );
}

function UsageBody({ days, today }: { days: readonly DailyUsageDay[]; today: string }) {
  const { t } = useI18n();
  const narrow = useNarrow();
  const grid = usageGrid(days, today, narrow ? 16 : USAGE_WEEKS);
  const [selected, setSelected] = useState(today);
  const [hover, setHover] = useState<string | null>(null);
  const cells = grid.weeks.flat();
  const shown = cells.find((cell) => cell.date === (hover ?? selected)) ?? cells.at(-1);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span
          data-testid="usage-recent-total"
          className="text-[20px] leading-7 font-medium text-foreground tabular-nums"
        >
          {formatTokens(grid.recentTotal)} token
        </span>
        <span className="text-meta text-content-tertiary">{t('近 30 天，含缓存读取')}</span>
      </div>
      {shown && <Readout cell={shown} />}
      <Heatmap grid={grid} selected={selected} onSelect={setSelected} onHover={setHover} />
    </div>
  );
}

export function UsagePage() {
  const { t } = useI18n();
  const narrow = useNarrow();
  const [params] = useSearchParams();
  const { live } = useLiveData();
  const fixture = resolveScenario(params);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDay(live ? Date.now() : fixture.now, tz);
  const teams = useTeams(live);
  const teamId = teams.isSuccess ? teams.data[0]?.id : undefined;
  const usage = useDailyUsage(teamId, usageWindowDays(today), tz, live);
  const days = live ? usage.data?.days : (fixture.dailyUsage ?? []);
  const failed = live && (teams.isError || usage.isError);

  return (
    <RouteDialog title={t('用量')} size={narrow ? 'page' : 'form'}>
      {failed ? (
        <EmptyState
          testId="usage-error"
          icon={TriangleAlert}
          title={t('用量加载失败')}
          description={t('检查网络后再试一次。')}
          action={{
            label: t('重试'),
            onClick: () => void (teams.isError ? teams.refetch() : usage.refetch()),
            disabled: teams.isFetching || usage.isFetching,
          }}
          className="py-12"
        />
      ) : days === undefined ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span role="status" className="sr-only">
            {t('正在加载用量…')}
          </span>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : days.length === 0 ? (
        <EmptyState
          testId="usage-empty"
          icon={ChartColumn}
          title={t('还没有用量')}
          description={t('和 Coordinator 说第一句话后，这里会按天显示用了多少 token。')}
          className="py-12"
        />
      ) : (
        <UsageBody days={days} today={today} />
      )}
    </RouteDialog>
  );
}
