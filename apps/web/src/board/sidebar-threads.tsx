import type { ProjectColor, ProjectIcon } from '@cairn/shared';
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  ChevronDown,
  Copy,
  Ellipsis,
  MailOpen,
  Pencil,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import {
  KeyedMenuContent,
  KeyedMenuItem,
  KeyedMenuSubContent,
  KeyedMenuSubTrigger,
} from '../components/menu-keys.js';
import {
  SidebarProjectRow,
  SidebarThreadList,
  SidebarThreadRow,
} from '../components/shell/sidebar-project.js';
import type { StoneTone } from '../components/stone/tone.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { SnoozeChoice } from './snooze-presets.js';

export type ThreadStatus = 'running' | 'needs-you' | 'failed' | 'done' | 'idle';

export const THREAD_TONE: Record<ThreadStatus, StoneTone> = {
  running: 'working',
  'needs-you': 'waiting',
  failed: 'waiting',
  done: 'resolved',
  idle: 'idle',
};

const VISIBLE_THREADS = 8;

export function threadStatus(todo: TodoRecord): ThreadStatus {
  if (todo.awaitingReply === true) return 'needs-you';
  switch (todo.phase) {
    case 'queued':
    case 'planning':
    case 'building':
      return 'running';
    case 'confirm':
    case 'review':
      return 'needs-you';
    case 'failed':
      return 'failed';
    case 'done':
    case 'closed':
      return 'done';
    case 'todo':
      return 'idle';
  }
}

export function threadHref(id: string): string {
  return `/app/todo/${id}`;
}

export function projectThreads(todos: readonly TodoRecord[], projectId: string): TodoRecord[] {
  return todos.filter((todo) => todo.projectId === projectId).sort((a, b) => b.phaseAt - a.phaseAt);
}

interface ThreadMenuProps {
  todo: TodoRecord;
  onMarkUnread: (todo: TodoRecord) => void;
  onRename: (todo: TodoRecord) => void;
  onSnooze: (todo: TodoRecord, choice: SnoozeChoice) => void;
  onArchive: (todo: TodoRecord) => void;
  onDelete: (todo: TodoRecord) => void;
}

function ThreadMenu({
  todo,
  onMarkUnread,
  onRename,
  onSnooze,
  onArchive,
  onDelete,
}: ThreadMenuProps) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}${threadHref(todo.id)}`);
  };
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setSnoozeOpen(false);
  };
  const label = t('线程操作：{title}', {
    title: todo.title === '' ? `#${todo.seqNum}` : todo.title,
  });
  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon-xs"
            data-testid="thread-row-menu"
            aria-label={label}
            className="size-5.5"
          >
            <Ellipsis />
          </Button>
        }
      />
      <KeyedMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        anchor={() => triggerRef.current?.closest('[data-slot="sidebar-thread-row"]') ?? null}
        aria-label={label}
        className="w-48"
      >
        <KeyedMenuItem
          data-testid="thread-row-mark-unread"
          shortcut="U"
          onClick={() => onMarkUnread(todo)}
        >
          <MailOpen />
          {t('标记为未读')}
        </KeyedMenuItem>
        <KeyedMenuItem data-testid="thread-row-rename" shortcut="R" onClick={() => onRename(todo)}>
          <Pencil />
          {t('重命名')}
        </KeyedMenuItem>
        <DropdownMenuSub open={snoozeOpen} onOpenChange={setSnoozeOpen}>
          <KeyedMenuSubTrigger data-testid="thread-row-snooze" shortcut="S">
            <AlarmClock />
            {t('暂停至')}
          </KeyedMenuSubTrigger>
          <KeyedMenuSubContent data-testid="thread-snooze-menu" className="w-60">
            <KeyedMenuItem
              data-testid="thread-snooze-needed"
              shortcut="N"
              onClick={() => onSnooze(todo, 'needed')}
            >
              {t('需要时（智能体唤醒）')}
            </KeyedMenuItem>
            <KeyedMenuItem
              data-testid="thread-snooze-tomorrow"
              shortcut="T"
              onClick={() => onSnooze(todo, 'tomorrow-09:00')}
            >
              {t('明天 09:00')}
            </KeyedMenuItem>
            <KeyedMenuItem
              data-testid="thread-snooze-monday"
              shortcut="M"
              onClick={() => onSnooze(todo, 'next-monday')}
            >
              {t('下周一')}
            </KeyedMenuItem>
            <KeyedMenuItem
              data-testid="thread-snooze-pick"
              shortcut="P"
              onClick={() => onSnooze(todo, 'pick')}
            >
              {t('选择时间…')}
            </KeyedMenuItem>
          </KeyedMenuSubContent>
        </DropdownMenuSub>
        <KeyedMenuItem data-testid="thread-row-copy-link" shortcut="L" onClick={copyLink}>
          <Copy />
          {t('复制链接')}
        </KeyedMenuItem>
        <KeyedMenuItem
          data-testid="thread-row-archive"
          shortcut="A"
          onClick={() => onArchive(todo)}
        >
          <Archive />
          {t('Archive')}
        </KeyedMenuItem>
        <DropdownMenuSeparator />
        <KeyedMenuItem
          variant="destructive"
          data-testid="thread-row-delete"
          shortcut="D"
          confirms
          onClick={() => onDelete(todo)}
        >
          <Trash2 />
          {t('删除')}
        </KeyedMenuItem>
      </KeyedMenuContent>
    </DropdownMenu>
  );
}

interface ProjectGroupProps {
  name: string;
  tone: number;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
  active: boolean;
  activeThreadId: string | null;
  threads: TodoRecord[];
  unreadIds: ReadonlySet<string>;
  onOpenProject: () => void;
  onOpenThread: (todo: TodoRecord) => void;
  onMarkUnread: (todo: TodoRecord) => void;
  onRename: (todo: TodoRecord) => void;
  onSnooze: (todo: TodoRecord, choice: SnoozeChoice) => void;
  onArchive: (todo: TodoRecord) => void;
  onDelete: (todo: TodoRecord) => void;
}

export function ProjectGroup({
  name,
  tone,
  icon,
  color,
  active,
  activeThreadId,
  threads,
  unreadIds,
  onOpenProject,
  onOpenThread,
  onMarkUnread,
  onRename,
  onSnooze,
  onArchive,
  onDelete,
}: ProjectGroupProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? threads : threads.slice(0, VISIBLE_THREADS);
  const hidden = threads.length - shown.length;
  const waiting = threads.filter((todo) => {
    const status = threadStatus(todo);
    return status === 'needs-you' || status === 'failed';
  }).length;
  return (
    <div data-testid="sidebar-project-group">
      <SidebarProjectRow
        name={name}
        tone={tone}
        icon={icon}
        color={color}
        waiting={waiting}
        active={active}
        onClick={onOpenProject}
      />
      {threads.length > 0 && (
        <SidebarThreadList>
          {shown.map((todo) => {
            const status = threadStatus(todo);
            return (
              <div
                key={todo.id}
                data-testid="sidebar-thread-row"
                data-status={status}
                className="group/unread relative"
              >
                {unreadIds.has(todo.id) && (
                  <span
                    data-testid="unread-dot"
                    role="img"
                    aria-label={t('未读')}
                    className="pointer-events-none absolute top-1/2 right-2.5 size-1.5 -translate-y-1/2 rounded-full bg-(--card-button) group-focus-within/unread:hidden group-hover/unread:hidden"
                  />
                )}
                <SidebarThreadRow
                  title={todo.title === '' ? `#${todo.seqNum}` : todo.title}
                  tone={THREAD_TONE[status]}
                  open={todo.id === activeThreadId}
                  onClick={() => onOpenThread(todo)}
                  menu={
                    <ThreadMenu
                      todo={todo}
                      onMarkUnread={onMarkUnread}
                      onRename={onRename}
                      onSnooze={onSnooze}
                      onArchive={onArchive}
                      onDelete={onDelete}
                    />
                  }
                />
              </div>
            );
          })}
          {hidden > 0 && (
            <Button
              variant="ghost"
              data-testid="sidebar-thread-more"
              className="h-7 justify-start px-2 text-caption font-normal text-content-tertiary"
              onClick={() => setExpanded(true)}
            >
              {t('显示另外 {n} 个', { n: hidden })}
            </Button>
          )}
        </SidebarThreadList>
      )}
    </div>
  );
}

interface CollapsibleGroupProps {
  testId: string;
  icon: ReactNode;
  label: string;
  count: number;
  children: ReactNode;
}

function CollapsibleThreadGroup({ testId, icon, label, count, children }: CollapsibleGroupProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-testid={testId} data-count={count}>
      <Button
        variant="ghost"
        data-testid={`${testId}-toggle`}
        aria-expanded={expanded}
        className="h-8 w-full justify-start gap-2.5 px-2 text-ui font-normal text-content-tertiary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover"
        onClick={() => setExpanded((open) => !open)}
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <span
          data-testid={`${testId}-count`}
          className="ml-auto flex-none text-caption tabular-nums"
        >
          {count}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-3 flex-none transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
        />
      </Button>
      {expanded && <SidebarThreadList>{children}</SidebarThreadList>}
    </div>
  );
}

interface SnoozedThreadGroupProps {
  threads: TodoRecord[];
  activeThreadId: string | null;
  onOpenThread: (todo: TodoRecord) => void;
  onUnsnooze: (todo: TodoRecord) => void;
}

export function SnoozedThreadGroup({
  threads,
  activeThreadId,
  onOpenThread,
  onUnsnooze,
}: SnoozedThreadGroupProps) {
  const { t } = useI18n();
  if (threads.length === 0) return null;
  return (
    <CollapsibleThreadGroup
      testId="group-snoozed"
      icon={<AlarmClockOff className="size-4 flex-none" />}
      label={t('已暂停')}
      count={threads.length}
    >
      {threads.map((todo) => (
        <div key={todo.id} data-testid="snoozed-thread-row">
          <SidebarThreadRow
            title={todo.title === '' ? `#${todo.seqNum}` : todo.title}
            tone="idle"
            snoozed
            open={todo.id === activeThreadId}
            onClick={() => onOpenThread(todo)}
            menu={
              <SingleActionMenu
                todo={todo}
                menuTestId="snoozed-row-menu"
                itemTestId="thread-row-unsnooze"
                icon={<AlarmClockOff />}
                label={t('取消暂停')}
                onRun={onUnsnooze}
              />
            }
          />
        </div>
      ))}
    </CollapsibleThreadGroup>
  );
}

interface ArchivedThreadGroupProps {
  threads: TodoRecord[];
  activeThreadId: string | null;
  onOpenThread: (todo: TodoRecord) => void;
  onUnarchive: (todo: TodoRecord) => void;
}

export function ArchivedThreadGroup({
  threads,
  activeThreadId,
  onOpenThread,
  onUnarchive,
}: ArchivedThreadGroupProps) {
  const { t } = useI18n();
  if (threads.length === 0) return null;
  return (
    <CollapsibleThreadGroup
      testId="group-archived"
      icon={<Archive className="size-4 flex-none" />}
      label={t('已归档')}
      count={threads.length}
    >
      {threads.map((todo) => (
        <div key={todo.id} data-testid="archived-thread-row">
          <SidebarThreadRow
            title={todo.title === '' ? `#${todo.seqNum}` : todo.title}
            tone="idle"
            open={todo.id === activeThreadId}
            onClick={() => onOpenThread(todo)}
            menu={
              <SingleActionMenu
                todo={todo}
                menuTestId="archived-row-menu"
                itemTestId="thread-row-unarchive"
                icon={<ArchiveRestore />}
                label={t('取消归档')}
                onRun={onUnarchive}
              />
            }
          />
        </div>
      ))}
    </CollapsibleThreadGroup>
  );
}

interface SingleActionMenuProps {
  todo: TodoRecord;
  menuTestId: string;
  itemTestId: string;
  icon: ReactNode;
  label: string;
  onRun: (todo: TodoRecord) => void;
}

function SingleActionMenu({
  todo,
  menuTestId,
  itemTestId,
  icon,
  label,
  onRun,
}: SingleActionMenuProps) {
  const { t } = useI18n();
  const ariaLabel = t('线程操作：{title}', {
    title: todo.title === '' ? `#${todo.seqNum}` : todo.title,
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid={menuTestId}
            aria-label={ariaLabel}
            className="size-5.5"
          >
            <Ellipsis />
          </Button>
        }
      />
      <KeyedMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        aria-label={ariaLabel}
        className="w-48"
      >
        <KeyedMenuItem data-testid={itemTestId} shortcut="U" onClick={() => onRun(todo)}>
          {icon}
          {label}
        </KeyedMenuItem>
      </KeyedMenuContent>
    </DropdownMenu>
  );
}
