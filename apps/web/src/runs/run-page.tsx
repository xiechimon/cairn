import type { RunTrace, RunTraceItem } from '@cairn/shared';
import { ChevronLeft, Download, ScrollText, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useLiveData } from '../api/provider.js';
import { useNarrow } from '../board/use-narrow.js';
import { NoticeLine } from '../components/chat/notice-line.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { toastError } from '../components/ui/toaster.js';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from '../components/ui/trace.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { RouteDialog } from '../overlay/route-dialog.js';
import { fullText, isProblem, oneLine, type RunRow, runRows } from './run-items.js';
import { RunList, type RunScope } from './run-list.js';
import { downloadRunTrace, useRunLinkTo, useRunList, useRunTrace } from './run-trace-api.js';

type ToolItem = Extract<RunTraceItem, { kind: 'tool' }>;

const PRE_CLS =
  'm-0 max-h-80 overflow-auto rounded-md bg-card p-2 font-mono text-caption whitespace-pre-wrap text-content-secondary shadow-(--edge-ring) [overflow-wrap:anywhere]';

const STATUS_WORD: Record<string, string> = {
  done: '完成',
  failed: '未完成',
  stopped: '已停止',
  pending: '尚未开始',
  claimed: '运行中',
  running: '运行中',
  quota: '额度用尽',
};

function seconds(ms: number, t: TFunc): string {
  return ms < 1000 ? `${ms} ms` : t('{s} 秒', { s: Math.round(ms / 100) / 10 });
}

function metaLine(trace: RunTrace, t: TFunc): string {
  const parts = [t(STATUS_WORD[trace.status] ?? trace.status)];
  parts.push(new Date(trace.startedAt).toLocaleString());
  if (trace.finishedAt !== null) parts.push(seconds(trace.finishedAt - trace.startedAt, t));
  if (trace.models.length > 0) parts.push(trace.models.join('、'));
  const tools = trace.items.filter((i) => i.kind === 'tool').length;
  if (tools > 0) parts.push(t('{n} 次工具调用', { n: tools }));
  const tokens =
    trace.usage.input + trace.usage.output + trace.usage.cacheRead + trace.usage.cacheWrite;
  if (tokens > 0) parts.push(t('{n} tokens', { n: tokens }));
  return parts.join(' · ');
}

function Pre({ label, text }: { label: string; text: string }) {
  if (text === '') return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-meta text-content-tertiary">{label}</span>
      <pre translate="no" className={PRE_CLS}>
        {text}
      </pre>
    </div>
  );
}

function useOpenSet() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string, value: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  return { open, setOpen, toggle };
}

type OpenState = ReturnType<typeof useOpenSet>;

function Folded({
  id,
  state,
  title,
  description,
  status,
  children,
}: {
  id: string;
  state: OpenState;
  title: string;
  description?: string;
  status?: 'error';
  children: ReactNode;
}) {
  return (
    <TraceCollapsible
      data-run-item={id}
      open={state.open.has(id)}
      onOpenChange={(value) => state.toggle(id, value)}
    >
      <TraceCollapsibleTrigger className="pointer-coarse:min-h-11">
        <TraceLine status={status}>
          <TraceTitle>{title}</TraceTitle>
          {description !== undefined && description !== '' && (
            <TraceDescription className="max-w-[48ch] truncate">{description}</TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function ToolRow({
  tool,
  recovered,
  state,
}: {
  tool: ToolItem;
  recovered: boolean;
  state: OpenState;
}) {
  const { t } = useI18n();
  const took = tool.endedAt === null ? '' : ` · ${seconds(tool.endedAt - tool.at, t)}`;
  const description = recovered ? `${t('之后已继续')}${took}` : `${oneLine(tool.arguments)}${took}`;
  return (
    <Folded
      id={tool.id}
      state={state}
      title={tool.name}
      description={description}
      {...(tool.isError ? { status: 'error' as const } : {})}
    >
      <Pre label={t('参数')} text={fullText(tool.arguments)} />
      <Pre label={tool.isError ? t('报错') : t('输出')} text={fullText(tool.result)} />
      {tool.result === null && (
        <span className="text-meta text-content-tertiary">{t('暂无输出')}</span>
      )}
      {tool.truncated && (
        <span className="text-meta text-content-tertiary">
          {t('内容过长已截断，导出的文件里是全文')}
        </span>
      )}
    </Folded>
  );
}

function ItemRow({ row, state }: { row: Extract<RunRow, { type: 'item' }>; state: OpenState }) {
  const { t } = useI18n();
  const { item } = row;
  switch (item.kind) {
    case 'user':
      return (
        <div data-run-item={item.id} className="flex min-w-0 flex-col gap-1">
          <span className="text-meta text-content-tertiary">{t('你发的消息')}</span>
          <p className="m-0 text-ui whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
            {item.text}
          </p>
        </div>
      );
    case 'reply':
      return (
        <div data-run-item={item.id} className="flex min-w-0 flex-col gap-1">
          <span className="text-meta text-content-tertiary">{t('回复')}</span>
          <p className="m-0 text-ui whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
            {item.text}
          </p>
        </div>
      );
    case 'prompt':
      return (
        <Folded
          id={item.id}
          state={state}
          title={t('发给模型的完整内容')}
          description={oneLine(item.text)}
        >
          <Pre label={t('内容')} text={item.text} />
        </Folded>
      );
    case 'thinking':
      return (
        <Folded id={item.id} state={state} title={t('思考')} description={oneLine(item.text)}>
          <p className="m-0 text-ui whitespace-pre-wrap [overflow-wrap:anywhere]">{item.text}</p>
        </Folded>
      );
    case 'tool':
      return <ToolRow tool={item} recovered={row.recovered} state={state} />;
    case 'error':
      return (
        <div data-run-item={item.id}>
          <NoticeLine tone="danger" label={item.text} testId="run-item-error" />
        </div>
      );
    case 'stopped':
      return (
        <div data-run-item={item.id}>
          <NoticeLine label={t('已停止')} testId="run-item-stopped" />
        </div>
      );
    case 'note':
      return (
        <div data-run-item={item.id}>
          <NoticeLine label={item.text} />
        </div>
      );
    case 'step':
      return (
        <div data-run-item={item.id}>
          <NoticeLine
            label={`${t('步骤')} · ${item.stepKind} · ${t(STATUS_WORD[item.status] ?? item.status)}`}
          />
        </div>
      );
  }
}

function RunBody({ trace }: { trace: RunTrace }) {
  const { t } = useI18n();
  const state = useOpenSet();
  const [problemsOnly, setProblemsOnly] = useState(false);
  const hasProblems = trace.items.some(isProblem);
  const rows = runRows(trace.items, problemsOnly && hasProblems);
  const jump = (itemId: string) => {
    const group = rows.find(
      (row) => row.type === 'tools' && row.tools.some((tool) => tool.id === itemId),
    );
    state.setOpen(
      (prev) => new Set([...prev, itemId, ...(group === undefined ? [] : [group.key])]),
    );
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-run-item="${CSS.escape(itemId)}"]`)
        ?.scrollIntoView({ block: 'center' }),
    );
  };
  return (
    <div className="flex flex-col gap-4" data-testid="run-page">
      <p className="m-0 text-meta text-content-tertiary tabular-nums" data-testid="run-meta">
        {metaLine(trace, t)}
      </p>
      {trace.failure !== null && (
        <NoticeLine
          tone="danger"
          layout="plain"
          testId="run-failure"
          label={trace.failure.text}
          actions={
            trace.failure.itemId === null ? undefined : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 flex-none px-1 font-normal text-content-tertiary hover:text-foreground pointer-coarse:h-11"
                onClick={() => trace.failure?.itemId != null && jump(trace.failure.itemId)}
              >
                {t('看出错的那一步')}
              </Button>
            )
          }
        />
      )}
      {hasProblems && (
        <div className="flex">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={problemsOnly}
            data-testid="run-problems-only"
            className="pointer-coarse:h-11 aria-pressed:bg-muted"
            onClick={() => setProblemsOnly((value) => !value)}
          >
            {t('只看报错')}
          </Button>
        </div>
      )}
      <Trace data-testid="run-items" className="gap-3">
        {rows.map((row) =>
          row.type === 'tools' ? (
            <Folded
              key={row.key}
              id={row.key}
              state={state}
              title={t('{n} 次工具调用', { n: row.tools.length })}
              description={[...new Set(row.tools.map((tool) => tool.name))].join('、')}
            >
              {row.tools.map((tool) => (
                <ToolRow key={tool.id} tool={tool} recovered={false} state={state} />
              ))}
            </Folded>
          ) : (
            <ItemRow key={row.key} row={row} state={state} />
          ),
        )}
      </Trace>
    </div>
  );
}

function RunActions({ trace }: { trace: RunTrace }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const [exporting, setExporting] = useState(false);
  return (
    <div className="desktop-titlebar-no-drag flex items-center gap-1">
      <IconTooltip
        label={t('导出')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="run-export"
            aria-busy={exporting}
            className="text-content-tertiary hover:text-foreground pointer-coarse:size-11"
            onClick={() => {
              if (exporting) return;
              setExporting(true);
              downloadRunTrace(live ? teamId : undefined, trace)
                .catch((error: unknown) => toastError(t('下载失败，请重试。'), error))
                .finally(() => setExporting(false));
            }}
          />
        }
      >
        <Download />
      </IconTooltip>
    </div>
  );
}

function TracePane({ query }: { query: ReturnType<typeof useRunTrace> }) {
  const { t } = useI18n();
  const trace = query.data;
  const missing = query.error instanceof ApiError && query.error.status === 404;
  if (trace !== undefined) return <RunBody key={trace.id} trace={trace} />;
  if (missing)
    return (
      <EmptyState
        testId="run-missing"
        icon={ScrollText}
        title={t('找不到这条运行记录')}
        className="h-full"
      />
    );
  if (query.isError)
    return (
      <EmptyState
        testId="run-error"
        icon={TriangleAlert}
        title={t('未能加载运行记录')}
        action={{
          label: t('重试'),
          onClick: () => void query.refetch(),
          disabled: query.isFetching,
        }}
        className="h-full"
      />
    );
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span role="status" className="sr-only">
        {t('正在加载运行记录…')}
      </span>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-6 w-3/5" />
    </div>
  );
}

export function RunPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const linkTo = useRunLinkTo();
  const narrow = useNarrow();
  const { runId = null } = useParams();
  const [params] = useSearchParams();
  const problems = params.get('problems') === '1';
  const picked = useRunTrace(runId);
  const threadId = params.get('thread') ?? picked.data?.threadId ?? null;
  const threadSettled = params.has('thread') || runId === null || !picked.isPending;
  const scope: RunScope = threadId === null || params.get('scope') === 'all' ? 'all' : 'thread';
  const list = useRunList(scope === 'all' ? null : threadId, problems, threadSettled);
  const firstId = list.data?.pages[0]?.runs[0]?.id ?? null;
  const fallback = useRunTrace(runId === null && !narrow ? firstId : null);
  const shown = runId === null ? fallback : picked;
  const selectedId = runId ?? (narrow ? null : firstId);
  const threadEmpty = runId === null && !problems && list.isSuccess && firstId === null;
  const team = useRunList(null, false, threadEmpty && scope === 'thread');
  const nothing =
    threadEmpty && (scope === 'all' || (team.isSuccess && team.data.pages[0]?.runs.length === 0));
  const rowLink = (id: string | null, change: Parameters<typeof linkTo>[1] = {}) =>
    linkTo(id, { thread: threadId, ...change });
  const reshape = (change: Parameters<typeof linkTo>[1]) =>
    navigate(rowLink(runId ?? selectedId, change), { replace: true });
  const showList = !narrow || runId === null;
  const showTrace = !narrow || runId !== null;
  return (
    <RouteDialog
      title={(showTrace ? shown.data?.title : undefined) ?? t('运行记录')}
      size="page"
      bleed
      {...(showTrace && shown.data !== undefined
        ? { actions: <RunActions trace={shown.data} /> }
        : {})}
    >
      {nothing ? (
        <p className="m-0 px-4 pt-4 text-ui text-content-secondary" data-testid="run-list-nothing">
          {t('暂无运行记录')}
        </p>
      ) : (
        <div className="flex h-full min-h-0">
          {showList && (
            <RunList
              query={list}
              scope={scope}
              scopes={threadId !== null}
              problems={problems}
              selectedId={selectedId}
              linkTo={(id) => rowLink(id)}
              onScope={(next) => reshape({ scope: next === 'all' ? 'all' : null })}
              onProblems={(next) => reshape({ problems: next ? '1' : null })}
              className={narrow ? 'w-full' : 'w-80 flex-none border-r border-border'}
            />
          )}
          {showTrace && (
            <div className="min-h-0 min-w-0 flex-auto overflow-y-auto px-4 pt-4 pb-5">
              <div className="mx-auto flex w-full max-w-192 flex-col gap-3">
                {narrow && (
                  <Link
                    to={rowLink(null)}
                    data-testid="run-back"
                    className="-ml-1 flex w-fit items-center gap-1 rounded-md px-1 text-meta text-content-secondary outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                  >
                    <ChevronLeft className="size-4" />
                    {t('运行记录')}
                  </Link>
                )}
                {(runId !== null || firstId !== null) && <TracePane query={shown} />}
              </div>
            </div>
          )}
        </div>
      )}
    </RouteDialog>
  );
}
