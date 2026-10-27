import { canOrchestrate } from '@cairn/shared';
import { cn } from 'cn';
import {
  Activity,
  Ban,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  type LucideIcon,
  Play,
  RotateCcw,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { SpiralMark } from '../chief/chief-fab-icon.js';
import type { CardOrchestration } from '../chief/orchestration-inflight.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { PHASE_UI } from '../phase.js';
import { useOpenTaskInPlace } from '../task-panel/task-panel-root.js';
import { COLUMNS, cardFace, STALE_PENDING_MS, sortColumnTodos, splitStale } from './columns.js';
import { relativeTime } from './rel-time.js';
import { ATTENTION } from './todo-card.js';

export const BOARD_VIEW_PARAM = 'view';

export function withoutBoardView(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(BOARD_VIEW_PARAM);
  return `?${params}`;
}
const DONE_PREVIEW = 5;

export interface RowContext {
  now: number;
  projectNames?: Record<string, string>;
  onAction?: (todo: TodoRecord) => void;
  orchestrationOf?: (todo: TodoRecord) => CardOrchestration | null;
}

const ACTION_CLASS = 'flex-none gap-1 text-(--card-button)';

function RowAction({
  orchestration,
  icon: Icon,
  label,
  onClick,
}: {
  orchestration: CardOrchestration | null;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const failed = orchestration?.error !== undefined;
  if (orchestration != null && !failed) {
    return <span className="px-2 text-meta text-content-tertiary">{t('编排中')}</span>;
  }
  const ActionIcon = failed ? RotateCcw : Icon;
  return (
    <Button variant="ghost" size="xs" className={ACTION_CLASS} onClick={onClick}>
      <ActionIcon aria-hidden strokeWidth={1.75} className="size-3.25" />
      {t(failed ? '重试' : label)}
    </Button>
  );
}

function orchestrationFor(ctx: RowContext, todo: TodoRecord): CardOrchestration | null {
  return canOrchestrate(todo.phase) ? (ctx.orchestrationOf?.(todo) ?? null) : null;
}

function columnTodos(columnId: string, todos: TodoRecord[]): TodoRecord[] {
  const column = COLUMNS.find((c) => c.id === columnId);
  return column == null ? [] : sortColumnTodos(column, todos.filter(column.accepts));
}

function TaskRow({
  todo,
  testId,
  status,
  meta,
  muted = false,
  trailing,
}: {
  todo: TodoRecord;
  testId: string;
  status: ReactNode;
  meta: (string | undefined)[];
  muted?: boolean;
  trailing?: ReactNode;
}) {
  const { search } = useLocation();
  const openInPlace = useOpenTaskInPlace();
  return (
    <div
      data-testid={testId}
      className="relative flex min-h-14 items-center gap-3 px-3.5 py-2.5 transition-colors duration-(--dur-fast) ease-(--ease-standard) hover:bg-secondary/60"
    >
      <span className="mt-0.5 flex size-3.75 flex-none self-start items-center justify-center">
        {status}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          className={cn(
            "line-clamp-2 text-ui wrap-break-word no-underline after:absolute after:inset-0 after:content-['']",
            muted ? 'text-content-tertiary' : 'text-foreground',
          )}
          to={{ pathname: `/app/todo/${todo.id}`, search }}
          onClick={(event) => openInPlace(event, todo.id)}
        >
          {todo.title}
        </Link>
        <div className="text-meta text-content-tertiary">
          {meta.filter((part) => part != null).join(' · ')}
        </div>
      </div>
      {trailing != null && (
        <div className="relative z-10 flex flex-none items-center">{trailing}</div>
      )}
    </div>
  );
}

function RowList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)">
      {children}
    </div>
  );
}

function StatusGlyph({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return <Icon aria-hidden strokeWidth={1.75} className={cn('size-3.75', className)} />;
}

function Fold({
  label,
  hint,
  testId,
  children,
}: {
  label: string;
  hint?: string;
  testId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId}>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        className="-ml-2 gap-1.5 font-normal text-content-secondary aria-expanded:bg-transparent aria-expanded:text-content-secondary"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'size-3.5 transition-transform duration-(--dur-fast) ease-(--ease-standard)',
            open && 'rotate-90',
          )}
        />
        {label}
        {hint != null && <span className="text-meta text-content-dim">{hint}</span>}
      </Button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function useProjectName(projectNames?: Record<string, string>) {
  const { live } = useLiveData();
  return (todo: TodoRecord) => projectNames?.[todo.projectId] ?? (live ? undefined : PROJECT_NAME);
}

function NeedsYouRows({ todos, ...ctx }: RowContext & { todos: TodoRecord[] }) {
  const { t } = useI18n();
  const projectOf = useProjectName(ctx.projectNames);
  return (
    <RowList>
      {todos.map((todo) => {
        const face = cardFace(todo);
        if (face.kind !== 'attention') return null;
        const attention = ATTENTION[face.need];
        const orchestration = orchestrationFor(ctx, todo);
        const orchestrationFailed = orchestration?.error !== undefined;
        return (
          <TaskRow
            key={todo.id}
            todo={todo}
            testId="needs-you-row"
            status={
              <StatusGlyph
                icon={orchestrationFailed ? CircleX : attention.icon}
                className="text-(--card-button)"
              />
            }
            meta={[
              projectOf(todo),
              `#${todo.seqNum}`,
              t(orchestrationFailed ? '编排失败' : attention.label),
              relativeTime(todo.phaseAt, ctx.now, t),
            ]}
            trailing={
              <RowAction
                orchestration={orchestration}
                icon={attention.actionIcon}
                label={attention.action}
                onClick={() => ctx.onAction?.(todo)}
              />
            }
          />
        );
      })}
    </RowList>
  );
}

function NeedsYouList({
  todos,
  loading,
  quiet,
  ...ctx
}: RowContext & { todos: TodoRecord[]; loading: boolean; quiet: ReactNode }) {
  const { t } = useI18n();
  const { fresh, stale } = splitStale(todos, ctx.now);
  return (
    <>
      {fresh.length > 0 ? (
        <NeedsYouRows todos={fresh} {...ctx} />
      ) : loading ? (
        <div className="flex flex-col gap-2.5 rounded-(--radius-card) bg-card px-3.5 py-3 shadow-(--e1)">
          <Skeleton className="bg-accent h-3.5 w-3/5" />
          <Skeleton className="bg-accent h-3 w-2/5" />
        </div>
      ) : (
        quiet
      )}
      {stale.length > 0 && (
        <Fold
          testId="needs-you-stale"
          label={t('较早的 {count} 条', { count: stale.length })}
          hint={t('超过 7 天没动')}
        >
          <NeedsYouRows todos={stale} {...ctx} />
        </Fold>
      )}
    </>
  );
}

export function NeedsYouInbox(props: RowContext & { todos: TodoRecord[]; loading: boolean }) {
  const { t } = useI18n();
  return (
    <section
      data-testid="needs-you-inbox"
      className="board-inbox min-h-0 flex-1 overflow-y-auto pb-10"
    >
      <div className="mx-auto flex w-full max-w-198 flex-col gap-5 px-4 pt-4">
        <NeedsYouList
          {...props}
          quiet={
            <div className="flex flex-col items-center gap-1 py-10 text-center">
              <CircleCheck aria-hidden strokeWidth={1.5} className="size-6 text-content-dim" />
              <span className="text-ui text-content-secondary">{t('没有等你处理的事')}</span>
            </div>
          }
        />
      </div>
    </section>
  );
}

function HomeSection({
  testId,
  icon: Icon,
  tone,
  title,
  count,
  label,
  children,
}: {
  testId: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  count: number;
  label?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section data-testid={testId} aria-label={t(title)} className="flex flex-col gap-2">
      <header className="flex h-8 items-center gap-2 px-1">
        <Icon aria-hidden strokeWidth={1.75} className={cn('size-3.75 flex-none', tone)} />
        <h2 className="font-heading text-heading font-medium text-foreground">{t(title)}</h2>
        <span
          data-testid="home-section-count"
          className="text-meta tabular-nums text-content-tertiary"
        >
          {count}
        </span>
        {label != null && <span className="text-meta text-content-tertiary">{t(label)}</span>}
      </header>
      {children}
    </section>
  );
}

function QuietLine({ children }: { children: ReactNode }) {
  return <p className="m-0 px-1 text-meta text-content-tertiary">{children}</p>;
}

export function HomeSections({
  todos,
  loading,
  ...ctx
}: RowContext & { todos: TodoRecord[]; loading: boolean }) {
  const { t } = useI18n();
  const { search } = useLocation();
  const projectOf = useProjectName(ctx.projectNames);
  const needsYou = columnTodos('pending', todos);
  const running = columnTodos('building', todos);
  const notStarted = columnTodos('todo', todos);
  const done = columnTodos('done', todos).filter(
    (todo) => ctx.now - todo.phaseAt <= STALE_PENDING_MS,
  );
  const boardSearch = new URLSearchParams(search);
  boardSearch.set(BOARD_VIEW_PARAM, 'board');
  const needsYouFresh = splitStale(needsYou, ctx.now).fresh.length;

  return (
    <div data-testid="home-sections" className="board-inbox min-h-0 flex-1 overflow-y-auto pb-10">
      <div className="mx-auto flex w-full max-w-198 flex-col gap-7 px-4 pt-5">
        <HomeSection
          testId="home-needs-you"
          icon={CircleAlert}
          tone="text-(--card-button)"
          title="需要你"
          count={needsYouFresh}
        >
          <NeedsYouList
            todos={needsYou}
            loading={loading}
            quiet={<QuietLine>{t('没有等你处理的事')}</QuietLine>}
            {...ctx}
          />
        </HomeSection>

        <HomeSection
          testId="home-running"
          icon={Activity}
          tone="text-running"
          title="在跑"
          count={running.length}
        >
          {running.length > 0 ? (
            <RowList>
              {running.map((todo) => (
                <TaskRow
                  key={todo.id}
                  todo={todo}
                  testId="home-running-row"
                  status={
                    todo.phase === 'queued' ? (
                      <StatusGlyph icon={CircleDashed} className="text-content-tertiary" />
                    ) : (
                      <SpiralMark busy className="size-3.75 text-running" />
                    )
                  }
                  meta={[
                    projectOf(todo),
                    `#${todo.seqNum}`,
                    todo.agent?.displayName,
                    t(PHASE_UI[todo.phase].chip),
                    relativeTime(todo.phaseAt, ctx.now, t),
                  ]}
                />
              ))}
            </RowList>
          ) : (
            <QuietLine>{t('没有在跑的任务')}</QuietLine>
          )}
          {notStarted.length > 0 && (
            <Fold
              testId="home-not-started"
              label={t('还没开始的 {count} 条', { count: notStarted.length })}
            >
              <RowList>
                {notStarted.map((todo) => (
                  <TaskRow
                    key={todo.id}
                    todo={todo}
                    testId="home-not-started-row"
                    status={<StatusGlyph icon={CircleDashed} className="text-content-tertiary" />}
                    meta={[
                      projectOf(todo),
                      `#${todo.seqNum}`,
                      relativeTime(todo.phaseAt, ctx.now, t),
                    ]}
                    trailing={
                      <RowAction
                        orchestration={orchestrationFor(ctx, todo)}
                        icon={Play}
                        label="开始"
                        onClick={() => ctx.onAction?.(todo)}
                      />
                    }
                  />
                ))}
              </RowList>
            </Fold>
          )}
        </HomeSection>

        <HomeSection
          testId="home-done"
          icon={CircleCheck}
          tone="text-icon"
          title="做完了"
          count={done.length}
          label="最近 7 天"
        >
          {done.length > 0 ? (
            <RowList>
              {done.slice(0, DONE_PREVIEW).map((todo) => (
                <TaskRow
                  key={todo.id}
                  todo={todo}
                  testId="home-done-row"
                  muted={todo.phase === 'closed'}
                  status={
                    <StatusGlyph
                      icon={todo.phase === 'closed' ? Ban : CircleCheck}
                      className="text-content-tertiary"
                    />
                  }
                  meta={[
                    projectOf(todo),
                    `#${todo.seqNum}`,
                    t(PHASE_UI[todo.phase].chip),
                    relativeTime(todo.phaseAt, ctx.now, t),
                  ]}
                />
              ))}
            </RowList>
          ) : (
            <QuietLine>{t('最近 7 天还没有完成的任务')}</QuietLine>
          )}
          <Link
            data-testid="home-open-board"
            to={{ search: `?${boardSearch}` }}
            className="flex items-center gap-1 self-end rounded-(--radius-control) px-1 text-meta text-content-tertiary no-underline hover:text-content-secondary"
          >
            {t('打开看板')}
            <ChevronRight aria-hidden strokeWidth={1.75} className="size-3.25" />
          </Link>
        </HomeSection>
      </div>
    </div>
  );
}

const BRIEF_WINDOW_MS = 24 * 60 * 60 * 1000;

export function DailyBrief({ todos, ...ctx }: RowContext & { todos: TodoRecord[] }) {
  const { t } = useI18n();
  const projectOf = useProjectName(ctx.projectNames);
  const running = new Set(columnTodos('building', todos));
  const waiting = splitStale(columnTodos('pending', todos), ctx.now).fresh;
  const waitingSet = new Set(waiting);
  const byProject = new Map<string, { done: number; running: number; waiting: number }>();
  for (const todo of todos) {
    const name = projectOf(todo);
    if (name == null) continue;
    const done = todo.phase === 'done' && ctx.now - todo.phaseAt <= BRIEF_WINDOW_MS;
    if (!done && !running.has(todo) && !waitingSet.has(todo)) continue;
    const line = byProject.get(name) ?? { done: 0, running: 0, waiting: 0 };
    if (done) line.done += 1;
    if (running.has(todo)) line.running += 1;
    if (waitingSet.has(todo)) line.waiting += 1;
    byProject.set(name, line);
  }
  const lines = [...byProject].sort(([a], [b]) => a.localeCompare(b));
  return (
    <div data-testid="chief-brief" className="flex flex-col gap-3 text-ui text-content-secondary">
      {lines.length > 0 ? (
        <>
          <p className="m-0">{t('过去 24 小时各项目的情况：')}</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {lines.map(([name, line]) => (
              <li key={name} data-testid="chief-brief-project" className="flex gap-3">
                <span className="w-28 flex-none truncate font-medium text-foreground">{name}</span>
                <span className="min-w-0">
                  {[
                    line.done > 0 ? t('完成 {n} 个', { n: line.done }) : null,
                    line.running > 0 ? t('{n} 个运行中', { n: line.running }) : null,
                    line.waiting > 0 ? t('{n} 项待处理', { n: line.waiting }) : null,
                  ]
                    .filter((part) => part != null)
                    .join(t('，'))}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="m-0">{t('过去 24 小时各项目没有新进展')}</p>
      )}
      {waiting.length > 0 && (
        <>
          <p className="m-0">{t('有 {n} 件事需要你处理：', { n: waiting.length })}</p>
          <NeedsYouRows todos={waiting} {...ctx} />
        </>
      )}
    </div>
  );
}
