import { createContext, type ReactNode, useContext } from 'react';
import { Link, type To } from 'react-router';
import { AppSidebar } from '../board/app-sidebar.js';
import type { SidebarSelected } from '../board/sidebar.js';
import { SegmentedTabs } from '../components/segmented.js';
import type { FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft } from '../icons/index.js';

export const SHEET_PANEL =
  'relative isolate flex min-w-0 flex-1 overflow-hidden border-l border-border bg-background max-[640px]:border-0';

export const EmbeddedShell = createContext(false);

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
  back?: To;
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
  back,
  tabs,
  tab,
  onTab,
  actions,
  bleed = false,
  children,
}: PageShellProps) {
  const { t } = useI18n();
  const embedded = useContext(EmbeddedShell);
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
            <div
              data-testid="page-toolbar"
              className="flex w-full flex-none items-center gap-3 px-4 pt-1 empty:hidden"
            >
              {tabs != null && tab != null && <TabGroup tabs={tabs} tab={tab} onTab={onTab} />}
              <div className="ml-auto flex flex-none items-center gap-0.5 empty:hidden">
                {actions}
              </div>
            </div>
          ) : (
            <header
              data-testid="page-topbar"
              className="flex h-14 flex-none items-center gap-3 border-b border-border px-6 whitespace-nowrap"
            >
              {back != null && (
                <Link
                  className="-mr-1 -ml-2 flex size-7 flex-none items-center justify-center rounded-md text-content-tertiary"
                  to={back}
                  aria-label={t('返回')}
                >
                  <ChevronLeft width={20} height={20} />
                </Link>
              )}
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
                className={embedded ? 'w-full pt-1' : 'mx-auto w-192 max-w-full pt-4'}
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
