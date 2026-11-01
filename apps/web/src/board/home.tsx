import { canOrchestrate } from '@cairn/shared';
import { cn } from 'cn';
import { ChevronRight, CircleCheck, type LucideIcon, RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import type { CardOrchestration } from '../chief/orchestration-inflight.js';
import { StatusGlyph as PhaseGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { PHASE_STATUS } from '../phase.js';
import { COLUMNS, cardFace, sortColumnTodos, splitStale } from './columns.js';
import { relativeTime } from './rel-time.js';
import { ATTENTION } from './todo-card.js';

export const BOARD_VIEW_PARAM = 'view';

export function withoutBoardView(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(BOARD_VIEW_PARAM);
  return `?${params}`;
}
const _DONE_PREVIEW = 5;

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

function _columnTodos(columnId: string, todos: TodoRecord[]): TodoRecord[] {
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

function _StatusGlyph({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
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
              <PhaseGlyph
                kind={orchestrationFailed ? 'failed' : PHASE_STATUS[todo.phase].glyph}
                className={orchestrationFailed ? 'text-destructive' : PHASE_STATUS[todo.phase].ink}
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
