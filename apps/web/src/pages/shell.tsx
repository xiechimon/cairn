import type { ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { AppSidebar } from '../board/app-sidebar.js';
import type { SidebarSelected } from '../board/sidebar.js';
import { SegmentedTabs } from '../components/segmented.js';
import type { FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft } from '../icons/index.js';

export const SHEET_PANEL = 'relative isolate flex min-w-0 flex-1 overflow-hidden bg-background';

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
  onNewTask?: () => void;
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
  onNewTask,
  bleed = false,
  children,
}: PageShellProps) {
  const { t } = useI18n();
  return (
    <div className="page-shell flex h-full overflow-hidden bg-(--surface-1)" data-route={route}>
      <AppSidebar fixture={fixture} selected={selected} onNewTask={onNewTask} />
      <div className={`page-main ${SHEET_PANEL}`}>
        <div className="page-main-col flex min-w-0 flex-1 flex-col">
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
                <ChevronLeft width={16} height={16} />
              </Link>
            )}
            <h1 className="min-w-0 truncate font-heading text-page font-medium text-foreground">
              {title}
            </h1>
            {tabs != null && tab != null && <TabGroup tabs={tabs} tab={tab} onTab={onTab} />}
            {actions != null && (
              <div className="ml-auto flex flex-none items-center gap-0.5">{actions}</div>
            )}
          </header>
          <div
            className={`flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto${bleed ? '' : ' px-4'}`}
          >
            {bleed ? (
              children
            ) : (
              <div data-testid="page-col" className="mx-auto w-192 max-w-full pt-4">
                {children}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
