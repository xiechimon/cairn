import {
  RUN_PROBLEM_STATUSES,
  type RunListPage,
  type RunListRow,
  type RunTrace,
  type RunTraceItem,
} from '@cairn/shared';
import { Download, ScrollText, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChiefThreads, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useNarrow } from '../board/use-narrow.js';
import { TraceCard, TraceGroupSummary, TraceRowButton } from '../components/chat/trace-parts.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import {
  durationText,
  formatRunHeader,
  fullText,
  type LedgerFilter,
  oneLine,
  scopedRunId,
  selectLedgerRuns,
  type TraceScope,
  toolTarget,
} from './run-items.js';
import { downloadRunTrace, useRunList, useRunTrace } from './run-trace-api.js';
import { TRACE_NONE } from './trace-nav.js';

const STATUS_WORDS: Record<string, string> = {
  done: '完成',
  failed: '未完成',
  stopped: '已停止',
  running: '运行中',
  quota: '额度用尽',
};

const WAKE_WORDS: Record<string, string> = {
  settle: '任务完成',
  gate: '检查',
  failed: '任务失败',
  wake: '唤醒',
};

function wakeLabel(reason: string, t: (key: string) => string): string {
  const kind = WAKE_WORDS[reason];
  return kind === undefined || reason === 'wake' ? t('自动唤醒') : `${t('自动唤醒')} · ${t(kind)}`;
}

function itemVerb(item: RunTraceItem, t: (key: string) => string): string {
  switch (item.kind) {
    case 'user':
      return t('输入');
    case 'wake':
      return t('唤醒');
    case 'prompt':
      return t('输入');
    case 'thinking':
      return t('思考');
    case 'reply':
      return t('输出');
    case 'model':
      return t('模型');
    case 'tool':
      return t('工具');
    case 'error':
      return t('错误');
    case 'stopped':
      return t('已停止');
    case 'note':
      return t('记录');
    case 'step':
      return t('步骤');
  }
}

function itemTarget(item: RunTraceItem, t: (key: string) => string): string {
  switch (item.kind) {
    case 'wake':
      return wakeLabel(item.reason, t);
    case 'tool':
      return toolTarget(item.name, item.arguments);
    case 'model':
      return item.model ?? t('模型');
    case 'step':
      return item.stepKind;
    case 'error':
    case 'note':
    case 'user':
    case 'prompt':
    case 'thinking':
    case 'reply':
      return oneLine(item.text);
    case 'stopped':
      return '';
  }
}

function tokensOf(trace: RunTrace): number {
  return trace.usage.input + trace.usage.output + trace.usage.cacheRead + trace.usage.cacheWrite;
}

function useDelayed(active: boolean, ms = 200): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return shown;
}

export function useRunProblemCounts(): Map<string, number> {
  const { live, teamId } = useLiveData();
  const query = useRunList(null, false, live && teamId !== undefined, true);
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of (query.data?.pages[0] as RunListPage | undefined)?.problemCounts ?? [])
      counts.set(entry.threadId, entry.count);
    return counts;
  }, [query.data]);
}

function ConversationRail({
  scope,
  onOpen,
}: {
  scope: TraceScope;
  onOpen: ((projectId: string | null) => void) | undefined;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const counts = useRunProblemCounts();
  const threads = useChiefThreads(teamId, live);
  const projects = useProjects(teamId, live);
  if (onOpen === undefined) return null;
  const general = (threads.data ?? []).find((thread) => thread.projectId == null);
  const entries = [
    {
      id: general?.id ?? null,
      projectId: null,
      name: t('通用'),
      count: general === undefined ? 0 : (counts.get(general.id) ?? 0),
    },
    ...(projects.data ?? []).map((project) => {
      const thread = (threads.data ?? []).find((candidate) => candidate.projectId === project.id);
      return {
        id: thread?.id ?? null,
        projectId: project.id,
        name: project.name,
        count: thread === undefined ? 0 : (counts.get(thread.id) ?? 0),
      };
    }),
  ];
  const current = scope.kind === 'coordinator' ? scope.threadId : null;
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label={t('对话')}
      className="hidden w-44 flex-none flex-col gap-1 overflow-auto p-3 lg:flex"
    >
      {entries.map((entry) => {
        const selected = current !== null && entry.id === current;
        return (
          <Button
            key={entry.projectId ?? 'general'}
            variant="ghost"
            aria-current={selected ? 'true' : undefined}
            className="h-8 min-h-8 justify-between px-2 text-ui font-normal text-content-secondary aria-[current=true]:bg-(--hover-1) aria-[current=true]:text-foreground"
            onClick={() => onOpen(entry.projectId)}
          >
            <span className="min-w-0 truncate">{entry.name}</span>
            {entry.count > 0 && (
              <span className="ml-2 flex-none text-meta tabular-nums text-destructive">
                {entry.count}
              </span>
            )}
          </Button>
        );
      })}
    </nav>
  );
}

function RunMeta({ trace, locale }: { trace: RunTrace; locale: string }) {
  const { t } = useI18n();
  const tokens = tokensOf(trace);
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 text-meta text-content-tertiary tabular-nums">
      <span>{t(STATUS_WORDS[trace.status] ?? trace.status)}</span>
      <span>{formatRunHeader(trace.startedAt, locale)}</span>
      {trace.models.length > 0 && <span>{trace.models.join(' · ')}</span>}
      {tokens > 0 && <span>{t('{n} tokens', { n: tokens })}</span>}
    </p>
  );
}

function Inspector({
  item,
  trace,
  locale,
}: {
  item: RunTraceItem;
  trace: RunTrace;
  locale: string;
}) {
  const { t } = useI18n();
  const rows: [string, string][] = [];
  rows.push([t('概览'), `${itemVerb(item, t)} ${itemTarget(item, t)}`.trim()]);
  if (item.kind === 'tool' || item.kind === 'model' || item.kind === 'wake')
    rows.push([t('时间'), formatRunHeader(item.at, locale)]);
  if (item.kind === 'tool') {
    if (item.endedAt !== null) rows.push([t('用时'), durationText(item.endedAt - item.at)]);
    rows.push([t('输入'), fullText(item.arguments)]);
    rows.push([item.isError ? t('错误') : t('输出'), fullText(item.result)]);
    if (item.truncated) rows.push([t('说明'), t('内容过大，已省略，导出 JSON 查看完整记录')]);
  } else if (item.kind === 'model') {
    if (item.model !== null) rows.push([t('模型'), item.model]);
    if (item.startedAt !== null && item.endedAt !== null)
      rows.push([t('用时'), durationText(item.endedAt - item.startedAt)]);
    rows.push([
      t('用量'),
      item.usage === null
        ? t('未记录')
        : t('输入 {input} · 输出 {output} · 缓存读 {cacheRead} · 缓存写 {cacheWrite}', {
            input: item.usage.input,
            output: item.usage.output,
            cacheRead: item.usage.cacheRead,
            cacheWrite: item.usage.cacheWrite,
          }),
    ]);
  } else if (item.kind === 'wake') {
    rows.push([t('原因'), wakeLabel(item.reason, t)]);
  } else if ('text' in item) {
    rows.push([item.kind === 'reply' ? t('输出') : t('输入'), item.text]);
  }
  rows.push([t('本轮总量'), `${tokensOf(trace)} tokens`]);
  return (
    <div className="flex flex-col gap-3">
      {rows
        .filter(([, value]) => value !== '')
        .map(([label, value], index) => (
          <div key={`${label}-${index}`} className="flex min-w-0 flex-col gap-1">
            <h3 className="m-0 text-meta font-normal text-content-tertiary">{label}</h3>
            {label === t('概览') || label === t('原因') || label === t('用量') ? (
              <p className="m-0 text-ui break-words text-foreground">{value}</p>
            ) : (
              <pre
                translate="no"
                className="m-0 max-h-64 overflow-auto rounded-md bg-card p-2 font-mono text-code whitespace-pre-wrap text-content-secondary shadow-(--edge-ring) [overflow-wrap:anywhere]"
              >
                {value}
              </pre>
            )}
          </div>
        ))}
    </div>
  );
}

function StepRows({
  trace,
  stepId,
  filter,
  onSelect,
}: {
  trace: RunTrace;
  stepId: string | null;
  filter: LedgerFilter;
  onSelect: (stepId: string) => void;
}) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(100);
  const items = useMemo(() => [...trace.items].sort((a, b) => a.at - b.at), [trace]);
  const visible = items.filter(
    (item) =>
      filter !== 'problems' ||
      item.kind === 'error' ||
      item.kind === 'stopped' ||
      (item.kind === 'tool' && item.isError),
  );
  const shown = visible.slice(0, limit);
  const selected =
    items.find((item) => item.id === stepId) ??
    items.find((item) => item.kind === 'error' || (item.kind === 'tool' && item.isError)) ??
    items[0];
  return (
    <TraceCard>
      {shown.map((item) => {
        const nested =
          item.kind === 'tool' &&
          item.parentId !== undefined &&
          items.some((parent) => parent.id === item.parentId);
        return (
          <div key={item.id} data-run-item={item.id} className={nested ? 'pl-6' : undefined}>
            <TraceRowButton
              verb={itemVerb(item, t)}
              target={itemTarget(item, t)}
              onClick={() => onSelect(item.id)}
              aria-current={selected?.id === item.id ? 'true' : undefined}
              className={item.kind === 'error' ? 'text-destructive' : undefined}
              trailing={
                item.kind === 'tool' && item.endedAt !== null
                  ? durationText(item.endedAt - item.at)
                  : item.kind === 'model' && item.startedAt !== null && item.endedAt !== null
                    ? durationText(item.endedAt - item.startedAt)
                    : undefined
              }
            />
          </div>
        );
      })}
      {visible.length > limit && (
        <Button variant="ghost" className="w-full" onClick={() => setLimit((n) => n + 100)}>
          {t('显示更多')}
        </Button>
      )}
    </TraceCard>
  );
}

export function RunTraceView({
  scope,
  runId,
  stepId,
  onSelect,
  onOpenConversation,
}: {
  scope: TraceScope;
  runId: string | null;
  stepId: string | null;
  onSelect: (runId: string | null, stepId: string | null) => void;
  onOpenConversation?: ((projectId: string | null) => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const { live, teamId } = useLiveData();
  const narrow = useNarrow();
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [search, setSearch] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const list = useRunList(scope, false, true);
  const rows: RunListRow[] = list.data?.pages.flatMap((page) => page.runs) ?? [];
  const selectedId = scopedRunId(rows, scope, runId);
  const ledger = selectLedgerRuns(rows, scope, filter, search);
  const latest = ledger.at(-1)?.id ?? null;
  const activeId = selectedId ?? (runId === null ? latest : runId === TRACE_NONE ? null : runId);
  const detail = useRunTrace(activeId);
  const trace =
    detail.data !== undefined &&
    (scope.kind === 'coordinator'
      ? detail.data.kind === 'coordinator' && detail.data.threadId === scope.threadId
      : detail.data.kind === 'task' && detail.data.todoId === scope.todoId)
      ? detail.data
      : null;
  const steps = useDelayed(list.isLoading);
  const ledgerRef = useRef<HTMLElement | null>(null);
  const scrolledRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeId === null || scrolledRef.current === activeId) return;
    scrolledRef.current = activeId;
    ledgerRef.current
      ?.querySelector(`[data-run-row="${activeId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);
  const selectRun = (id: string) => {
    setInspecting(false);
    onSelect(id, null);
  };
  const selectStep = (id: string) => {
    if (activeId !== null) onSelect(activeId, id);
    setInspecting(true);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="run-trace-view">
      {!narrow && <ConversationRail scope={scope} onOpen={onOpenConversation} />}
      {(!narrow || !inspecting) && (
        <section
          ref={ledgerRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-4"
          aria-label={t('轨迹')}
        >
          <div className="flex flex-none flex-wrap items-center gap-2">
            <SegmentedTabs
              quiet
              value={filter}
              onChange={setFilter}
              label={t('筛选轨迹')}
              options={[
                { value: 'all', label: t('全部'), testId: 'trace-filter-all' },
                { value: 'sent', label: t('消息'), testId: 'trace-filter-sent' },
                { value: 'wake', label: t('唤醒'), testId: 'trace-filter-wake' },
                { value: 'problems', label: t('问题'), testId: 'trace-filter-problems' },
              ]}
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('在这个对话里搜索')}
              aria-label={t('搜索轨迹')}
              className="h-8 min-w-40 flex-1"
            />
          </div>
          {steps && (
            <div className="mt-3 flex flex-col gap-2" aria-busy="true">
              <span role="status" className="sr-only">
                {t('正在加载轨迹…')}
              </span>
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-9" />
              ))}
            </div>
          )}
          {list.isError && !list.isLoading && (
            <EmptyState
              testId="run-trace-error"
              icon={TriangleAlert}
              title={t('未能加载轨迹')}
              action={{
                label: t('重试'),
                onClick: () => void list.refetch(),
                disabled: list.isFetching,
              }}
            />
          )}
          {!steps && !list.isError && ledger.length === 0 && !list.hasNextPage && (
            <EmptyState
              testId="run-trace-empty"
              icon={ScrollText}
              title={search !== '' || filter !== 'all' ? t('没有符合条件的记录') : t('暂无轨迹')}
            />
          )}
          {!steps && !list.isError && ledger.length > 0 && (
            <ul className="m-0 mt-3 flex list-none flex-col gap-4 p-0">
              {ledger.map((row) => {
                const open = row.id === activeId;
                const toolCount = row.toolCount;
                return (
                  <li key={row.id} data-run-row={row.id} className="min-w-0">
                    <TraceGroupSummary
                      summary={row.firstLine === '' ? t('自动唤醒') : row.firstLine}
                      summaryTitle={row.firstLine === '' ? t('自动唤醒') : row.firstLine}
                      open={open}
                      running={row.status === 'running'}
                      failed={
                        RUN_PROBLEM_STATUSES.includes(row.status)
                          ? t(STATUS_WORDS[row.status] ?? '')
                          : null
                      }
                      elapsed={row.durationMs === null ? undefined : durationText(row.durationMs)}
                      onClick={() => (open ? onSelect(TRACE_NONE, null) : selectRun(row.id))}
                    />
                    <p className="m-0 pl-5.5 text-meta text-content-tertiary tabular-nums">
                      {formatRunHeader(row.at, locale)}
                      {toolCount > 0 ? ` · ${toolCount} ${t('工具')}` : ''}
                    </p>
                    {open && (
                      <div className="mt-2">
                        {trace === null && detail.isLoading && (
                          <p className="m-0 px-3 py-2 text-meta text-content-tertiary">
                            {t('正在加载…')}
                          </p>
                        )}
                        {trace === null && detail.isError && (
                          <div className="px-3 py-2">
                            <Button variant="ghost" size="sm" onClick={() => void detail.refetch()}>
                              {t('未能加载，重试')}
                            </Button>
                          </div>
                        )}
                        {trace === null && !detail.isLoading && !detail.isError && (
                          <EmptyState
                            icon={ScrollText}
                            title={t('找不到这条运行记录')}
                            className="py-2"
                          />
                        )}
                        {trace !== null && (
                          <StepRows
                            trace={trace}
                            stepId={stepId}
                            filter={filter}
                            onSelect={selectStep}
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {list.hasNextPage && (
            <Button
              variant="ghost"
              className="mt-3"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('加载更多')}
            </Button>
          )}
        </section>
      )}
      {(!narrow || inspecting) && (trace !== null || detail.isLoading) && (
        <aside
          className="flex min-h-0 w-full flex-col gap-3 overflow-auto border-l border-border p-4 lg:w-96 lg:flex-none"
          aria-label={t('步骤详情')}
          data-testid="run-trace-inspector"
        >
          {narrow && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1 w-fit"
              onClick={() => setInspecting(false)}
            >
              {t('返回轨迹')}
            </Button>
          )}
          {trace !== null && (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-ui font-medium text-foreground">
                    {trace.title}
                  </h2>
                  <RunMeta trace={trace} locale={locale} />
                </div>
                <IconTooltip
                  label={t('导出 JSON')}
                  side="bottom"
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('导出 JSON')}
                      data-testid="run-trace-export"
                      onClick={() =>
                        void downloadRunTrace(live ? teamId : undefined, trace).catch((error) =>
                          toastError(t('下载失败，请重试。'), error),
                        )
                      }
                    />
                  }
                >
                  <Download />
                </IconTooltip>
              </div>
              {(() => {
                const items = [...trace.items].sort((a, b) => a.at - b.at);
                const selected =
                  items.find((item) => item.id === stepId) ??
                  items.find(
                    (item) => item.kind === 'error' || (item.kind === 'tool' && item.isError),
                  ) ??
                  items[0];
                return selected === undefined ? null : (
                  <Inspector item={selected} trace={trace} locale={locale} />
                );
              })()}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
