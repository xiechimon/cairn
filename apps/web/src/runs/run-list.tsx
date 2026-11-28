import type { RunListRow, RunStatus } from '@cairn/shared';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { cn } from 'cn';
import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleStop,
  CircleX,
  type LucideIcon,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { SegmentedTabs } from '../components/segmented.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import type { Locale } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import type { RunLinkTo } from './run-trace-api.js';

export type RunScope = 'thread' | 'all';

export const RUN_STATUS_WORD: Record<RunStatus, string> = {
  running: '运行中',
  done: '完成',
  failed: '未完成',
  stopped: '已停止',
  quota: '额度用尽',
};

const STATUS_ICON: Record<RunStatus, { Icon: LucideIcon; ink: string }> = {
  running: { Icon: CircleDashed, ink: 'text-content-tertiary' },
  done: { Icon: CircleCheck, ink: 'text-content-tertiary' },
  failed: { Icon: CircleX, ink: 'text-destructive' },
  stopped: { Icon: CircleStop, ink: 'text-content-tertiary' },
  quota: { Icon: CircleSlash, ink: 'text-(--card-button)' },
};

function intlLocale(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function runDayLabel(at: number, now: number, locale: Locale, t: TFunc): string {
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  if (dayKey(at) === dayKey(now)) return capital(t('今天'));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday.getTime())) return capital(t('昨天'));
  const date = new Date(at);
  const year = date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric';
  const tag = intlLocale(locale);
  if (locale === 'en')
    return date.toLocaleDateString(tag, { weekday: 'short', month: 'short', day: 'numeric', year });
  const day = date.toLocaleDateString(tag, { month: 'long', day: 'numeric', year });
  return `${day} ${date.toLocaleDateString(tag, { weekday: 'short' })}`;
}

export function runClock(at: number, locale: Locale): string {
  return new Date(at).toLocaleTimeString(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function duration(ms: number, t: TFunc): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return t('{s} 秒', { s: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} 分钟', { n: minutes });
  return t('{h} 小时 {m} 分钟', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

function rowLabel(row: RunListRow, t: TFunc): string {
  if (row.firstLine !== '') return row.firstLine;
  return row.woke ? t('自动唤醒') : t('无消息');
}

function rowMeta(row: RunListRow, scope: RunScope, t: TFunc): string {
  const parts: string[] = [];
  if (scope === 'all' && row.source !== null) parts.push(row.source);
  if (row.status !== 'done') parts.push(t(RUN_STATUS_WORD[row.status]));
  if (row.toolCount > 0) parts.push(t('{n} 次工具调用', { n: row.toolCount }));
  if (row.durationMs !== null && row.status !== 'running') parts.push(duration(row.durationMs, t));
  return parts.join(' · ');
}

function RunRowLink({
  row,
  scope,
  selected,
  to,
}: {
  row: RunListRow;
  scope: RunScope;
  selected: boolean;
  to: ReturnType<RunLinkTo>;
}) {
  const { t, locale } = useI18n();
  const { Icon, ink } = STATUS_ICON[row.status];
  const meta = rowMeta(row, scope, t);
  return (
    <Link
      data-run-row={row.id}
      data-status={row.status}
      to={to}
      aria-current={selected ? 'page' : undefined}
      className="flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-ui outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-(--sidebar-active) pointer-coarse:py-2.5"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon
          role="img"
          aria-label={t(RUN_STATUS_WORD[row.status])}
          className={cn('size-4 flex-none', ink)}
        />
        <span className="min-w-0 flex-1 truncate text-foreground">{rowLabel(row, t)}</span>
        <span className="flex-none text-meta text-content-tertiary tabular-nums">
          {runClock(row.at, locale)}
        </span>
      </span>
      {meta !== '' && (
        <span className="truncate pl-6.5 text-caption font-normal text-content-tertiary tabular-nums">
          {meta}
        </span>
      )}
    </Link>
  );
}

type RunListQuery = UseInfiniteQueryResult<InfiniteData<{ runs: RunListRow[] }>, Error>;

export function RunList({
  query,
  scope,
  scopes,
  problems,
  selectedId,
  linkTo,
  onScope,
  onProblems,
  className,
}: {
  query: RunListQuery;
  scope: RunScope;
  scopes: boolean;
  problems: boolean;
  selectedId: string | null;
  linkTo: RunLinkTo;
  onScope: (scope: RunScope) => void;
  onProblems: (problems: boolean) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || !hasNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const rows = query.data?.pages.flatMap((page) => page.runs) ?? [];
  const now = Date.now();
  const groups: { label: string; rows: RunListRow[] }[] = [];
  for (const row of rows) {
    const label = runDayLabel(row.at, now, locale, t);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-run-row]')];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next =
      links[event.key === 'ArrowDown' ? Math.min(at + 1, links.length - 1) : Math.max(at - 1, 0)];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <div className={cn('flex min-h-0 flex-col', className)} data-testid="run-list-column">
      <div className="flex flex-none flex-wrap items-center gap-2 px-3 pt-3 pb-2">
        {scopes && (
          <SegmentedTabs<RunScope>
            label={t('运行记录')}
            value={scope}
            onChange={onScope}
            options={[
              { value: 'thread', label: t('这个对话'), testId: 'run-scope-thread' },
              { value: 'all', label: t('全部'), testId: 'run-scope-all' },
            ]}
          />
        )}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={problems}
          data-testid="run-list-problems"
          className="rounded-full text-content-secondary pointer-coarse:h-11 aria-pressed:border-foreground/60 aria-pressed:text-foreground dark:aria-pressed:border-foreground/60"
          onClick={() => onProblems(!problems)}
        >
          {t('出问题的')}
        </Button>
      </div>
      <nav
        aria-label={t('运行记录')}
        data-testid="run-list"
        className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-2 pb-3"
        onKeyDown={onKeyDown}
      >
        {query.isPending ? (
          <div className="flex flex-col gap-1 pt-7" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="flex flex-col gap-1.5 px-2.5 py-1.5">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="ml-6.5 h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : query.isError && rows.length === 0 ? (
          <div
            className="flex items-center gap-2 px-2.5 py-2 text-meta text-content-secondary"
            data-testid="run-list-error"
          >
            {t('未能加载运行记录')}
            <Button
              variant="ghost"
              size="sm"
              className="pointer-coarse:h-11"
              onClick={() => void query.refetch()}
            >
              {t('重试')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p
            className="m-0 px-2.5 py-2 text-meta text-content-secondary"
            data-testid="run-list-empty"
          >
            {problems ? t('暂无出问题的记录') : t('暂无运行记录')}
          </p>
        ) : (
          groups.map((group) => (
            <ul key={group.label} aria-label={group.label} className="m-0 list-none p-0">
              <li
                aria-hidden="true"
                className="px-2.5 pt-3 pb-1 text-caption text-content-tertiary"
              >
                {group.label}
              </li>
              {group.rows.map((row) => (
                <li key={row.id}>
                  <RunRowLink
                    row={row}
                    scope={scope}
                    selected={row.id === selectedId}
                    to={linkTo(row.id)}
                  />
                </li>
              ))}
            </ul>
          ))
        )}
        {isFetchNextPageError && (
          <div className="flex items-center gap-2 px-2.5 py-2 text-meta text-content-secondary">
            {t('未能加载更早的记录')}
            <Button
              variant="ghost"
              size="sm"
              className="pointer-coarse:h-11"
              onClick={() => void fetchNextPage()}
            >
              {t('重试')}
            </Button>
          </div>
        )}
        <div ref={sentinel} aria-hidden="true" className="h-1" />
      </nav>
    </div>
  );
}
