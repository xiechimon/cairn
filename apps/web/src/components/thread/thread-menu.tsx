import {
  AlarmClockOff,
  Archive,
  CircleDot,
  Ellipsis,
  GitFork,
  Link,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';
import { ShortcutMenuContent, type ShortcutMenuEntry } from '../shortcut-menu.js';
import { Button } from '../ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../ui/dropdown-menu.js';

export const THREAD_MENU: readonly ShortcutMenuEntry[] = [
  { id: 'unread', label: 'Mark as unread', icon: <CircleDot />, shortcut: 'U' },
  { id: 'rename', label: 'Rename', icon: <Pencil />, shortcut: 'R' },
  {
    id: 'snooze',
    label: 'Snooze until',
    icon: <AlarmClockOff />,
    shortcut: 'S',
    submenu: [
      { id: 'snooze-needed', label: 'Needed (the agent wakes it)' },
      { id: 'snooze-tomorrow', label: 'Tomorrow 09:00' },
      { id: 'snooze-monday', label: 'Next Monday' },
      { id: 'snooze-pick', label: 'Pick a time…' },
    ],
  },
  { id: 'fork', label: 'Fork', icon: <GitFork />, shortcut: 'F' },
  { id: 'link', label: 'Copy link', icon: <Link />, shortcut: 'L' },
  'separator',
  { id: 'archive', label: 'Archive', icon: <Archive />, shortcut: 'A' },
  { id: 'delete', label: 'Delete…', icon: <Trash2 />, shortcut: 'D', danger: true },
];

export const PROJECT_MENU: readonly ShortcutMenuEntry[] = [
  { id: 'rename', label: 'Rename', icon: <Pencil />, shortcut: 'R' },
  { id: 'settings', label: 'Settings', icon: <Settings2 />, shortcut: ',' },
  { id: 'link', label: 'Copy link', icon: <Link />, shortcut: 'L' },
  'separator',
  { id: 'archive', label: 'Archive…', icon: <Archive />, shortcut: 'A' },
  { id: 'delete', label: 'Delete…', icon: <Trash2 />, shortcut: 'D', danger: true },
];

export function ThreadMenu({
  onSelect,
  entries = THREAD_MENU,
}: {
  onSelect: (id: string) => void;
  entries?: readonly ShortcutMenuEntry[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Thread menu"
            className="size-6 text-content-tertiary"
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <ShortcutMenuContent entries={entries} onSelect={onSelect} align="end" className="w-56" />
    </DropdownMenu>
  );
}
