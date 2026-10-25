import { cn } from 'cn';
import { Plus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronRight } from '../icons/index.js';

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

export const FORM_TEXTAREA_CLS =
  'rounded-md border-border bg-card text-ui shadow-xs focus-visible:border-border md:text-ui dark:bg-input/30';

export function ResourceList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-testid="resource-group" className={cn('mt-4', className)}>
      <SettingsCard>{children}</SettingsCard>
    </div>
  );
}

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
        'h-auto w-full rounded-none border-0 border-b border-border text-left font-normal last:border-b-0 hover:bg-transparent active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-transparent',
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

export function RowDesc({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('truncate text-meta text-content-tertiary', className)}>{children}</span>
  );
}

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
