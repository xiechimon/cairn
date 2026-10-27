import { Fragment, type Ref, useEffect } from 'react';
import { Button } from '../components/ui/button.js';
import { DialogShell, PICKER_ROW_SELECTED } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import type { SlashRow } from './slash-commands.js';

export interface SlashMenuSection {
  title: string;
  rows: SlashRow[];
}

export interface SlashMenuProps {
  open: boolean;
  sections: SlashMenuSection[];
  caret: number | null;
  query: string;
  highlight: number | null;
  onHover: (index: number) => void;
  onPick: (row: SlashRow) => void;
  listboxRef: Ref<HTMLDivElement>;
  listboxId: string;
}

const MENU_CLS =
  'slash-menu absolute inset-x-0 bottom-[calc(100%+8px)] z-40 max-h-55 overflow-auto rounded-(--radius-popover) bg-popover p-(--menu-pad) shadow-(--shadow-popover)';

const ROW_CLS =
  'slash-menu-row flex h-auto w-full cursor-pointer items-baseline justify-start gap-2 rounded-(--radius-menu-item) border-0 px-2.5 py-2 text-left text-ui font-normal text-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground active:not-aria-[haspopup]:translate-y-0';

const NAME_CLS = 'flex-none font-mono text-meta';
const DESC_CLS = 'truncate text-meta text-content-tertiary';

export function SlashMenu({
  open,
  sections,
  caret,
  query,
  highlight,
  onHover,
  onPick,
  listboxRef,
  listboxId,
}: SlashMenuProps) {
  const { t } = useI18n();
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  useEffect(() => {
    if (!open || highlight == null) return;
    document.getElementById(`${listboxId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listboxId]);
  if (!open) return null;
  let offset = 0;
  return (
    <div
      ref={listboxRef}
      id={listboxId}
      className={`${MENU_CLS} duration-100 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2`}
      role="listbox"
      aria-label="Commands"
      data-caret={caret ?? ''}
    >
      {total === 0 ? (
        <div className="slash-menu-empty px-2 py-2 text-ui text-content-tertiary">
          {t('没有匹配"/{query}"的命令', { query })}
        </div>
      ) : (
        sections.map((section) => {
          const base = offset;
          offset += section.rows.length;
          return (
            <Fragment key={section.title}>
              <div className="px-2 pt-2 pb-1 text-caption text-content-tertiary" aria-hidden="true">
                {section.title}
              </div>
              {section.rows.map((row, i) => {
                const index = base + i;
                return (
                  <Button
                    key={`${section.title}-${row.name}`}
                    id={`${listboxId}-opt-${index}`}
                    variant="ghost"
                    tabIndex={-1}
                    role="option"
                    aria-selected={index === highlight}
                    className={`${ROW_CLS}${index === highlight ? ` ${PICKER_ROW_SELECTED}` : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onPick(row)}
                  >
                    <span className={NAME_CLS}>/{row.name}</span>
                    <span className={DESC_CLS}>
                      {row.descKey != null ? t(row.descKey) : (row.description ?? '')}
                    </span>
                  </Button>
                );
              })}
            </Fragment>
          );
        })
      )}
    </div>
  );
}

export interface SlashHelpProps {
  open: boolean;
  onClose: () => void;
  commands: SlashRow[];
  skillCount: number;
}

export function SlashHelp({ open, onClose, commands, skillCount }: SlashHelpProps) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('命令说明')}
      open={open}
      onClose={onClose}
      size="s"
      className="slash-help"
      hint={t('团队技能来自技能页面（共 {count} 个）', { count: skillCount })}
    >
      <div className="flex flex-col">
        {commands.map((row) => (
          <div key={row.name} className="slash-help-row flex items-baseline gap-2 py-2">
            <span className={NAME_CLS}>/{row.name}</span>
            <span className={DESC_CLS}>
              {row.descKey != null ? t(row.descKey) : (row.description ?? '')}
            </span>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
