// Doc pane (issue #56, extended in #57 for the 变更 surface, in #67 for
// the 方案▾ type dropdown and in #75 for the r8 plan-version surfaces):
// plan mode keeps the 方案▾ / vN▾ header over the plan markdown (or the
// centered 暂无方案 placeholder in planning, r7 16). Changes mode
// (review/done/failed) renders the diff header 变更▾ v1▾ · N 个文件改动
// +N with the 全部展开/全部收起 toggle (r7 §3.6), one file row per changed
// file (chevron + name + 👁 + right-aligned +N), the unified-diff hunks
// when expanded (r7 27b) and the centered 暂无可显示的变更 placeholder
// when there is nothing to show (r7 38). #75 adds the version dropdown
// under the version chip (r8 63/70: version rows + 与其他版本对比… +
// 回到与 base 对比), the compare submenu (r8 64: 上一版本 alone) and the
// plan-version diff surface (r8 65–72: range chip `v1 → v2`, `+A −B`
// stats, del/add/marker rows). #225 wires the expanded file block's
// 显示完整文件 button: changes mode swaps the hunks for the conv-branch
// full text inline (live = GET /api/builds/{id}/changes/file, #224;
// fixture = DiffFile.fullContent), the button flipping to 显示差异 as the
// way back. #244 (#238 裁决 A) wires the same button on the plan-diff
// face: plan-version full text lives in the plans table (already loaded
// by the plans read face), not on the conv branch — it lands in the same
// DiffFile.fullContent slot in both fixture and live mode, no fetch.
// #366: the pane moved into the detail route's 488px right column and its
// 方案▾/变更▾ select became the pane-view picker (doc surface + the three
// static sections, overlays/plan-dropdown). The head now always renders —
// it carries that picker, so the empty surfaces keep their way out — and
// the changes/diff file stack scrolls in its column under the pinned head
// (the .doc-files alias was zero-reference, final pick under #1036).

import type { DiffFileContent } from '@pacman/shared';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useBuildChangeFile } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import type {
  ChangesContent,
  DiffFile,
  DocBlock,
  PaneView,
  PlanDiffContent,
  PlanVersion,
} from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FileTab,
  FileText,
  Restore,
  UnfoldVertical,
} from '../icons/index.js';
import { type DocTypeLabel, PaneTypeSelect } from '../overlays/plan-dropdown.js';
import { Segments } from './segments.js';
import { computeHunkWordDiff } from './word-diff.js';

interface DocPaneProps {
  /** plan: 方案 header + markdown; changes: diff surface (review/done/
   *  failed); diff: plan-version unified diff (r8 65–72). */
  mode: 'plan' | 'changes' | 'diff';
  doc: DocBlock[] | undefined;
  changes: ChangesContent | undefined;
  /** Fixture instant the relative version ages are measured against. */
  now: number;
  /** Scenario-frozen initial open state of the 方案▾ dropdown (#67). */
  planDropdownOpen?: boolean;
  /** #366: the type select is the right-pane view picker — picking a
   *  section row swaps the pane away from this doc surface. */
  onPaneView: (view: PaneView) => void;
  /** Build payload present → the dropdown lists the three section rows. */
  hasSections?: boolean;
  /** Version dropdown rows, newest first (r8 63/70). */
  planVersions?: PlanVersion[];
  /** Open menu on the version chip / range chip (r8 63/64). */
  versionMenu?: 'versions' | 'compare';
  onVersionMenu?: (menu: 'versions' | 'compare' | undefined) => void;
  /** 上一版本 picked in the compare submenu (r8 64 → 71). */
  onCompare?: () => void;
  /** 回到与 base 对比 picked (r8 70): drops the diff surface. */
  onBase?: () => void;
  /** Plan-version diff content (mode 'diff'). */
  planDiff?: PlanDiffContent;
  onToggleExpand?: () => void;
  /** #225: changes 面「显示完整文件」的 build 柄（live = buildId，fixture =
   *  null）；plan-diff 面不经此柄（#244：全文走 DiffFile.fullContent 槽，
   *  DiffFileBlock 收 null）。 */
  buildId?: string | null;
  /** #476（#473 决策候选 A）：plan 空态的任务元信息块（TaskMetaBlock）——
   *  给了就顶替居中「暂无方案」占位；只在 plan 面 doc==null 分支消费，
   *  不与文档面并存。fixture 面缺省（无数据源），占位字节不变。 */
  emptyMeta?: ReactNode;
}

// #945（detail.css 清零）：右栏文档面皮肤迁 token utilities。族律 = r7
// 27/27b/36 捕获：head 36px 发丝缝、文件行 32px surface-secondary、diff
// mono caption（hunk 头 20px 行盒 / 行 16px）、gutter 老新双列右对齐
// （各 20px，4px 网格）。ghost 七通道中和随各钮。
/** pane 头带（36px + 发丝缝，#366）——docpane 与 right-pane 三 section 头
 *  共用单源（#945：老 .doc-pane-head 规则族的两消费面防漂移律不变）。 */
export const PANE_HEAD =
  'flex h-9 flex-none items-center border-b border-(--border) pl-4 text-meta text-(--text-secondary) [&>svg]:text-(--text-tertiary)';
// #1006 原型（#980 前提④）：PANE_SELECT 七通道中和串退役——头带文字钮
// 走 registry ghost xs 档默认形态（hover:bg-muted 反馈生效），只留 layout
// 位（ml-0：wrap 内贴左）。plan-dropdown 的同名配方同步退役（两消费面
// 防漂移律不变）。
const PANE_SELECT = 'doc-pane-select ml-0';
const DIFF_LINE = 'flex items-center font-mono text-caption leading-4 text-(--text-secondary)';
const DIFF_NO = 'flex-none pr-1 text-right text-(--text-tertiary)';
const DIFF_KIND_SKIN: Record<string, string> = {
  add: 'bg-(--diff-add-bg)',
  del: 'bg-(--diff-del-bg)',
  marker: 'bg-transparent text-(--text-tertiary)',
  context: '',
};
// #1101 词级层：配对 del/add 行内变化的词骑更深/更饱和的底。token 明暗双
// 模定义在 shadcn.css（fg 对比度与可区分度实测读数 docs/verify/1101/
// contrast.txt）。状态载体走 data-word（#945 裁定：状态归数据，不新增
// 结构类名）。
const WORD_SKIN: Record<string, string> = {
  add: 'bg-(--diff-add-word-bg)',
  del: 'bg-(--diff-del-word-bg)',
};

/** 全文视图状态（#225，镜像 #202 deriveFileView 五态）：hidden = hunk 面；
 *  loading/error 仅 fetch 面可达（changes 面 live）；binary = 不可预览态
 *  （live base64 封套 / 槽位缺 fullContent）；text 直渲。 */
type FullFileView =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'binary' }
  | { kind: 'text'; content: string };

/** 结构子集传参，不绑 useQuery 全形（#202 code-review 同律）。
 *  fetchLive = 经 changes/file 端点取全文（changes 面 live）；false =
 *  槽位面（fixture 任意面 / plan-diff 面，#244）。 */
function deriveFullFileView(
  fetchLive: boolean,
  showFull: boolean,
  fixtureContent: string | null,
  file: { isError: boolean; data: DiffFileContent | undefined },
): FullFileView {
  if (!showFull) return { kind: 'hidden' };
  if (!fetchLive) {
    return fixtureContent !== null ? { kind: 'text', content: fixtureContent } : { kind: 'binary' };
  }
  if (file.isError) return { kind: 'error' };
  if (file.data === undefined) return { kind: 'loading' };
  return file.data.encoding === 'base64'
    ? { kind: 'binary' }
    : { kind: 'text', content: file.data.content };
}

/** 单文件 diff 块（r7 27/27b 捕获形）：文件行 + 展开的 hunk 面 + #1101
 *  词级高亮。#1102 起跨面复用（项目页提交详情面 import）——渲染单源不另写
 *  一套；复用面传 allowFullFile=false 摘掉「显示完整文件」钮（全文读面只有
 *  build changes/file 与 fullContent 槽两个数据源，提交详情面都没有）。 */
export function DiffFileBlock({
  file,
  expanded,
  buildId,
  allowFullFile = true,
}: {
  file: DiffFile;
  expanded: boolean;
  /** #225/#244 全文读面柄：changes 面 live = buildId（经 changes/file 端点取）；
   *  null = fullContent 槽（fixture 任意面 / plan-diff 面，机制见文件头）。 */
  buildId: string | null;
  /** #1102：false = 不渲染「显示完整文件」钮（无全文数据源的消费面）。 */
  allowFullFile?: boolean;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const [showFull, setShowFull] = useState(false);
  // fetch 面仅 changes 面 live 成立（buildId 非空）；buildId=null 时
  // （fixture 任意面 / plan-diff 面 live）走 fullContent 槽，不起请求。
  const fetchLive = live && buildId != null;
  const fullQ = useBuildChangeFile(buildId, showFull ? file.path : null, fetchLive);
  const full = deriveFullFileView(fetchLive, showFull, file.fullContent ?? null, fullQ);
  // #1101 词级配对是渲染层纯计算（word-diff.ts 头部注释 = 配对规则正本）。
  // memo 挂 hunks 身份：showFull 翻转等本地态重渲不重算；cap 兜住最坏成本。
  const wordDiffs = useMemo(
    () => file.hunks.map((hunk) => computeHunkWordDiff(hunk.lines)),
    [file.hunks],
  );
  return (
    <div>
      {/* 文件行骑 surface-secondary（r7 27 双模）：chevron + 路径 + 👁 +
          右对齐 +N（mono，−N 走 danger 墨）。 */}
      <div className="doc-file-row flex h-8 flex-none items-center gap-1.5 bg-(--secondary) pl-3 text-ui text-(--text-secondary) [&_svg]:text-(--text-tertiary)">
        {expanded ? (
          <ChevronDown width={10} height={10} />
        ) : (
          <ChevronRight width={10} height={10} />
        )}
        <FileText width={14} height={14} />
        {file.path}
        <span className="flex text-(--text-tertiary)">
          <Eye width={14} height={14} />
        </span>
        <span className="ml-auto pr-4 font-mono text-meta text-(--diff-add-fg)">
          +{file.added}
          {file.removed != null && file.removed > 0 && (
            <span className="text-(--destructive)"> −{file.removed}</span>
          )}
        </span>
      </div>
      {expanded && (
        <div>
          {full.kind === 'hidden' &&
            file.hunks.map((hunk, hi) => {
              const wordDiff = wordDiffs[hi];
              return (
                <div key={hunk.header}>
                  {/* ink-2 on --secondary: ink-3 there reads 4.19:1 in light (#1442) */}
                  <div className="diff-hunk-head border-y border-(--border) bg-(--secondary) pl-14 font-mono text-caption leading-5 text-(--text-secondary)">
                    {hunk.header}
                  </div>
                  {hunk.lines.map((line, i) => {
                    const segs = wordDiff?.segments.get(i);
                    const isCapped = wordDiff?.capped.has(i) === true;
                    return (
                      // fixture order is stable; lines carry no ids
                      <div
                        key={i}
                        className={`diff-line--${line.kind} ${DIFF_LINE} ${
                          DIFF_KIND_SKIN[line.kind] ?? ''
                        }`}
                        data-kind={line.kind}
                        // #1101 超限对退整行高亮，且不静默：capped 载体 +
                        // hover 说明（word-diff.ts 的 cap 常量是判据正本）。
                        data-word={isCapped ? 'capped' : undefined}
                        title={isCapped ? t('行过长，已退回整行高亮') : undefined}
                      >
                        <span data-no="old" className={`${DIFF_NO} w-5`}>
                          {line.oldNo ?? ''}
                        </span>
                        <span data-no="new" className={`${DIFF_NO} w-5`}>
                          {line.newNo ?? ''}
                        </span>
                        <span className="w-3 flex-none text-center text-(--diff-add-fg)">
                          {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}
                        </span>
                        <span className="pl-2 whitespace-pre">
                          {segs == null
                            ? line.text
                            : segs.map((seg, si) =>
                                seg.changed ? (
                                  // segment order is stable; fragments carry no ids
                                  <span
                                    key={si}
                                    data-word={line.kind}
                                    className={WORD_SKIN[line.kind]}
                                  >
                                    {seg.text}
                                  </span>
                                ) : (
                                  seg.text
                                ),
                              )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          {full.kind === 'text' && (
            <div data-testid="diff-full">
              {full.content
                .replace(/\n$/, '')
                .split('\n')
                .map((text, i) => (
                  // file order is stable; lines carry no ids
                  <div key={i} className={`${DIFF_LINE}`} data-kind="context">
                    <span data-no="old" className={`${DIFF_NO} w-5`} />
                    <span data-no="new" className={`${DIFF_NO} w-5`}>
                      {i + 1}
                    </span>
                    <span className="w-3 flex-none text-center text-(--diff-add-fg)" />
                    <span className="pl-2 whitespace-pre">{text}</span>
                  </div>
                ))}
            </div>
          )}
          {(full.kind === 'loading' || full.kind === 'error' || full.kind === 'binary') && (
            // #225 全文态占位：loading/error/binary 在 hunk 区同槽，左对齐
            // hunk 头文本位（56px），tertiary mono 同 hunk 头族。
            <div className="py-2 pr-3 pl-14 font-mono text-caption leading-4 text-(--text-tertiary)">
              {full.kind === 'loading'
                ? t('加载中…')
                : full.kind === 'error'
                  ? t('文件加载失败')
                  : t('二进制文件暂不支持预览')}
            </div>
          )}
          {/* #1006 原型（#980 前提④）：27px 满宽漆面条（surface-secondary
              恒压 hover）退役——ghost 档默认形态，满宽/左对齐是 layout 位，
              hover:bg-muted 反馈生效。allowFullFile=false（#1102 提交详情面）
              = 无全文数据源，钮整个不渲染（不留按下即「二进制」谎报的死钮）。 */}
          {allowFullFile && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setShowFull((v) => !v)}
            >
              <UnfoldVertical width={12} height={12} />
              {showFull ? t('显示差异') : t('显示完整文件')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The floating menu under the version chip / range chip: the version
 *  list (current row bold, restore glyph right, ages computed from the
 *  fixture instant), then 与其他版本对比… (right label = the open diff's
 *  `from`, r8 70) and — only while a diff is open — 回到与 base 对比. */
function VersionMenu({
  versions,
  menu,
  now,
  diffOpen,
  diffFrom,
  onMenu,
  onCompare,
  onBase,
}: {
  versions: PlanVersion[];
  menu: 'versions' | 'compare';
  now: number;
  diffOpen: boolean;
  diffFrom?: string;
  onMenu: (menu: 'versions' | 'compare' | undefined) => void;
  onCompare: () => void;
  onBase: () => void;
}) {
  const { t } = useI18n();
  // #1006 原型（#980 前提②④；#983「菜单族 → DropdownMenu」同族判例，
  // plan-dropdown/more-menu 先例）：手搓 absolute 菜单盘（37px 行距 +
  // 发丝缝 + 七通道中和 + --radius-popover/edge 投影皮肤）退役，组合
  // registry DropdownMenu 件——行形态/hover-focus 反馈/圆角/投影/进出场
  // 动效全部 registry 默认。compare 面沿老「整盘换面」契约（menu 联合态
  // 驱动单张 DropdownMenuContent 的内容切换，非嵌套 Submenu——嵌套会让
  // 单 menu 态同时驱动两层受控 open、item-press 与 outside-press 互相
  // 抢态；换面是本面既有交互正本）。受控 open 沿 versionMenu 页面态
  // （fixture 场景冻结契约不动）。.version-menu* 别名透传（e2e 句柄）。
  // 盘宽 212 右对齐是 layout 位（r8 §2.7 锚定经 Positioner align=end）。
  // 与其他版本对比… = closeOnClick=false 的换面项（保持菜单开、切 compare
  // 面），其余行是 select-and-close（#306 家族律）。
  if (menu === 'compare') {
    return (
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="version-menu--sub w-auto min-w-17"
      >
        <DropdownMenuItem className="version-menu-row" onClick={onCompare}>
          {t('上一版本')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  }
  return (
    <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-53">
      {versions.map((row, i) => (
        <DropdownMenuItem
          key={row.v}
          className={`version-menu-row justify-between${i === 0 ? ' font-semibold' : ''}`}
          onClick={() => onMenu(undefined)}
        >
          <span>
            {row.v} · {relativeTime(row.at, now, t)}
          </span>
          <Restore width={13} height={13} className="text-(--text-tertiary)" />
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        className="version-menu-row justify-between"
        closeOnClick={false}
        onClick={() => onMenu('compare')}
      >
        <span>{t('与其他版本对比…')}</span>
        {diffOpen && diffFrom != null && <span className="text-(--text-tertiary)">{diffFrom}</span>}
      </DropdownMenuItem>
      {diffOpen && (
        <DropdownMenuItem className="version-menu-row" onClick={onBase}>
          <span>{t('回到与 base 对比')}</span>
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}

/** Version chip + its menu anchor, shared by the plan-mode select and
 *  the diff-mode range chip (r8 63/70 anchor the panel to the chip's
 *  right edge). */
function VersionControl({
  range,
  label,
  planVersions,
  versionMenu,
  now,
  onVersionMenu,
  onCompare,
  onBase,
}: {
  /** Range chip (`v1 → v2`) when a diff is open; plain select otherwise. */
  range?: { from: string; to: string };
  label?: string;
  planVersions?: PlanVersion[];
  versionMenu?: 'versions' | 'compare';
  now: number;
  onVersionMenu?: (menu: 'versions' | 'compare' | undefined) => void;
  onCompare?: () => void;
  onBase?: () => void;
}) {
  return (
    <span className="doc-range-wrap relative ml-4 inline-flex">
      {/* #1006 原型（#980 前提④）：两 chip 钮收敛 registry Button 档——
          range chip = outline xs 档（描边 pill 的 registry 对应），select 面
          = ghost xs 档（plan-dropdown 同配方，防两消费面漂移律不变）；
          七通道中和串退役，hover/aria-expanded 反馈走底座。触发/开态归
          DropdownMenu 原语（受控 open 沿 versionMenu 页面态）。 */}
      <DropdownMenu
        open={versionMenu != null}
        onOpenChange={(next: boolean) => onVersionMenu?.(next ? 'versions' : undefined)}
      >
        {range != null ? (
          <DropdownMenuTrigger
            render={<Button variant="outline" size="xs" className="doc-range-chip" />}
          >
            {range.from} → {range.to}
            <ChevronDown width={12} height={12} />
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="xs" className={PANE_SELECT} />}
          >
            {label}
            <ChevronDown width={12} height={12} />
          </DropdownMenuTrigger>
        )}
        {onVersionMenu != null && planVersions != null && (
          <VersionMenu
            versions={planVersions}
            menu={versionMenu ?? 'versions'}
            now={now}
            diffOpen={range != null}
            diffFrom={range?.from}
            onMenu={onVersionMenu}
            onCompare={() => onCompare?.()}
            onBase={() => onBase?.()}
          />
        )}
      </DropdownMenu>
    </span>
  );
}

/** plan-doc 块皮肤（r8 56 / XMON-55 P2）：正文 15px/24；段间距 8px（首块
 *  归零）；bullet 悬挂 17/−12；节标签 = 12px/500 tertiary 上 22px 下 6px
 *  （是 label 不是 title——它引导的散文是 15px，节边界由更宽的上带标出）。 */
function docBlockClass(kind: string, first: boolean): string {
  const base = 'text-card-title leading-6 break-words text-(--foreground)';
  if (kind === 'para') return `${base}${first ? '' : ' mt-2'}`;
  if (kind === 'bullet') return `${base} pl-4 [text-indent:-12px]`;
  return `${base} ${first ? 'mt-0' : 'mt-6'} mb-1.5 text-meta font-medium tracking-[0.02em] text-(--text-tertiary)`;
}

export function DocPane({
  mode,
  doc,
  changes,
  now,
  planDropdownOpen,
  onPaneView,
  hasSections,
  planVersions,
  versionMenu,
  onVersionMenu,
  onCompare,
  onBase,
  planDiff,
  onToggleExpand,
  buildId,
  emptyMeta,
}: DocPaneProps) {
  const { t } = useI18n();
  // 方案▾/变更▾ 型选钮（#149 接线，#366 升级为右 pane 视图选择器）：
  // 首行 = 相位派生的文档型（✓，重选即留档面），其后三行 = 静止 section。
  const typeSelect = (docLabel: DocTypeLabel) => (
    <PaneTypeSelect
      view="doc"
      docLabel={docLabel}
      sections={hasSections}
      onView={onPaneView}
      initiallyOpen={planDropdownOpen}
    />
  );
  if (mode === 'changes' || mode === 'diff') {
    const hasData = mode === 'diff' ? planDiff != null : changes != null;
    const files = mode === 'diff' ? (planDiff?.files ?? []) : (changes?.files ?? []);
    const expanded = mode === 'diff' ? (planDiff?.expanded ?? false) : (changes?.expanded ?? false);
    const fileCount = files.length;
    const added = files.reduce((sum, f) => sum + f.added, 0);
    const removed = files.reduce((sum, f) => sum + (f.removed ?? 0), 0);
    return (
      <section className="doc-pane flex min-h-0 flex-1 flex-col" data-testid="doc-pane">
        {/* #366: the pane head always renders — it carries the view picker,
            so the empty surfaces keep their way out; the version chip /
            stat / toggle only make sense over data. */}
        <header className={PANE_HEAD}>
          <FileTab width={14} height={14} />
          {typeSelect(mode === 'diff' ? '方案' : '变更')}
          {hasData &&
            (mode === 'diff' && planDiff != null ? (
              <VersionControl
                range={{ from: planDiff.from, to: planDiff.to }}
                planVersions={planVersions}
                versionMenu={versionMenu}
                now={now}
                onVersionMenu={onVersionMenu}
                onCompare={onCompare}
                onBase={onBase}
              />
            ) : (
              <VersionControl
                label={planVersions?.[0]?.v ?? 'v1'}
                planVersions={planVersions}
                versionMenu={versionMenu}
                now={now}
                onVersionMenu={onVersionMenu}
                onCompare={onCompare}
                onBase={onBase}
              />
            ))}
          {hasData && (
            <>
              {/* changes mode（r7 27/36）：stat 簇 + 右对齐展开切换。 */}
              <span className="ml-4 text-(--text-tertiary)">
                {t('· {n} 个文件改动', { n: fileCount })}{' '}
                <span className="text-(--diff-add-fg)">+{added}</span>
                {removed > 0 && <span className="text-(--destructive)"> −{removed}</span>}
              </span>
              {/* #1006 原型（#980 前提④）：ghost xs 档默认形态（hover 反馈
                  生效），中和串退役；ml-auto 右对齐 + 17px 右衬是 layout 位。 */}
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto mr-4 text-(--text-tertiary)"
                onClick={onToggleExpand}
              >
                {expanded ? t('全部收起') : t('全部展开')}
              </Button>
            </>
          )}
        </header>
        {hasData ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* #1101 症状①（GitHub 形态，保留横向滚动）：行盒是 block 级
                flex，宽 = 容器宽，而 whitespace-pre 的长行溢出行盒——底色
                只画到视口宽，右滚即裸底。内层 w-max min-w-full 把「一行宽」
                抬成「整个文件栈最宽行的宽」：所有块级行盒（diff 行/hunk 头/
                文件行/全文行）自然撑满滚动宽，底色跟到最右端；内容不溢出
                时 min-w-full 与原布局逐像素等价。表格布局（display:table）
                是票面另一候选——弃用理由：要重写每行的 flex 行盒与 17/22px
                钉死几何，波及全部既有 e2e 载体，成本与风险都高于单盒方案。 */}
            <div className="w-max min-w-full">
              {files.map((file) => (
                <DiffFileBlock
                  key={file.path}
                  file={file}
                  expanded={expanded}
                  buildId={mode === 'changes' ? (buildId ?? null) : null}
                />
              ))}
            </div>
          </div>
        ) : (
          // changes-empty 占位（r7 38）：整 pane 居中、头上无 band——
          // --full 变体把 .doc-empty 的绝对居中改回 static flex 项。
          <div className="doc-empty static flex flex-1 items-center justify-center text-meta text-(--text-tertiary)">
            {t('暂无可显示的变更')}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="doc-pane flex min-h-0 flex-1 flex-col" data-testid="doc-pane">
      <header className={PANE_HEAD}>
        <FileTab width={14} height={14} />
        {typeSelect('方案')}
        {doc != null && (
          <VersionControl
            label={planVersions?.[0]?.v ?? 'v1'}
            planVersions={planVersions}
            versionMenu={versionMenu}
            now={now}
            onVersionMenu={onVersionMenu}
            onCompare={onCompare}
            onBase={onBase}
          />
        )}
      </header>
      <div
        className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6"
        data-testid="doc-body"
      >
        {doc == null
          ? // #476：live 空态由任务元信息块承接（顶对齐、随 doc-pane-body
            // 既有滚动）；fixture 面 emptyMeta 缺省 → 居中占位原样。
            (emptyMeta ?? (
              <div className="doc-empty absolute inset-0 flex items-center justify-center text-meta text-(--text-tertiary)">
                {t('暂无方案')}
              </div>
            ))
          : doc.map((block, i) => (
              <p
                // fixture order is stable; blocks carry no ids
                key={i}
                className={cn(`doc-block--${block.kind}`, docBlockClass(block.kind, i === 0))}
              >
                {block.kind === 'bullet' ? '• ' : ''}
                <Segments segments={block.segments} codeClassName="doc-code" />
              </p>
            ))}
      </div>
    </section>
  );
}
