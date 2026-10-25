import { type Ref, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent } from '../components/ui/dialog.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  PICKER_ROW_SELECTED,
} from '../components/ui/dialog-shell.js';
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

export interface MentionGroupEntry {
  id: string;
  label: string;
  subtitle?: string;
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
  open: boolean;
  onClose: () => void;
  onInsert: (tokens: MentionToken[]) => void;
  groups: MentionGroups;
}

type Layer = 'top' | MentionKind;

const CATEGORIES: { kind: MentionKind; Icon: typeof FileCheck }[] = [
  { kind: 'todo', Icon: FileCheck },
  { kind: 'skill', Icon: Puzzle },
  { kind: 'agent', Icon: Users },
  { kind: 'project', Icon: Layers },
  { kind: 'machine', Icon: Server },
];

const PANEL_CLS =
  'mention-picker flex max-h-[70vh] w-100 max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-lg bg-popover p-0 shadow-(--shadow-popover) ring-0 sm:max-w-100';

const ROW_CLS =
  'flex w-full cursor-pointer items-center justify-start gap-3 rounded-md border-0 bg-transparent px-3 py-0 text-left text-ui font-normal text-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground active:not-aria-[haspopup]:translate-y-0 disabled:pointer-events-auto disabled:cursor-default';

const HEAD_BTN_CLS =
  'size-6 cursor-pointer rounded-md text-content-tertiary active:not-aria-[haspopup]:translate-y-0';

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
  const [selected, setSelected] = useState<Record<MentionKind, Set<string>>>({
    todo: new Set(),
    skill: new Set(),
    agent: new Set(),
    project: new Set(),
    machine: new Set(),
  });

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
          <div className="flex-1 overflow-auto p-1">
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
            <div className="flex-1 overflow-auto p-1">
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
                        isSelected ? ` ${PICKER_ROW_SELECTED}` : ''
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

export interface MentionInlineProps {
  open: boolean;
  rows: InlineCompletionRow[];
  caret: number | null;
  query: string;
  highlight: number | null;
  onHover: (index: number) => void;
  onPick: (row: InlineCompletionRow) => void;
  listboxRef: Ref<HTMLDivElement>;
  listboxId: string;
}

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

const INLINE_PANEL_CLS =
  'mention-inline absolute inset-x-0 bottom-[calc(100%+8px)] z-40 max-h-55 overflow-auto rounded-lg bg-popover p-1 shadow-(--shadow-popover)';

const INLINE_ROW_CLS =
  'mention-inline-row flex h-10 w-full cursor-pointer items-center justify-start gap-2 rounded-md border-0 bg-transparent px-2 text-left text-ui font-normal text-foreground hover:bg-transparent hover:text-foreground focus:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0';

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
  useEffect(() => {
    if (!open || highlight == null) return;
    document.getElementById(`${listboxId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listboxId]);
  if (!open) return null;
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
            className={`${INLINE_ROW_CLS}${index === highlight ? ` mention-inline-row--active ${PICKER_ROW_SELECTED}` : ''}`}
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
