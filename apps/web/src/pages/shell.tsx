// The one shell for every non-board route (paper-redesign-plan PR 6):
// Grouped sidebar on canvas, a sheet panel inset 10px, the Paper top bar
// (56px, serif page title, text buttons + one ink primary button) and one 768px
// reading column. Class aliases page-shell / page-main / page-main-col /
// page-tabs-group / page-tab are e2e handles.
import type { ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { AppSidebar } from '../board/app-sidebar.js';
import type { SidebarSelected } from '../board/sidebar.js';
import { SegmentedTabs } from '../components/segmented.js';
import type { FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft } from '../icons/index.js';

/** The sheet panel inset 10px off the canvas; the board route wears the
 *  same one so moving between routes keeps the main panel still. A div, not
 *  <main>: a <header> inside <main> loses role=banner. The ring is an
 *  ::after layer above the content: an inset box-shadow on the sheet itself
 *  paints under its children, so any child with a background hides it. */
export const SHEET_PANEL =
  "relative isolate my-2.5 mr-2.5 flex min-w-0 flex-1 overflow-hidden rounded-(--cds-radius-2xl) bg-background after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:[box-shadow:var(--sheet-ring)] after:content-['']";

export interface PageTab {
  id: string;
  label: string;
  /** Disabled tab (local project 文件 tab); the page renders the placeholder. */
  disabled?: boolean;
}

/** Text tabs on the shared segmented face: 任务|文件 in the top bar,
 *  基本信息|仓库|标签 in the project settings column. The tab value drives
 *  page state; no panels. */
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
  /** data-route value: route-scoped selectors hang off it. */
  route: string;
  fixture: FixtureSet;
  /** Sidebar row to light; absent = the AppSidebar default (工作台). */
  selected?: SidebarSelected;
  /** Serif page title, already translated. */
  title: ReactNode;
  /** Parent route for detail pages. Sidebar destinations have no parent and
   *  render no back arrow. */
  back?: To;
  /** Tab group right after the title (project 任务|文件). */
  tabs?: PageTab[];
  tab?: string;
  onTab?: (id: string) => void;
  /** Right side of the top bar: text buttons, then at most one ink primary button. */
  actions?: ReactNode;
  /** Page-owned 新任务 dialog (project page); absent = the sidebar's own. */
  onNewTask?: () => void;
  /** Body fills the sheet instead of the 768px column (project files). */
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
          <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
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
