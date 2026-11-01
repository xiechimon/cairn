import { AlarmClockOff, Archive, Check, Ellipsis, X } from 'lucide-react';
import { useState } from 'react';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { WaitPill } from '../components/shell/wait-pill.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import type { StoneTone } from '../components/stone/tone.js';
import { BulkBar } from '../components/thread/bulk-bar.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadTone } from './thread-copy.js';
import { useThreadActions } from './use-thread-actions.js';

const GROUPS: { tone: StoneTone; label: string; hint?: string }[] = [
  { tone: 'waiting', label: '待你处理', hint: '需要你拍板、审阅或授权的。' },
  { tone: 'review', label: '等你审阅', hint: '检查跑完、等你看的改动。' },
  { tone: 'working', label: '运行中', hint: '正在跑的 agent。' },
  { tone: 'idle', label: '空闲' },
  { tone: 'resolved', label: '已解决' },
];

interface ThreadsInboxProps {
  todos: readonly TodoRecord[];
  now: number;
  onOpen: (todo: TodoRecord) => void;
  onClose: () => void;
}

export function ThreadsInbox({ todos, now, onOpen, onClose }: ThreadsInboxProps) {
  const { t } = useI18n();
  const actions = useThreadActions();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Partial<Record<StoneTone, boolean>>>({
    resolved: true,
  });
  const byTone = new Map<StoneTone, TodoRecord[]>();
  for (const todo of todos) {
    const tone = threadTone(todo);
    byTone.set(tone, [...(byTone.get(tone) ?? []), todo]);
  }
  const waiting = byTone.get('waiting')?.length ?? 0;
  const picked = todos.filter((todo) => selected.has(todo.id));
  const clear = () => setSelected(new Set());
  const toggle = (id: string, next: boolean) =>
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  const bulk = (run: (rows: readonly TodoRecord[]) => void) => () => {
    run(picked);
    clear();
  };

  return (
    <aside
      data-testid="threads-inbox"
      aria-label={t('Threads')}
      className="relative flex w-105 max-w-full flex-none flex-col border-l border-border bg-background max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:w-full max-md:border-l-0"
    >
      <header className="flex h-14 flex-none items-center gap-2.5 px-4">
        <h2 className="m-0 font-heading text-heading font-semibold text-foreground">
          {t('Threads')}
        </h2>
        {waiting > 0 && (
          <span data-testid="threads-inbox-waiting">
            <WaitPill count={waiting} />
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('关闭 Threads')}
          onClick={onClose}
          className="ml-auto text-content-tertiary hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-20">
        <StoneTrail>
          {GROUPS.map(({ tone, label, hint }) => {
            const rows = byTone.get(tone) ?? [];
            if (rows.length === 0 && hint == null) return null;
            return (
              <StoneGroup
                key={tone}
                tone={tone}
                label={t(label)}
                count={rows.length}
                collapsed={collapsed[tone] === true}
                onCollapsedChange={(next) => setCollapsed((prev) => ({ ...prev, [tone]: next }))}
                {...(hint != null ? { emptyHint: t(hint) } : {})}
              >
                {rows.map((todo) => (
                  <ThreadRow
                    key={todo.id}
                    title={todo.title}
                    reason={t(threadCopy(todo).reason)}
                    tone={tone}
                    age={relativeTime(todo.phaseAt, now, t)}
                    snoozed={todo.snoozeMode != null}
                    selected={selected.has(todo.id)}
                    onSelectedChange={(next) => toggle(todo.id, next)}
                    onOpen={() => onOpen(todo)}
                    menu={
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              data-testid="threads-inbox-row-menu"
                              aria-label={t('线程操作：{title}', { title: todo.title })}
                            />
                          }
                        >
                          <Ellipsis />
                        </DropdownMenuTrigger>
                        <KeyedMenuContent align="end" className="w-48">
                          <KeyedMenuItem shortcut="E" onClick={() => actions.resolve([todo])}>
                            <Check />
                            {t('解决')}
                          </KeyedMenuItem>
                          <KeyedMenuItem
                            shortcut="S"
                            onClick={() => actions.snooze([todo], 'needed')}
                          >
                            <AlarmClockOff />
                            {t('暂停到需要时')}
                          </KeyedMenuItem>
                          <KeyedMenuItem shortcut="A" onClick={() => actions.archive([todo])}>
                            <Archive />
                            {t('归档')}
                          </KeyedMenuItem>
                        </KeyedMenuContent>
                      </DropdownMenu>
                    }
                  />
                ))}
              </StoneGroup>
            );
          })}
        </StoneTrail>
      </div>
      {picked.length > 0 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
          <BulkBar
            count={picked.length}
            onResolve={bulk(actions.resolve)}
            onSnooze={bulk((rows) => actions.snooze(rows, 'needed'))}
            onArchive={bulk(actions.archive)}
            onClear={clear}
          />
        </div>
      )}
    </aside>
  );
}
