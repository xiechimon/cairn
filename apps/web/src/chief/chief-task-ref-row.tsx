import { cn } from 'cn';
import { useContext } from 'react';
import { useMachines, useProjects, useSteps } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ThreadLink } from '../board/thread-link.js';
import { useThreadUnread } from '../board/use-thread-unread.js';
import { POPUP_STILL, useWarmHoverCard } from '../components/thread/task-pr-line.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { TodoGlanceContext, TodoStatusTile } from '../detail/segments.js';
import { useI18n } from '../i18n/provider.js';
import { PHASE_UI } from '../phase.js';
import type { TaskRef } from './chief-task-refs.js';

export function TaskRefRow({
  taskRef,
  elbow = true,
  nested = false,
  guide = true,
}: {
  taskRef: TaskRef;
  elbow?: boolean;
  nested?: boolean;
  guide?: boolean;
}) {
  const { t } = useI18n();
  const unread = useThreadUnread(taskRef.todoId);
  const card = useWarmHoverCard();
  return (
    <Popover {...card.root}>
      <PopoverTrigger
        openOnHover
        delay={0}
        onPointerLeave={card.onPointerLeave}
        nativeButton={false}
        role="link"
        render={
          <ThreadLink
            todoId={taskRef.todoId}
            data-phase={taskRef.phase}
            data-testid="chief-task-ref"
            className={cn(
              'relative my-0.5 flex h-6 w-fit cursor-pointer text-ui font-normal text-popover-foreground no-underline hover:underline',
              nested
                ? 'ml-13.5 max-w-[calc(100%-3.375rem)]'
                : elbow
                  ? 'ml-7.5 max-w-[calc(100%-1.875rem)]'
                  : 'max-w-full',
            )}
          />
        }
      >
        {guide && (elbow || nested) && (
          <svg
            aria-hidden="true"
            data-slot="task-ref-elbow"
            viewBox="0 0 12 16"
            className="pointer-events-none absolute top-2.75 -left-3.25 h-4 w-3 overflow-visible text-(--task-ref-line)"
          >
            <path
              d="M1 14.25V7A6 6 0 0 1 7 1H10.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
        <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-popover pr-2 pl-0.5 shadow-(--e1-lift)">
          <TodoStatusTile phase={taskRef.phase} />
          <span className="min-w-0 truncate">{taskRef.title ?? t('任务')}</span>
          {unread && (
            <span
              role="img"
              aria-label={t('有新动态')}
              data-slot="task-ref-unread"
              className="size-1.5 flex-none rounded-full bg-(--card-button)"
            />
          )}
        </span>
        <span className="sr-only">{`${t('，')}${t(PHASE_UI[taskRef.phase].chip)}`}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        data-testid="chief-task-ref-hover"
        className={cn('w-80 gap-1.5 p-3.5', POPUP_STILL)}
      >
        {card.root.open && <TaskRefPlace taskRef={taskRef} />}
      </PopoverContent>
    </Popover>
  );
}

function TaskRefPlace({ taskRef }: { taskRef: TaskRef }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const glance = useContext(TodoGlanceContext)?.get(taskRef.todoId);
  const project = useProjects(teamId, live).data?.find((p) => p.id === glance?.projectId);
  const steps = useSteps(glance?.buildId, live).data ?? [];
  const machineId = steps.findLast((step) => step.machineId != null)?.machineId;
  const machine = useMachines(teamId, live).data?.find((m) => m.id === machineId)?.name;
  const folder = project?.repoKind === 'local' ? project.localPath : undefined;
  const rows: [string, string, string][] = [
    ...(project !== undefined
      ? [['project', t('项目'), project.name] as [string, string, string]]
      : []),
    ['machine', t('运行机器'), machine ?? t('还没分配机器')],
    ...(folder !== undefined ? [['folder', t('目录'), folder] as [string, string, string]] : []),
  ];
  return (
    <>
      <div className="flex items-center gap-2 text-meta text-content-tertiary">
        <TodoStatusTile phase={taskRef.phase} />
        <span>{t(PHASE_UI[taskRef.phase].chip)}</span>
      </div>
      <p className="m-0 line-clamp-2 text-ui font-medium text-foreground">
        {taskRef.title ?? t('任务')}
      </p>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-meta">
        {rows.map(([slot, label, value]) => (
          <div key={slot} data-slot={`task-ref-${slot}`} className="contents">
            <dt className="text-content-tertiary">{label}</dt>
            <dd className="m-0 truncate text-content-secondary" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
