import { ThreadLink } from '../board/thread-link.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { TodoStatusTile } from '../detail/segments.js';
import { useI18n } from '../i18n/provider.js';
import { PHASE_UI } from '../phase.js';
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
            className="relative ml-8 flex h-5 w-fit max-w-[calc(100%-2rem)] cursor-pointer items-center gap-1.5 text-ui font-normal text-(--foreground) no-underline hover:underline"
          />
        }
      >
        <svg
          aria-hidden="true"
          data-slot="task-ref-elbow"
          viewBox="0 0 12 16"
          className="pointer-events-none absolute top-2.25 -left-3.75 h-4 w-3 overflow-visible text-(--task-ref-line)"
        >
          <path
            d="M1 14.25V7A6 6 0 0 1 7 1H10.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <TodoStatusTile phase={taskRef.phase} />
        <span className="min-w-0 truncate">{taskRef.title ?? `#${taskRef.seq ?? ''}`}</span>
        <span className="sr-only">{`，${t(PHASE_UI[taskRef.phase].chip)}`}</span>
      </TooltipTrigger>
      <TooltipContent>{t(PHASE_UI[taskRef.phase].chip)}</TooltipContent>
    </Tooltip>
  );
}
