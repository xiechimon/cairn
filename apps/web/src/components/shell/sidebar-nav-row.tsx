import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Button } from '../ui/button.js';

export interface SidebarNavRowProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick?: () => void;
}

export function SidebarNavRow({
  icon,
  label,
  shortcut,
  active = false,
  onClick,
}: SidebarNavRowProps) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-slot="sidebar-nav-row"
      className={cn(
        'group/nav h-8 w-full justify-start gap-2.5 px-2 text-ui font-normal',
        active
          ? 'bg-(--sidebar-active) font-semibold text-foreground hover:bg-(--sidebar-active) dark:hover:bg-(--sidebar-active)'
          : 'text-content-secondary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover',
      )}
    >
      <span className="flex-none text-icon">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {shortcut != null && (
        <span className="ml-auto text-caption text-content-tertiary opacity-0 group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100">
          {shortcut}
        </span>
      )}
    </Button>
  );
}
