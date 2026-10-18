// Slash menu + command help skins (issue #731).
//
// SlashMenu: the `/` listbox. Same combobox contract as MentionInline
// (#728): the textarea keeps focus for the whole open window — rows are
// non-focusable (tabIndex -1 + mousedown preventDefault) and the highlight
// is exposed through aria-activedescendant. Rows render in caller-given
// sections (builtins first, then skills); a zero total renders the empty
// state (rule 51 isomorph).
//
// SlashHelp: the `/help` panel. A read-only registry Dialog listing the
// currently available builtins with their descriptions — the only builtin
// that needs its own surface (proposal §2).
//
// #1008（#983 判决：floating-shell 族拆退役）：/help 面板 = 居中 fixed 模态
// 族 → registry Dialog。旧冻结坐标（top-228 / 400 宽 / 负 margin 居中）与
// 手写皮肤/ClickCatcher 退役，居中与动效归 DialogContent 默认（#991 Q9
// registry 默认赢）；400 宽与 70vh 封顶留 layout 槽。标题走 DialogTitle
// 语义映射（slash-help-title 别名零引用，已随 #1036 终摘）。listbox 面（SlashMenu 本体）
// 仍是 composer 相对锚的内联面板（无壳，非本票射程）。
// 行钮收编 components/ui Button（ghost 档七通道中和，#908
// comment-6001887439 裁决 3；行不在 motion.css hover 家族名单，hover 底
// 中和为透明、高亮只走 --active 类）。

import { Fragment, type Ref, useEffect } from 'react';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog.js';
import { DIALOG_FACE, PICKER_ROW_SELECTED } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import type { SlashRow } from './slash-commands.js';

export interface SlashMenuSection {
  title: string;
  rows: SlashRow[];
}

export interface SlashMenuProps {
  open: boolean;
  sections: SlashMenuSection[];
  /** Start offset of the detected `/` token (data-caret debug anchor). */
  caret: number | null;
  /** Query text after `/` — only the empty-state copy consumes it. */
  query: string;
  /** Global highlight index across sections; null = none highlighted. */
  highlight: number | null;
  onHover: (index: number) => void;
  onPick: (row: SlashRow) => void;
  listboxRef: Ref<HTMLDivElement>;
  listboxId: string;
}

/** 面板壳（原 .slash-menu）：与 .mention-inline 同锚同皮（r9 §2.2/§3.2）。 */
const MENU_CLS =
  'slash-menu absolute inset-x-0 bottom-[calc(100%+8px)] z-40 max-h-55 overflow-auto rounded-lg bg-popover p-1 shadow-(--shadow-popover)';

/** 行钮基底（原 .slash-menu-row，Button ghost 七通道中和 + h-auto——旧行
 *  高随内容，不吃件 size 档的 32px）。 */
const ROW_CLS =
  'slash-menu-row flex h-auto w-full cursor-pointer items-baseline justify-start gap-2 rounded-md border-0 px-2 py-2 text-left text-ui font-normal text-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground active:not-aria-[haspopup]:translate-y-0';

/** 命令行名（mono 12px，DESIGN 代码档）与描述（12px tertiary 截断）——menu
 *  行与 /help 行共用（原 .slash-menu-name / .slash-menu-desc）。 */
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
  /** Currently available builtins (same rows as the menu). */
  commands: SlashRow[];
  skillCount: number;
}

export function SlashHelp({ open, onClose, commands, skillCount }: SlashHelpProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      {/* layout 槽：400 宽（窄视口回件默认 calc 律）、70vh 封顶滚动；皮肤/
          居中/动效/z 归 DialogContent 默认。registry 关闭钮（X）是官网
          confirm 形态一部分，缺省开启。别名 slash-help 随行（e2e 句柄）。 */}
      <DialogContent
        className={`slash-help max-h-[70vh] w-100 max-w-[calc(100vw-2rem)] gap-0 overflow-auto p-4 sm:max-w-100 ${DIALOG_FACE}`}
      >
        <DialogTitle className="mb-2 font-heading text-heading leading-none">
          {t('命令说明')}
        </DialogTitle>
        <div className="flex max-h-80 flex-col overflow-auto">
          {commands.map((row) => (
            <div key={row.name} className="slash-help-row flex items-baseline gap-2 px-2 py-2">
              <span className={NAME_CLS}>/{row.name}</span>
              <span className={DESC_CLS}>
                {row.descKey != null ? t(row.descKey) : (row.description ?? '')}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-border pt-2 text-meta text-content-tertiary">
          {t('团队技能来自技能页面（共 {count} 个）', { count: skillCount })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
