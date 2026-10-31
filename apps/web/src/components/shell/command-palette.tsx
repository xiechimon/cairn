import { cn } from 'cn';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Input } from '../ui/input.js';
import { Kbd } from '../ui/kbd.js';

export interface CommandPaletteProps {
  query: string;
  onQueryChange: (next: string) => void;
  onMoveCursor?: (delta: 1 | -1) => void;
  footer: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CommandPalette({
  query,
  onQueryChange,
  onMoveCursor,
  footer,
  children,
  className,
}: CommandPaletteProps) {
  return (
    <div
      role="dialog"
      aria-label="Command palette"
      data-slot="command-palette"
      className={cn(
        'w-full overflow-hidden rounded-(--edge-radius) bg-background shadow-(--e3)',
        className,
      )}
    >
      <div className="flex h-13 items-center gap-2.5 border-b border-border px-4">
        <Search className="size-4 flex-none text-content-tertiary" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            onMoveCursor?.(event.key === 'ArrowDown' ? 1 : -1);
          }}
          aria-label="Search"
          placeholder="Search threads, projects and actions"
          className="h-full border-0 bg-transparent px-0 text-card-title shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>
      <div role="listbox" className="max-h-105 overflow-auto p-1.5">
        {children}
      </div>
      <div className="flex gap-3.5 border-t border-border px-3.5 py-2 text-caption text-content-tertiary">
        {footer}
      </div>
    </div>
  );
}

export function PaletteSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="px-2.5 pt-2 pb-1 text-caption font-medium text-content-tertiary">{title}</div>
      {children}
    </section>
  );
}

export interface PaletteRowProps {
  icon: ReactNode;
  active?: boolean;
  hint?: string;
  shortcut?: string;
  onSelect?: () => void;
  children: ReactNode;
}

export function PaletteRow({
  icon,
  active = false,
  hint,
  shortcut,
  onSelect,
  children,
}: PaletteRowProps) {
  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect?.();
      }}
      data-slot="palette-row"
      className={cn(
        'flex h-9 cursor-default items-center gap-2.5 rounded-(--radius-control) px-2.5 text-ui text-foreground',
        active ? 'bg-menu-hover' : 'hover:bg-menu-hover',
      )}
    >
      <span className="flex-none text-content-tertiary [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
      {hint != null && <span className="truncate text-meta text-content-tertiary">{hint}</span>}
      {shortcut != null && (
        <Kbd className="ml-auto bg-transparent font-mono text-caption">{shortcut}</Kbd>
      )}
    </div>
  );
}
