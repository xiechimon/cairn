import type { RunTurnRow } from '@cairn/shared';
import { X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Switch } from '../components/ui/switch.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { PopoverDismissEffect } from '../components/use-dismiss-on-overlay.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { useRunLinkTo, useRunTurns } from './run-trace-api.js';
import { markRunTraceHintSeen, useRunTraceHintSeen } from './run-trace-hint.js';

const PROBLEM_WORD = { failed: '未完成', stopped: '已停止', quota: '额度用尽' } as const;

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function groupOf(at: number, now: number): '今天' | '昨天' | '更早' {
  if (dayKey(at) === dayKey(now)) return '今天';
  if (dayKey(at) === dayKey(now - 86_400_000)) return '昨天';
  return '更早';
}

function timeOf(at: number, group: string): string {
  const d = new Date(at);
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (group !== '更早') return clock;
  const day = d.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
  return `${day} ${clock}`;
}

export function RunTurnTime({ at, group }: { at: number; group: string }) {
  return (
    <span className="min-w-16 flex-none whitespace-nowrap text-meta text-content-tertiary tabular-nums">
      {timeOf(at, group)}
    </span>
  );
}

function rowLabel(row: RunTurnRow, t: TFunc): string {
  if (row.firstLine !== '') return row.firstLine;
  return row.woke ? t('自动唤醒') : t('无消息');
}

function TurnList({ threadId, onPick }: { threadId: string; onPick: () => void }) {
  const { t } = useI18n();
  const linkTo = useRunLinkTo();
  const [problems, setProblems] = useState(true);
  const switchId = useId();
  const query = useRunTurns(threadId, problems, true);
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
  const rows = query.data?.pages.flatMap((page) => page.turns) ?? [];
  const now = Date.now();
  const groups: { label: string; rows: RunTurnRow[] }[] = [];
  for (const row of rows) {
    const label = groupOf(row.at, now);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-run-turn]')];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next =
      links[event.key === 'ArrowDown' ? Math.min(at + 1, links.length - 1) : Math.max(at - 1, 0)];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-ui font-medium text-foreground">{t('运行记录')}</span>
        <label
          htmlFor={switchId}
          className="flex items-center gap-2 text-meta text-content-secondary"
        >
          {t('只看出问题的')}
          <Switch
            id={switchId}
            size="sm"
            data-testid="run-turns-problems"
            checked={problems}
            onCheckedChange={setProblems}
          />
        </label>
      </div>
      <nav
        aria-label={t('运行记录')}
        data-testid="run-turns"
        className="-mx-1 max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain"
        onKeyDown={onKeyDown}
      >
        {query.isPending ? (
          <div className="flex flex-col gap-2 px-2 py-1" aria-busy="true">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : query.isError && rows.length === 0 ? (
          <div
            className="flex items-center gap-2 px-2 py-2 text-meta text-content-secondary"
            data-testid="run-turns-error"
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
          <div
            className="flex items-center gap-2 px-2 py-2 text-meta text-content-secondary"
            data-testid="run-turns-empty"
          >
            {problems ? t('暂无出问题的轮次') : t('暂无轮次')}
            {problems && (
              <Button
                variant="ghost"
                size="sm"
                className="pointer-coarse:h-11"
                onClick={() => setProblems(false)}
              >
                {t('看全部')}
              </Button>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <ul key={group.label} aria-label={t(group.label)} className="m-0 list-none p-0">
              <li aria-hidden="true" className="px-2 pt-2 pb-1 text-meta text-content-tertiary">
                {t(group.label)}
              </li>
              {group.rows.map((row) => (
                <li key={row.stepId}>
                  <Link
                    data-run-turn={row.stepId}
                    to={linkTo(row.stepId)}
                    onClick={onPick}
                    className="flex min-h-8 items-center gap-2 rounded-md px-2 text-ui outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                  >
                    <RunTurnTime at={row.at} group={group.label} />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {rowLabel(row, t)}
                    </span>
                    {row.problem !== null && (
                      <span className="flex-none text-meta text-destructive">
                        {t(PROBLEM_WORD[row.problem])}
                      </span>
                    )}
                    {row.toolCount > 0 && (
                      <span className="flex-none text-meta text-content-tertiary tabular-nums">
                        {t('{n} 次工具调用', { n: row.toolCount })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ))
        )}
        {isFetchNextPageError && (
          <div className="flex items-center gap-2 px-2 py-2 text-meta text-content-secondary">
            {t('未能加载更早的轮次')}
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

export function RunTurnsTrigger({
  threadId,
  state,
  tooltip,
  hintWanted,
  hintBelow,
  className,
  children,
}: {
  threadId: string;
  state: string;
  tooltip: string;
  hintWanted: boolean;
  hintBelow: boolean;
  className: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hintSeen = useRunTraceHintSeen();
  const showHint = hintWanted && !hintSeen && !open;
  const change = (value: boolean) => {
    setOpen(value);
    if (value) markRunTraceHintSeen();
  };
  return (
    <div className="pointer-events-auto relative">
      <Popover open={open} onOpenChange={change}>
        <PopoverDismissEffect open={open} onClose={() => setOpen(false)} />
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    aria-label={t('Coordinator 运行记录')}
                    aria-description={state}
                    data-slot="status-mark-glyph"
                    data-testid="chief-status-mark-button"
                    className={`${className} cursor-pointer rounded-full border-0 p-0 hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent`}
                  />
                }
              />
            }
          >
            {children}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {`${tooltip} · ${t('点击查看运行记录')}`}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={8}
          className="w-96 max-w-[calc(100vw-2rem)] p-2"
          data-testid="run-turns-popover"
          data-usage-popover="true"
        >
          <TurnList threadId={threadId} onPick={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {showHint && (
        <span
          data-testid="run-trace-hint"
          data-side={hintBelow ? 'below' : 'right'}
          className="absolute flex items-center data-[side=below]:top-full data-[side=below]:left-1/2 data-[side=below]:-translate-x-1/2 data-[side=right]:top-1/2 data-[side=right]:left-full data-[side=right]:ml-1 data-[side=right]:-translate-y-1/2 gap-0.5 rounded-full bg-popover py-0.5 pr-0.5 pl-3 text-meta whitespace-nowrap text-foreground shadow-(--shadow-popover)"
        >
          <Button
            variant="ghost"
            size="xs"
            className="rounded-full pointer-coarse:min-h-11"
            onClick={() => change(true)}
          >
            {t('点这里看每一轮做了什么')}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('不再提示')}
            data-testid="run-trace-hint-close"
            className="rounded-full text-content-tertiary pointer-coarse:size-11"
            onClick={markRunTraceHintSeen}
          >
            <X />
          </Button>
        </span>
      )}
    </div>
  );
}
