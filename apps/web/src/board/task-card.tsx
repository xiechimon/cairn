import { cn } from 'cn';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ACCENT_INK } from '../phase.js';
import type { TaskCardFacts } from './task-card-facts.js';
import { glyphOf, type TaskEntry, taskRowCopy } from './tasks-sections.js';

export function TaskCard({
  entry,
  facts,
  onOpen,
}: {
  entry: TaskEntry;
  facts: TaskCardFacts;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const copy = taskRowCopy(entry);
  const glyph = glyphOf(entry);
  const latest = facts.latest ?? t(copy.what.key, copy.what.params);
  return (
    <Button
      variant="ghost"
      data-slot="task-card"
      data-section={entry.section}
      onClick={onOpen}
      className="h-auto w-full max-w-120 flex-col items-stretch gap-1 rounded-(--radius-card) bg-card px-3.5 py-3 text-left font-normal whitespace-normal shadow-(--e1) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)"
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
          {facts.updates > 0 && <span>· {t('{n} 次更新', { n: facts.updates })}</span>}
        </span>
      </span>
      <span
        data-slot="task-card-latest"
        className="line-clamp-2 pl-6 text-meta text-content-secondary"
      >
        {t('最新：{line}', { line: latest })}
      </span>
    </Button>
  );
}
