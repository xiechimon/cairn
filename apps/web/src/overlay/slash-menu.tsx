import { Fragment, type Ref, useEffect, useLayoutEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
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

const ANCHOR_CLS = 'absolute bottom-[calc(100%+8px)] left-0 z-40 w-60 max-w-full';

const MENU_CLS =
  'slash-menu max-h-62 overflow-auto rounded-(--radius-popover) bg-popover p-(--menu-pad) shadow-(--shadow-popover)';

const ROW_CLS =
  'slash-menu-row flex h-7 w-full cursor-pointer items-center justify-start rounded-(--radius-menu-item) border-0 px-2.5 text-left text-ui font-normal text-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground active:not-aria-[haspopup]:translate-y-0';

const ROW_LIT = ' bg-(--menu-hover) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';

const BUBBLE_CLS =
  'pointer-events-none absolute left-[calc(100%+8px)] w-max max-w-56 rounded-md bg-foreground px-2.5 py-1.5 text-meta leading-snug text-background shadow-(--shadow-popover) max-sm:hidden';

const NAME_CLS = 'flex-none font-mono text-code text-foreground';
const DESC_CLS = 'truncate text-meta text-content-tertiary';

function MatchedName({ name, query }: { name: string; query: string }) {
  const at = query === '' ? -1 : name.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <span className="truncate">{name}</span>;
  return (
    <span className="truncate">
      {name.slice(0, at)}
      <b className="font-semibold">{name.slice(at, at + query.length)}</b>
      {name.slice(at + query.length)}
    </span>
  );
}

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
  const [bubbleTop, setBubbleTop] = useState<number | null>(null);
  useEffect(() => {
    if (!open || highlight == null) return;
    document.getElementById(`${listboxId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listboxId]);
  useLayoutEffect(() => {
    if (!open || highlight == null) {
      setBubbleTop(null);
      return;
    }
    const row = document.getElementById(`${listboxId}-opt-${highlight}`);
    const list = document.getElementById(listboxId);
    setBubbleTop(row == null || list == null ? null : row.offsetTop - list.scrollTop);
  });
  if (!open) return null;
  const rows = sections.flatMap((section) => section.rows);
  const lit = highlight == null ? undefined : rows[highlight];
  const litDesc = lit == null ? '' : lit.descKey != null ? t(lit.descKey) : (lit.description ?? '');
  let offset = 0;
  return (
    <div
      className={`${ANCHOR_CLS} duration-100 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2`}
    >
      <div
        ref={listboxRef}
        id={listboxId}
        className={MENU_CLS}
        role="listbox"
        aria-label="Commands"
        data-caret={caret ?? ''}
      >
        {total === 0 ? (
          <div className="slash-menu-empty px-2.5 py-1.5 text-ui text-content-tertiary">
            {t('没有匹配"/{query}"的命令', { query })}
          </div>
        ) : (
          sections.map((section, sectionIndex) => {
            const base = offset;
            offset += section.rows.length;
            return (
              <Fragment key={section.title}>
                {sectionIndex > 0 && section.rows.length > 0 && (
                  <div aria-hidden="true" className="mx-2.5 my-1 h-px bg-border" />
                )}
                {section.rows.map((row, i) => {
                  const index = base + i;
                  const desc = row.descKey != null ? t(row.descKey) : (row.description ?? '');
                  return (
                    <Button
                      key={`${section.title}-${row.name}`}
                      id={`${listboxId}-opt-${index}`}
                      variant="ghost"
                      tabIndex={-1}
                      role="option"
                      aria-selected={index === highlight}
                      aria-description={desc === '' ? undefined : desc}
                      className={`${ROW_CLS}${index === highlight ? ROW_LIT : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => onHover(index)}
                      onClick={() => onPick(row)}
                    >
                      <MatchedName name={row.name} query={query} />
                    </Button>
                  );
                })}
              </Fragment>
            );
          })
        )}
      </div>
      {litDesc !== '' && bubbleTop != null && (
        <div aria-hidden="true" className={BUBBLE_CLS} style={{ top: bubbleTop }}>
          {litDesc}
        </div>
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
