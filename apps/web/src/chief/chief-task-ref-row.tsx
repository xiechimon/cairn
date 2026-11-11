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
        <span
          aria-hidden="true"
          data-slot="task-ref-elbow"
          className="pointer-events-none absolute top-1/2 -left-3.5 size-4 rounded-tl-lg border-t-[1.5px] border-l-[1.5px] border-(--tree-line)"
        />
        <TodoStatusTile phase={taskRef.phase} />
        <span className="min-w-0 truncate">{taskRef.title ?? `#${taskRef.seq ?? ''}`}</span>
        <span className="sr-only">{`，${t(PHASE_UI[taskRef.phase].chip)}`}</span>
      </TooltipTrigger>
      <TooltipContent>{t(PHASE_UI[taskRef.phase].chip)}</TooltipContent>
    </Tooltip>
  );
}
