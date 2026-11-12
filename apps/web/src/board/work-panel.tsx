import { PackageCheck, Search, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useArchivedTodos, useProjects, usePrs } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { prByThread } from '../components/thread/pr-panel-model.js';
import { Button } from '../components/ui/button.js';
import type { TodoRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { MadeCard, MadeCarousel } from './made-carousel.js';
import { groupMade, MADE_GROUP_LABEL, madeKindOf, matchesMadeQuery } from './made-groups.js';
import { MadeSearch } from './made-search.js';
import { joinMeta, relativeTime } from './rel-time.js';
import { threadStatus } from './thread-copy.js';

export type WorkPane = 'tasks' | 'made' | 'machines' | 'file';

export const PANE_PARAM = 'pane';

export function paneOf(value: string | null): WorkPane | null {
  return value === 'tasks' || value === 'made' || value === 'machines' || value === 'file'
    ? value
    : null;
}

type MadeTab = 'all' | 'archived';

interface WorkPanelProps {
  todos: readonly TodoRecord[];
  projectId?: string | null;
  now: number;
  onClose: () => void;
  onOpenThread: (id: string) => void;
  todosQuery?: QueryLike;
}

export function useProjectNames(): ReadonlyMap<string, string> {
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const { search } = useLocation();
  return useMemo(() => {
    if (live) return new Map((projectsQ.data ?? []).map((p) => [p.id, p.name]));
    return new Map(Object.entries(resolveScenario(new URLSearchParams(search)).projectNames ?? {}));
  }, [live, projectsQ.data, search]);
}

const isMade = (todo: TodoRecord) => threadStatus(todo) === 'done';

export function WorkPanel({
  todos,
  projectId = null,
  now,
  onClose,
  onOpenThread,
  todosQuery,
}: WorkPanelProps) {
  const { t } = useI18n();
  const title = t('成果');
  const { live: connected, teamId } = useLiveData();
  const prOf = prByThread(usePrs(teamId, undefined, connected).data);
  const projectNames = useProjectNames();
  const [tab, setTab] = useState<MadeTab>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const archivedQ = useArchivedTodos(teamId, connected && tab === 'archived');
  const archivedLive = useMemo(
    () =>
      (archivedQ.data ?? [])
        .map(toDisplayTodo)
        .filter((todo) => projectId === null || todo.projectId === projectId),
    [archivedQ.data, projectId],
  );
  const source =
    tab === 'archived'
      ? connected
        ? archivedLive.filter(isMade)
        : todos.filter((todo) => isMade(todo) && todo.archivedAt != null)
      : todos.filter((todo) => isMade(todo) && todo.archivedAt == null);
  const showProject = projectId === null;
  const projectOf = (todo: TodoRecord) =>
    showProject ? projectNames.get(todo.projectId) : undefined;
  const made = source.filter((todo) =>
    matchesMadeQuery(todo.title, projectOf(todo), query, t(MADE_GROUP_LABEL[madeKindOf(todo)])),
  );
  const groups = groupMade(made);
  const activeQuery: QueryLike | undefined =
    tab === 'archived' && connected ? archivedQ : todosQuery;

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };
  const toggleSearch = () => (searching ? closeSearch() : setSearching(true));

  const emptyView =
    source.length === 0 ? (
      tab === 'archived' ? (
        <p
          data-testid="made-archived-empty"
          className="m-0 px-4 pt-8 text-ui text-content-tertiary"
        >
          {t('还没有已归档的成果')}
        </p>
      ) : (
        <EmptyState
          testId="made-empty"
          icon={PackageCheck}
          title={t('还没有完成的工作')}
          description={t('任务合并完成后会出现在这里。')}
          className="mt-[10vh]"
        />
      )
    ) : (
      <EmptyState
        testId="made-no-match"
        icon={SearchX}
        title={t('没有匹配的成果')}
        className="mt-[10vh]"
      />
    );

  const listView = (
    <>
      {groups.map((group, index) => (
        <section
          key={group.key}
          data-testid="made-group"
          data-group={group.key}
          className={index === 0 ? 'pt-7' : 'pt-9'}
        >
          <h3 className="m-0 flex items-baseline gap-1.5 px-4 pb-1 text-ui font-normal text-foreground">
            {t(MADE_GROUP_LABEL[group.key])}
            <span data-testid="made-group-count" className="text-content-tertiary tabular-nums">
              {group.items.length}
            </span>
          </h3>
          <MadeCarousel groupKey={group.key} count={group.items.length}>
            {group.items.map((todo) => (
              <MadeCard
                key={todo.id}
                todo={todo}
                meta={joinMeta([relativeTime(todo.phaseAt, now, t), projectOf(todo)])}
                pr={prOf.get(todo.id)}
                onOpen={() => onOpenThread(todo.id)}
              />
            ))}
          </MadeCarousel>
        </section>
      ))}
    </>
  );
  const body = made.length === 0 ? emptyView : listView;
  return (
    <SidePanel label={title} onDismiss={onClose} phoneTab>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{title}</SidePanelTitle>
        <IconTooltip
          label={t('搜索成果')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="made-search-toggle"
              aria-pressed={searching}
              onClick={toggleSearch}
              className="text-content-secondary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
            />
          }
        >
          <Search aria-hidden className="size-5.5" strokeWidth={1.75} />
        </IconTooltip>
      </SidePanelHead>
      {searching && <MadeSearch value={query} onChange={setQuery} onClose={closeSearch} />}
      <div className="flex flex-none px-4">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          label={title}
          className="h-7 p-0.5 group-data-horizontal/tabs:h-7"
          optionHandle="h-6 px-2.5 text-foreground data-active:font-normal dark:text-foreground"
          options={[
            { value: 'all', label: t('全部'), testId: 'made-tab-all' },
            { value: 'archived', label: t('已归档'), testId: 'made-tab-archived' },
          ]}
        />
      </div>
      <div data-testid="made-tabs" className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
        {tab === 'archived' && (
          <p
            data-testid="made-archived-note"
            className="m-0 px-4 pt-5 text-ui text-content-tertiary"
          >
            {t('已归档的成果会一直保留，直到你删除它或它所在的项目。')}
          </p>
        )}
        <QueryBoundary
          query={activeQuery}
          isEmpty={made.length === 0}
          loadingLabel={t('正在加载成果')}
          errorTitle={t('成果没能加载')}
          empty={body}
        >
          {body}
        </QueryBoundary>
      </div>
    </SidePanel>
  );
}
