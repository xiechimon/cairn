// Board sidebar (issue #54): 240px expanded rail, structure and copy from
// r6 §3.1 / r2 §1.1, geometry from r7 01 pixel probes (row pitch 36, level-1
// icons at x16, group chevrons at x20, sub-rows at x36, user chip at the
// bottom). #55 adds the collapsed rail: 40px wide, icon-only rows, 32px row
// pitch with a 24px selected pill and the user avatar chip at the bottom.
// All rows render; the collapse toggle persists like the theme.
// #121: the nav rows (rail + expanded, team name and 新建项目 included) are
// react-router Links — SPA hops carrying the live ?search= along.
// #127: the avatar chips toggle the user-menu popover (Base UI Popover;
// Esc rides the Base UI layer stack since #656). #389: 新任务 row joins 搜索, sharing the global C
// hotkey opener.
// #414 (shadcn 试点): 视觉层切 B（neutral）token + tailwind 工具类，
// sidebar.css 随之整件退役——行 pill 的 ::before 层译成 before: 工具类，
// 行高/内距/轨道宽全部按 r7 实测原值保留。brand mark 的 mask 是唯一工具类
// 表达不了的规则，落 inline style。选中态/hover 的语义色不变，墨色走
// muted-foreground 族。
// #943: 裸控件收编——九个行钮/头像钮全走 components/ui Button（ghost 档 +
// ROW_BTN/RAIL_BTN 中和件：行视觉盒在 before: pill，件配方的涂底/圆角/
// 边框/press 位移逐位归零，r7 几何不动）。跨域 spec 仍消费的类别名
// （sidebar-row/rail-row/sidebar-kbd…）原位保留（#1036 dead-class 闸的
// selector-exempt 台账钉住引用），零引用别名已终摘；
// 本域 spec 的钉扎载体已按 #910 换 role/label/text + 少量二级 testid。
// #949: #137 常亮互斥的调暗覆写从 overlays.css 的 :root[data-search-open]
// 规则迁进本文件的 SEARCH_OPEN_DIM utility 变体（选中档常量随行携带，
// 不再依赖类别名选择器——标记写入方 = overlays/search-panel）。

import { BRAND } from '@pacman/shared';
import {
  type ComponentType,
  type ReactElement,
  type SVGProps,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { UserMenu } from '../detail/user-menu.js';
import { isDeleted } from '../fixtures/deletions.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import {
  BarChart3,
  ChevronDown,
  Clock,
  EllipsisVertical,
  Kanban,
  Key,
  Layers,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Puzzle,
  Search,
  Server,
} from '../icons/index.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { readStoredTheme } from '../theme.js';
import { ProjectAvatar } from './project-avatar.js';

/** Which sidebar row carries the active pill: a nav row (工作台 / 定时 /
 *  the team head row on team/account — r7 01/11, r2 07e/24b/24c, r7 12/13),
 *  a 资源 subrow by href (issue #69, r7 06–10), or none (/app/project/new
 *  r2 07, and the user-menu-only routes r2 19/32). Project rows are not a
 *  named slot — the pill matches the live row by pathname (侧栏 live 收编). */
export type SidebarSelected =
  | 'board'
  | 'schedules'
  | 'team'
  | 'none'
  | '/app/resources/skills'
  | '/app/resources/mcp-servers'
  | '/app/resources/secrets'
  | '/app/resources/machines'
  | '/app/resources/providers';

/** Sidebar project row (live 收编)：id + name 投影自 live projectsQ 或
 *  fixture projectNames；undefined = 数据未决/场景缺省 → 回退 canon 单行。
 *  行 href = /app/project/<id>，头像首字母 = 名称首字符小写（todo-card 同律）。 */
export interface SidebarProject {
  id: string;
  name: string;
}

/** canon 回退行：fixture 场景缺省（capture 面只有这一个项目）与 live 查询
 *  在途共用，行形与旧钉死面字节一致。 */
const CANON_PROJECT: SidebarProject = { id: PROJECT_ID, name: PROJECT_NAME };

interface BoardSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  /** Todos waiting on the user — the 工作台 nav badge (#351: 待处理列计数). */
  attention?: number;
  /** Opens the ⌘K search panel (issue #67); the 搜索 rows are triggers. */
  onSearch?: () => void;
  /** Opens the new-task dialog (issue #389); the 新任务 row + C hotkey share
   *  this opener (AppSidebar resolves own-dialog routes vs the global one). */
  onNewTask: () => void;
  /** Render the 用量 nav row (present from the 05b capture day on). */
  usageNav?: boolean;
  /** Route carrying the selected pill: #71 named slots, #69 resource
   *  hrefs (r7 06–10), 'none' = no pill. */
  selected?: SidebarSelected;
  /** Indigo dot right of the 机器 row (r5 100/101/114/116: machine online). */
  machineOnline?: boolean;
  /** 项目组行数据位：live = projectsQ 投影（在途/空 = []，不闪 canon 幻影）；
   *  fixture = scenario projectNames 投影；缺省 = canon 单行回退。 */
  projects?: SidebarProject[];
}

/** Leaf nav rows shared by both sidebar states — each renders full in the
 *  expanded sidebar (icon + label + route) and icon-only in the rail. */
const RESOURCE_ROWS: {
  label: string;
  href: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { label: '技能', href: '/app/resources/skills', Icon: Puzzle },
  { label: 'MCP', href: '/app/resources/mcp-servers', Icon: Network },
  { label: '密钥', href: '/app/resources/secrets', Icon: Key },
  { label: '机器', href: '/app/resources/machines', Icon: Server },
  { label: '模型服务', href: '/app/resources/providers', Icon: Layers },
];

/** 用量 nav row — the live site grew it between the r7 captures and the
 *  #67 05b capture, so it renders only for scenarios that set usageNav. */
const USAGE_ROW = { label: '用量', href: '/app/usage', Icon: BarChart3 };

/** Group-collapse storage keys (#147): the 项目 key is the brand-slot twin
 *  of the observed original `tds.sidebarProjectsCollapsed` (r2 §1.1/§1.5,
 *  measured value "1", registered in the shared client-state table); the
 *  资源 twin is [推断] in the same shape. Values follow the sidebar
 *  collapse key: "1" collapsed, "0"/absent open. */
export const GROUP_STORAGE_KEYS = {
  project: 'pacman.sidebarProjectsCollapsed',
  resource: 'pacman.sidebarResourcesCollapsed',
} as const;

type GroupId = keyof typeof GROUP_STORAGE_KEYS;

function readGroupCollapsed(storage: Storage | null): Record<GroupId, boolean> {
  // #1091：null / getItem 抛 = 无记忆，两组回落展开态（首渲染路径）。
  try {
    return {
      project: storage?.getItem(GROUP_STORAGE_KEYS.project) === '1',
      resource: storage?.getItem(GROUP_STORAGE_KEYS.resource) === '1',
    };
  } catch {
    return { project: false, resource: false };
  }
}

/** Group-header aria (r6): the label tracks the collapse in both
 *  directions — 收起… open, 展开… collapsed — shared by the expanded and
 *  rail headers. */
const groupAria = (t: TFunc, label: string, collapsed: boolean) =>
  t(collapsed ? '展开{label}' : '收起{label}', { label: t(label) });

/** 行形公共件（#414）：展开态 36px 行的 pill 层 + hover/selected 梯子。
 *  ::before 层 → before: 工具类直译；行内容（>span）抬到 pill 之上。
 *  抬层排除 absolute 定位件（kbd 角标/online 点）——子代选择器的相对化
 *  会压过它们自身的 absolute（特异性 0-1-1 > 0-1-0，旧 css 同款战争的
 *  工具类版），不排掉会把角标拉回文档流。
 *  B 面 hover/selected = --sidebar-hover/--sidebar-active（neutral alpha 梯）。
 *  focus 环走 B 的 ring（全局 indigo outline 在 app.css，本族显式覆盖）。 */
const ROW_BASE =
  'relative flex w-full flex-none items-center text-left text-[13px] leading-4 text-muted-foreground no-underline outline-none before:absolute before:inset-x-2 before:inset-y-[2px] before:rounded-none before:content-[""] focus-visible:[outline:2px_solid_var(--focus-ring)] focus-visible:outline-offset-2 [&>span:not(.sidebar-kbd):not(.sidebar-online-dot)]:relative';
/** hover 与 selected 互斥挂在行上（旧 css 的 :not(--selected):hover 闸）：
   选中行悬停保持深 pill，不被 hover 梯洗浅。 */
const ROW_HOVER = 'hover:before:bg-sidebar-hover';
/** #137 常亮互斥（#949 起 utility 承载，旧 overlays.css 的
   :root[data-search-open] 覆写等值迁移）：⌘K 面板开着时它是全局唯一亮
   focus 面——页层选中 pill 在 scrim 下卸底、墨色降回二级，面板关闭根
   标记清除即恢复。变体钉 html[data-search-open] 祖先（特异性压过行自身
   的 selected 档），标记的写入方 = overlays/search-panel 的
   useSingleLitSurface。 */
const SEARCH_OPEN_DIM =
  '[html[data-search-open]_&]:before:bg-transparent [html[data-search-open]_&]:text-(--text-secondary)';
/** #953 终账裁决（#908 comment-6001887439 观察 2）：旧 text-foreground 档与
   ROW_BASE 的 text-muted-foreground 在无 tailwind-merge 的模板串里共存，编译
   序恒让 muted 胜——选中行墨自 #414 以来即 muted，选择信号由 pill 底承担
   （docs/verify/943/contrast-943.md 实测；#953 摘除死档前后双模复测逐字节
   一致，docs/verify/953/）。--selected 别名状态类（CSS 零规则、零 spec
   引用——spec 一律钉 aria-current="page"）已随 #1036 dead-class 终摘。 */
const ROW_SELECTED = `before:bg-sidebar-active ${SEARCH_OPEN_DIM}`;

/** 行钮中和件（#943 裸控件收编 Button）：行的视觉盒 = before: pill 层，
 *  Button 自带的件配方在行面上逐位归零——ghost hover/aria-expanded 的整盒
 *  涂底会与 pill 叠色（hover:bg-transparent 双侧），size 档的 gap/右内距
 *  会推挤图标与 truncate 位（gap-0 pr-0），font-medium/rounded-lg/1px 透明
 *  边对 r7 实测行几何（pill x8、图标 x19、方角）都是漂移源，press 位移按
 *  XMON-69 例外律同族禁掉（fab 钮同款 active:not-aria-[haspopup] 形态，
 *  变体链一致才吃得掉件基类）。focus 环件基类与行族同值（#388 canon），
 *  不重复写。 */
const ROW_BTN =
  'justify-start gap-0 border-none pr-0 font-normal hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent active:not-aria-[haspopup]:translate-y-0';

function GroupHeader({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      className={`sidebar-group group ${ROW_BASE} ${ROW_HOVER} ${ROW_BTN} h-9 cursor-pointer bg-transparent pl-[19px] aria-expanded:bg-transparent aria-expanded:text-muted-foreground ${
        collapsed ? 'sidebar-group--collapsed' : ''
      }`}
      aria-label={groupAria(t, label, collapsed)}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <span className="sidebar-group-chevron flex-none text-muted-foreground transition-transform duration-150 group-[.sidebar-group--collapsed]:[transform:rotate(-90deg)]">
        <ChevronDown />
      </span>
      <span className="ml-[11px] text-[13px] leading-4 text-muted-foreground">{t(label)}</span>
    </Button>
  );
}

/** Rail twin of GroupHeader (#147): same collapse state, same aria. Hiding
 *  the rail member rows while collapsed is [推断] — the captured original
 *  rail (r7 03) only ever shows the open-group state. */
function RailGroupChevron({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      className={`rail-row rail-group group relative h-8 w-10 flex-none cursor-pointer border-none bg-transparent text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-muted-foreground active:not-aria-[haspopup]:translate-y-0 ${
        collapsed ? 'rail-group--collapsed' : ''
      }`}
      aria-label={groupAria(t, label, collapsed)}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <span className="transition-transform duration-150 group-[.rail-group--collapsed]:[transform:rotate(-90deg)]">
        <ChevronDown />
      </span>
    </Button>
  );
}

/** Rail 行公共件：32px 轨道行 + 方角 hover 面（inset 8/4，V2 骨架）。 */
const RAIL_ROW =
  'rail-row relative flex h-8 w-10 flex-none items-center justify-center text-muted-foreground no-underline outline-none before:absolute before:inset-x-2 before:inset-y-1 before:rounded-none before:content-[""] hover:before:bg-sidebar-hover focus-visible:[outline:2px_solid_var(--focus-ring)] focus-visible:outline-offset-2 [&>svg]:relative [&>.project-avatar]:relative';
const RAIL_SELECTED = `rail-row--selected text-foreground before:bg-sidebar-active ${SEARCH_OPEN_DIM}`;
/** Rail 行钮中和件（#943）：与 ROW_BTN 同理——rail 钮的视觉盒同样是
 *  before: pill，件配方的涂底/圆角/边框/press 位移归零。 */
const RAIL_BTN =
  'cursor-pointer border-none bg-transparent hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent active:not-aria-[haspopup]:translate-y-0';

/** 用户菜单 popover（#127：两侧栏 avatar chip 共用一开合态，分支各 render
 *  自己的 Popover Root——同一时刻只挂载一支。#854 收编
 *  components/ui/popover（Base UI Popover + Positioner）：开合 / Esc /
 *  外点关 / 焦点归还全归原语；UserMenu（含 外观 分段与导航行）原样做面板
 *  内容。定位正本迁 Positioner 参数（side=top align=start alignOffset=8
 *  sideOffset=4 = 原 left:8 底边贴触发行顶 + 4px 家族基线间距，#163/#388/
 *  #610 锚定律）；V2 进出场（scale .98 + fade 100ms）由原语 base 自带。
 *
 *  住模块层，不嵌在 BoardSidebar 里：嵌进去每次父 render 都换函数身份，
 *  React 会把 Popover 子树整个卸载重挂——受控 open 被重挂时的关闭回调
 *  打回 false，触发钮就点不开了。 */
function UserMenuPopover({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  /** 开合双向都归调用面（原语 onOpenChange 直通）：只接关闭会让触发钮点不
   *  开——Base UI Trigger 不再自带 onClick，开面必须由这里落 open=true。 */
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
}) {
  const { t } = useI18n();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="top"
        align="start"
        alignOffset={8}
        sideOffset={4}
        aria-label={t('用户菜单')}
        className="block rounded-none border-none bg-transparent p-0 shadow-none"
      >
        <UserMenu floating theme={readStoredTheme(safeLocalStorage())} />
      </PopoverContent>
    </Popover>
  );
}

export function BoardSidebar({
  collapsed = false,
  onToggle,
  attention = 0,
  onSearch,
  onNewTask,
  usageNav = false,
  selected = 'board',
  machineOnline = false,
  projects,
}: BoardSidebarProps) {
  const { t } = useI18n();
  // XMON-105: user chip identity single source (live = /api/user/me).
  const { user } = useLiveData();
  // Links carry the live query string across hops so the fixture scenario
  // survives client-side navigation (todo-card / page-back convention).
  const { search, pathname } = useLocation();
  // 项目行 = 调用面投影（app-sidebar：live projectsQ / fixture projectNames）；
  // 缺省回退 canon 单行（capture 面）。pill 不再吃 'project' 具名槽——按当前
  // 路径匹配行 href，多项目下选中的是真实所在行。
  const projectRows = useMemo(() => projects ?? [CANON_PROJECT], [projects]);
  const resourceRows = usageNav
    ? [...RESOURCE_ROWS.slice(0, 4), USAGE_ROW, ...RESOURCE_ROWS.slice(4)]
    : RESOURCE_ROWS;
  // #127: the avatar chips toggle the user-menu popover — click catcher +
  // Esc close it like the rest of the anchored-overlay family; the stored
  // theme at open time seeds the 外观 segment (#122).
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // #147: the 项目 / 资源 group collapses are real state persisted beside
  // the sidebar collapse key; both sidebar shapes (rail + expanded) read
  // the same pair so a collapse survives the rail toggle and the reload.
  const [groupCollapsed, setGroupCollapsed] = useState(() =>
    readGroupCollapsed(safeLocalStorage()),
  );
  const toggleGroup = useCallback((id: GroupId) => {
    setGroupCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      safeSetItem(GROUP_STORAGE_KEYS[id], next[id] ? '1' : '0');
      return next;
    });
  }, []);
  const toggleProjectGroup = useCallback(() => toggleGroup('project'), [toggleGroup]);
  const toggleResourceGroup = useCallback(() => toggleGroup('resource'), [toggleGroup]);
  if (collapsed) {
    return (
      <aside className="board-sidebar board-sidebar--collapsed relative z-(--z-docked) flex w-10 flex-none flex-col border-r border-[var(--border)] bg-background">
        {/* 展开钮的 hover 面是它骑 seam 行的本分（见展开态注释）；按压面与
            展开态折叠钮同律禁掉——同一个控件折叠前后的两张脸，按下去都只
            该是图标本身（XMON-69，律在 motion.css 的 sidebar toggles 段）。 */}
        <Button
          variant="ghost"
          className="rail-toggle h-11 w-10 flex-none cursor-pointer border-0 border-b border-[var(--border)] bg-transparent text-muted-foreground hover:bg-sidebar-hover hover:text-muted-foreground dark:hover:bg-sidebar-hover dark:hover:text-muted-foreground active:not-aria-[haspopup]:translate-y-0"
          aria-label={t('展开侧边栏')}
          onClick={onToggle}
        >
          <PanelLeftOpen />
        </Button>
        <nav className="flex flex-none flex-col pt-1">
          {/* #468: rail 态没有常亮 badge 位，悬浮浮出 ⌘K 提示（展开态行的
              sidebar-kbd 角标见下）。#983 判决（#1004 施工段执行）：kbd-hint
              退役回消费点组合 = registry Tooltip + Kbd（side=right 对应原
              placement=right；Kbd 的 in-tooltip 反色变体由 registry 自带）。 */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  className={`${RAIL_ROW} ${RAIL_BTN}`}
                  aria-label={t('搜索')}
                  onClick={onSearch}
                >
                  <Search />
                </Button>
              }
            />
            <TooltipContent side="right" sideOffset={8}>
              <Kbd>⌘K</Kbd>
            </TooltipContent>
          </Tooltip>
          <Link
            className={`${RAIL_ROW} ${selected === 'board' ? RAIL_SELECTED : ''}`}
            to={{ pathname: '/app', search }}
            aria-current={selected === 'board' ? 'page' : undefined}
            aria-label={t('工作台')}
          >
            <Kanban />
          </Link>
          <Link
            className={`${RAIL_ROW} ${selected === 'schedules' ? RAIL_SELECTED : ''}`}
            to={{ pathname: '/app/schedules', search }}
            aria-current={selected === 'schedules' ? 'page' : undefined}
            aria-label={t('定时')}
          >
            <Clock />
          </Link>
          <RailGroupChevron
            label="项目"
            collapsed={groupCollapsed.project}
            onToggle={toggleProjectGroup}
          />
          {!groupCollapsed.project &&
            projectRows.map((row) => {
              const href = `/app/project/${row.id}`;
              if (isDeleted(row.id)) return null;
              return (
                <Link
                  key={row.id}
                  className={`${RAIL_ROW} ${pathname === href ? RAIL_SELECTED : ''}`}
                  to={{ pathname: href, search }}
                  aria-current={pathname === href ? 'page' : undefined}
                  aria-label={row.name}
                >
                  <ProjectAvatar char={row.name.charAt(0).toLowerCase()} />
                </Link>
              );
            })}
          <RailGroupChevron
            label="资源"
            collapsed={groupCollapsed.resource}
            onToggle={toggleResourceGroup}
          />
          {!groupCollapsed.resource &&
            resourceRows.map(({ label, href, Icon }) => (
              <Link
                key={href}
                className={`${RAIL_ROW} ${selected === href ? RAIL_SELECTED : ''}`}
                to={{ pathname: href, search }}
                aria-current={selected === href ? 'page' : undefined}
                aria-label={t(label)}
              >
                <Icon />
              </Link>
            ))}
        </nav>
        <div className="flex-1" />
        <UserMenuPopover
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          trigger={
            <Button
              variant="ghost"
              className="rail-user mb-[11px] h-[38px] w-10 flex-none cursor-pointer border-none bg-transparent outline-none hover:bg-sidebar-hover hover:text-muted-foreground dark:hover:bg-sidebar-hover aria-expanded:bg-transparent [&_img]:block [&_img]:size-6 [&_img]:rounded-full"
              aria-label={user.displayName}
            >
              <SeededAvatar
                className="size-6"
                name={user.displayName}
                src={user.avatarUrl}
                fallback="/avatar-user.png"
              />
            </Button>
          }
        />
      </aside>
    );
  }

  return (
    <aside className="board-sidebar relative z-(--z-docked) flex w-60 flex-none flex-col overflow-hidden border-r border-[var(--border)] bg-background">
      {/* 头部几何与选中态无关（dogfood 2026-09-30）：--active 只换底色，不搬
          内容。pill 的 mx-2 内缩 8px，pl 补 11 让图标仍落在 x19——与非选中态
          pl-[19px] 同一条线；名字间距恒 11px。r7 12 探针钉的是 pill 盒子
          （x8 y6 w223 h32，sidebar-seam.spec.ts），盒子不动，盒内内容也不该
          动——否则点品牌进 /app/team 时图标右移 3px、名字左移 2px，读作收紧。
          右端同律（XMON-69）：折叠钮是 ml-auto，x 由行的右边界减自身 margin
          定；pill 内缩 8px 后钮若不把这 8px 还回来，就往左走 8px——展开态折叠
          钮是全头部最右的墨，那一跳读作图标回缩。故选中态 mr 取 6（8+6=14，
          与非选中态 mr-[14px] 同一条右边界线）。 */}
      <div
        data-testid="team-row"
        className={`sidebar-team-row flex flex-none items-center text-foreground ${
          selected === 'team'
            ? 'sidebar-team-row--active mx-2 mt-1.5 mb-[5px] h-8 rounded-none bg-sidebar-active pl-[11px]'
            : 'h-[43px] pl-[19px]'
        }`}
      >
        <span className="flex size-4 flex-none items-center justify-center">
          {/* 品牌槽（#390）：mark = logo.svg 真资产 alpha mask，随
              currentColor 取行墨——工具类表达不了 mask url，inline 承载 */}
          <span
            data-testid="brand-mark"
            className="sidebar-brand-mark block size-4"
            aria-hidden="true"
            style={{
              backgroundColor: 'currentColor',
              WebkitMask: 'url("/logo.svg") center / 125% no-repeat',
              mask: 'url("/logo.svg") center / 125% no-repeat',
            }}
          />
        </span>
        {/* r2 §1.1: clicking the head name navigates to /app/team。
            aria-current = team 页选中态的语义载体（#910 裁定 3：状态类
            断言归行为、载体改 aria-*；sidebar-team-row--active 类名按
            §5.0 别名残留律原位保留，spec 不再钉它）。 */}
        <Link
          className="sidebar-team-name relative top-px ml-[11px] truncate text-sm leading-6 text-foreground no-underline"
          to={{ pathname: '/app/team', search }}
          aria-current={selected === 'team' ? 'page' : undefined}
        >
          {BRAND.manifestName}
        </Link>
        {/* 展开态折叠钮不给自己加面（dogfood 2026-09-30）：无 hover 底色、
            无阴影。它坐在头部行自己的底上，而那层底（选中 pill / 行本身）
            已经是分离信号；再叠 5% 灰底（--sidebar-hover 浅色 =
            rgb(28 25 23 / 0.05)）在行内的深色 pill 上读成阴影。focus 环保留
            ——键盘模态仍需可见（app.css 全局 :focus-visible 律）。
            rail 顶部的展开钮不在此列：它骑在自己的 seam 行上，hover 面照旧。
            按压面两钮一并禁（XMON-69）：motion.css 的全局 button:active 降
            到 .85，落在 14px 裸图标上读作图标自己缩了一下；律在 motion.css
            的 sidebar toggles 段，不在这里。 */}
        <Button
          variant="ghost"
          size="icon-sm"
          className={`sidebar-team-collapse ml-auto size-7 cursor-pointer border-none bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent active:not-aria-[haspopup]:translate-y-0 ${
            selected === 'team' ? 'mr-[6px]' : 'mr-[14px]'
          }`}
          aria-label={t('收起侧边栏')}
          onClick={onToggle}
        >
          <PanelLeftClose />
        </Button>
      </div>

      <nav className="flex min-h-0 flex-[0_1_auto] flex-col overflow-y-auto border-t border-[var(--border)] pt-[9.5px]">
        <Button
          variant="ghost"
          className={`sidebar-row ${ROW_BASE} ${ROW_HOVER} ${ROW_BTN} h-9 cursor-pointer pl-[18px]`}
          onClick={onSearch}
        >
          <span className="flex size-4 flex-none items-center justify-center">
            <Search />
          </span>
          <span className="ml-3 truncate">{t('搜索')}</span>
          {/* #983/#1004：手写 kbd 角标退役回 registry Kbd（保留 sidebar-kbd
              别名类作 e2e 载体与 ROW_BASE 抬层选择器钩）。 */}
          <Kbd className="sidebar-kbd absolute top-1/2 right-[17px] -translate-y-1/2">⌘K</Kbd>
        </Button>
        {/* #389: 新任务行动作行——点击与全局 C 热键同一 opener；行序钉在
            搜索 之后（sidebar-visual 的 .sidebar-kbd 单数探针吃首枚 ⌘K）。
            #445: sidebar-new-task = 可钉别名（顶栏「+ 任务」撤除后，本行是
            新建入口的唯一点击面——e2e/integration 的 opener 与焦点回落断言
            全部指这里）。 */}
        <Button
          variant="ghost"
          className={`sidebar-row sidebar-new-task ${ROW_BASE} ${ROW_HOVER} ${ROW_BTN} h-9 cursor-pointer pl-[18px]`}
          onClick={onNewTask}
        >
          <span className="flex size-4 flex-none items-center justify-center">
            <Plus />
          </span>
          <span className="ml-3 truncate">{t('新任务')}</span>
          <Kbd className="sidebar-kbd absolute top-1/2 right-[17px] -translate-y-1/2">C</Kbd>
        </Button>
        <Link
          className={`sidebar-row ${ROW_BASE} h-9 pl-[18px] ${selected === 'board' ? `sidebar-row--selected ${ROW_SELECTED}` : ROW_HOVER}`}
          to={{ pathname: '/app', search }}
          aria-current={selected === 'board' ? 'page' : undefined}
        >
          <span className="flex size-4 flex-none items-center justify-center">
            <Kanban />
          </span>
          <span className="ml-3 truncate">{t('工作台')}</span>
          {attention > 0 && (
            <span className="mr-[18px] ml-auto h-4 min-w-4 rounded-full bg-(--badge-attention) px-1 text-center text-[10px] leading-4 font-semibold text-(--badge-attention-fg)">
              {attention}
            </span>
          )}
        </Link>
        <Link
          className={`sidebar-row ${ROW_BASE} h-9 pl-[18px] ${selected === 'schedules' ? `sidebar-row--selected ${ROW_SELECTED}` : ROW_HOVER}`}
          to={{ pathname: '/app/schedules', search }}
          aria-current={selected === 'schedules' ? 'page' : undefined}
        >
          <span className="flex size-4 flex-none items-center justify-center">
            <Clock />
          </span>
          <span className="ml-3 truncate">{t('定时')}</span>
        </Link>

        <GroupHeader
          label="项目"
          collapsed={groupCollapsed.project}
          onToggle={toggleProjectGroup}
        />
        {/* r2 §1.1: the fold hides the group's sub-rows, header stays */}
        {!groupCollapsed.project && (
          <>
            <Link
              className={`sidebar-subrow ${ROW_BASE} ${ROW_HOVER} h-9 pl-[34px]`}
              to={{ pathname: '/app/project/new', search }}
            >
              <span className="flex size-4 flex-none items-center justify-center">
                <Plus />
              </span>
              <span className="ml-3 truncate">{t('新建项目')}</span>
            </Link>
            {/* #207 + 侧栏 live 收编:项目行 = 调用面投影多行渲染,行随
                fixture 删除覆面隐去(#66 deletions 同律);pill 按路径匹配。 */}
            {projectRows.map((row) => {
              const href = `/app/project/${row.id}`;
              if (isDeleted(row.id)) return null;
              return (
                <Link
                  key={row.id}
                  className={`sidebar-subrow ${ROW_BASE} h-9 pl-[34px] ${pathname === href ? `sidebar-subrow--selected ${ROW_SELECTED}` : ROW_HOVER}`}
                  to={{ pathname: href, search }}
                  aria-current={pathname === href ? 'page' : undefined}
                >
                  <ProjectAvatar char={row.name.charAt(0).toLowerCase()} />
                  <span className="ml-3 truncate">{row.name}</span>
                </Link>
              );
            })}
          </>
        )}

        <GroupHeader
          label="资源"
          collapsed={groupCollapsed.resource}
          onToggle={toggleResourceGroup}
        />
        {!groupCollapsed.resource &&
          resourceRows.map(({ label, href, Icon }) => (
            <Link
              key={href}
              className={`sidebar-subrow ${ROW_BASE} h-9 pl-[34px] ${selected === href ? `sidebar-subrow--selected ${ROW_SELECTED}` : ROW_HOVER}`}
              to={{ pathname: href, search }}
              aria-current={selected === href ? 'page' : undefined}
            >
              <span className="flex size-4 flex-none items-center justify-center">
                <Icon />
              </span>
              <span className="ml-3 truncate">{t(label)}</span>
              {machineOnline && label === '机器' && (
                <span
                  data-testid="online-dot"
                  className="sidebar-online-dot absolute top-1/2 right-4 size-[5px] -translate-y-1/2 rounded-full bg-primary"
                />
              )}
            </Link>
          ))}
      </nav>

      <div className="flex-1" />

      <UserMenuPopover
        open={userMenuOpen}
        onOpenChange={setUserMenuOpen}
        trigger={
          <Button
            variant="ghost"
            className="sidebar-user h-11 flex-none cursor-pointer justify-start gap-0 border-0 border-t border-[var(--border)] bg-transparent px-2 font-normal hover:bg-sidebar-hover hover:text-muted-foreground dark:hover:bg-sidebar-hover aria-expanded:bg-transparent aria-expanded:text-muted-foreground outline-none [&_img]:block [&_img]:size-6 [&_img]:rounded-full"
            aria-label={user.displayName}
          >
            <SeededAvatar
              className="size-6"
              name={user.displayName}
              src={user.avatarUrl}
              fallback="/avatar-user.png"
            />
            <span className="relative -top-px ml-[9px] text-sm leading-[14px] whitespace-nowrap text-muted-foreground">
              {user.displayName}
            </span>
            <span className="ml-auto flex size-6 items-center justify-center text-muted-foreground">
              <EllipsisVertical />
            </span>
          </Button>
        }
      />
    </aside>
  );
}
