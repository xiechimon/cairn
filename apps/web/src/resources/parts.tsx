// Shared parts of the resource pages on the Paper page patterns
// (apps/web/DESIGN.md 页面模式): one white settings card of 52px rows per
// list, name + meta on the left, status and controls on the right.

import { cn } from 'cn';
import { Plus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronRight } from '../icons/index.js';

/** Top bar `+ 新建` of the resource pages: the ink primary button.
 *  data-testid="resource-new" is the hit-test probe handle (title-band-clicks). */
export function ResourceNewButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Button className={TOPBAR_PRIMARY_BUTTON} onClick={onClick} data-testid="resource-new">
      <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
      {t('新建')}
    </Button>
  );
}

export const RES_SEARCH_ROW_CLS = 'flex gap-2';

/** FORM_CONTROL_CLS without the fixed 32px height, for Textarea. The focus
 *  border stays the rest color: app.css only resets it for .border-input. */
export const FORM_TEXTAREA_CLS =
  'rounded-md border-border bg-card text-ui shadow-xs focus-visible:border-border md:text-ui dark:bg-input/30';

/** One card holding a resource list. data-testid="resource-group" is the
 *  geometry and count anchor. */
export function ResourceList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-testid="resource-group" className={cn('mt-4', className)}>
      <SettingsCard>{children}</SettingsCard>
    </div>
  );
}

/** A list row. With `onOpen` the whole row opens the item (role=button,
 *  Enter / Space); without it the row is static. */
export function ResourceRow({
  mcp = false,
  className,
  onOpen,
  children,
  ...rest
}: {
  mcp?: boolean;
  className?: string;
  onOpen?: () => void;
  children: ReactNode;
} & Omit<ComponentProps<'div'>, 'className' | 'children' | 'onClick' | 'role'>) {
  const mark = mcp ? { 'data-mcp': '' } : {};
  if (onOpen === undefined) {
    return (
      <div
        data-testid="resource-row"
        {...mark}
        className={cn(SETTINGS_ROW_CLS, className)}
        {...rest}
      >
        {children}
      </div>
    );
  }
  return (
    <Button
      variant="ghost"
      data-testid="resource-row"
      {...mark}
      className={cn(
        SETTINGS_ROW_CLS,
        'h-auto w-full rounded-none text-left font-normal hover:bg-transparent active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-transparent',
        className,
      )}
      onClick={onOpen}
    >
      {children}
    </Button>
  );
}

export function RowText({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('flex min-w-0 flex-col', className)}>{children}</span>;
}

export function RowLine({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('flex min-w-0 items-center gap-2', className)}>{children}</span>;
}

export function RowTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('truncate text-ui text-foreground', className)}>{children}</span>;
}

/** Meta line under the title. */
export function RowDesc({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('truncate text-meta text-content-tertiary', className)}>{children}</span>
  );
}

/** Right-edge meta (kind, relative time, slot). */
export function RowMeta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('flex-none text-meta whitespace-nowrap text-content-tertiary', className)}>
      {children}
    </span>
  );
}

export function RowChevron() {
  return <ChevronRight aria-hidden className="size-4 flex-none text-content-tertiary" />;
}

/** Online status: green dot + 在线, grey dot + 离线. data-on carries the
 *  state for assertions. */
export function OnlineStatus({ on }: { on: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-meta',
        on ? 'text-running-text' : 'text-content-tertiary',
      )}
    >
      <span
        aria-hidden
        data-on={on}
        className={cn('size-1.5 flex-none rounded-full', on ? 'bg-running' : 'bg-content-dim')}
      />
      {on ? t('在线') : t('离线')}
    </span>
  );
}
