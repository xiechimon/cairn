import { cn } from 'cn';
import type { ReactNode } from 'react';
import { KeyHint } from '../key-hint.js';
import { Button } from '../ui/button.js';
import { SIDEBAR_ROW, SidebarRowActions } from './sidebar-project.js';

export interface SidebarNavRowProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
  actionsPinned?: boolean;
}

export function SidebarNavRow({
  icon,
  label,
  shortcut,
  active = false,
  onClick,
  actions,
  actionsPinned = false,
}: SidebarNavRowProps) {
  return (
    <div className="group/row relative flex flex-none">
      <Button
        variant="ghost"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        data-slot="sidebar-nav-row"
        className={cn(
          SIDEBAR_ROW,
          'pr-2 pl-1.5 text-foreground',
          active
            ? 'bg-(--sidebar-active) hover:bg-(--sidebar-active) dark:hover:bg-(--sidebar-active)'
            : 'hover:bg-sidebar-hover group-hover/row:bg-sidebar-hover group-has-aria-expanded/row:bg-sidebar-hover dark:hover:bg-sidebar-hover',
          actions != null &&
            (actionsPinned
              ? 'pr-14'
              : 'group-focus-within/row:pr-8 group-hover/row:pr-8 [@media(hover:none)]:pr-12'),
        )}
      >
        <span className="flex-none text-sidebar-ink">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
        {shortcut != null && (
          <KeyHint className="ml-auto text-content-secondary">{shortcut}</KeyHint>
        )}
      </Button>
      {actions != null && <SidebarRowActions pinned={actionsPinned}>{actions}</SidebarRowActions>}
    </div>
  );
}
