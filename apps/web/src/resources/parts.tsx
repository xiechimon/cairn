import { cn } from 'cn';
import { ChevronRight, Plus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { InfoTip } from '../components/info-tip.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export function ResourceNewButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Button className={TOPBAR_PRIMARY_BUTTON} onClick={onClick} data-testid="resource-new">
      <Plus aria-hidden strokeWidth={1.75} className="size-5" />
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
  menu,
  children,
  ...rest
}: {
  mcp?: boolean;
  className?: string;
  onOpen?: () => void;
  menu?: ReactNode;
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
  if (menu === undefined) {
    return (
      <Button
        variant="ghost"
        data-testid="resource-row"
        {...mark}
        className={cn(
          SETTINGS_ROW_CLS,
          'h-auto w-full rounded-none border-0 border-b border-border text-left font-normal first:rounded-t-(--radius-card) last:rounded-b-(--radius-card) last:border-b-0 hover:bg-menu-hover dark:hover:bg-menu-hover',
          className,
        )}
        onClick={onOpen}
      >
        {children}
      </Button>
    );
  }
  return (
    <div
      data-testid="resource-row"
      {...mark}
      className={cn(
        'flex items-center gap-1 border-b border-border pr-2 first:rounded-t-(--radius-card) last:rounded-b-(--radius-card) last:border-b-0 hover:bg-menu-hover dark:hover:bg-menu-hover',
        className,
      )}
      {...rest}
    >
      <Button
        variant="ghost"
        className={cn(
          SETTINGS_ROW_CLS,
          'h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent text-left font-normal hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent',
        )}
        onClick={onOpen}
      >
        {children}
      </Button>
      {menu}
    </div>
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
  return <ChevronRight aria-hidden className="size-5 flex-none text-content-tertiary" />;
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

export function RowNote({ danger = false, children }: { danger?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex-none text-meta whitespace-nowrap',
        danger ? 'text-destructive' : 'text-content-secondary',
      )}
    >
      {children}
    </span>
  );
}

export interface IntegrationItem {
  key: string;
  testId?: string;
  icon: ReactNode;
  name: string;
  kind?: string;
  info?: string;
  description: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
}

export function IntegrationRow({
  testId,
  icon,
  name,
  kind,
  info,
  description,
  status,
  action,
}: Omit<IntegrationItem, 'key'>) {
  return (
    <div
      data-connector-card={name}
      data-testid={testId}
      className={cn(SETTINGS_ROW_CLS, 'flex-wrap justify-start gap-3 py-2.5 sm:flex-nowrap')}
    >
      <span className="flex size-5 flex-none items-center justify-center">{icon}</span>
      <RowText className="min-w-40 flex-1">
        <RowLine>
          <RowTitle className="font-medium">{name}</RowTitle>
          {kind !== undefined && <RowMeta>{kind}</RowMeta>}
          {info !== undefined && <InfoTip info={info} />}
        </RowLine>
        <span className="line-clamp-2 text-meta text-content-tertiary">{description}</span>
      </RowText>
      {status}
      {action !== undefined && (
        <span className="ms-auto flex flex-none flex-wrap items-center justify-end gap-2">
          {action}
        </span>
      )}
    </div>
  );
}
