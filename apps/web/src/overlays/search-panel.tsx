// ⌘K search panel (issue #67, r7 05 + the 05b supplementary results
// capture): a fixed 520×440 panel centered on the viewport over a 60%
// black scrim. Empty query = the 前往 nav group (任务 row first and
// selected, then the eight nav routes, r7 05); a query folds the fixture
// todos into two-line 任务 result rows (title + project sub-line, right
// meta = relative time + phase chip pill, 05b) plus 项目/Agents groups
// for name matches; no hit = the 没有与"…"匹配的结果 line (r2 §8.4 04b,
// curly quotes verbatim). Geometry measured off the r7 bitmaps: input row
// 40 + 1px divider, group label block 31, rows 40 inset 8 with radius 8.
// #159: every row is a live SPA hop (todo→详情, 项目→项目页, agent→团队,
// 前往→对应路由) carrying the current ?search= along (#121 convention) and
// closing the panel. The highlight is hover-followed: no row is lit at
// rest, the hover pill lights the row under the mouse, ↑↓ moves a keyboard
// cursor (while it lives the hover pill stands down so exactly one row
// stays lit; Enter hops to it), and any real pointer movement hands the
// highlight back to the mouse.
//
// #949: overlays.css 清零——面板/行/输入行皮肤全部等值迁 utility（r7 实测
// 几何逐值保留）；行钮收编 components/ui Button（ghost + ROW 中和串，#908
// 裁决 3 七通道）；行 chip 按 spec/22 §5.1 C2 换 StatusChip size="sm"
// （mini 14px → sm 16px 是 §5.2 正典增长）；#159 的 hover 让位律从
// data-kbd CSS 覆写改为渲染期条件类（cursor 翻转本就触发重渲染，同帧
// 换类，机制时序不变）；选中态载体 = data-selected（#910 裁定 3），行族
// 载体 = data-row-kind（todo 行计数/定位的语义盲区继任者）。

import type { SearchResponse } from '@pacman/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAgentAvatarUrlById } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_FACE,
  DialogShell,
  PICKER_ROW_SELECTED,
  VIEWPORT_POP_ANIM,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { PROJECT_ID, PROJECT_INITIAL, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { AgentRef, FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  Clock,
  FileCheck,
  Kanban,
  Key,
  Layers,
  Network,
  Puzzle,
  Search,
  Server,
  Users,
} from '../icons/index.js';
import { PHASE_UI } from '../phase.js';

/** 前往 group rows, top to bottom. Canon is the r7 05 bitmap, not r2
 *  §8.4: the live set dropped 帐号/API 密钥 (r6) and grew the selected
 *  任务 row — both visible in 05 and in the 05b recapture. #159: each row
 *  hops to its route — the sidebar RESOURCE_ROWS twins verbatim; 任务 and
 *  工作台 both land on /app (the clone has no standalone tasks view,
 *  [推断] like the panel's own nav set). */
const NAV_ROWS = [
  { label: '任务', Icon: FileCheck, href: '/app' },
  { label: '工作台', Icon: Kanban, href: '/app' },
  { label: '定时', Icon: Clock, href: '/app/schedules' },
  { label: '团队', Icon: Users, href: '/app/team' },
  { label: '技能', Icon: Puzzle, href: '/app/resources/skills' },
  { label: 'MCP', Icon: Network, href: '/app/resources/mcp-servers' },
  { label: '密钥', Icon: Key, href: '/app/resources/secrets' },
  { label: '机器', Icon: Server, href: '/app/resources/machines' },
  { label: '模型服务', Icon: Layers, href: '/app/resources/providers' },
];

/** 行钮皮肤（#949 per-face 清零；Paper：40px 行 / 8px 圆角 / 列表容器 8px
 *  侧距 / 六档字号 / 4px 网格）。Button ghost 件配方按
 *  #908 裁决 3 七通道中和：hover 涂底换成选中行白卡（PICKER_ROW_SELECTED，
 *  键盘 cursor 与 hover 共面）、
 *  hover 墨色钉住行墨、press 位移禁掉（XMON-69 例外律变体链）、1px 透明边
 *  归零（border-none，r7 行盒）、font-medium 归 normal、justify/gap 随档位。
 *  focus 环 = 件基类 #388 canon，与旧全局环同值，不重复写。 */
const ROW_BASE =
  'flex h-10 w-full cursor-pointer items-center justify-start gap-4 whitespace-normal rounded-md border-none bg-transparent pl-4 pr-2 text-left text-ui font-normal text-content-secondary hover:text-content-secondary active:not-aria-[haspopup]:translate-y-0 [&>svg]:flex-none [&>svg]:text-content-tertiary';

/** 结果行（任务/项目/agent）差额：icon tile 列距 12px、左垫 8px。 */
const ROW_RESULT = 'gap-3 pl-2';

/** #159 hover 跟随的三态行底（渲染期条件类，旧 data-kbd CSS 覆写的等值
 *  机制）：静息 = 透明；鼠标态 = hover 亮白卡 + 发丝环；键盘 cursor 活着 =
 *  非选中行的 hover 让位（唯一亮面律），选中行静息 + hover 同值恒亮。
 *  dark: 双写中和 ghost 件的 dark:hover:bg-muted/50。 */
function rowLitClasses(selected: boolean, kbd: boolean): string {
  if (selected) return PICKER_ROW_SELECTED;
  if (kbd) return 'hover:bg-transparent dark:hover:bg-transparent';
  return 'hover:bg-card hover:shadow-xs hover:ring-1 hover:ring-border dark:hover:bg-card';
}

/** 28px icon tile（结果行首列）：--row-icon-bg 底 + 8px 圆角；项目/agent
 *  档在消费点 cn 覆写。 */
const ROW_ICON =
  'flex size-7 flex-none items-center justify-center rounded-md bg-(--row-icon-bg) text-content-tertiary';

interface SearchPanelProps {
  fixture: FixtureSet;
  query: string;
  onQuery: (query: string) => void;
  /** #73 retained-mount open flag. */
  open: boolean;
  onClose: () => void;
  /** W4 #286：live 面服务端搜索结果（调用方经 useSearchResults 注入）。
   *  提供且 q 非空 = 服务端结果集（GET /api/search，02 §6.3 [设计]）；缺省 =
   *  客户端过滤（fixture 面 DOM 零改动）。 */
  server?: SearchResponse;
}

/** W4 #286 行面结构化：fixture TodoRecord/AgentRef 与服务端 search 行共形
 * （面板行渲染消费的最小字段集）。 */
interface TodoRowItem {
  id: string;
  seqNum: number;
  title: string;
  phase: TodoRecord['phase'];
  phaseAt: number;
  /** fixture 行的 projectNames 查表键；服务端行缺省（projectName 自带）。 */
  projectId?: string;
  /** 服务端 search 行自带（W4 #286）；fixture 行经 projectNames 查表。 */
  projectName?: string;
}
interface AgentRowItem {
  id: string;
  displayName: string;
  /** XMON-105: explicit avatar override; the live search envelope carries
   *  no avatarUrl, so live rows join it from the members read-side (same
   *  identity the team page renders). */
  avatarUrl?: string | null;
}
interface ProjectRowItem {
  id: string;
  name: string;
}

function TodoRow({
  todo,
  now,
  selected,
  kbd,
  index,
  onActivate,
  projectName,
}: {
  todo: TodoRowItem;
  now: number;
  /** #159: lit only while the ↑↓ keyboard cursor sits here — the mouse
   *  hover pill is CSS (:hover), and at rest no row is selected. */
  selected: boolean;
  /** 键盘 cursor 活着（hover pill 让位态，#159）。 */
  kbd: boolean;
  /** Flat row position in the list (keyboard cursor + scroll-into-view). */
  index: number;
  onActivate: () => void;
  /** M5 live：真项目名（fixture.projectNames 位 / 服务端行自带）；缺省 = capture canon。 */
  projectName?: string;
}) {
  const { t } = useI18n();
  const ui = PHASE_UI[todo.phase];
  return (
    <Button
      variant="ghost"
      data-row-kind="todo"
      data-row-index={index}
      data-selected={selected ? '' : undefined}
      onClick={onActivate}
      className={`${ROW_BASE} ${ROW_RESULT} ${rowLitClasses(selected, kbd)}`}
    >
      <span className={ROW_ICON}>
        <FileCheck width={16} height={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate leading-5 text-foreground">
          #{todo.seqNum} {todo.title}
        </span>
        <span className="truncate text-meta text-content-tertiary">
          {projectName ?? PROJECT_NAME}
        </span>
      </span>
      {/* 时间列墨 = --text-tertiary（#949 better-colors 实测换槽：
          --text-dim × --popover-bg 亮模 2.89 < 槽地板 3，#908 裁决 2
          换消费面引用，token 值不动） */}
      <span className="flex-none text-meta text-content-tertiary">
        {relativeTime(todo.phaseAt, now, t)}
      </span>
      {/* #853→#949：行 chip = StatusChip（五态 token 对皮肤在件内）；#983
          判决：sm 几何档退役，收敛 registry Badge h-5 默认——行内只剩定位
          职责（右贴 + 不挤压）。 */}
      <StatusChip tone={ui.tone} className="ml-auto flex-none">
        {t(ui.chip)}
      </StatusChip>
    </Button>
  );
}

/** #137 常亮互斥: one lit focus surface globally. While any search panel
 *  is open, `data-search-open` on the root dims the page-layer 常亮
 *  selected pills（sidebar.tsx 的 [html[data-search-open]] utility 变体消费
 *  本标记，#949 起规则不住 CSS 文件）; the panel's own selected row stays
 *  the single lit surface. Module-level count so a route-owned panel and
 *  the shell-owned panel (app-sidebar) never clobber each other's marker. */
let openPanelCount = 0;
function useSingleLitSurface(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openPanelCount += 1;
    document.documentElement.dataset.searchOpen = '';
    return () => {
      openPanelCount -= 1;
      if (openPanelCount === 0) delete document.documentElement.dataset.searchOpen;
    };
  }, [open]);
}

export function SearchPanel({ fixture, query, onQuery, open, onClose, server }: SearchPanelProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  // #121 convention: SPA hops carry the live query string so the fixture
  // scenario rides along (same as the sidebar / todo-card links).
  const { search } = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  // #159 hover 跟随: the ↑↓ keyboard cursor — the only JS-owned highlight.
  // null = at-rest / mouse-owned (rows light via the hover pill utilities,
  // zero extra re-renders); a real pointer movement releases the cursor
  // (让位).
  const [cursor, setCursor] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // #137 two-path focus. The ref callback below focuses at the real DOM
  // attach — the mount path, and the one that runs when ⌘K opens onto a
  // panel whose input does not exist yet. This effect is the reopen path:
  // the retained panel never detaches its input (mid-exit ⌘K), so the ref
  // callback does not re-fire and the open flip would leave the caret
  // nowhere. Both paths must stay: dropping either regresses ⌘K focus.
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);
  const attachInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (node && openRef.current) node.focus({ preventScroll: true });
  }, []);
  useSingleLitSurface(open);
  const q = query.trim().toLowerCase();
  // W4 #286：live 面切服务端结果集（server 注入 + q 非空）；fixture
  // 面保持客户端过滤（渲染 DOM 零改动）。
  const useServer = server !== undefined && q !== '';
  const todos: TodoRowItem[] = useServer
    ? server.todos
    : q === ''
      ? []
      : fixture.todos.filter((t) => t.title.toLowerCase().includes(q));
  // XMON-105: live agent rows join avatarUrl from the members read-side
  // (the /api/search envelope carries no avatar field).
  const agentAvatarById = useAgentAvatarUrlById();
  const agents: AgentRowItem[] = useServer
    ? server.agents.map((a) => ({ ...a, avatarUrl: agentAvatarById.get(a.id) ?? null }))
    : q === ''
      ? []
      : [...new Set(fixture.todos.map((t) => t.agent))]
          .filter((agent): agent is AgentRef => agent != null)
          .filter((agent) => agent.displayName.toLowerCase().includes(q));
  // M5 live：项目 chip/命中 = 真项目名（首位；多项目面归后票）；fixture 面
  // 保持 capture canon 常量。
  const projectName = fixture.projectNames
    ? (Object.values(fixture.projectNames)[0] ?? PROJECT_NAME)
    : PROJECT_NAME;
  const projects: ProjectRowItem[] = useServer
    ? server.projects
    : q !== '' && projectName.toLowerCase().includes(q)
      ? [
          {
            id: fixture.projectNames
              ? (Object.keys(fixture.projectNames)[0] ?? PROJECT_ID)
              : PROJECT_ID,
            name: projectName,
          },
        ]
      : [];
  const hitCount = todos.length + agents.length + projects.length;

  // Flat activation targets in render order — the ↑↓ cursor's index space
  // (nav rows on the empty query; todos → 项目 rows → agents on a hit list).
  const targets =
    q === ''
      ? NAV_ROWS.map((row) => row.href)
      : [
          ...todos.map((todo) => `/app/todo/${todo.id}`),
          ...projects.map((project) => `/app/project/${project.id}`),
          ...agents.map(() => '/app/team'),
        ];

  const go = (pathname: string) => {
    navigate({ pathname, search });
    onClose();
  };
  const releaseCursor = () => setCursor(null);

  // A query or open flip rebuilds the flat index space — the cursor drops
  // and the panel returns to its at-rest state: no fixed lit row (#159).
  useEffect(() => {
    setCursor(null);
  }, [query, open]);

  // The keyboard cursor stays in view inside the scrollable list.
  useEffect(() => {
    if (cursor == null) return;
    listRef.current
      ?.querySelector(`[data-row-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const kbd = cursor != null;

  return (
    // #453：视口根面走 DialogShell 的 `viewportRoot` 变体——面板自带 fixed
    // 几何（520×440 / top 146 / 居中负边距，r7 §3.5 实测），scrim 归壳的
    // Backdrop 位（皮肤经 backdropClassName 给），模态机制（焦点圈定 /
    // 滚动锁 / Esc 层栈）由壳承载。z 档 = #688 阶梯的 --z-modal（背板由壳
    // 减一 = --z-modal-scrim 同值；面板与 scrim 的 z utility 是容器
    // stacking context 万一退化时仍压得住的兜底，与适配层入参读同一条
    // 阶梯，不存在第二套真值）。
    // #844 二段关闭闪：进场走 VIEWPORT_POP_ANIM keyframe（group/dlgvp 读壳
    // Popup 开态），退场走指定式 transition（opacity + scale 100ms，
    // group-data-closed/dlgvp 终态按住到卸载窗结束——一次性 exit keyframe
    // 会在壳 150ms visibility 桥里先播完回弹，闪几帧全不透明）；origin 顶
    // 心（r7 家族律），reduced-motion 关过渡（D4 各文件自理）。
    <DialogShell
      open={open}
      onClose={onClose}
      viewportRoot
      // 背板是 Base UI Backdrop（自带 data-open/data-closed）→ 自变体淡入淡出，
      // 与 .dlg 默认背板同档（duration-200 fade）。壳已给 fixed inset-0，
      // 这里只带 scrim 皮肤 + z 兜底（--overlay-scrim = 60% 黑，r7 canon）。
      backdropClassName="z-(--z-modal-scrim) bg-(--overlay-scrim) duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      zIndex="var(--z-modal)"
    >
      <div
        className={`fixed top-36.5 left-1/2 z-(--z-modal) flex h-110 w-130 -ml-65 flex-col overflow-hidden ${DIALOG_FACE} origin-top transition-[opacity,scale] group-data-closed/dlgvp:scale-[0.98] group-data-closed/dlgvp:opacity-0 motion-reduce:transition-none ${VIEWPORT_POP_ANIM}`}
        role="dialog"
        aria-label={t('搜索')}
        // entering the panel (incl. a synthetic pointer jump straight onto
        // a row) hands the highlight to the mouse as well
        onMouseEnter={releaseCursor}
        onMouseMove={(event) => {
          // 鼠标一动让位: only a *real* move (coordinate delta) drops the
          // keyboard cursor — a scroll-jitter re-fire under a resting
          // pointer keeps it.
          const prev = pointerRef.current;
          pointerRef.current = { x: event.clientX, y: event.clientY };
          if (prev != null && (prev.x !== event.clientX || prev.y !== event.clientY))
            setCursor(null);
        }}
      >
        <div className="flex h-10 flex-none items-center gap-2 border-b border-border px-4 text-content-tertiary">
          <Search width={14} height={14} />
          {/* A5 收编：palette 裸输入形态（r7 05 canon）；e2e search-focus
              钉面板 scope 的 textbox 语义载体——Input 渲染的 input 元素
              天然满足，ref 经 React 19 ref-as-prop 透传 */}
          <Input
            // the live panel opens focused (r7 05/05b show the caret);
            // the attach callback is the mount-time focus path (#137),
            // the [open] effect the retained-mount refocus.
            // B3: variant="palette" 皮肤换 Tailwind 工具类——flex-1 + 无框
            // 透明 + text-ui；行容器几何（40px/垫距/分隔线）已随 #949 迁
            // 上方行 utility。无焦点环：面板唯一输入、开即聚焦，插入符即
            // 焦点指示（新建任务正文 textarea 同律）。
            ref={attachInput}
            className="flex-1 h-auto border-none shadow-none ring-0 p-0 text-ui md:text-ui leading-4 rounded-none bg-transparent dark:bg-transparent text-foreground placeholder:text-content-tertiary focus-visible:border-transparent focus-visible:!ring-0 focus-visible:outline-none"
            value={query}
            placeholder={t('搜索任务、项目、成员…')}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (targets.length === 0) return;
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setCursor((prev) =>
                  prev == null
                    ? event.key === 'ArrowDown'
                      ? 0
                      : targets.length - 1
                    : (prev + step + targets.length) % targets.length,
                );
              } else if (event.key === 'Enter' && cursor != null) {
                // Enter follows the visible cursor only — an unlit row is
                // never activated (#159: no hidden default selection).
                const target = targets[cursor];
                if (target == null) return;
                event.preventDefault();
                go(target);
              }
            }}
          />
        </div>
        {q === '' ? (
          <div className="flex-1 overflow-y-auto px-2 pb-2" ref={listRef}>
            <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary">{t('前往')}</div>
            {NAV_ROWS.map(({ label, Icon, href }, index) => (
              <Button
                variant="ghost"
                key={label}
                data-row-kind="nav"
                data-row-index={index}
                data-selected={cursor === index ? '' : undefined}
                className={`${ROW_BASE} ${rowLitClasses(cursor === index, kbd)}`}
                onClick={() => go(href)}
              >
                <Icon width={16} height={16} />
                {t(label)}
              </Button>
            ))}
          </div>
        ) : hitCount === 0 ? (
          <div className="px-4 py-6 text-ui text-content-tertiary">
            {t('没有与“{q}”匹配的结果', { q: query.trim() })}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-2 pb-2" ref={listRef}>
            {todos.length > 0 && (
              <>
                <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary">{t('任务')}</div>
                {todos.map((todo, index) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    now={fixture.now}
                    selected={cursor === index}
                    kbd={kbd}
                    index={index}
                    onActivate={() => go(`/app/todo/${todo.id}`)}
                    projectName={
                      useServer
                        ? todo.projectName
                        : ((todo.projectId !== undefined
                            ? fixture.projectNames?.[todo.projectId]
                            : undefined) ?? projectName)
                    }
                  />
                ))}
              </>
            )}
            {projects.length > 0 && (
              <>
                <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary">{t('项目')}</div>
                {projects.map((project, index) => (
                  <Button
                    variant="ghost"
                    key={project.id}
                    data-row-kind="project"
                    data-row-index={todos.length + index}
                    data-selected={cursor === todos.length + index ? '' : undefined}
                    className={`${ROW_BASE} ${ROW_RESULT} ${rowLitClasses(
                      cursor === todos.length + index,
                      kbd,
                    )}`}
                    onClick={() => go(`/app/project/${project.id}`)}
                  >
                    <span
                      className={`${ROW_ICON} bg-(--project-avatar-bg) text-caption font-medium text-(--project-avatar-fg)`}
                    >
                      {project.name.charAt(0).toLowerCase() || PROJECT_INITIAL}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-foreground">{project.name}</span>
                    </span>
                  </Button>
                ))}
              </>
            )}
            {agents.length > 0 && (
              <>
                <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary uppercase">
                  Agents
                </div>
                {agents.map((agent, index) => {
                  // flat cursor space: todos → 项目 rows → agents (#159)
                  const rowIndex = todos.length + projects.length + index;
                  return (
                    <Button
                      variant="ghost"
                      key={agent.id}
                      data-row-kind="agent"
                      data-row-index={rowIndex}
                      data-selected={cursor === rowIndex ? '' : undefined}
                      className={`${ROW_BASE} ${ROW_RESULT} ${rowLitClasses(cursor === rowIndex, kbd)}`}
                      onClick={() => go('/app/team')}
                    >
                      <span
                        className={`${ROW_ICON} bg-transparent [&_img]:size-4 [&_img]:rounded-full`}
                      >
                        <SeededAvatar
                          className="size-4"
                          name={agent.displayName}
                          src={agent.avatarUrl}
                          fallback="/avatar-robot-1.svg"
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-foreground">{agent.displayName}</span>
                      </span>
                    </Button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </DialogShell>
  );
}

/** ⌘K / Escape wiring + the scenario-frozen initial open state (issue
 *  #67). Shared by the board and detail routes so the hotkey works on
 *  both; the panel itself is viewport-fixed. */
export function useSearchState(initialOpen: boolean, initialQuery: string) {
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen, query, setQuery };
}
