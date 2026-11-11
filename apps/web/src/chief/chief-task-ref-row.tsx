import { ThreadLink } from '../board/thread-link.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { TodoStatusTile } from '../detail/segments.js';
import { useI18n } from '../i18n/provider.js';
import { isInFlightPhase, PHASE_UI } from '../phase.js';
import type { TaskRef } from './chief-task-refs.js';

export function TaskRefRow({ taskRef }: { taskRef: TaskRef }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ThreadLink
            todoId={taskRef.todoId}
            data-phase={taskRef.phase}
            data-testid="chief-task-ref"
            className="ml-1 flex w-fit max-w-full cursor-pointer items-center gap-1.5 text-ui font-semibold text-(--foreground) no-underline hover:underline"
          />
        }
      >
        <span
          aria-hidden="true"
          className="size-2.5 flex-none translate-y-1 rounded-tl-md border-t border-l border-(--text-tertiary)"
        />
        <TodoStatusTile phase={taskRef.phase} />
        <span className="min-w-0 truncate">{taskRef.title ?? `#${taskRef.seq ?? ''}`}</span>
        {isInFlightPhase(taskRef.phase) && (
          <span className="flex-none font-normal text-(--text-tertiary)">{`· ${t('进行中')}`}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{t(PHASE_UI[taskRef.phase].chip)}</TooltipContent>
    </Tooltip>
  );
}
