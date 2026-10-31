import { Archive, Copy, Ellipsis, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  SidebarProjectRow,
  SidebarThreadList,
  SidebarThreadRow,
} from '../components/shell/sidebar-project.js';
import type { StoneTone } from '../components/stone/tone.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export type ThreadStatus = 'running' | 'needs-you' | 'failed' | 'done' | 'idle';

const THREAD_TONE: Record<ThreadStatus, StoneTone> = {
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
  onArchive: (todo: TodoRecord) => void;
  onDelete: (todo: TodoRecord) => void;
}

function ThreadMenu({ todo, onArchive, onDelete }: ThreadMenuProps) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}${threadHref(todo.id)}`);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon-xs"
            data-testid="thread-row-menu"
            aria-label={t('线程操作：{title}', {
              title: todo.title === '' ? `#${todo.seqNum}` : todo.title,
            })}
            className="size-5.5"
          >
            <Ellipsis />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        anchor={() => triggerRef.current?.closest('[data-slot="sidebar-thread-row"]') ?? null}
        aria-label={t('线程操作：{title}', {
          title: todo.title === '' ? `#${todo.seqNum}` : todo.title,
        })}
        className="w-48"
      >
        <DropdownMenuItem data-testid="thread-row-copy-link" onClick={copyLink}>
          <Copy />
          {t('复制链接')}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="thread-row-archive" onClick={() => onArchive(todo)}>
          <Archive />
          {t('Archive')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          data-testid="thread-row-delete"
          onClick={() => onDelete(todo)}
        >
          <Trash2 />
          {t('删除')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProjectGroupProps {
  name: string;
  tone: number;
  active: boolean;
  activeThreadId: string | null;
  threads: TodoRecord[];
  onOpenProject: () => void;
  onOpenThread: (todo: TodoRecord) => void;
  onArchive: (todo: TodoRecord) => void;
  onDelete: (todo: TodoRecord) => void;
}

export function ProjectGroup({
  name,
  tone,
  active,
  activeThreadId,
  threads,
  onOpenProject,
  onOpenThread,
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
        waiting={waiting}
        active={active}
        onClick={onOpenProject}
      />
      {threads.length > 0 && (
        <SidebarThreadList>
          {shown.map((todo) => {
            const status = threadStatus(todo);
            return (
              <div key={todo.id} data-testid="sidebar-thread-row" data-status={status}>
                <SidebarThreadRow
                  title={todo.title === '' ? `#${todo.seqNum}` : todo.title}
                  tone={THREAD_TONE[status]}
                  open={todo.id === activeThreadId}
                  onClick={() => onOpenThread(todo)}
                  menu={<ThreadMenu todo={todo} onArchive={onArchive} onDelete={onDelete} />}
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
