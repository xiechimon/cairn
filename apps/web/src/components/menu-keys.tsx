import { cn } from 'cn';
import type { ComponentProps, KeyboardEvent } from 'react';
import { isEditableTarget } from '../overlay/hotkeys.js';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './ui/dropdown-menu.js';

interface MenuKeyProps {
  shortcut?: string | undefined;
  confirms?: boolean | undefined;
}

const MENU_ROLE = '[role="menu"]';

function keyAttributes(shortcut: string | undefined) {
  if (shortcut === undefined) return {};
  return {
    'data-menu-key': shortcut.toLowerCase(),
    'aria-keyshortcuts': shortcut.toUpperCase(),
  };
}

function MenuKeyHint({ shortcut, confirms }: MenuKeyProps) {
  return (
    <>
      {confirms === true && (
        <span aria-hidden="true" className="-ml-2.5">
          …
        </span>
      )}
      {shortcut !== undefined && (
        <DropdownMenuShortcut aria-hidden="true" className="min-w-3 pl-3 text-right tabular-nums">
          {shortcut.toUpperCase()}
        </DropdownMenuShortcut>
      )}
    </>
  );
}

function activateKeyedRow(event: KeyboardEvent<HTMLElement>) {
  const { target, currentTarget: popup } = event;
  if (!(target instanceof HTMLElement)) return;
  const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  if (isEditableTarget(target)) {
    if (composing || event.key.length === 1) event.stopPropagation();
    return;
  }
  if (composing) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.length !== 1 || event.key === ' ') return;
  if (target.closest(MENU_ROLE) !== popup) return;
  const rows = [...popup.querySelectorAll<HTMLElement>('[data-menu-key]')].filter(
    (row) => row.closest(MENU_ROLE) === popup,
  );
  if (rows.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  const key = event.key.toLowerCase();
  const row = rows.find((candidate) => candidate.dataset.menuKey === key);
  if (row === undefined || row.hasAttribute('data-disabled')) return;
  row.click();
}

export function KeyedMenuContent(props: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent {...props} onKeyDownCapture={activateKeyedRow} />;
}

export function KeyedMenuSubContent(props: ComponentProps<typeof DropdownMenuSubContent>) {
  return <DropdownMenuSubContent {...props} onKeyDownCapture={activateKeyedRow} />;
}

export function KeyedMenuItem({
  shortcut,
  confirms,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & MenuKeyProps) {
  return (
    <DropdownMenuItem {...keyAttributes(shortcut)} {...props}>
      {children}
      <MenuKeyHint shortcut={shortcut} confirms={confirms} />
    </DropdownMenuItem>
  );
}

export function KeyedMenuSubTrigger({
  shortcut,
  children,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuSubTrigger> & MenuKeyProps) {
  return (
    <DropdownMenuSubTrigger
      {...keyAttributes(shortcut)}
      className={cn('[&>svg:last-child]:ml-0', className)}
      {...props}
    >
      {children}
      <MenuKeyHint shortcut={shortcut} />
    </DropdownMenuSubTrigger>
  );
}

export function KeyedMenuRadioItem({
  shortcut,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuRadioItem> & MenuKeyProps) {
  return (
    <DropdownMenuRadioItem {...keyAttributes(shortcut)} {...props}>
      {children}
      <MenuKeyHint shortcut={shortcut} />
    </DropdownMenuRadioItem>
  );
}

export function KeyedMenuCheckboxItem({
  shortcut,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuCheckboxItem> & MenuKeyProps) {
  return (
    <DropdownMenuCheckboxItem {...keyAttributes(shortcut)} {...props}>
      {children}
      <MenuKeyHint shortcut={shortcut} />
    </DropdownMenuCheckboxItem>
  );
}
