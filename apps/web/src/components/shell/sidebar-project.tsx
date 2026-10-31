import { cn } from 'cn';
import { AlarmClockOff, Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProjectAvatar } from '../../board/project-avatar.js';
import { Pebble } from '../stone/pebble.js';
import type { StoneTone } from '../stone/tone.js';
import { Button } from '../ui/button.js';

export interface SidebarProjectRowProps {
  name: string;
  tone: number;
  waiting?: number;
  active?: boolean;
  onClick?: () => void;
}

export function SidebarProjectRow({
  name,
  tone,
  waiting = 0,
  active = false,
  onClick,
}: SidebarProjectRowProps) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-slot="sidebar-project-row"
      className={cn(
        'h-8 w-full justify-start gap-2.5 px-2 text-ui font-normal',
        active
          ? 'bg-(--sidebar-active) font-semibold text-foreground hover:bg-(--sidebar-active) dark:hover:bg-(--sidebar-active)'
          : 'text-content-secondary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover',
      )}
    >
      <ProjectAvatar name={name} tone={tone} className="rounded-sm" />
      <span className="min-w-0 truncate">{name}</span>
      {waiting > 0 && (
        <span className="ml-auto flex-none rounded-full bg-(--chip-confirm-bg) px-1.5 text-caption leading-4.5 font-semibold text-(--chip-confirm-fg)">
          {waiting}
        </span>
      )}
    </Button>
  );
}

export function SidebarThreadList({ children }: { children: ReactNode }) {
  return (
    <div className="mt-px mb-1.5 ml-4.25 flex flex-col gap-px border-l border-dashed border-border py-0.5 pl-2">
      {children}
    </div>
  );
}

export interface SidebarThreadRowProps {
  title: string;
  tone: StoneTone;
  open?: boolean;
  snoozed?: boolean;
  onClick?: () => void;
  menu?: ReactNode;
}

export function SidebarThreadRow({
  title,
  tone,
  open = false,
  snoozed = false,
  onClick,
  menu,
}: SidebarThreadRowProps) {
  return (
    <div
      data-slot="sidebar-thread-row"
      data-open={open ? '' : undefined}
      className={cn(
        'group/thread flex h-7 items-center rounded-(--radius-control) pr-1',
        open ? 'bg-card text-foreground shadow-(--e1)' : 'hover:bg-sidebar-hover',
      )}
    >
      <Button
        variant="ghost"
        onClick={onClick}
        className={cn(
          'h-7 min-w-0 flex-1 justify-start gap-2 px-2 text-ui font-normal hover:bg-transparent dark:hover:bg-transparent',
          snoozed ? 'text-content-tertiary' : 'text-content-secondary',
          open && 'text-foreground',
        )}
      >
        <Pebble tone={tone} />
        <span className="min-w-0 truncate">{title}</span>
        {snoozed && <AlarmClockOff className="size-3 flex-none text-content-tertiary" />}
      </Button>
      <span className="hidden flex-none group-hover/thread:inline-flex">
        {menu ?? (
          <Button variant="ghost" size="icon-xs" aria-label="Thread menu" className="size-5.5">
            <Ellipsis />
          </Button>
        )}
      </span>
    </div>
  );
}
