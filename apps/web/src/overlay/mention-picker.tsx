// Mention popover (issue #311, r9 §2.2/§3.2): a centered 400-wide panel
// that opens over a scrim. Top layer = five category rows (任务 / 技能 /
// Agents / 项目 / 机器) with counts; clicking a row drills in to a
// second layer with a search box and the row list. Selection is
// multi-select cumulative (no checkbox glyph per r9 §2.2 — the
// `插入 (N)` footer count is the only indicator); the footer offers
// 取消 / 插入 (N) with the count driving button state.
//
// Wire surface = onInsert(mentions[]). The caller maps the picker
// tokens into the host textarea / spec textarea via
// insertMentionText — the picker only knows about the structured
// MentionToken shape; it never touches the editor.
//
// Live / fixture dual-track: the picker is data-source agnostic. The
// caller (composer / new-task-dialog) decides whether to feed it from
// the live REST hooks or the fixture set and passes the resolved
// MentionGroups in. This mirrors search-panel's `server` prop
// pattern (#286): fixture mode keeps DOM-stable; live mode wires the
// real entity endpoints.
//
// #1008（#983 判决：floating-shell 族拆退役）：居中 fixed 模态族 → registry
// Dialog。壳皮肤（top-228 冻结坐标 / 负 margin 居中 / --z-picker / 12px 圆角
// 描边投影 / 手写 ClickCatcher）退役，几何与动效归 DialogContent 默认（居中
// translate + zoom-95，#991 Q9 registry 默认赢）；400 宽与 70vh 封顶是内容
// layout 槽，消费点 className 承载。外点关走 modal Dialog 原生背板（不穿透，
// 旧 ClickCatcher 同语义）。mention-picker-center.spec 钉的旧「transform=
// none 负 margin 居中」随重钉迁 registry 形（相位二）。
// 行钮收编 components/ui Button（ghost 七通道中和，#908 裁决 3；本族行不在
// motion.css hover 家族名单——「提及/下拉选中行 hover 即选中语义」是家族律
// 的登记例外，故 hover 底中和为透明，高亮只走 --selected/--active 类）。
// kind 身份色 tile/chip 走 mention-chip.ts 的槽映射（暂定正典，见该文件头注）。

import { type Ref, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent } from '../components/ui/dialog.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';
import {
  ChevronLeft,
  FileCheck,
  FileText,
  Layers,
  Puzzle,
  Server,
  Users,
  X,
} from '../icons/index.js';
import { mentionIconClass } from './mention-chip.js';
import type { InlineCompletionRow, MentionKind, MentionToken } from './mention-token.js';

/** One entity row inside a drilled-in category. The picker renders the
 *  `label` chip verbatim; for todo rows the label carries the seq
 *  prefix (`#1` etc.) built by the caller. `subtitle` is the
 *  secondary line (project name, machine id tail, etc.). */
export interface MentionGroupEntry {
  id: string;
  label: string;
  subtitle?: string;
  /** Todo seq (`#1`) — only set when `kind === 'todo'`. */
  seq?: number;
}

export interface MentionGroups {
  todo: MentionGroupEntry[];
  skill: MentionGroupEntry[];
  agent: MentionGroupEntry[];
  project: MentionGroupEntry[];
  machine: MentionGroupEntry[];
}

interface MentionPickerProps {
  /** #73 retained-mount open flag — exit fade outlives the close. */
  open: boolean;
  onClose: () => void;
  /** Caller receives the structured mention list (already filtered for
   *  the categories it selected). The picker closes after this fires. */
  onInsert: (tokens: MentionToken[]) => void;
  groups: MentionGroups;
}

type Layer = 'top' | MentionKind;

/** Category header config (label + icon). Order is the panel order
 *  (r9 §2.2 first-layer scan). */
const CATEGORIES: { kind: MentionKind; Icon: typeof FileCheck }[] = [
  { kind: 'todo', Icon: FileCheck },
  { kind: 'skill', Icon: Puzzle },
  { kind: 'agent', Icon: Users },
  { kind: 'project', Icon: Layers },
  { kind: 'machine', Icon: Server },
];

/** 面板 layout 槽（#1008：定位归 registry DialogContent 默认）：400 宽（窄
 *  视口回 calc(100vw-2rem) 件默认律）、70vh 封顶、列布局内部分段（head/list/
 *  foot 各自的 border 全出血，故 p-0 gap-0）。Paper 选择器面 = 白底 + 10px
 *  圆角 + 浮层投影（自带发丝环，ring-0 撤 registry 环）。别名 mention-picker
 *  原样（e2e 句柄）。 */
const PANEL_CLS =
  'mention-picker flex max-h-[70vh] w-100 max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-lg bg-popover p-0 shadow-(--shadow-popover) ring-0 sm:max-w-100';

/** 类目/实体行基底（原 .mention-row，Button ghost 七通道中和）。 */
const ROW_CLS =
  'flex w-full cursor-pointer items-center justify-start gap-3 border-0 bg-transparent px-4 py-0 text-left text-ui font-normal text-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground active:not-aria-[haspopup]:translate-y-0 disabled:pointer-events-auto disabled:cursor-default';

/** head 返回/关闭钮（原 .mention-picker-back/-close）：24px 方钮、tertiary
 *  墨，hover = ghost 档浅底 + 正文墨。 */
const HEAD_BTN_CLS =
  'size-6 cursor-pointer rounded-md text-content-tertiary active:not-aria-[haspopup]:translate-y-0';

/** r9 §2.2 first layer uses a 28px icon glyph + label + count chip on
 *  the right. Each row is 44 tall, pitch 45 — implemented as 44 + 1
 *  divider to match the existing overlay chip-row family. */
function TopRow({
  kind,
  Icon,
  count,
  onClick,
}: {
  kind: MentionKind;
  Icon: typeof FileCheck;
  count: number;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      type="button"
      className={`${ROW_CLS} mention-row--top h-11 disabled:opacity-50`}
      onClick={onClick}
      // Empty categories stay focusable so ⌘K-style screen-reader
      // navigation works — the click is a no-op when count is 0.
      disabled={count === 0}
      aria-label={`${labelFor(t, kind)} (${count})`}
    >
      <span className={mentionIconClass(kind)}>
        <Icon width={16} height={16} />
      </span>
      <span className="mention-row-label flex-1 font-medium">{labelFor(t, kind)}</span>
      <span className="mention-row-count text-meta text-content-tertiary tabular-nums">
        {count}
      </span>
    </Button>
  );
}

/** Resolved display label for a category. i18n keys are the existing
 *  chrome strings from en.ts (任务 / 技能 / Agents / 项目 / 机器); the
 *  picker uses them verbatim so the en fallback carries the same
 *  vocabulary as the rest of the app. */
function labelFor(t: ReturnType<typeof useI18n>['t'], kind: MentionKind): string {
  switch (kind) {
    case 'todo':
      return t('任务');
    case 'skill':
      return t('技能');
    case 'agent':
      return 'Agents';
    case 'project':
      return t('项目');
    case 'machine':
      return t('机器');
  }
}

export function MentionPicker({ open, onClose, onInsert, groups }: MentionPickerProps) {
  const { t } = useI18n();
  const [layer, setLayer] = useState<Layer>('top');
  const [query, setQuery] = useState('');
  // Selected ids per kind — the picker keeps them while the user
  // toggles rows inside the drilled layer; switching kind clears the
  // search query but keeps the accumulated selection for the Insert
  // count.
  const [selected, setSelected] = useState<Record<MentionKind, Set<string>>>({
    todo: new Set(),
    skill: new Set(),
    agent: new Set(),
    project: new Set(),
    machine: new Set(),
  });

  // Reset every time the popover opens — closing with no insert
  // should not leak the previous selection into the next open.
  useEffect(() => {
    if (!open) return;
    setLayer('top');
    setQuery('');
    setSelected({
      todo: new Set(),
      skill: new Set(),
      agent: new Set(),
      project: new Set(),
      machine: new Set(),
    });
  }, [open]);

  // Esc 由 FloatingShell（Base UI layer 栈）接管：嵌在 new-task-dialog 里时
  // 本面自动成 nested 顶层，Esc 只收本面，外层 dialog 收不到（不再需要旧
  // 窗口感知 + 调用方分层闸）。

  const allSelected = useMemo(() => {
    const list: { kind: MentionKind; id: string; label: string; seq?: number }[] = [];
    (Object.keys(selected) as MentionKind[]).forEach((kind) => {
      const entries = groups[kind];
      const ids = selected[kind];
      ids.forEach((id) => {
        const found = entries.find((e) => e.id === id);
        if (!found) return;
        list.push({ kind, id, label: found.label, seq: found.seq });
      });
    });
    return list;
  }, [selected, groups]);

  const counts: Record<MentionKind, number> = {
    todo: groups.todo.length,
    skill: groups.skill.length,
    agent: groups.agent.length,
    project: groups.project.length,
    machine: groups.machine.length,
  };

  const drilledKind: Exclude<MentionKind, 'todo'> | 'todo' | null = layer === 'top' ? null : layer;

  const drilledEntries = drilledKind === null ? [] : groups[drilledKind];
  const drilledQuery = query.trim().toLowerCase();
  const filteredEntries =
    drilledKind === null
      ? []
      : drilledQuery === ''
        ? drilledEntries
        : drilledEntries.filter((e) => e.label.toLowerCase().includes(drilledQuery));

  const toggle = (kind: MentionKind, id: string) => {
    setSelected((prev) => {
      const next = { ...prev, [kind]: new Set(prev[kind]) };
      if (next[kind].has(id)) next[kind].delete(id);
      else next[kind].add(id);
      return next;
    });
  };

  const insert = () => {
    const tokens: MentionToken[] = allSelected.map((s) => ({
      kind: s.kind,
      label: s.label,
      id: s.id,
      ...(s.seq != null ? { seq: s.seq } : {}),
    }));
    if (tokens.length === 0) return;
    onInsert(tokens);
  };

  return (
    // #1008：壳 = registry Dialog（居中 fixed 模态族判决，#983）。Esc/背板
    // 外点关归 Base UI 原生（modal 档外点不穿透，旧 ClickCatcher 同语义）；
    // 自带 head 关闭钮，故 registry 的 showCloseButton 关掉（双 X 重复）。
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className={PANEL_CLS} showCloseButton={false} aria-label={t('提及')}>
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          {layer !== 'top' ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className={`${HEAD_BTN_CLS} [&_svg:not([class*='size-'])]:size-auto`}
              aria-label={t('返回')}
              onClick={() => setLayer('top')}
            >
              <ChevronLeft width={14} height={14} />
            </Button>
          ) : null}
          <div className="flex-1 font-heading text-heading font-medium text-foreground">
            {layer === 'top' ? t('提及') : `${labelFor(t, layer)} · ${counts[layer]}`}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className={`${HEAD_BTN_CLS} [&_svg:not([class*='size-'])]:size-auto`}
            aria-label={t('关闭')}
            onClick={onClose}
          >
            <X width={14} height={14} />
          </Button>
        </div>
        {layer === 'top' ? (
          <div className="flex-1 overflow-auto py-1">
            {CATEGORIES.map(({ kind, Icon }) => (
              <TopRow
                key={kind}
                kind={kind}
                Icon={Icon}
                count={counts[kind]}
                onClick={() => setLayer(kind)}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-2">
              <Input
                type="text"
                className="h-8 border-border bg-background px-3 py-0 text-ui text-foreground dark:bg-background md:text-ui"
                placeholder={t('搜索…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-auto py-1">
              {filteredEntries.length === 0 ? (
                <div className="px-4 py-6 text-center text-meta text-content-tertiary">
                  {drilledQuery === ''
                    ? t('没有可引用的对象')
                    : t('没有与"{query}"匹配的结果', { query: drilledQuery })}
                </div>
              ) : (
                filteredEntries.map((entry) => {
                  const isSelected = selected[layer].has(entry.id);
                  return (
                    <Button
                      key={entry.id}
                      variant="ghost"
                      type="button"
                      className={`${ROW_CLS} mention-row--entry h-12${
                        isSelected ? ' bg-(--secondary)' : ''
                      }`}
                      onClick={() => toggle(layer, entry.id)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="mention-row-title truncate font-medium">
                          {entry.label}
                        </span>
                        {entry.subtitle != null && (
                          <span className="truncate text-meta text-content-tertiary">
                            {entry.subtitle}
                          </span>
                        )}
                      </span>
                    </Button>
                  );
                })
              )}
            </div>
          </>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          {/* #1055 角色分槽：确认动作 = 主操作 → 墨色胶囊（registry Button
              default 档，禁用态走 registry opacity 降档）。类名锚原位保留
              （e2e 定位面，零规则）。 */}
          <Button
            className={`mention-picker-insert ${DIALOG_PRIMARY_BUTTON}`}
            disabled={allSelected.length === 0}
            onClick={insert}
          >
            {t('插入 ({count})', { count: allSelected.length })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Inline unified `@` listbox for the composer (#728 agents-only origin, #760
 *  agents + files, #848 all five entity kinds + files).
 *
 *  Combobox pattern (#728, canon #727 §1 rules 20-24): the textarea keeps
 *  focus for the whole open window — rows are non-focusable (tabIndex -1 +
 *  mousedown preventDefault) and the highlight is exposed through
 *  aria-activedescendant on the textarea, row ids derived from `listboxId`.
 *  The old shape attached ONE ref to every row (`.current` = the last row)
 *  and stole focus on open, breaking continuous typing and IME. Keyboard
 *  and Esc live in composer-wire's handleKeyDown (single source, #625);
 *  this skin only renders state and reports hover/pick.
 *
 *  Partition (#848): ONE list, one ranking — kind travels per row and the
 *  glyph tells them apart (agent initial vs per-kind icon vs file glyph).
 *  No section headers: headers are not rows and would corrupt the ↑↓ cycle. */
export interface MentionInlineProps {
  open: boolean;
  rows: InlineCompletionRow[];
  /** Start offset of the detected `@` token (data-caret debug anchor). */
  caret: number | null;
  /** Query text after `@` — only the empty-state copy consumes it. */
  query: string;
  /** Highlighted row index; null = none highlighted (top row is NOT
   *  preselected — CC rule 56 isomorph, Enter without highlight sends). */
  highlight: number | null;
  /** Hover moves the highlight (CC rule 24). */
  onHover: (index: number) => void;
  onPick: (row: InlineCompletionRow) => void;
  /** Container ref for the wire's outside pointer-down containment check. */
  listboxRef: Ref<HTMLDivElement>;
  /** Base element id; rows are `${listboxId}-opt-${index}`. */
  listboxId: string;
}

/** Per-kind glyph for non-agent inline rows (#848 — the popover's icon
 *  family, reused so the two faces read as one vocabulary). */
function InlineKindIcon({ kind }: { kind: InlineCompletionRow['kind'] }) {
  switch (kind) {
    case 'todo':
      return <FileCheck width={14} height={14} />;
    case 'skill':
      return <Puzzle width={14} height={14} />;
    case 'project':
      return <Layers width={14} height={14} />;
    case 'machine':
      return <Server width={14} height={14} />;
    case 'file':
      return <FileText width={14} height={14} />;
    case 'agent':
      return null;
  }
}

/** 内联 listbox 面板（原 .mention-inline）：锚在 composer wrap 里，局部
 *  z40（#688 阶梯外，绘制收编于宿主面 stacking context）；与 slash-menu
 *  同锚同皮（r9 §2.2/§3.2）。 */
const INLINE_PANEL_CLS =
  'mention-inline absolute inset-x-0 bottom-[calc(100%+8px)] z-40 max-h-55 overflow-auto rounded-lg bg-popover p-1 shadow-(--shadow-popover)';

/** 内联行（原 .mention-inline-row，Button ghost 中和）：hover/focus 与
 *  JS 驱动的 --active 高亮共面（#728 combobox 律：箭头与 hover 一种视觉
 *  语言，DOM 焦点恒在 textarea）。 */
const INLINE_ROW_CLS =
  'mention-inline-row flex h-10 w-full cursor-pointer items-center justify-start gap-2 rounded-md border-0 bg-transparent px-2 text-left text-ui font-normal text-foreground hover:bg-(--secondary) hover:text-foreground focus:bg-(--secondary) dark:hover:bg-(--secondary) aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0';

export function MentionInline({
  open,
  rows,
  caret,
  query,
  highlight,
  onHover,
  onPick,
  listboxRef,
  listboxId,
}: MentionInlineProps) {
  const { t } = useI18n();
  // Keep the highlighted row visible inside the scrollable listbox.
  useEffect(() => {
    if (!open || highlight == null) return;
    document.getElementById(`${listboxId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listboxId]);
  if (!open) return null;
  // 条件渲染（关即卸载）= 仅进场：静态 animate-in 挂载即播，无退场窗。
  return (
    <div
      ref={listboxRef}
      id={listboxId}
      className={`${INLINE_PANEL_CLS} duration-100 ease-out animate-in fade-in-0 zoom-in-98`}
      role="listbox"
      aria-label={t('提及')}
      data-caret={caret ?? ''}
    >
      {rows.length === 0 ? (
        <div className="mention-inline-empty px-3 py-2 text-meta text-content-tertiary">
          {query === ''
            ? t('没有可引用的对象')
            : t('没有与"{query}"匹配的结果', { query: `@${query}` })}
        </div>
      ) : (
        rows.map((row, index) => (
          <Button
            key={`${row.kind}:${row.id}`}
            id={`${listboxId}-opt-${index}`}
            variant="ghost"
            tabIndex={-1}
            role="option"
            aria-selected={index === highlight}
            className={`${INLINE_ROW_CLS}${index === highlight ? ' mention-inline-row--active bg-(--secondary)' : ''}`}
            // Keep the textarea focused: a row mousedown must not blur it
            // (focus loss = broken continuous typing + IME, failure mode 4).
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(row)}
          >
            {row.kind === 'agent' ? (
              <span className="inline-flex size-6 flex-none items-center justify-center rounded-full bg-(--surface-tertiary) text-caption font-semibold text-foreground">
                {row.label.charAt(0).toLowerCase()}
              </span>
            ) : (
              <span className="inline-flex size-6 flex-none items-center justify-center rounded-full bg-(--surface-tertiary) text-caption font-semibold text-foreground">
                <InlineKindIcon kind={row.kind} />
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-px">
              <span className="truncate font-medium">{row.label}</span>
              {row.subtitle != null && (
                <span className="truncate text-meta text-content-tertiary">{row.subtitle}</span>
              )}
            </span>
          </Button>
        ))
      )}
    </div>
  );
}
