// Project route (issue #71): 任务|文件 tab group centered in the topbar
// (r2 24b/07e), project name left after the back chevron. 文件 = repo tree
// pane (branch chip + 文件|历史 segment + file rows, r2 07e/24) beside the
// 请选择一个文件查看 placeholder; 任务 = search/filter/sort toolbar + view
// toggle + todo rows (r2 26) or the 暂无内容 empty state (r2 24b).
// #178: the toolbar is live — the list|grid toggle persists through the
// registered client-state key (cairn.projectTasksLayout, the
// teamMembersLayout twin), 筛选/排序 open anchored popovers (family law
// #67/#127) driving client-side filter/sort, and the search box filters
// by title.
import {
  type DocumentDiffFile,
  LOCAL_ERROR_REASON_COPY,
  type LocalErrorReason,
  type ProjectCommitDetailResponse,
  type ProjectFileResponse,
} from '@cairn/shared';
import { cn } from 'cn';
import { ListTodo } from 'lucide-react';
import { Fragment, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import {
  useGithubConnection,
  useProjectCommitDetail,
  useProjectCommits,
  useProjectFile,
  useProjects,
  useProjectTree,
  useTodos,
} from '../api/hooks.js';
import { mapCommits, mapDiffFiles, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { EmptyState } from '../components/empty-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { CARD_RADIUS_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { DiffFileBlock } from '../detail/docpane.js';
import { localTodo } from '../fixtures/fixtures.js';
import type {
  DiffFile,
  Phase,
  ProjectCommitRow,
  ProjectContent,
  TodoRecord,
} from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  FileTab,
  Folder,
  Funnel,
  GitCommit,
  Grid2x2,
  ListLines,
  Search,
  Settings,
  X,
} from '../icons/index.js';
import { type NewTaskSurfaceApi, NewTaskSurfaceRoot } from '../overlay/new-task-surface-root.js';
import { PHASE_STATUS, PHASE_UI } from '../phase.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { GithubIssuesDialog } from './github-issues-dialog.js';
import { PageShell } from './shell.js';

/* #980 registry 对齐：手写配方（28 高带框 chip / 方角行 / 七通道中和）退役，
   件默认形态赢。类名留存原则——跨域 spec 的定位别名（dead-buttons /
   segmented-controls / avatar-dicebear 钉 .prj-file-row / .prj-history-row /
   .prj-files-seg-tab / .prj-branch-chip / .prj-task-row|-card|-link /
   .prj-tasks-view-btn / .prj-files / .prj-task-avatar）原样透传；选中态载体
   = aria-selected / aria-current / data-active（#910 裁定 3，--active 状态类
   退役）。 */

/** 文件树行钮：ghost 件默认形态 + 布局位；选中 = Paper 选择器选中行（白卡
 *  + 1px line 环 + 一层极轻投影，DESIGN.md「选择器与 ⌘K」；载体
 *  aria-current）。 */
const FILE_ROW_CLS = 'w-full cursor-pointer justify-start gap-2 px-1.5 font-normal';
const FILE_ROW_ACTIVE_CLS = 'bg-card shadow-xs ring-1 ring-border hover:bg-card dark:hover:bg-card';

/** 历史行钮（#1102 点行开提交详情）：文件行同款 ghost 件默认形态，双行文本
 *  所以 h-auto + py-1.5；prj-history-row 别名留存（dead-buttons / #980 跨域
 *  定位句柄），选中态载体 = aria-current（#910 裁定 3，文件行同律）。 */
const HISTORY_ROW_CLS =
  'h-auto w-full cursor-pointer justify-start gap-2 px-1.5 py-1.5 font-normal [&_svg]:flex-none [&_svg]:text-icon';

/** #1097 Files 面行数据 = wire entry（name/path/type）原样投影。fixture 面
 *  string 文件退化为顶层 blob 行（path=name，形态零漂移）；live 面直接吃
 *  projectTreeResponseSchema 的 entries（type/path 字段契约里一直有，本票
 *  起两端才真正消费）。 */
export interface FileTreeRow {
  name: string;
  path: string;
  type: 'blob' | 'tree';
}

/** 面包屑钮（#1097 导航）：ghost 小钮 + mono 段名；当前段不可点，载体
 *  aria-current=location（路径回显 = 载荷 path 同源值，见 ProjectPage）。 */
const CRUMB_BTN_CLS = 'h-6 cursor-pointer px-1 font-mono text-meta font-normal';

/** 文件栏的加载 / 读失败 / 空目录 / 无提交 / 空改动集占位行。 */
const PANE_NOTE_CLS = 'px-1 py-6 text-center text-meta text-content-tertiary';

function FilesPane({
  branch,
  entries,
  treeLoading,
  treeError,
  dirPath,
  onNavigateDir,
  seg,
  onSeg,
  commits,
  now,
  selectedFile,
  onSelectFile,
  selectedCommit,
  onSelectCommit,
}: {
  branch: string;
  entries: FileTreeRow[];
  /** 当前目录的 tree 请求在途且无缓存数据（加载态优先于空态，防空闪）。 */
  treeLoading: boolean;
  /** tree 读失败（非 local 降级面）：诚实态单列——读失败不得演成空目录
   *  （code-review #1097 spec 轴：空文案会把读错说成仓空）。 */
  treeError: boolean;
  /** 当前子目录（'' = 顶层）；面包屑段即其 '/' 切分。 */
  dirPath: string;
  onNavigateDir: (path: string) => void;
  seg: 'files' | 'history';
  onSeg: (seg: 'files' | 'history') => void;
  commits: ProjectCommitRow[];
  now: number;
  /** #202 查看器选中文件（#1097 起 = 完整路径，同名跨目录不串）;null = 未选。 */
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  /** #1102 详情面选中提交（全 sha）；null = 未选。 */
  selectedCommit: string | null;
  onSelectCommit: (sha: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex w-69 flex-none flex-col border-r border-border py-2 pr-2 pl-4">
      <div className="flex items-center justify-between pr-2">
        {/* 分支 chip = 静态展示（#149 裁决，[设计]）：托管 repo 读面固定
            defaultBranch（tree?ref=main），无切分支行为预期；chevron 保
            r2 07e 捕获形状。非交互元素——不再是死钮。registry 词汇：
            Badge secondary + font-mono。 */}
        <Badge
          variant="secondary"
          className="prj-branch-chip gap-1.5 font-mono text-muted-foreground"
        >
          {branch}
          <ChevronDown width={12} height={12} />
        </Badge>
        {/* 「导出」钮全除（#149 wontfix）：无导出后端面，local-first 裁决
            （#129 先例），台账 #136 勾兑登记。 */}
      </div>
      <SegmentedTabs
        className="mt-2"
        optionHandle="prj-files-seg-tab"
        value={seg}
        onChange={onSeg}
        options={[
          { value: 'files', label: t('文件') },
          { value: 'history', label: t('历史') },
        ]}
      />
      {seg === 'files' ? (
        <div className="mt-3">
          {/* 面包屑（#1097）：仅子目录内渲染——顶层零视觉漂移（既有捕获面
              不动）。段名来自 dirPath 切分；服务端载荷的 path 回显与其恒等
              （server vitest P1-P3 钉住），显示走状态是为了切目录即时反馈。 */}
          {dirPath !== '' ? (
            <nav
              aria-label={t('目录导航')}
              className="mb-1 flex flex-wrap items-center gap-x-0.5 px-1.5 text-muted-foreground"
            >
              <Button variant="ghost" className={CRUMB_BTN_CLS} onClick={() => onNavigateDir('')}>
                {t('根目录')}
              </Button>
              {dirPath
                .split('/')
                .filter(Boolean)
                .map((name, i, segs) => {
                  const prefix = segs.slice(0, i + 1).join('/');
                  const isCurrent = i === segs.length - 1;
                  return (
                    <Fragment key={prefix}>
                      <ChevronRight
                        width={12}
                        height={12}
                        aria-hidden="true"
                        className="flex-none"
                      />
                      {isCurrent ? (
                        <span
                          aria-current="location"
                          className="px-1 font-mono text-meta text-foreground"
                        >
                          {name}
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          className={CRUMB_BTN_CLS}
                          onClick={() => onNavigateDir(prefix)}
                        >
                          {name}
                        </Button>
                      )}
                    </Fragment>
                  );
                })}
            </nav>
          ) : null}
          {treeLoading ? (
            <div className={PANE_NOTE_CLS}>{t('加载中…')}</div>
          ) : treeError ? (
            <div className={PANE_NOTE_CLS}>{t('文件树读取失败。')}</div>
          ) : entries.length === 0 ? (
            // 空目录定义态（#1097 验收）：git 不跟踪空目录，服务端对空/不存在
            // 目录同回 entries=[]（server vitest P5）——web 一律演空态文案。
            <div className={PANE_NOTE_CLS}>{t('此目录为空。')}</div>
          ) : (
            entries.map((e) =>
              e.type === 'tree' ? (
                // 目录行（#1097）：Folder 字形区分（非仅颜色）+ 点击下钻；
                // data-tree-entry = 跨域定位载体（e2e W1-W7）。
                <Button
                  key={e.path}
                  variant="ghost"
                  data-tree-entry="folder"
                  className={`prj-file-row ${FILE_ROW_CLS}`}
                  onClick={() => onNavigateDir(e.path)}
                >
                  <Folder className="size-3.5 text-icon" />
                  <span className="font-mono text-meta text-muted-foreground">{e.name}</span>
                </Button>
              ) : (
                // 文件行 = 既有形态零回归；键与选中比较都用完整 path（#1097：
                // 同名文件跨目录不串）。选中态载体 = aria-current（#910 裁定 3）。
                <Button
                  key={e.path}
                  variant="ghost"
                  data-tree-entry="file"
                  aria-current={selectedFile === e.path ? 'true' : undefined}
                  className={`prj-file-row ${FILE_ROW_CLS}${selectedFile === e.path ? ` ${FILE_ROW_ACTIVE_CLS}` : ''}`}
                  onClick={() => onSelectFile(e.path)}
                >
                  <FileTab className="size-3.5 text-icon" />
                  <span className="font-mono text-meta text-muted-foreground">{e.name}</span>
                </Button>
              ),
            )
          )}
        </div>
      ) : commits.length === 0 ? (
        <div className={`mt-3 ${PANE_NOTE_CLS}`}>{t('尚无提交历史。')}</div>
      ) : (
        // 历史行形 [设计]（官方历史面无捕获）：git log 最小投影，新→旧。
        // #1102 起可点：行 = ghost 钮（文件行同族），点击开右侧提交详情面；
        // data-history-entry = 跨域定位载体（data-tree-entry #1097 同律）。
        <ul className="mt-3">
          {commits.map((c) => (
            <li key={c.id}>
              <Button
                variant="ghost"
                data-history-entry="commit"
                aria-current={selectedCommit === c.id ? 'true' : undefined}
                className={`prj-history-row ${HISTORY_ROW_CLS}${selectedCommit === c.id ? ` ${FILE_ROW_ACTIVE_CLS}` : ''}`}
                onClick={() => onSelectCommit(c.id)}
              >
                <GitCommit width={14} height={14} />
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <span
                    data-testid="history-message"
                    className="max-w-full truncate text-ui text-foreground"
                  >
                    {c.message}
                  </span>
                  {/* 元信息走无衬线，只有 sha 是 mono（DESIGN.md code 档）：
                      276px 栏里整行 mono 会把 sha 截掉。 */}
                  <span
                    data-testid="history-meta"
                    className="max-w-full truncate text-meta text-content-tertiary"
                  >
                    {c.authorName} · {relativeTime(c.at, now, t)} ·{' '}
                    <span className="font-mono">{c.shortSha}</span>
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** #178 view-switch client-state key, [推断] same shape as the r2 §1.5
 *  observed cairn.teamMembersLayout (registered in shared
 *  protocol/client-state.ts); absent = list. */
export const PROJECT_TASKS_LAYOUT_STORAGE_KEY = 'cairn.projectTasksLayout';

type TasksLayout = 'list' | 'grid';
type TaskFilter = 'all' | 'active' | 'done';
type TaskSort = 'default' | 'recent' | 'title';

interface TaskRow {
  id: string;
  seqNum: number;
  title: string;
  phase: Phase;
  phaseAt: number;
}

/** 已完成 / 已取消的标题降到 ink-3（DESIGN.md「已经不需要看」）。 */
function isSettled(phase: Phase): boolean {
  return phase === 'done' || phase === 'closed';
}

/** 行 / 卡的状态 = 图标 + 颜色 + 文字三件套（DESIGN.md 状态不只靠颜色）；
 *  词与图标同详情页顶栏（PHASE_UI chip + PHASE_STATUS）。 */
function TaskStatus({ phase }: { phase: Phase }) {
  const { t } = useI18n();
  const { icon: Icon, ink } = PHASE_STATUS[phase];
  return (
    <span
      data-testid="task-status"
      className={cn('flex flex-none items-center gap-1 text-meta whitespace-nowrap', ink)}
    >
      <Icon aria-hidden strokeWidth={1.75} className="size-3.25" />
      {t(PHASE_UI[phase].chip)}
    </span>
  );
}

/** XMON-105 owner avatar（登录用户身份单源）+ 右下 idle 点；列表与网格共用
 *  .prj-task-avatar 句柄（avatar-dicebear spec）。 */
function TaskAvatar({ name, src }: { name?: string | null; src?: string | null }) {
  return (
    <span className="prj-task-avatar relative size-5 flex-none after:absolute after:-right-px after:-bottom-px after:size-1.75 after:rounded-full after:border-[1.5px] after:border-card after:bg-(--badge-idle) after:content-['']">
      <SeededAvatar className="size-5" name={name} src={src} fallback="/avatar-user.png" />
    </span>
  );
}

/** 文件查看器状态(#202):idle = 占位;loading/error 仅 live 可达;
 *  binary = 不可预览态(live base64 封套 / fixture 缺内容映射);text 直渲。 */
type FileViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'binary' }
  | { kind: 'text'; content: string };

/** 查看器状态推导(#202,code-review 抽取):fixture 直读 fileContents
 *  映射(缺席键 = 不可预览态);live 折 query 三态后按 encoding 分渲。
 *  结构子集传参,不绑 useQuery 全形。 */
function deriveFileView(
  selected: string | null,
  live: boolean,
  fixtureContent: string | null,
  file: { isError: boolean; data: ProjectFileResponse | undefined },
): FileViewState {
  if (selected === null) return { kind: 'idle' };
  if (!live) {
    return fixtureContent !== null ? { kind: 'text', content: fixtureContent } : { kind: 'binary' };
  }
  if (file.isError) return { kind: 'error' };
  if (file.data === undefined) return { kind: 'loading' };
  return file.data.encoding === 'base64'
    ? { kind: 'binary' }
    : { kind: 'text', content: file.data.content };
}

/** 提交详情面状态（#1102，镜像 #202 FileViewState 推导族）：idle = 占位；
 *  loading/error 仅 live 可达；detail = 元信息 + wire 形 files（渲染前经
 *  mapDiffFiles 进 DiffFileBlock 显示契约）。 */
type CommitViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; reason?: string }
  | {
      kind: 'detail';
      sha: string;
      shortSha: string;
      message: string;
      authorName: string;
      at: number;
      files: DocumentDiffFile[];
    };

/** 详情面状态推导（#1102，deriveFileView 同律）：fixture 直读行上 files 槽
 *  （缺席键 = files:[] 定义态，行数据必带肉防死钮）；live 折 query 三态，
 *  error 携带分类 reason（LOCAL_ERROR_REASON_COPY 分译用，#386/#1030 单源）。
 *  结构子集传参，不绑 useQuery 全形。 */
function deriveCommitView(
  selected: string | null,
  live: boolean,
  fixtureRow: ProjectCommitRow | undefined,
  q: { isError: boolean; error: Error | null; data: ProjectCommitDetailResponse | undefined },
): CommitViewState {
  if (selected === null) return { kind: 'idle' };
  if (!live) {
    return fixtureRow === undefined
      ? { kind: 'idle' }
      : {
          kind: 'detail',
          sha: fixtureRow.id,
          shortSha: fixtureRow.shortSha,
          message: fixtureRow.message,
          authorName: fixtureRow.authorName,
          at: fixtureRow.at,
          files: fixtureRow.files ?? [],
        };
  }
  if (q.isError) {
    return {
      kind: 'error',
      ...(q.error instanceof ApiError && q.error.reason !== undefined
        ? { reason: q.error.reason }
        : {}),
    };
  }
  if (q.data === undefined) return { kind: 'loading' };
  return { kind: 'detail', ...q.data };
}

/** 提交详情查看器（#1102）：右栏「右侧查看器」形态（文件查看器同位）。
 *  头带 = 元信息与列表行同源同格式（message / authorName · 相对时间 ·
 *  shortSha——「与列表行一致」验收的渲染面）+ 关闭钮（清选中回占位）；
 *  体 = DiffFileBlock 复用（docpane 渲染单源，allowFullFile=false 摘全文钮）。
 *  w-max min-w-full = 行底色骑满横向滚动宽（#1101 症状①同款修法）。 */
function CommitDetailView({
  view,
  files,
  now,
  onClose,
}: {
  view: CommitViewState;
  /** view.kind==='detail' 时的 mapDiffFiles 产物（调用方 memo，其余态空数组）。 */
  files: DiffFile[];
  now: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (view.kind !== 'detail') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ui text-content-tertiary">
        <span>
          {view.kind === 'loading'
            ? t('加载中…')
            : view.kind === 'error'
              ? t('提交详情加载失败')
              : t('请选择一个提交查看')}
        </span>
        {/* 分类 reason 走 #386 单源分译（local 不可达降级词表）；未分类
            （网络/5xx）只出主行——tree 降级分支同款口径。 */}
        {view.kind === 'error' &&
        view.reason !== undefined &&
        view.reason in LOCAL_ERROR_REASON_COPY ? (
          <span className="text-meta">
            {t(LOCAL_ERROR_REASON_COPY[view.reason as LocalErrorReason])}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-commit-detail="pane">
      <div className="flex flex-none items-start gap-2 border-b border-border px-4 py-3">
        {/* mt-0.75 = 把 14px 图标落在 20px 首行的正中。 */}
        <GitCommit width={14} height={14} className="mt-0.75 flex-none text-icon" />
        <div className="flex min-w-0 flex-1 flex-col items-start">
          {/* data-commit-detail 载体 = 跨域定位句柄（data-tree-entry #1097 同律）。 */}
          <span
            className="max-w-full truncate text-ui text-foreground"
            data-commit-detail="message"
          >
            {view.message}
          </span>
          <span className="text-meta text-content-tertiary" data-commit-detail="meta">
            {view.authorName} · {relativeTime(view.at, now, t)} ·{' '}
            <span className="font-mono">{view.shortSha}</span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="flex-none text-muted-foreground"
          aria-label={t('关闭提交详情')}
          onClick={onClose}
        >
          <X width={12} height={12} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {files.length === 0 ? (
          // 空改动集定义态（空提交 / 纯二进制 / 种子提交——server S6 口径）：
          // 诚实文案，不白屏不「加载失败」。
          <div className={PANE_NOTE_CLS}>{t('该提交没有可显示的改动。')}</div>
        ) : (
          <div className="w-max min-w-full">
            {files.map((file) => (
              <DiffFileBlock
                key={file.path}
                file={file}
                expanded
                buildId={null}
                allowFullFile={false}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function readStoredLayout(storage: Storage | null): TasksLayout {
  // #1091：null / getItem 抛 = 无记忆，回落 list（本页首渲染路径）。
  try {
    return storage?.getItem(PROJECT_TASKS_LAYOUT_STORAGE_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

/** 筛选最小集 [推断]（票面：全部/进行中/已完成，核 phase 九值）：已完成
 *  = done 单值（02 §4.1「已接受，若选了则已合并」）；进行中 = 其余八值
 *  ——closed「未完成即搁置」归未完成侧，不造第三档。 */
function filterOk(phase: Phase, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'done') return phase === 'done';
  return phase !== 'done';
}

/** 排序三值 [推断]：默认 = 数据源序（fixture 冻结序 / server 返回序），
 *  最近更新 = phaseAt 降序（行面相对时间的数据同源），标题 = 升序。 */
function sortTodos(rows: TaskRow[], sort: TaskSort): TaskRow[] {
  if (sort === 'recent') return [...rows].sort((a, b) => b.phaseAt - a.phaseAt);
  if (sort === 'title') return [...rows].sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  return rows;
}

const TASK_FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '进行中' },
  { id: 'done', label: '已完成' },
];

const TASK_SORTS: { id: TaskSort; label: string }[] = [
  { id: 'default', label: '默认' },
  { id: 'recent', label: '最近更新' },
  { id: 'title', label: '标题' },
];

/** 筛选/排序选项组：components/ui/dropdown-menu（Base UI Menu RadioGroup）。
 *  单选即关走显式 closeOnClick——RadioItem 缺省是 false（原生菜单 radio
 *  保开语义），本面家族律是 select-and-close（#306）；勾形只骑选中项 =
 *  RadioItemIndicator 原生律；roving focus / typeahead / Esc / 外点关 /
 *  焦点归还全归原语。行皮肤/几何 = 件默认（#980 裁决④，手写 28 高透明行
 *  配方退役）。 */
function TasksMenu<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { id: T; label: string }[];
  value: T;
  onSelect: (id: T) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={(next) => onSelect(next as T)}>
      {options.map((option) => (
        <DropdownMenuRadioItem key={option.id} value={option.id} closeOnClick>
          {t(option.label)}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** 筛选/排序 trigger + its anchored menu: one component per dropdown so
 *  the trigger and its popup travel together. trigger = outline 件默认形态
 *  （手写 28 高带框 chip 配方退役），aria-haspopup/aria-expanded 与 toggle
 *  开合归 Trigger/Root；定位走 Positioner 参数（side=bottom align=start
 *  sideOffset=6）；菜单盘 = 件默认皮肤 + shrink-to-fit 布局位（w-auto 中和
 *  base 的 w-(--anchor-width)，min-w 保原盘最小宽）。 */
function TasksMenuButton<T extends string>({
  icon,
  label,
  options,
  value,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onSelect: (id: T) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <span className="relative flex">
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          {icon}
          {t(label)}
          <ChevronDown width={12} height={12} />
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent sideOffset={6} aria-label={t(label)} className="w-auto min-w-37">
        <TasksMenu options={options} value={value} onSelect={onSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TasksPane({
  todos,
  now,
  onNewTask,
  onOpenGithubIssues,
}: {
  todos: TaskRow[];
  now: number;
  /** #305: 空态「+ 任务」入口开 NewTaskDialog（与看板新建入口同构）。 */
  onNewTask: () => void;
  /** #446：github 形态 + 已连接时的「从 GitHub issue 建任务」入口开关；
   * 缺省 = 入口不渲染（local/hosted/fixture/未连接面零漂移）。 */
  onOpenGithubIssues?: () => void;
}) {
  const { t } = useI18n();
  // XMON-105: task-row owner avatar = the logged-in user identity single
  // source (same face as sidebar chip / account head / chat user rows).
  const { user } = useLiveData();
  // #318: 行/卡点击 = 导航任务详情(r2 §2 原站点行开详情);search 随行
  // 携带(fixture 面 scenario 参数不丢,todo-card #58 同律)。
  const { search } = useLocation();
  const [layout, setLayout] = useState<TasksLayout>(() => readStoredLayout(safeLocalStorage()));
  const switchLayout = useCallback((next: TasksLayout) => {
    setLayout(next);
    safeSetItem(PROJECT_TASKS_LAYOUT_STORAGE_KEY, next);
  }, []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [sort, setSort] = useState<TaskSort>('default');
  // 客户端过滤/排序（票面裁决：数据面 todos 已在页内，无服务端往返）
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = todos.filter(
      (todo) =>
        filterOk(todo.phase, filter) &&
        (needle === '' || todo.title.toLowerCase().includes(needle)),
    );
    return sortTodos(rows, sort);
  }, [todos, query, filter, sort]);
  return (
    <div className="pb-6">
      <div className="flex items-center gap-2">
        {/* 搜索框 = registry InputGroup。#1244：focus 环画在壳上，
            2px --focus-ring outline，控件面自身不出环。 */}
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="text"
            placeholder={t('搜索任务…')}
            aria-label={t('搜索任务')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <TasksMenuButton
          icon={<Funnel />}
          label="筛选"
          options={TASK_FILTERS}
          value={filter}
          onSelect={setFilter}
        />
        <TasksMenuButton
          icon={<ArrowUpDown />}
          label="排序"
          options={TASK_SORTS}
          value={sort}
          onSelect={setSort}
        />
        {onOpenGithubIssues !== undefined && (
          <Button variant="outline" onClick={onOpenGithubIssues}>
            {t('从 GitHub issue 建任务')}
          </Button>
        )}
        <SegmentedTabs
          optionHandle="prj-tasks-view-btn"
          value={layout}
          onChange={switchLayout}
          options={[
            { value: 'list', ariaLabel: t('列表视图'), icon: <ListLines /> },
            { value: 'grid', ariaLabel: t('网格视图'), icon: <Grid2x2 /> },
          ]}
        />
      </div>
      {todos.length === 0 ? (
        // 空态 = 共享 EmptyState（裸 ink-3 图标 + 标题 + 一句说明 + 一个墨色
        // 主按钮，DESIGN.md「页面模式 · 空态」）；按钮名即 #305 的 新建任务。
        <EmptyState
          className="mt-6"
          icon={ListTodo}
          title={t('暂无内容')}
          description={t('创建第一个任务以开始使用。')}
          action={{ label: t('新建任务'), onClick: onNewTask }}
        />
      ) : visible.length === 0 ? (
        // 筛选/搜索清空 ≠ 项目无任务：给匹配空态一行，不误用 r2 24b 的
        // 「创建第一个任务」空态（那是无 todo 项目的 canon）
        <p className="m-0 mt-6 text-center text-ui text-content-tertiary">{t('没有匹配的任务')}</p>
      ) : layout === 'list' ? (
        // 列表 = 一张设置卡的 52px 行（DESIGN.md「页面模式 · 设置列表」，
        // 定时 / 资源列表同形）：左标题 + 元信息，右状态三件套 + 头像。
        <SettingsCard className="prj-task-list mt-4">
          {visible.map((todo) => (
            <div
              key={todo.id}
              data-testid="task-row"
              className={cn('prj-task-row relative', SETTINGS_ROW_CLS)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                {/* #318: 标题是真 <a>,after: 拉伸盖满整行 = 点行开详情
                    (todo-card-link #58 同款,行内无其它交互件无需抬 z) */}
                <Link
                  className={cn(
                    "prj-task-link truncate text-ui no-underline after:absolute after:inset-0 after:content-['']",
                    isSettled(todo.phase) ? 'text-content-tertiary' : 'text-foreground',
                  )}
                  to={{ pathname: `/app/todo/${todo.id}`, search }}
                >
                  {todo.title}
                </Link>
                <span data-testid="task-meta" className="truncate text-meta text-content-tertiary">
                  #{todo.seqNum} · {relativeTime(todo.phaseAt, now, t)}
                </span>
              </span>
              <TaskStatus phase={todo.phase} />
              <TaskAvatar name={user.displayName} src={user.avatarUrl} />
            </div>
          ))}
        </SettingsCard>
      ) : (
        // 网格形 [设计]（票面注记：官方无捕获）——卡 = registry Card 换
        // --radius-card + line 环（DESIGN.md「卡片圆角：一个角」）；卡内
        // 状态三件套 + 头像、两行标题（任务卡同档 14px 500）、元信息。
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(224px,1fr))] gap-2">
          {visible.map((todo) => (
            <Card
              key={todo.id}
              size="sm"
              data-testid="task-card"
              className={cn(
                'prj-task-card relative items-start gap-2 px-3.5 py-3 ring-border',
                CARD_RADIUS_CLS,
              )}
            >
              <div className="flex items-center justify-between self-stretch">
                <TaskStatus phase={todo.phase} />
                <TaskAvatar name={user.displayName} src={user.avatarUrl} />
              </div>
              {/* #318: 同列表行——标题 <a> 的 after: 拉伸盖满整卡。 */}
              <Link
                className={cn(
                  "prj-task-link line-clamp-2 text-card-title no-underline after:absolute after:inset-0 after:content-['']",
                  isSettled(todo.phase)
                    ? 'font-normal text-content-tertiary'
                    : 'font-medium text-foreground',
                )}
                to={{ pathname: `/app/todo/${todo.id}`, search }}
              >
                {todo.title}
              </Link>
              <span data-testid="task-meta" className="text-meta text-content-tertiary">
                #{todo.seqNum} · {relativeTime(todo.phaseAt, now, t)}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  // r2 §2 route table: ?tab=tasks selects the 任务 surface; the capture
  // state flag drives fixture rows (same precedent as the detail tabs).
  const [tab, setTab] = useState<'tasks' | 'files'>(
    searchParams.get('tab') === 'tasks' ? 'tasks' : (fixture.projectTab ?? 'files'),
  );
  // 文件|历史 分段（#149 接线）：历史 = 提交历史读面（live 走
  // projects/{id}/commits [推断] 端点；fixture 走 ProjectContent.commits）。
  const [seg, setSeg] = useState<'files' | 'history'>('files');
  // M5 live：项目行 = GET /api/projects 检索；文件树 = GET tree（02 §3
  // 读裸库面）；任务列表 = 真 todos 按 projectId 过滤。
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const todosQ = useTodos(teamId, live);
  // fixture 面本地新行（board #66 同律）：保存落在客户端集合，页面/侧栏
  // 徽标都吃它；live 面走 mutation + invalidate，不用本地集。
  const [fixtureAdded, setFixtureAdded] = useState<TodoRecord[]>([]);
  // wireProject 先行（形态门数据源）；tree 对 hosted 与 local 形态发（#1030
  // 起 local 读面放行，server 侧目录解析分支；github 形态不发——404 静默 +
  // console 刷屏不可接受，不发无谓请求，文件面走诚实降级 + GitHub 外链）。
  // local 的 ref 不传（server 落 HEAD）：local 仓默认分支任意，hosted 的
  // ref='main' 是种子提交恒 main 的既约，不能外推到 local。
  const wireProject = live ? (projectsQ.data ?? []).find((p) => p.id === id) : undefined;
  const hostedRepo = live && wireProject?.repoKind === 'hosted';
  const localRepo = live && wireProject?.repoKind === 'local';
  // #1097 子目录下钻位：与 fileSel 同律按 (projectId, path) 键——路由切项目
  // 组件不重挂载，旧项目的目录位不得串场。'' = 顶层。
  const [dirSel, setDirSel] = useState<{ projectId: string; path: string }>({
    projectId: '',
    path: '',
  });
  const dirPath = dirSel.projectId === id ? dirSel.path : '';
  const navigateDir = useCallback((path: string) => setDirSel({ projectId: id ?? '', path }), [id]);
  const treeQ = useProjectTree(
    live && (hostedRepo || localRepo) ? id : undefined,
    hostedRepo ? 'main' : undefined,
    dirPath === '' ? undefined : dirPath,
  );
  // 加载态判据（e2e W6）：live 可读形态下当前目录键尚无数据 = 在途（含
  // projects 未落定、tree query 还没启用的窗口）——空态只在数据真落后判定，
  // 防「切目录瞬间闪空」。fixture 面 query 恒 disabled，不演加载。
  const treeLoading =
    live &&
    !treeQ.isError &&
    treeQ.data === undefined &&
    (projectsQ.isLoading || hostedRepo || localRepo);
  // 历史读面惰性：仅 live + 文件 tab + 历史 seg + 可读形态（hosted/local）才发
  // （GitHub 接入无本地存储面 = tree/file 同族 404，不发无谓请求）。
  const commitsQ = useProjectCommits(
    live ? id : undefined,
    live && tab === 'files' && seg === 'history' && (hostedRepo || localRepo),
  );
  const project: ProjectContent | undefined = live
    ? wireProject
      ? {
          name: wireProject.name,
          // 分支 chip = 实读 ref 回显（hosted='main'、local='HEAD'——tree 载荷
          // 自带回显，不猜）；tree 未回时退 'main'（hosted 语义不变）。
          branch: treeQ.data?.ref ?? 'main',
          // live 行数据不走本字段——fileRows 直取 treeQ entries（#1097 起
          // type/path 全量消费）；files 仅 fixture 形态供数。
          files: [],
          repoName: wireProject.repoName ?? wireProject.githubRepo ?? '',
          hosted: wireProject.repoKind === 'hosted',
          ...(wireProject.repoKind !== undefined ? { repoKind: wireProject.repoKind } : {}),
          defaultBranch: 'main',
          description: null,
        }
      : undefined
    : fixture.project;
  // local 项目 Files tab 开闸（#1030，推翻 spec 12「v1 出局：Files tab 对 local
  // 禁用」的 out-of-scope）：server 端目录解析已分叉（requireRepoReadDir），
  // web 按形态发请求。不可达降级见下方 treeQ.isError 分支。
  const isLocalRepo = project?.repoKind === 'local';
  // tree 读失败的诚实态（hosted 等非 local 降级面）：local 形态的 isError 走
  // 上方「本地仓库当前无法读取。」降级分支，不进 FilesPane。
  const treeError = live && treeQ.isError && !isLocalRepo;
  // #1097 行数据单源：live = tree 载荷 entries 原样（type/path 终于被消费）；
  // fixture = string 文件退化顶层 blob 行（无目录，path=name）。
  // 展示序（用户 2026-10-10 反馈）：文件夹组置顶、组内各自字母序——git 树序
  // 把子树按「名 + /」排（docs 与 docs.md 交错），不是文件管理器直觉；排序是
  // 显示层关注点，wire 保持 git 真值不动。
  const fileRows: FileTreeRow[] = useMemo(() => {
    const rows = live
      ? (treeQ.data?.entries ?? []).map((e) => ({ name: e.name, path: e.path, type: e.type }))
      : (project?.files ?? []).map((f) => ({ name: f, path: f, type: 'blob' as const }));
    return rows.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1,
    );
  }, [live, treeQ.data, project]);
  // 文件查看器选中态(#202):存 (projectId, path) 对——路由切换项目时
  // 组件不重挂载,旧项目选中不串场。live 读面点击触发 = 天然惰性;非托管
  // 形态 tree 同族 404 无行可点,误点落「文件加载失败」诚实态,不做
  // 形态门(code-review:门会让 query 永久 disabled = 永挂 loading)。
  const [fileSel, setFileSel] = useState<{ projectId: string; path: string } | null>(null);
  const selectedFile = fileSel !== null && fileSel.projectId === id ? fileSel.path : null;
  const fileQ = useProjectFile(
    live ? id : undefined,
    selectedFile ?? undefined,
    // ref 同 treeQ 口径：hosted 固定 'main'；local 落 HEAD（默认分支任意）。
    hostedRepo ? 'main' : undefined,
  );
  const fixtureFileContent =
    !live && selectedFile !== null ? (fixture.project?.fileContents?.[selectedFile] ?? null) : null;
  const fileView = deriveFileView(selectedFile, live, fixtureFileContent, fileQ);
  // 提交详情选中态（#1102）：存 (projectId, sha) 对——fileSel/dirSel 同款
  // 纪律，路由切项目组件不重挂载，旧项目选中不串场。详情读面惰性门与
  // commitsQ 同闸（live + 文件 tab + 历史 seg + 可读形态），行点击触发。
  const [commitSel, setCommitSel] = useState<{ projectId: string; sha: string } | null>(null);
  const selectedCommit = commitSel !== null && commitSel.projectId === id ? commitSel.sha : null;
  const commitDetailQ = useProjectCommitDetail(
    live ? id : undefined,
    selectedCommit ?? undefined,
    live && tab === 'files' && seg === 'history' && (hostedRepo || localRepo),
  );
  const fixtureCommitRows = !live ? (project?.commits ?? []) : [];
  const commitView = deriveCommitView(
    selectedCommit,
    live,
    selectedCommit !== null ? fixtureCommitRows.find((c) => c.id === selectedCommit) : undefined,
    commitDetailQ,
  );
  // wire 形 → DiffFileBlock 显示契约（mapDiffFiles 单源，docpane/changes 面
  // 同款）；非 detail 态恒空数组，memo 挂 commitView 身份不重算。
  const commitDiffFiles = useMemo(
    () => (commitView.kind === 'detail' ? mapDiffFiles(commitView.files) : []),
    [commitView],
  );
  const todos = live
    ? (todosQ.data ?? []).map(toDisplayTodo).filter((x) => x.projectId === id)
    : [...fixture.todos, ...fixtureAdded].filter((x) => x.projectId === id);
  // 新建任务面：dialog 接线 = useNewTaskSurface（board/侧栏全局面同一 save
  // 路径）。本页差异走 hook 参数位——fixture 落点 = fixtureAdded 本地行
  // append（seqNum 基线 = scenario 集 + 已加行；canon projectId
  // approximation 同 #176 律）；锚 = 路由项目 id（#305 律：选择器行置首、
  // 保存缺省锚本页、不建默认项目）；提及面 = 空 picker；members eager
  // （查询面语义保持原状，#640 后保存并开始直发编排回合不再吃指派）。
  // spec 15 #394 同律：提交 = 正文单字段，标题 live 面 wire 空串 server
  // 派生、fixture 面 localTodo 内派生。
  const onFixtureSave = useCallback(
    (spec: string) => {
      setFixtureAdded((prev) => [
        ...prev,
        localTodo(
          [...fixture.todos, ...prev].reduce((max, t) => Math.max(max, t.seqNum), 0) + 1,
          spec,
          fixture.now,
        ),
      ]);
    },
    [fixture],
  );
  // XMON-93 隔离面：dialog 的 open/正文态住进 NewTaskSurfaceRoot 叶子内部，
  // 开合与输入不再整页重渲染（任务列表行同步重渲染 = ESC 退出卡顿的同源
  // 根因，board 面实测）。opener 走 ref 读，引用恒定。
  const newTaskApiRef = useRef<NewTaskSurfaceApi | null>(null);
  const openNewTask = useCallback(() => newTaskApiRef.current?.openDialog(), []);
  // 从 GitHub issue 建任务入口（#446 / ADR 0005 读向）：三重门 = live +
  // github 形态 + 已连接。未连接 = 入口不渲染且页面不报错不空白（connection
  // 查询失败面容忍，票面验收）；local/hosted/fixture 面零漂移。查询 enabled
  // 收窄到 github 形态项目（页面挂载不空转，useGithubConnection 同律）。
  const isGithubRepoEntry = live && wireProject?.repoKind === 'github';
  // github 项目 Files tab 诚实降级（#704 / B-C1）：cairn 不保存该形态的仓库
  // 文件副本（Multica link-back 只读方向——关联不镜像），文件面 = 说明 + 外链
  // GitHub；变更与 PR 面走 daemon 上报真值（任务详情 changes / 分支 PR 面板）。
  // 判据复用 issues 入口同源位（live && repoKind === 'github'）。
  const githubFilesUrl =
    isGithubRepoEntry && wireProject?.githubRepo != null
      ? `https://github.com/${wireProject.githubRepo}`
      : null;
  const ghConnQ = useGithubConnection(isGithubRepoEntry ? teamId : undefined, isGithubRepoEntry);
  const ghIssuesAvailable = isGithubRepoEntry && ghConnQ.data?.connected === true;
  const [issuesOpen, setIssuesOpen] = useState(false);
  const closeIssues = useCallback(() => setIssuesOpen(false), []);
  const onIssueImported = useCallback(
    (record: { id: string }) => {
      setIssuesOpen(false);
      // 真用户路径落点：导入即导航任务详情（标题与全部标签当场可见）。
      navigate({ pathname: `/app/todo/${record.id}`, search });
    },
    [navigate, search],
  );
  return (
    <PageShell
      route="project"
      // 文件 = 树 + 查看器铺满纸面；任务 = 列表页同款 768px 阅读栏。
      bleed={tab === 'files'}
      fixture={
        live ? { ...fixture, todos } : { ...fixture, todos: [...fixture.todos, ...fixtureAdded] }
      }
      selected="none"
      title={project?.name ?? ''}
      // #389: C 热键/侧栏行走本页 dialog（保存锚路由项目，#305 律）
      onNewTask={openNewTask}
      tabs={[
        { id: 'tasks', label: '任务' },
        { id: 'files', label: '文件' },
      ]}
      tab={tab}
      onTab={(next) => setTab(next === 'tasks' ? 'tasks' : 'files')}
      actions={
        id === undefined ? undefined : (
          // #1174 设置入口：/app/project/:id/settings 自 #207 起带全套删除流，
          // 但全站没有任何导航指向它——孤儿路由，删项目只能猜 API（票面实撞
          // 场景）。形态 = todos.dev 项目页实测（ego-browser 2026-10-10）：
          // topbar 右缘动作区齿轮（28×28 命中 / 16px lucide settings 形）→
          // 设置路由；search 随行保 fixture scenario（team-page 设置链同律）。
          // registry ghost icon-sm 钮经 render prop 落 router Link（dhead 返回
          // 钮同款 #1006 形态，锚语义保留）；零手写 per-face。
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to={{ pathname: `/app/project/${id}/settings`, search }} />}
            aria-label={t('设置')}
          >
            <Settings />
          </Button>
        )
      }
    >
      {tab === 'files' && isLocalRepo && treeQ.isError ? (
        // local 仓不可达降级（#1030）：tree 读失败 = server 看不到 localPath
        // （多机部署不同机 / 目录已删 / 已非 git 仓）。不渲染 FilesPane——
        // 空树会被误读成「仓库是空的」，历史面同闸也不再发。分类 reason 走
        // #386 单源分译；未分类失败（网络/5xx）只出主行。
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-ui text-content-tertiary">
          <span>{t('本地仓库当前无法读取。')}</span>
          {treeQ.error instanceof ApiError &&
          treeQ.error.reason !== undefined &&
          treeQ.error.reason in LOCAL_ERROR_REASON_COPY ? (
            <span className="text-meta">
              {t(LOCAL_ERROR_REASON_COPY[treeQ.error.reason as LocalErrorReason])}
            </span>
          ) : null}
        </div>
      ) : tab === 'files' && isGithubRepoEntry ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-3 text-ui text-content-tertiary">
          <span>{t('GitHub 仓库项目的文件在 GitHub 上查看')}</span>
          {githubFilesUrl != null && (
            /* #946 better-colors 实测换槽：原规则引 --accent（软分隔线族，
               on surface ≈1.1:1 不可读）——「链接用主题色」的设计意图落品牌槽
               --card-button（#908 裁决 2：配对未过可换消费面槽引用，token
               值不动；实测数字在 PR body）。 */
            <a
              className="text-primary underline"
              href={githubFilesUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('打开 GitHub 仓库')}
            </a>
          )}
        </div>
      ) : tab === 'files' ? (
        <div className="prj-files flex min-h-0 flex-1">
          <FilesPane
            branch={project?.branch ?? 'main'}
            entries={fileRows}
            treeLoading={treeLoading}
            treeError={treeError}
            dirPath={dirPath}
            onNavigateDir={navigateDir}
            seg={seg}
            onSeg={setSeg}
            commits={live ? mapCommits(commitsQ.data?.commits ?? []) : (project?.commits ?? [])}
            now={live ? Date.now() : fixture.now}
            selectedFile={selectedFile}
            onSelectFile={(path) => setFileSel({ projectId: id ?? '', path })}
            selectedCommit={selectedCommit}
            onSelectCommit={(sha) => setCommitSel({ projectId: id ?? '', sha })}
          />
          {/* 右栏查看器按 seg 分面（#1102）：历史 seg = 提交详情面（选中/
              加载/错误/空改动四态诚实分渲）；文件 seg = 既有文件查看器零
              回归。两选中态独立存——seg 来回切各自还原，不互串。 */}
          {seg === 'history' ? (
            <CommitDetailView
              view={commitView}
              files={commitDiffFiles}
              now={live ? Date.now() : fixture.now}
              onClose={() => setCommitSel(null)}
            />
          ) : fileView.kind === 'text' ? (
            <div className="block min-w-0 flex-1 overflow-auto px-4 py-3">
              <pre className="m-0 font-mono text-meta leading-4.5 whitespace-pre text-foreground">
                {fileView.content}
              </pre>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-ui text-content-tertiary">
              {fileView.kind === 'loading'
                ? t('加载中…')
                : fileView.kind === 'error'
                  ? t('文件加载失败')
                  : fileView.kind === 'binary'
                    ? t('二进制文件暂不支持预览')
                    : t('请选择一个文件查看')}
            </div>
          )}
        </div>
      ) : (
        <TasksPane
          todos={todos}
          now={live ? Date.now() : fixture.now}
          onNewTask={openNewTask}
          {...(ghIssuesAvailable ? { onOpenGithubIssues: () => setIssuesOpen(true) } : {})}
        />
      )}
      {/* dialog 接线 = NewTaskSurfaceRoot 隔离根，本页差异参数位随 opts 传入。 */}
      <NewTaskSurfaceRoot
        fixture={fixture}
        opts={{ onFixtureSave, anchorProjectId: id, mentions: false, eager: true }}
        apiRef={newTaskApiRef}
      />
      {/* #446 issue 选择弹层：门与入口同闸（ghIssuesAvailable），关着不发
          请求（useGithubIssues enabled 位）。 */}
      {ghIssuesAvailable && id !== undefined && (
        <GithubIssuesDialog
          open={issuesOpen}
          onClose={closeIssues}
          projectId={id}
          teamId={teamId}
          onImported={onIssueImported}
        />
      )}
    </PageShell>
  );
}
