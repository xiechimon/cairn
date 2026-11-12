import { parseSearchQuery, type SearchFilterResult } from '@cairn/shared';
import { cn } from 'cn';
import { CircleHelp, Plus, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { formatUsd, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useProjectMark } from '../board/project-mark.js';
import { relativeTime } from '../board/rel-time.js';
import { threadCopy, threadTone } from '../board/thread-copy.js';
import { useThreadHref } from '../board/thread-link.js';
import { EmptyState } from '../components/empty-state.js';
import { StoneTrail } from '../components/stone/stone-group.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { withoutDeleted } from '../fixtures/deletions.js';
import type { TodoRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import {
  type ActivityGroup,
  type ActivityRow,
  activityRows,
  activityTodosForHits,
  activityTotalCost,
  groupByDay,
  pageRows,
  searchTodosLocally,
} from '../search/activity-model.js';
import { ChipProblems, QueryChip, SyntaxHelp } from '../search/query-chip.js';
import {
  chipProblem,
  completeTrailingToken,
  endsInFilter,
  joinQuery,
  removeChipAt,
  splitQuery,
} from '../search/search-query.js';
import { useActivityClock } from '../search/use-activity-clock.js';
import { useActivityData } from '../search/use-activity-data.js';

const QUICK_FILTERS = [
  { label: '失败', token: 'is:failed' },
  { label: '等你处理', token: 'is:waiting' },
  { label: '待审阅', token: 'is:review' },
  { label: '近 7 天', token: 'after:7d' },
  { label: '超过 $1', token: 'cost:>1' },
] as const;

const GROUP_LABEL: Record<ActivityGroup['id'], string> = {
  today: '今日',
  yesterday: '昨日',
  week: '本周早些时候',
  older: '更早',
};

function ActivityThreadRow({
  row,
  now,
  onOpen,
}: {
  row: ActivityRow;
  now: number;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const projectMark = useProjectMark();
  const tone = threadTone(row.todo);
  return (
    <ThreadRow
      title={row.todo.title}
      tone={tone}
      age={relativeTime(row.todo.phaseAt, now, t)}
      onOpen={onOpen}
      reason={
        <span className="inline-flex max-w-full items-center gap-1.5">
          <ToneGlyph tone={tone} still />
          {row.projectName !== undefined && (
            <>
              <ProjectAvatar name={row.projectName} {...projectMark(row.todo.projectId)} bare />
              <span className="truncate">{row.projectName}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate max-[640px]:hidden">{t(threadCopy(row.todo).reason)}</span>
          <span aria-hidden className="max-[640px]:hidden">
            ·
          </span>
          <span data-testid="activity-row-cost" className="flex-none font-mono text-code">
            {row.cost === null ? '—' : formatUsd(row.cost)}
          </span>
        </span>
      }
    />
  );
}

export function ActivityPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const threadHref = useThreadHref();
  const [params, setParams] = useSearchParams();
  const { live } = useLiveData();
  const fixture = resolveScenario(params);
  const queryParam = params.get('q') ?? '';
  const [query, setQueryState] = useState(() => {
    const initial = (params.get('q') ?? '').trim();
    return initial === '' ? '' : `${initial} `;
  });
  const [pages, setPages] = useState(1);
  const [helpOpen, setHelpOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setQueryState((previous) =>
      previous.trim() === queryParam ? previous : queryParam === '' ? '' : `${queryParam} `,
    );
  }, [queryParam]);

  const setQuery = (nextQuery: string) => {
    setQueryState(nextQuery);
    const next = new URLSearchParams(params);
    if (nextQuery.trim() === '') next.delete('q');
    else next.set('q', nextQuery.trim());
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  };

  const activity = useActivityData(live, query);
  const { todos: todosQ, projects: projectsQ, search: searchQ } = activity;
  const now = useActivityClock(live, fixture.now, activity.refreshAtBoundary);
  const allTodos: TodoRecord[] = useMemo(
    () => (live ? (todosQ.data ?? []).map(toDisplayTodo) : withoutDeleted(fixture.todos)),
    [live, todosQ.data, fixture],
  );
  const projectName = (projectId: string): string | undefined =>
    live
      ? projectsQ.data?.find((project) => project.id === projectId)?.name
      : fixture.projectNames?.[projectId];

  const trimmed = query.trim();
  const parsed = parseSearchQuery(query, now);
  const local = !live && trimmed !== '' ? searchTodosLocally(allTodos, projectName, parsed) : null;
  const matched: TodoRecord[] =
    trimmed === ''
      ? allTodos
      : live
        ? activityTodosForHits(searchQ.data?.todos ?? [], allTodos)
        : (local?.todos ?? []);
  const serverFilters: readonly SearchFilterResult[] | undefined = live
    ? searchQ.data?.filters
    : local?.filters;
  const rows = activityRows(matched, projectName);
  const shown = pageRows(rows, pages);
  const groups = groupByDay(shown, now);
  const totalCost = activityTotalCost(rows);

  useEffect(() => {
    setPages(1);
  }, [query]);

  const { chips, text } = splitQuery(query, now);
  const problems = chips.map((chip) => chipProblem(chip, serverFilters));
  const hasToken = (token: string) => chips.some((chip) => chip.raw === token);
  const toggleQuick = (token: string) => {
    const index = chips.findIndex((chip) => chip.raw === token);
    setQuery(
      joinQuery(
        index === -1
          ? [...chips, ...splitQuery(`${token} `, now).chips]
          : removeChipAt(chips, index),
        text,
      ),
    );
  };

  const loading = activity.state === 'loading';
  const failed = activity.state === 'error';

  return (
    <PageShell
      route="activity"
      fixture={fixture}
      selected="none"
      title={<span className="max-[640px]:pl-8">{t('活动')}</span>}
      bleed
      actions={
        !loading &&
        !failed && (
          <span data-testid="activity-summary" className="text-meta text-content-tertiary">
            {t('{n} 条 · {cost}', {
              n: rows.length,
              cost: totalCost === null ? '—' : formatUsd(totalCost),
            })}
          </span>
        )
      }
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1 text-content-tertiary dark:bg-input/30">
          <Search width={16} height={16} className="flex-none" />
          {chips.map((chip, index) => (
            <QueryChip
              key={`${chip.raw}-${index}`}
              chip={chip}
              problem={problems[index] ?? null}
              onRemove={() => setQuery(joinQuery(removeChipAt(chips, index), text))}
            />
          ))}
          <Input
            ref={inputRef}
            aria-label={t('筛选活动')}
            value={text}
            placeholder={t('加词或筛选')}
            onChange={(event) => setQuery(joinQuery(chips, event.target.value))}
            onKeyDown={(event) => {
              const lastChip = chips.at(-1);
              if (event.key === 'Backspace' && text === '' && lastChip !== undefined) {
                event.preventDefault();
                setQuery(joinQuery(chips.slice(0, -1), lastChip.raw));
              } else if (event.key === 'Tab' && !event.shiftKey) {
                const completed = completeTrailingToken(text);
                if (completed === null) return;
                event.preventDefault();
                setQuery(joinQuery(chips, completed));
              } else if (event.key === 'Enter' && endsInFilter(text, now)) {
                event.preventDefault();
                setQuery(`${query} `);
              }
            }}
            className="h-6 min-w-24 flex-1 rounded-none border-none bg-transparent p-0 text-ui text-foreground shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent md:text-ui"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('语法')}
            aria-expanded={helpOpen}
            className="text-content-tertiary"
            onClick={() => setHelpOpen((value) => !value)}
          >
            <CircleHelp />
          </Button>
        </div>
        <ChipProblems chips={chips} problems={problems} />
        {helpOpen && <SyntaxHelp className="shadow-none ring-1 ring-border" />}
        <fieldset className="m-0 flex min-w-0 items-center gap-1.5 overflow-x-auto border-0 p-0">
          <legend className="sr-only">{t('快速筛选')}</legend>
          {QUICK_FILTERS.map((quick) => (
            <Button
              key={quick.token}
              variant="outline"
              size="sm"
              data-testid="quick-filter"
              aria-pressed={hasToken(quick.token)}
              className={cn(
                'flex-none rounded-full text-content-secondary',
                hasToken(quick.token) && 'border-foreground/30 bg-secondary text-foreground',
              )}
              onClick={() => toggleQuick(quick.token)}
            >
              {t(quick.label)}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="flex-none text-content-secondary"
            onClick={() => {
              setHelpOpen(true);
              inputRef.current?.focus();
            }}
          >
            <Plus data-icon="inline-start" />
            {t('筛选')}
          </Button>
        </fieldset>
      </div>
      <div className="min-h-0 flex-1 pb-4" data-testid="activity-list">
        {loading ? (
          <div className="flex flex-col gap-3 px-6 pt-2" aria-busy="true">
            <span role="status" className="sr-only">
              {t('正在加载活动')}
            </span>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : failed ? (
          <EmptyState
            testId="activity-error"
            icon={TriangleAlert}
            title={t('活动没能加载')}
            description={t('检查网络后再试一次。')}
            action={{ label: t('重试'), onClick: activity.retry, disabled: activity.retryBusy }}
            className="py-16"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            testId="activity-empty"
            icon={Search}
            title={trimmed === '' ? t('还没有活动') : t('没有同时满足这些筛选的任务')}
            {...(trimmed === ''
              ? {}
              : { action: { label: t('清除全部筛选'), onClick: () => setQuery('') } })}
            className="py-16"
          />
        ) : (
          <StoneTrail className="px-2">
            {groups.map((group) => (
              <section
                key={group.id}
                data-testid="activity-group"
                data-group={group.id}
                aria-label={t(GROUP_LABEL[group.id])}
                className="flex flex-col gap-1"
              >
                <div className="flex items-baseline gap-2 px-2 pt-2 pb-1">
                  <h2 className="m-0 text-caption font-medium text-content-tertiary">
                    {t(GROUP_LABEL[group.id])}
                  </h2>
                  <span
                    data-testid="activity-group-total"
                    className="text-caption text-content-tertiary"
                  >
                    {t('{n} 条 · {cost}', {
                      n: group.count,
                      cost: group.cost === null ? '—' : formatUsd(group.cost),
                    })}
                  </span>
                </div>
                {group.rows.map((row) => (
                  <ActivityThreadRow
                    key={row.id}
                    row={row}
                    now={now}
                    onOpen={() => navigate(threadHref(row.id))}
                  />
                ))}
              </section>
            ))}
            <div className="flex items-center gap-3 px-2 pt-3">
              <span data-testid="activity-showing" className="text-meta text-content-tertiary">
                {t('显示 {shown} / {total}', { shown: shown.length, total: rows.length })}
              </span>
              {shown.length < rows.length && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="activity-load-more"
                  onClick={() => setPages((value) => value + 1)}
                >
                  {t('加载更多')}
                </Button>
              )}
            </div>
          </StoneTrail>
        )}
      </div>
    </PageShell>
  );
}
