import { type Ref, useEffect } from 'react';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { useI18n } from '../i18n/provider.js';
import { FileCheck, FileText, Layers, Puzzle, Server } from '../icons/index.js';
import type { InlineCompletionRow } from './mention-token.js';

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
  'mention-inline absolute left-0 w-120 max-w-full bottom-[calc(100%+8px)] z-40 max-h-62 overflow-auto rounded-(--radius-popover) bg-popover p-(--menu-pad) shadow-(--shadow-popover)';

const INLINE_ROW_CLS =
  'mention-inline-row flex h-7 w-full cursor-pointer items-center justify-start gap-2 rounded-(--radius-menu-item) border-0 bg-transparent px-2.5 text-left text-ui font-normal text-foreground hover:bg-transparent hover:text-foreground focus:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0';

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
            className={`${INLINE_ROW_CLS}${index === highlight ? ' mention-inline-row--active bg-(--menu-hover) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(row)}
          >
            {row.kind === 'agent' ? (
              <SeededAvatar
                name={row.label}
                fallback="/avatar-robot-1.svg"
                className="size-4 flex-none"
              />
            ) : (
              <span className="inline-flex size-4 flex-none items-center justify-center text-icon">
                <InlineKindIcon kind={row.kind} />
              </span>
            )}
            <span
              className={`min-w-0 truncate ${row.subtitle != null ? 'max-w-2/3 flex-none' : ''}`}
            >
              {row.label}
            </span>
            {row.subtitle != null && (
              <span className="min-w-0 truncate text-meta text-content-tertiary">
                {row.subtitle}
              </span>
            )}
          </Button>
        ))
      )}
    </div>
  );
}
