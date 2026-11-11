import { cn } from 'cn';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ACCENT_INK } from '../phase.js';
import { relativeTime } from './rel-time.js';
import type { TaskCardFacts } from './task-card-facts.js';
import { glyphOf, type TaskEntry, taskRowCopy } from './tasks-sections.js';
import { useThreadUnread } from './use-thread-unread.js';

export function TaskCard({
  entry,
  facts,
  now,
  onOpen,
  compact = false,
}: {
  entry: TaskEntry;
  facts: TaskCardFacts;
  now: number;
  onOpen: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const copy = taskRowCopy(entry);
  const glyph = glyphOf(entry);
  const latest = facts.latest ?? t(copy.what.key, copy.what.params);
  const unread = useThreadUnread(entry.todo.id);
  return (
    <Button
      variant="ghost"
      data-slot="task-card"
      data-section={entry.section}
      data-compact={compact || undefined}
      onClick={onOpen}
      className={cn(
        'h-auto w-full max-w-120 flex-col items-stretch gap-1 rounded-(--radius-card) bg-card px-3.5 text-left font-normal whitespace-normal shadow-(--e1) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)',
        compact ? 'w-fit max-w-full py-2.5' : 'py-3',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusGlyph
          kind={glyph}
          className={copy.waiting ? ACCENT_INK : 'text-content-secondary'}
        />
        <span
          data-slot="task-card-title"
          className="min-w-0 flex-1 truncate text-ui font-semibold text-foreground"
        >
          {entry.todo.title}
        </span>
        {unread && (
          <span
            role="img"
            aria-label={t('有新动态')}
            data-slot="task-card-unread"
            className="size-1.5 flex-none rounded-full bg-(--card-button)"
          />
        )}
        <span
          data-slot="task-card-status"
          className="flex flex-none items-center gap-1.5 text-meta text-content-tertiary tabular-nums"
        >
          {copy.running && (
            <span
              aria-hidden
              data-slot="task-card-running"
              className="size-1.5 rounded-full bg-running"
            />
          )}
          <span className={cn(copy.waiting && `${ACCENT_INK} font-medium`)}>{t(copy.word)}</span>
          {!compact && facts.updates > 0 && <span>· {t('{n} 次更新', { n: facts.updates })}</span>}
          {!compact && (
            <span data-slot="task-card-age">· {relativeTime(entry.todo.phaseAt, now, t)}</span>
          )}
        </span>
      </span>
      {!compact && (
        <span
          data-slot="task-card-latest"
          className="line-clamp-2 pl-6 text-meta text-content-secondary"
        >
          {t('最新：{line}', { line: latest })}
        </span>
      )}
    </Button>
  );
}
