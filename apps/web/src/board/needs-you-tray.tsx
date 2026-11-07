import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ACT_ORDER, actRank, trayWindow } from './needs-you.js';
import { NeedsYouThreadCard } from './needs-you-thread-card.js';
import { threadCopy, threadTone } from './thread-copy.js';
import { useOpenThread } from './thread-link.js';

export function NeedsYouTray({ threads }: { threads: readonly TodoRecord[] }) {
  const { t } = useI18n();
  const openThread = useOpenThread();
  const [open, setOpen] = useState(false);
  if (threads.length === 0) return null;
  const { shown, more } = trayWindow(threads, open);
  return (
    <section
      data-testid="needs-you"
      aria-label={t('待你决定')}
      className="mx-auto mt-2 flex max-h-[32dvh] w-[calc(100%-2rem)] max-w-182 flex-none flex-col gap-1.5 overflow-y-auto"
    >
      <div className="flex items-baseline gap-2 px-1">
        <h3 className="m-0 font-heading text-meta font-semibold text-foreground">
          {t('待你决定')}
        </h3>
        <span
          data-testid="needs-you-count"
          className="text-meta text-content-tertiary tabular-nums"
        >
          {threads.length}
        </span>
      </div>
      {shown.map((todo) => {
        const copy = threadCopy(todo);
        return (
          <div key={todo.id} data-slot="needs-you-item" data-status={ACT_ORDER[actRank(todo)]}>
            <NeedsYouThreadCard
              compact
              todo={todo}
              title={todo.title}
              tone={threadTone(todo)}
              stateLabel={t(copy.state)}
              reason={t(copy.reason)}
              {...(copy.primary != null
                ? { primaryLabel: t(copy.primary), onPrimary: () => openThread(todo.id) }
                : {})}
              viewLabel={t('查看 thread')}
              onView={() => openThread(todo.id)}
            />
          </div>
        );
      })}
      {more > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(!open)}
          className="-ml-1 self-start text-meta text-content-tertiary hover:text-foreground"
        >
          {open ? t('收起其余') : t('还有 {n} 件', { n: more })}
        </Button>
      )}
    </section>
  );
}
