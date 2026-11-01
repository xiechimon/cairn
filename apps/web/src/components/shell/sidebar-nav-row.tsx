import { cn } from 'cn';
import type { ReactNode } from 'react';
import { KeyHint } from '../key-hint.js';
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
        'h-8 w-full justify-start gap-2.5 px-2 text-ui font-normal',
        active
          ? 'bg-(--sidebar-active) font-semibold text-foreground hover:bg-(--sidebar-active) dark:hover:bg-(--sidebar-active)'
          : 'text-content-secondary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover',
      )}
    >
      <span className="flex-none text-icon">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {shortcut != null && <KeyHint className="ml-auto">{shortcut}</KeyHint>}
    </Button>
  );
}
