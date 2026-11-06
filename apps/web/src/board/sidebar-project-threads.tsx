import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { SidebarThreadList, SidebarThreadRow } from '../components/shell/sidebar-project.js';
import { Button } from '../components/ui/button.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import { type ElapsedUnit, elapsedSince, type ProjectThreads } from './sidebar-threads.js';
import { threadTone } from './thread-copy.js';

const ELAPSED_COPY: Record<ElapsedUnit, string> = {
  m: '{n} 分',
  h: '{n} 小时',
  d: '{n} 天',
};

function ThreadRow({
  todo,
  now,
  open,
  onOpen,
}: {
  todo: TodoRecord;
  now: number;
  open: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const elapsed = elapsedSince(todo.phaseAt, now);
  const meta = elapsed === null ? null : t(ELAPSED_COPY[elapsed.unit], { n: elapsed.n });
  return (
    <SidebarThreadRow
      title={todo.title}
      tone={threadTone(todo)}
      open={open}
      meta={meta}
      showMenu={false}
      onClick={() => onOpen(todo.id)}
    />
  );
}

export function SidebarProjectThreads({
  threads,
  openThreadId,
  onOpen,
}: {
  threads: ProjectThreads;
  openThreadId: string | null;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const now = useMinuteClock();
  const [earlierOpen, setEarlierOpen] = useState(false);
  if (threads.live.length === 0 && threads.earlier.length === 0) return null;
  return (
    <SidebarThreadList>
      {threads.live.map((todo) => (
        <ThreadRow
          key={todo.id}
          todo={todo}
          now={now}
          open={openThreadId === todo.id}
          onOpen={onOpen}
        />
      ))}
      {threads.earlier.length > 0 && (
        <Button
          variant="ghost"
          data-testid="earlier-threads-toggle"
          aria-expanded={earlierOpen}
          onClick={() => setEarlierOpen((prev) => !prev)}
          className="h-6 w-fit cursor-pointer justify-start gap-1 px-2 text-caption font-normal text-content-tertiary hover:bg-transparent hover:text-content-secondary dark:hover:bg-transparent"
        >
          {t('更早')}
          <span className="tabular-nums">{threads.earlier.length}</span>
          <ChevronDown
            aria-hidden
            className={`size-3 transition-transform duration-150 ${earlierOpen ? '' : '-rotate-90'}`}
            strokeWidth={1.75}
          />
        </Button>
      )}
      {earlierOpen &&
        threads.earlier.map((todo) => (
          <ThreadRow
            key={todo.id}
            todo={todo}
            now={now}
            open={openThreadId === todo.id}
            onOpen={onOpen}
          />
        ))}
    </SidebarThreadList>
  );
}
