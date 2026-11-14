import { cn } from 'cn';
import { ThreadLink } from '../board/thread-link.js';
import { useThreadUnread } from '../board/use-thread-unread.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { TodoStatusTile } from '../detail/segments.js';
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
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ThreadLink
            todoId={taskRef.todoId}
            data-phase={taskRef.phase}
            data-testid="chief-task-ref"
            className={cn(
              'relative flex h-7 w-fit cursor-pointer items-center gap-1.5 text-ui font-normal text-(--foreground) no-underline hover:underline',
              nested
                ? 'ml-14 max-w-[calc(100%-3.5rem)]'
                : elbow
                  ? 'ml-8 max-w-[calc(100%-2rem)]'
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
            className="pointer-events-none absolute -top-px -left-3.75 h-4 w-3 overflow-visible text-(--task-ref-line)"
          >
            <path
              d="M1 1.75V9A6 6 0 0 0 7 15H10.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
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
        <span className="sr-only">{`，${t(PHASE_UI[taskRef.phase].chip)}`}</span>
      </TooltipTrigger>
      <TooltipContent>{t(PHASE_UI[taskRef.phase].chip)}</TooltipContent>
    </Tooltip>
  );
}
