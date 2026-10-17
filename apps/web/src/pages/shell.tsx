// Secondary-route shell (issue #71): sidebar + 44px topbar with a back
// chevron, a centered title or centered text-tab group, an optional
// left title (project name, r2 24b) and an optional right action (the
// indigo + 新建 on schedules, r7 11). Geometry from the r7 11 probes
// (topbar 43 + 1px border, back 28×28 @ x252, title centered on the
// content area) and r2 24b/24c for the name + tab-group variants.
// The 总管 launcher no longer rides this shell (ADR 0013 D6: the root
// ChiefRoot layout hosts the single floating window + FAB for every
// route); the sidebar is the shared AppSidebar, so its geometry/behavior
// matches the board's exactly.
// #946: pages.css 清零——本壳的全部几何/配色迁为 token utility（值 =
// 原规则等值迁移）；page-shell/page-main-col/
// page-tab(s-group) 类名留存 DOM：跨域 spec 的既有定位别名（#910 裁定 1
// 两级制下 spec 载体已迁语义位；零规则别名的终摘 = #1036 dead-class 闸，
// 仍被 spec 命中的名字由闸的 selector-exempt 台账钉住）。page-main
// 曾是 chief-drawer DOCK_ROWS 的停靠行钩子，随 0013 让位退役，别名
// 零引用终摘（#1036；page-fab 类随族 FAB 退役删除）。
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { AppSidebar } from '../board/app-sidebar.js';
import type { SidebarSelected } from '../board/sidebar.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import type { FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft } from '../icons/index.js';

export interface PageTab {
  id: string;
  label: string;
  /** 禁用位（spec 12 G2-T2 v1：local 项目的 文件 tab）——钮不可点，
   *  内容面由页面给占位文案。 */
  disabled?: boolean;
}

/** Text-tab pill group (任务|文件 in the topbar, 基本信息|仓库|标签 in the
 *  settings column — r2 24b/24c share one markup). registry Tabs 承载
 *  （#980 裁决②④：手写分段壳退役，default 档 = base-nova 形态）：
 *  role=tablist/tab、aria-selected、roving focus、disabled 全归 Base UI 原语；
 *  page-tabs-group/page-tab 类名留存（segmented-controls.spec 跨域别名，
 *  选中态载体 = data-active/aria-selected，#910 裁定 3）。本组无内容面板
 *  （tab 值驱动消费页状态），只渲 List+Trigger。 */
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
    <Tabs
      className="page-tabs-group pointer-events-auto gap-0"
      value={tab}
      onValueChange={(next) => onTab?.(String(next))}
    >
      <TabsList>
        {tabs.map((item) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className="page-tab px-3"
            disabled={item.disabled === true}
          >
            {t(item.label)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

interface PageShellProps {
  fixture: FixtureSet;
  selected: SidebarSelected;
  /** Centered topbar title (定时 / 新建项目 / 设置). */
  title?: string;
  /** Left-aligned title right after the back chevron (project name). */
  leftTitle?: string;
  /** Centered topbar tab group (任务|文件). */
  tabs?: PageTab[];
  tab?: string;
  onTab?: (id: string) => void;
  /** Right-edge action slot (indigo text button on schedules). */
  action?: ReactNode;
  /** #389: 页面自有新建 dialog 的 opener（project 页——保存锚路由项目）；
   *  缺省 = 侧栏内部全局 dialog。 */
  onNewTask?: () => void;
  children: ReactNode;
}

export function PageShell({
  fixture,
  selected,
  title,
  leftTitle,
  tabs,
  tab,
  onTab,
  action,
  onNewTask,
  children,
}: PageShellProps) {
  const { t } = useI18n();
  const { search } = useLocation();
  return (
    <div className="page-shell flex h-full overflow-hidden">
      <AppSidebar fixture={fixture} selected={selected} onNewTask={onNewTask} />
      {/* ADR 0013 D1/D6: the docking row is gone — the chief surface is a
          root-level floating window (chief-root.tsx), nothing yields here
          anymore. The former page-main alias went with it: zero spec
          references, final pick under the #1036 dead-class gate. */}
      <div className="relative flex min-w-0 flex-1 bg-(--card)">
        <div className="page-main-col flex min-w-0 flex-1 flex-col">
          <header className="relative flex h-11 flex-none items-center border-b border-(--border) pl-3">
            <Link
              className="flex size-7 flex-none items-center justify-center text-(--text-tertiary) no-underline"
              to={{ pathname: '/app', search }}
              aria-label={t('返回')}
            >
              <ChevronLeft />
            </Link>
            {leftTitle != null && (
              <span className="ml-1 min-w-0 truncate text-sm font-medium leading-[22px] text-(--foreground)">
                {leftTitle}
              </span>
            )}
            {title != null && (
              <div className="pointer-events-none absolute inset-x-0 text-center text-sm font-medium leading-[22px] text-(--foreground)">
                {t(title)}
              </div>
            )}
            {tabs != null && tab != null && (
              <div className="pointer-events-none absolute inset-x-0 flex justify-center">
                <TabGroup tabs={tabs} tab={tab} onTab={onTab} />
              </div>
            )}
            {action != null && <div className="ml-auto flex items-center pr-5">{action}</div>}
          </header>
          {/* #1032：内容体自持滚动（secondary/resources 壳同律）——children
              此前直接挂在 h-full overflow-hidden 的 page-main-col 里，长内容
              （任务列表/排期卡/设置面板/新建表单）被裁掉且滚轮不动。滚动层
              保持 flex-col：子页的 flex-1/min-h-0 语义（files tab 的内部自滚、
              空态垂直居中）原样成立；overflow-x 裁切守住「页面壳是唯一裁切
              者」的横纵向收口。 */}
          <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
