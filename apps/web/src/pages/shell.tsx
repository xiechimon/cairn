import { createContext, type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';
import { AppSidebar } from '../board/app-sidebar.js';
import type { SidebarSelected } from '../board/sidebar.js';
import { SegmentedTabs } from '../components/segmented.js';
import type { FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export const SHEET_PANEL =
  'relative isolate flex min-w-0 flex-1 overflow-hidden border-l border-border bg-background max-[640px]:border-0';

export const EmbeddedShell = createContext<{ toolbarSlot: HTMLElement | null } | null>(null);

export interface PageTab {
  id: string;
  label: string;
  disabled?: boolean;
}

export function TabGroup({
  tabs,
  tab,
  onTab,
}: {
  tabs: PageTab[];
  tab: string;
  onTab?: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <SegmentedTabs
      className="page-tabs-group"
      optionHandle="page-tab"
      value={tab}
      onChange={(next) => onTab?.(next)}
      options={tabs.map((item) => ({
        value: item.id,
        label: t(item.label),
        disabled: item.disabled === true,
      }))}
    />
  );
}

interface PageShellProps {
  route: string;
  fixture: FixtureSet;
  selected?: SidebarSelected;
  title: ReactNode;
  tabs?: PageTab[];
  tab?: string;
  onTab?: (id: string) => void;
  actions?: ReactNode;
  bleed?: boolean;
  children: ReactNode;
}

export function PageShell({
  route,
  fixture,
  selected,
  title,
  tabs,
  tab,
  onTab,
  actions,
  bleed = false,
  children,
}: PageShellProps) {
  const shell = useContext(EmbeddedShell);
  const embedded = shell !== null;
  return (
    <div
      className={
        embedded
          ? 'flex h-full min-w-0 flex-1 overflow-hidden'
          : 'page-shell flex h-full overflow-hidden bg-(--surface-1)'
      }
      data-route={route}
    >
      {!embedded && <AppSidebar fixture={fixture} selected={selected} />}
      <div className={embedded ? 'relative flex min-w-0 flex-1' : `page-main ${SHEET_PANEL}`}>
        <div className="page-main-col flex min-w-0 flex-1 flex-col">
          {embedded ? (
            shell.toolbarSlot !== null &&
            createPortal(
              <div data-testid="page-toolbar" className="flex items-center gap-3 empty:hidden">
                {tabs != null && tab != null && <TabGroup tabs={tabs} tab={tab} onTab={onTab} />}
                <div className="flex flex-none items-center gap-0.5 empty:hidden">{actions}</div>
              </div>,
              shell.toolbarSlot,
            )
          ) : (
            <header
              data-testid="page-topbar"
              className="flex h-14 flex-none items-center gap-3 border-b border-border px-6 whitespace-nowrap"
            >
              <h1 className="min-w-0 truncate voice-title text-page text-foreground">{title}</h1>
              {tabs != null && tab != null && <TabGroup tabs={tabs} tab={tab} onTab={onTab} />}
              <div className="ml-auto flex flex-none items-center gap-0.5">{actions}</div>
            </header>
          )}
          <div
            className={`flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto${bleed ? '' : ' px-4'}`}
          >
            {bleed ? (
              children
            ) : (
              <div
                data-testid="page-col"
                className={embedded ? 'w-full pt-1 pb-6' : 'mx-auto w-192 max-w-full pt-4'}
              >
                {children}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
