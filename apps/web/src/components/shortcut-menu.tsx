import type { KeyboardEvent, ReactNode } from 'react';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './ui/dropdown-menu.js';

export interface ShortcutMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  submenu?: readonly ShortcutMenuAction[];
}

export type ShortcutMenuEntry = ShortcutMenuAction | 'separator';

export interface ShortcutMenuContentProps {
  entries: readonly ShortcutMenuEntry[];
  onSelect: (id: string) => void;
  className?: string;
  align?: 'start' | 'center' | 'end';
}

function flatten(entries: readonly ShortcutMenuEntry[]): ShortcutMenuAction[] {
  return entries.flatMap((entry) => (entry === 'separator' ? [] : [entry]));
}

function ActionItem({
  action,
  onSelect,
}: {
  action: ShortcutMenuAction;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenuItem
      data-shortcut-key={action.shortcut?.toLowerCase()}
      variant={action.danger === true ? 'destructive' : 'default'}
      onClick={() => onSelect(action.id)}
    >
      {action.icon}
      {action.label}
      {action.shortcut != null && <DropdownMenuShortcut>{action.shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

export function ShortcutMenuContent({
  entries,
  onSelect,
  className,
  align,
}: ShortcutMenuContentProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const hit = flatten(entries).find(
      (action) =>
        action.shortcut != null && action.shortcut.toLowerCase() === event.key.toLowerCase(),
    );
    if (hit == null) return;
    event.preventDefault();
    event.currentTarget
      .querySelector<HTMLElement>(`[data-shortcut-key="${event.key.toLowerCase()}"]`)
      ?.click();
  };
  return (
    <DropdownMenuContent className={className} align={align} onKeyDown={onKeyDown}>
      {entries.map((entry, index) => {
        if (entry === 'separator') {
          return <DropdownMenuSeparator key={`separator-${index.toString()}`} />;
        }
        if (entry.submenu != null) {
          return (
            <DropdownMenuSub key={entry.id}>
              <DropdownMenuSubTrigger data-shortcut-key={entry.shortcut?.toLowerCase()}>
                {entry.icon}
                {entry.label}
                {entry.shortcut != null && (
                  <DropdownMenuShortcut className="mr-4">{entry.shortcut}</DropdownMenuShortcut>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-52">
                {entry.submenu.map((child) => (
                  <ActionItem key={child.id} action={child} onSelect={onSelect} />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        }
        return <ActionItem key={entry.id} action={entry} onSelect={onSelect} />;
      })}
    </DropdownMenuContent>
  );
}
