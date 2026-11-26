import { cn } from 'cn';
import { useContext } from 'react';
import { useMachines, useProjects, useSteps } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ThreadLink } from '../board/thread-link.js';
import { POPUP_STILL, useWarmHoverCard } from '../components/thread/task-pr-line.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import {
  TaskTile,
  ThreadUnreadContext,
  TodoGlanceContext,
  useStartsAfter,
} from '../detail/segments.js';
import { useI18n } from '../i18n/provider.js';
import { PHASE_UI } from '../phase.js';

const TRUNK_X = 18.75;
const ROW_H = 28;
const ROW_MID = 14;
const BEND = 6;
const BRANCH_END = 28;

function BranchGuide({ top }: { top: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 h-full w-8 overflow-visible text-(--task-ref-line)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {!top && (
        <rect
          data-slot="task-ref-trunk"
          x={TRUNK_X - 0.75}
          y="0"
          width="1.5"
          height={ROW_H}
          fill="currentColor"
          stroke="none"
        />
      )}
      <path
        data-slot="task-ref-elbow"
        strokeLinecap="round"
        d={`M${TRUNK_X} ${top ? ROW_H : ROW_MID + BEND}V${ROW_MID + BEND}A${BEND} ${BEND} 0 0 1 ${TRUNK_X + BEND} ${ROW_MID}H${BRANCH_END}`}
      />
    </svg>
  );
}

function TaskBranch({ todoId, top, rooted }: { todoId: string; top: boolean; rooted: boolean }) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  const card = useWarmHoverCard();
  const startsAfter = useStartsAfter(todoId, glance?.phase);
  const unread = useContext(ThreadUnreadContext)?.has(todoId) === true;
  if (glance === undefined) return null;
  const title = glance.title ?? t('任务');
  return (
    <div className="relative flex h-7 items-center">
      {rooted && <BranchGuide top={top} />}
      <Popover {...card.root}>
        <PopoverTrigger
          openOnHover
          delay={0}
          onPointerLeave={card.onPointerLeave}
          nativeButton={false}
          role="link"
          render={
            <ThreadLink
              todoId={todoId}
              data-phase={glance.phase}
              data-testid="chief-task-ref"
              className={cn(
                rooted ? 'ml-8 max-w-[calc(100%-2rem)]' : 'max-w-full',
                'flex h-7 min-w-0 cursor-pointer items-center gap-1.5 text-ui text-foreground no-underline decoration-current/40 underline-offset-3 hover:underline focus-visible:underline',
              )}
            />
          }
        >
          <TaskTile phase={glance.phase} />
          <span className="min-w-0 truncate">{title}</span>
          {unread && (
            <span
              role="img"
              aria-label={t('有新动态')}
              data-slot="task-mention-unread"
              className="size-1.5 flex-none rounded-full bg-(--card-button)"
            />
          )}
          <span className="sr-only">
            {[t(PHASE_UI[glance.phase].chip), startsAfter]
              .filter((line) => line !== undefined)
              .map((line) => `${t('，')}${line}`)
              .join('')}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          data-testid="chief-task-ref-hover"
          className={cn('w-80 gap-1.5 p-3.5', POPUP_STILL)}
        >
          {card.root.open && <TaskPlace todoId={todoId} />}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TaskPlace({ todoId }: { todoId: string }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  const project = useProjects(teamId, live).data?.find((p) => p.id === glance?.projectId);
  const steps = useSteps(glance?.buildId, live).data ?? [];
  const machineId = steps.findLast((step) => step.machineId != null)?.machineId;
  const machine = useMachines(teamId, live).data?.find((m) => m.id === machineId)?.name;
  const startsAfter = useStartsAfter(todoId, glance?.phase);
  if (glance === undefined) return null;
  const rows: [string, string, string][] = [
    ...(project !== undefined
      ? [['project', t('项目'), project.name] as [string, string, string]]
      : []),
    ['machine', t('所在执行机'), machine ?? t('尚未分配执行机')],
  ];
  return (
    <>
      <div className="flex items-center gap-2 text-meta text-content-tertiary">
        <TaskTile phase={glance.phase} />
        <span>{t(PHASE_UI[glance.phase].chip)}</span>
        {startsAfter !== undefined && <span data-slot="task-ref-waits">{startsAfter}</span>}
      </div>
      <p className="m-0 line-clamp-2 text-ui font-medium text-foreground">
        {glance.title ?? t('任务')}
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

export function TaskTrunk({
  todoIds,
  rooted = true,
}: {
  todoIds: readonly string[];
  rooted?: boolean;
}) {
  const glances = useContext(TodoGlanceContext);
  const shown = todoIds.filter(
    (id) => glances?.get(id) !== undefined && glances.get(id)?.internal !== true,
  );
  if (shown.length === 0) return null;
  return (
    <div
      className={cn('relative flex flex-col', rooted && 'pb-1.5')}
      data-testid="chief-task-trunk"
    >
      {shown.map((todoId, n) => (
        <TaskBranch key={todoId} todoId={todoId} top={n === 0} rooted={rooted} />
      ))}
      {rooted && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 h-1.5 w-8 overflow-visible text-(--task-ref-line)"
        >
          <rect x={TRUNK_X - 0.75} y="0" width="1.5" height="100%" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}
