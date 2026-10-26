import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { cn } from 'cn';
import {
  Activity,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  Plus,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { CardOrchestration } from '../chief/orchestration-inflight.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Skeleton } from '../components/ui/skeleton.js';
import type { TagChipData } from '../components/ui/tag-chip.js';
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { safeLocalStorage, safeSessionStorage, safeSetItem } from '../safe-storage.js';
import {
  type BoardColumnDef,
  COLUMNS,
  canDropOnColumn,
  needsDoneGate,
  needsResetGate,
  sortColumnTodos,
  splitStale,
  withColumnParam,
} from './columns.js';
import { DRAG_THRESHOLD_PX } from './dnd.js';
import { DragCard } from './drag-card.js';
import { DraggableCard } from './draggable-card.js';
import {
  type FilterChip,
  FilterChips,
  type FilterDimension,
  FilterPanel,
  TOPBAR_TEXT_BUTTON,
} from './filter-panel.js';
import { HomeSections, NeedsYouInbox } from './home.js';
import { BrandMark } from './sidebar.js';
import { cardTag } from './tag-filter.js';

export interface BoardFilters {
  dimensions: readonly FilterDimension[];
  chips: readonly FilterChip[];
  totalSelected: number;
  active: boolean;
  matches: (todo: TodoRecord) => boolean;
  onClear: () => void;
  summary: string;
}

interface BoardProps {
  fixture: FixtureSet;
  onAction?: (todo: TodoRecord) => void;
  onBranch?: (todo: TodoRecord) => void;
  hasBranch?: (todo: TodoRecord) => boolean;
  orchestrationOf?: (todo: TodoRecord) => CardOrchestration | null;
  onPhaseDrop?: (todo: TodoRecord, columnId: string) => void;
  onStartIntent?: (todo: TodoRecord) => void;
  onResetIntent?: (todo: TodoRecord) => void;
  onDoneIntent?: (todo: TodoRecord) => void;
  banner?: ReactNode;
  filters: BoardFilters;
  onlyColumn?: string | null;
  home?: boolean;
  tagsById?: ReadonlyMap<string, TagChipData>;
  onNewTask?: () => void;
  loading?: boolean;
}

const COLUMN_ICON = {
  idle: { icon: CircleDashed, tone: 'text-icon' },
  running: { icon: Activity, tone: 'text-running' },
  attention: { icon: CircleAlert, tone: 'text-(--card-button)' },
  done: { icon: CircleCheck, tone: 'text-icon' },
} as const;

function ColumnIcon({ status }: { status: BoardColumnDef['status'] }) {
  const { icon: Icon, tone } = COLUMN_ICON[status];
  return <Icon aria-hidden strokeWidth={1.75} className={`size-3.75 flex-none ${tone}`} />;
}

function NeedsYouSummary({ count }: { count: number }) {
  const { t } = useI18n();
  const { search } = useLocation();
  if (count === 0) {
    return (
      <span data-testid="needs-you" className="min-w-0 truncate text-ui text-content-tertiary">
        {t('没有等你处理的事')}
      </span>
    );
  }
  return (
    <Link
      data-testid="needs-you"
      to={withColumnParam(search, 'pending')}
      className="flex min-w-0 items-center gap-1.5 rounded-(--radius-control) text-ui text-content-tertiary no-underline hover:text-content-secondary"
    >
      <CircleAlert
        aria-hidden
        strokeWidth={1.75}
        className="size-3.25 flex-none text-(--card-button)"
      />
      <span className="min-w-0 truncate">
        <span className="font-semibold tabular-nums text-(--card-button)">{count}</span>{' '}
        {t('项等你处理')}
      </span>
    </Link>
  );
}

const LAST_SEEN_KEY = 'cairn.board.lastSeenAt';

function readLastSeenAt(): number {
  const parsed = Number(safeLocalStorage()?.getItem(LAST_SEEN_KEY) ?? Number.NaN);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function StalePendingLink({ count }: { count: number }) {
  const { t } = useI18n();
  const { search } = useLocation();
  return (
    <Link
      data-testid="column-stale-pending"
      to={withColumnParam(search, 'pending')}
      className="flex flex-none items-center gap-1.5 rounded-(--radius-card) px-2 py-2 text-meta text-content-tertiary no-underline hover:bg-secondary hover:text-content-secondary"
    >
      <span className="min-w-0 flex-1 truncate">{t('较早的 {count} 条', { count })}</span>
      <ChevronRight aria-hidden strokeWidth={1.75} className="size-3.25 flex-none" />
    </Link>
  );
}

export function BoardSurface({
  fixture,
  onAction,
  onBranch,
  hasBranch,
  orchestrationOf,
  onPhaseDrop,
  onStartIntent,
  onResetIntent,
  onDoneIntent,
  banner,
  filters,
  onlyColumn = null,
  home = false,
  tagsById,
  onNewTask,
  loading = false,
}: BoardProps) {
  const { t } = useI18n();
  const { search } = useLocation();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_THRESHOLD_PX },
    }),
  );
  const desktop =
    typeof window === 'undefined' ||
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const narrow = useCallback(
    (todos: TodoRecord[]) => (filters.active ? todos.filter(filters.matches) : todos),
    [filters.active, filters.matches],
  );
  const visibleTodos = narrow(fixture.todos);
  const visibleColumns = onlyColumn == null ? COLUMNS : COLUMNS.filter((c) => c.id === onlyColumn);
  const [seenWindow, setSeenWindow] = useState(() => ({
    from: readLastSeenAt(),
    to: Date.now(),
  }));
  const sinceLastSeen = visibleTodos.reduce(
    (counts, todo) => {
      if (todo.phaseAt <= seenWindow.from || todo.phaseAt > seenWindow.to) return counts;
      if (todo.phase === 'done' || todo.phase === 'closed') counts.done += 1;
      if (todo.phase === 'failed') counts.failed += 1;
      return counts;
    },
    { done: 0, failed: 0 },
  );
  useEffect(() => {
    const markSeen = () => safeSetItem(LAST_SEEN_KEY, String(Date.now()));
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markSeen();
      else setSeenWindow({ from: readLastSeenAt(), to: Date.now() });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      markSeen();
    };
  }, []);
  useEffect(() => {
    if (onlyColumn != null) return;
    const cols = COLUMNS.map(
      (column) => sortColumnTodos(column, visibleTodos.filter(column.accepts)).length,
    );
    if (cols.every((n) => n === 0)) return;
    try {
      localStorage.setItem('cairn-boot-shape', JSON.stringify({ cols }));
    } catch {}
  }, [visibleTodos, onlyColumn]);

  const showFilterEmpty =
    filters.active && visibleColumns.every((c) => !visibleTodos.some((todo) => c.accepts(todo)));

  const sweep = useCallback(() => {
    delete document.body.dataset.boardDragging;
    window.getSelection()?.removeAllRanges();
  }, []);

  const dragged = dragId == null ? null : (fixture.todos.find((t) => t.id === dragId) ?? null);
  const isValidDropTarget = (columnId: string | null): boolean =>
    dragged != null && columnId != null && canDropOnColumn(dragged, columnId);

  const onDragStart = (event: DragStartEvent) => {
    setDragId(String(event.active.id));
    document.body.dataset.boardDragging = '';
    window.getSelection()?.removeAllRanges();
  };

  const onDragOver = (event: DragOverEvent) => {
    const { over } = event;
    const overColumnId = over == null ? null : String(over.id);
    setDropColumnId(isValidDropTarget(overColumnId) ? overColumnId : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { over } = event;
    const overColumnId = over == null ? null : String(over.id);
    if (dragged != null && isValidDropTarget(overColumnId)) {
      const column = COLUMNS.find((c) => c.id === overColumnId);
      if (column?.startGate === true) onStartIntent?.(dragged);
      else if (overColumnId === 'todo' && needsResetGate(dragged)) onResetIntent?.(dragged);
      else if (overColumnId === 'done' && needsDoneGate(dragged)) onDoneIntent?.(dragged);
      else if (overColumnId != null) onPhaseDrop?.(dragged, overColumnId);
    }
    setDragId(null);
    setDropColumnId(null);
    sweep();
  };

  const onDragCancel = () => {
    setDragId(null);
    setDropColumnId(null);
    sweep();
  };

  const viewTodos = (columnId: string): TodoRecord[] => {
    const column = COLUMNS.find((c) => c.id === columnId);
    if (column == null) return [];
    return sortColumnTodos(column, visibleTodos.filter(column.accepts));
  };
  const pendingTodos = viewTodos('pending');
  const pendingSplit = splitStale(pendingTodos, fixture.now);
  const staleCount = pendingSplit.stale.length;

  return (
    <div className="board-main relative flex min-w-0 flex-1 flex-col">
      <header className="board-topbar flex h-14 flex-none items-center gap-3 px-6 whitespace-nowrap">
        <h1 className="board-topbar-title flex-none font-heading text-page font-medium text-foreground">
          {t(home || onlyColumn != null ? '工作台' : '看板')}
        </h1>
        {!home && <NeedsYouSummary count={pendingSplit.fresh.length} />}
        <FilterChips chips={filters.chips} onClearAll={filters.onClear} />
        <div className="board-topbar-actions ml-auto flex flex-none items-center gap-0.5">
          <FilterPanel
            dimensions={filters.dimensions}
            totalSelected={filters.totalSelected}
            onClearAll={filters.onClear}
          />
          <Button
            variant="ghost"
            size="sm"
            className={`board-topbar-schedule ${TOPBAR_TEXT_BUTTON}`}
            render={<Link to={{ pathname: '/app/schedules', search }} />}
          >
            <Clock aria-hidden strokeWidth={1.75} className="size-3.5 text-content-tertiary" />
            {t('定时')}
          </Button>
        </div>
      </header>

      {banner != null && <div className="flex-none px-[17px] pt-3">{banner}</div>}
      {onNewTask != null && (
        <Button
          variant="ghost"
          data-testid="board-new-task-bar"
          className="board-new-task-bar mx-auto mt-3 flex h-11 w-full justify-start font-normal hover:bg-card hover:text-content-tertiary dark:hover:bg-card active:not-aria-[haspopup]:translate-y-0 max-w-190 items-center gap-3 rounded-(--radius-composer) bg-card px-3.5 text-left text-ui text-content-tertiary shadow-(--shadow-composer) transition-[box-shadow] duration-(--dur-fast) ease-(--ease-standard) hover:shadow-(--shadow-composer-hover)"
          onClick={onNewTask}
        >
          <BrandMark className="size-5 text-(--card-button)" />
          <span className="min-w-0 flex-1 truncate">{t('新任务：接下来让 agent 做什么？')}</span>
          <Kbd>C</Kbd>
        </Button>
      )}
      {onlyColumn == null && (sinceLastSeen.done > 0 || sinceLastSeen.failed > 0) && (
        <span
          data-testid="board-since-last-seen"
          className="mx-auto block w-full max-w-190 px-4 pt-2 text-right text-meta text-content-tertiary"
        >
          {t('上次查看后：{done} 个完成，{failed} 个新失败', sinceLastSeen)}
        </span>
      )}

      {home ? (
        <HomeSections
          todos={visibleTodos}
          now={fixture.now}
          projectNames={fixture.projectNames}
          onAction={onAction}
          orchestrationOf={orchestrationOf}
          loading={loading}
        />
      ) : onlyColumn === 'pending' && !showFilterEmpty ? (
        <NeedsYouInbox
          todos={pendingTodos}
          now={fixture.now}
          projectNames={fixture.projectNames}
          onAction={onAction}
          orchestrationOf={orchestrationOf}
          loading={loading}
        />
      ) : (
        <DndContext
          sensors={desktop ? sensors : []}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div
            data-testid="board-scroller"
            className="board-scroller grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(var(--board-col-min),1fr))] grid-rows-[minmax(0,1fr)] gap-3.5 overflow-x-auto overflow-y-hidden bg-background px-[17px] pt-3 pb-[13px]"
          >
            {showFilterEmpty && (
              <div className="board-filter-empty col-span-4 flex h-full flex-col items-center justify-center gap-3">
                <span className="text-sm text-muted-foreground">{t('没有匹配筛选条件的任务')}</span>
                {filters.summary !== '' && (
                  <span className="text-xs text-muted-foreground">
                    {t('筛选生效：{summary}', { summary: filters.summary })}
                  </span>
                )}
                <Button variant="outline" size="sm" onClick={filters.onClear}>
                  {t('清除筛选')}
                </Button>
              </div>
            )}
            {!showFilterEmpty &&
              visibleColumns.map((column) => {
                const todos = column.id === 'pending' ? pendingSplit.fresh : viewTodos(column.id);
                const listed = todos.length + (column.id === 'pending' ? staleCount : 0);
                return (
                  <section
                    key={column.id}
                    className={cn(
                      'board-column group/column relative flex h-full flex-col bg-background',
                      isValidDropTarget(column.id) &&
                        'rounded-(--radius-card) bg-(--drop-tint-base)',
                      dropColumnId === column.id && 'bg-(--drop-tint-hover)',
                    )}
                    aria-label={t(column.name)}
                    data-column={column.id}
                    data-empty={listed === 0 && !loading ? 'true' : undefined}
                    data-drop-valid={isValidDropTarget(column.id) ? 'true' : undefined}
                    data-drop={dropColumnId === column.id ? 'true' : undefined}
                  >
                    <header className="mx-1 mb-1 flex h-9 flex-none items-center gap-2 border-b border-border px-1">
                      <ColumnIcon status={column.status} />
                      <h2 className="board-column-name font-heading text-heading font-medium text-foreground">
                        {t(column.name)}
                      </h2>
                      <span
                        data-testid="column-count"
                        className="text-meta tabular-nums text-content-tertiary"
                      >
                        {todos.length}
                      </span>
                      {column.label && (
                        <span className="text-meta text-content-tertiary">{t(column.label)}</span>
                      )}
                      {column.id === 'todo' && onNewTask != null && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="ml-auto text-content-tertiary opacity-0 transition-opacity duration-150 ease-out group-hover/column:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                          aria-label={t('新建任务')}
                          onClick={onNewTask}
                        >
                          <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
                        </Button>
                      )}
                    </header>
                    <ColumnList
                      columnId={column.id}
                      empty={
                        column.id === 'todo' && onNewTask != null ? (
                          <Button
                            variant="ghost"
                            data-column-empty-new=""
                            onClick={onNewTask}
                            className="h-auto w-full justify-start gap-2 rounded-(--radius-card) border border-dashed border-border bg-transparent px-3.5 py-3 text-left text-ui font-normal text-content-tertiary transition-colors duration-150 ease-out hover:border-content-dim hover:bg-transparent hover:text-content-secondary dark:hover:bg-transparent"
                          >
                            <Plus aria-hidden strokeWidth={1.75} className="size-3.5 flex-none" />
                            <span className="min-w-0 flex-1 truncate">{t('写下想做的事')}</span>
                          </Button>
                        ) : (
                          t(EMPTY_COPY[column.id] ?? '暂无')
                        )
                      }
                      count={listed}
                      loading={loading}
                    >
                      {todos.map((todo) => (
                        <DraggableCard
                          key={todo.id}
                          todo={todo}
                          now={fixture.now}
                          onAction={onAction}
                          onBranch={onBranch}
                          hasBranch={hasBranch == null ? undefined : hasBranch(todo)}
                          orchestration={orchestrationOf?.(todo) ?? null}
                          projectName={fixture.projectNames?.[todo.projectId]}
                          tag={tagsById == null ? null : cardTag(todo, tagsById)}
                        />
                      ))}
                      {column.id === 'pending' && staleCount > 0 && (
                        <StalePendingLink count={staleCount} />
                      )}
                    </ColumnList>
                  </section>
                );
              })}
          </div>
          <DragOverlay dropAnimation={null} style={{ willChange: 'transform' }}>
            {dragged != null && (
              <div data-testid="drag-overlay">
                <DragCard todo={dragged} projectName={fixture.projectNames?.[dragged.projectId]} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

const COLUMN_SCROLL_KEY = 'cairn.board.column-scroll';

function readColumnScroll(): Record<string, number> {
  const storage = safeSessionStorage();
  if (storage == null) return {};
  try {
    const raw = storage.getItem(COLUMN_SCROLL_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeColumnScroll(columnId: string, top: number): void {
  const storage = safeSessionStorage();
  if (storage == null) return;
  try {
    const all = readColumnScroll();
    all[columnId] = top;
    storage.setItem(COLUMN_SCROLL_KEY, JSON.stringify(all));
  } catch {}
}

const EMPTY_COPY: Record<string, string> = {
  todo: '还没有待开始的任务',
  building: '没有在跑的任务',
  pending: '没有等你处理的事',
  done: '最近 7 天还没有完成的任务',
};

/** The list area doubles as the column's drop target so empty columns
 *  accept drops (useDroppable id = column id). #504: the list is the
 *  column's scroll surface — the header stays fixed while cards
 *  overflow (overflow-y rides the same native-scrollbar convention as
 *  .secondary-body / .res-body). XMON-42: the 1px block padding is load
 *  bearing — a scroll container clips at its padding box while the card's
 *  ring is a box-shadow drawn outside the border box, so with a zero block
 *  inset the topmost card (and, scrolled to the end, the bottommost one)
 *  loses that edge; the inline axis carries 4px of inset.
 *  #1255: this list unmounts with the board route. The offset lives here,
 *  not on .board-scroller (that node is overflow-y hidden). */
function ColumnList({
  columnId,
  empty,
  count,
  loading,
  children,
}: {
  columnId: string;
  empty: ReactNode;
  count: number;
  loading: boolean;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const restored = useRef(false);
  const { setNodeRef } = useDroppable({ id: columnId });
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el == null) return;
    if (!restored.current) {
      const saved = readColumnScroll()[columnId];
      if (saved == null || saved === 0) {
        restored.current = true;
      } else if (el.scrollHeight - el.clientHeight > 0) {
        el.scrollTop = saved;
        restored.current = true;
      }
    }
    if (!restored.current) return;
    const onScroll = () => {
      writeColumnScroll(columnId, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      writeColumnScroll(columnId, el.scrollTop);
    };
  }, [columnId, count]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 py-1"
      ref={setRefs}
      data-column-list={columnId}
    >
      {children}
      {count === 0 &&
        loading &&
        [0, 1].map((n) => (
          <div
            key={n}
            data-card-skeleton=""
            className="flex h-21 flex-none flex-col gap-2.5 rounded-(--radius-card) bg-card px-3.5 py-3 shadow-(--panel-shadow)"
          >
            <Skeleton className="bg-accent h-3.5 w-4/5" />
            <Skeleton className="bg-accent h-3.5 w-1/2" />
            <Skeleton className="bg-accent mt-auto h-3 w-2/5" />
          </div>
        ))}
      {count === 0 && !loading && (
        <div className="board-column-empty px-0.5 py-2 text-meta text-content-tertiary">
          {empty}
        </div>
      )}
    </div>
  );
}
