// Composer (issue #56, r7 §3.4): box anchored x737 w687 h76 → min-h84
// (#860: 3-line textarea + auto-grow), placeholder
// overlaps the send button in every capture (r7 §3.4), so the page renders
// the FAB after the composer and it covers the send pixels.
// XMON-55 P5: the stop is no longer a 14×14 bare red square — it is the send
// button's sibling (32×32, same fill, same bottom axis, 8px apart) carrying a
// 10px --stop glyph; the send lights up on the brand solid once a draft
// exists. Geometry and rationale live in detail.css.
//
//
// textarea tracks `@`-prefixed token positions to expose an inline
// agents-only listbox (r9 §3.2). Both paths route through
// insertMentionText so the picked mention lands at the caret position
// without losing focus (#625: both paths live in useComposerWire, this
// file renders the popover/inline skins). The picker is data-source
// agnostic — the caller (todo-detail-page) feeds in MentionGroups
// derived from either live REST hooks or the fixture set.

import { useLayoutEffect, useState } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUp, Grid2x2, Paperclip, SearchPlus } from '../icons/index.js';
import { AttachmentStrip } from '../overlay/attachment-strip.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { type MentionGroups, MentionInline, MentionPicker } from '../overlay/mention-picker.js';
import type { FileMentionEntry } from '../overlay/mention-token.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';
import { ComposerChips } from './composer-chips.js';

const COMPOSER_CARD =
  'composer relative mx-auto mb-4 w-[calc(100%-2rem)] max-w-(--chat-max-w) flex-none rounded-(--radius-composer) border-0 bg-(--card) shadow-(--shadow-composer) transition-[box-shadow] duration-[220ms] ease-(--ease-out-expo) hover:shadow-(--shadow-composer-hover) focus-within:shadow-(--shadow-composer-focus)';
const COMPOSER_PLACEHOLDER = 'px-4 pt-3 text-ui';
const COMPOSER_INPUT =
  "field-sizing-fixed h-12 min-h-0 max-h-(--composer-max-h) overflow-y-auto resize-none border-none bg-transparent px-4 pt-3 pb-0 [font-family:var(--font-inter),Inter,system-ui,-apple-system,'PingFang_SC','Microsoft_YaHei',sans-serif] text-ui text-(--foreground) tabular-nums transition-none outline-none placeholder:text-(--text-secondary) focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";
const COMPOSER_TOOL =
  'flex size-7.5 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-(--text-tertiary) hover:bg-transparent hover:text-(--text-secondary) dark:hover:bg-transparent dark:hover:text-(--text-secondary) active:not-aria-[haspopup]:translate-y-0';
const COMPOSER_SQUARE =
  'absolute bottom-3 flex size-8 cursor-pointer items-center justify-center rounded-(--cds-radius-lg) border-none p-0 active:not-aria-[haspopup]:translate-y-0';

interface ComposerProps {
  placeholder: string;
  aiReview: boolean;
  streaming: boolean;
  onSend?: (text: string) => void | Promise<void>;
  editable?: boolean;
  onAttachment?: (files: File[]) => string[] | Promise<string[]>;
  draft?: string;
  onDraftChange?: (next: string) => void;
  mentionGroups?: MentionGroups;
  mentionFiles?: FileMentionEntry[];
  onStop?: () => void;
  onReview?: () => void;
}

export function Composer({
  placeholder,
  aiReview,
  streaming,
  onSend,
  editable,
  onAttachment,
  draft: draftProp,
  onDraftChange,
  mentionGroups,
  mentionFiles,
  onStop,
  onReview,
}: ComposerProps) {
  const { t } = useI18n();
  const {
    draft,
    send,
    handleChange,
    handleKeyDown,
    handleCaretMoved,
    handleCompositionEnd,
    handleBlur,
    textareaRef,
    fileInputRef,
    openFilePicker,
    attaching,
    pendingAttachments,
    onPickFiles,
    handlePaste,
    pickerOpen,
    togglePicker,
    closePicker,
    inlineOpen,
    inlineCaret,
    inlineQuery,
    inlineRows,
    inlineHighlight,
    setInlineHighlight,
    inlineListboxId,
    inlineListboxRef,
    insertToken,
    insertTokens,
    insertFile,
    groups,
    slashOpen,
    slashQuery,
    slashCaret,
    slashSections,
    slashHighlight,
    setSlashHighlight,
    slashListboxId,
    slashListboxRef,
    acceptSlashRow,
    helpOpen,
    closeHelp,
    helpRows,
    helpSkillCount,
  } = useComposerWire({
    editable,
    draft: draftProp,
    onDraftChange,
    onSend,
    onAttachment,
    mentionGroups,
    mentionFiles,
    slash: {
      reviewAvailable: aiReview && onReview !== undefined,
      stopAvailable: streaming && onStop !== undefined,
      ...(onReview !== undefined ? { onReview } : {}),
      ...(onStop !== undefined ? { onStop } : {}),
    },
    growCap: 384,
  });

  const [multiLine, setMultiLine] = useState(false);
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta == null) {
      setMultiLine(false);
      return;
    }
    const trailingBlank = draft.length - draft.replace(/\n+$/, '').length;
    const measure = () => {
      const cs = getComputedStyle(ta);
      const visualLines = Math.floor(
        (ta.scrollHeight - Number.parseFloat(cs.paddingTop)) / Number.parseFloat(cs.lineHeight),
      );
      setMultiLine(visualLines - trailingBlank >= 2);
    };
    measure();
    let width = ta.clientWidth;
    const observer = new ResizeObserver(() => {
      if (ta.clientWidth === width) return;
      width = ta.clientWidth;
      measure();
    });
    observer.observe(ta);
    return () => observer.disconnect();
  }, [draft, textareaRef]);

  return (
    <div
      className={`${COMPOSER_CARD} min-h-21 ${multiLine ? 'pb-12' : ''}`}
      data-testid="composer-card"
    >
      {editable ? (
        <div>
          <Textarea
            ref={textareaRef}
            className={`composer-placeholder composer-input ${COMPOSER_INPUT}`}
            placeholder={t(placeholder)}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onKeyUp={handleCaretMoved}
            onClick={handleCaretMoved}
            onSelect={handleCaretMoved}
            onCompositionEnd={handleCompositionEnd}
            onBlur={handleBlur}
            {...(inlineOpen
              ? {
                  role: 'combobox',
                  'aria-expanded': true,
                  'aria-controls': inlineListboxId,
                  'aria-autocomplete': 'list' as const,
                }
              : {})}
            {...(inlineOpen && inlineHighlight != null
              ? { 'aria-activedescendant': `${inlineListboxId}-opt-${inlineHighlight}` }
              : {})}
          />
          <MentionInline
            open={inlineOpen}
            rows={inlineRows}
            caret={inlineCaret}
            query={inlineQuery}
            highlight={inlineHighlight}
            onHover={setInlineHighlight}
            onPick={(row) => {
              if (row.kind === 'file') {
                insertFile(row.label);
              } else {
                insertToken({
                  kind: row.kind,
                  id: row.id,
                  label: row.label,
                  ...(row.seq !== undefined ? { seq: row.seq } : {}),
                });
              }
            }}
            listboxRef={inlineListboxRef}
            listboxId={inlineListboxId}
          />
          <SlashMenu
            open={slashOpen}
            sections={slashSections.map((s) => ({
              title: s.section === 'builtin' ? t('命令') : t('技能'),
              rows: s.rows,
            }))}
            caret={slashCaret}
            query={slashQuery}
            highlight={slashHighlight}
            onHover={setSlashHighlight}
            onPick={(row) => acceptSlashRow(row, 'enter')}
            listboxRef={slashListboxRef}
            listboxId={slashListboxId}
          />
        </div>
      ) : (
        <div
          className={`composer-placeholder ${COMPOSER_PLACEHOLDER} text-(--text-secondary)`}
          data-testid="composer-placeholder"
        >
          {t(placeholder)}
        </div>
      )}
      <div
        data-testid="composer-float"
        className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+6px)] z-30 flex flex-col gap-1.5 [&>.attachment-strip]:pointer-events-auto [&>.composer-chips]:static!"
      >
        <ComposerChips draft={draft} files={mentionFiles} suspended={inlineOpen || slashOpen} />
        <AttachmentStrip draft={draft} pending={pendingAttachments} />
      </div>
      {/* deliberate-native: hidden file picker trigger (display:none, opened programmatically); the visible skin is the attachment Button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onPickFiles}
        accept="text/*,image/*,application/json,application/pdf,application/xml"
      />
      <div
        className="composer-toolbar absolute bottom-3 left-2.5 flex items-center"
        data-testid="composer-toolbar"
      >
        <IconTooltip
          label={t('添加附件')}
          trigger={
            <Button
              variant="ghost"
              className={`composer-tool ${COMPOSER_TOOL} mr-1.5 font-normal disabled:pointer-events-auto disabled:opacity-100 [&_svg:not([class*='size-'])]:size-auto`}
              disabled={attaching || !onAttachment}
              onClick={openFilePicker}
            />
          }
        >
          <Paperclip width={16} height={16} />
        </IconTooltip>
        {aiReview && (
          <IconTooltip
            label={t('AI 审核')}
            trigger={
              <Button
                variant="ghost"
                className={`composer-tool ${COMPOSER_TOOL} mr-1.5 font-normal [&_svg:not([class*='size-'])]:size-auto`}
                onClick={onReview}
              />
            }
          >
            <SearchPlus width={16} height={16} />
          </IconTooltip>
        )}
        <IconTooltip
          label={t('提及')}
          trigger={
            <Button
              variant="ghost"
              className={`composer-tool ${COMPOSER_TOOL} mr-1.5 font-normal [&_svg:not([class*='size-'])]:size-auto`}
              onClick={togglePicker}
            />
          }
        >
          <Grid2x2 width={16} height={16} />
        </IconTooltip>
      </div>
      {streaming && (
        <Button
          variant="ghost"
          className={`composer-stop ${COMPOSER_SQUARE} right-13 bg-(--seg-active) text-(--destructive) hover:bg-(--seg-active) hover:text-(--destructive) dark:hover:bg-(--seg-active) dark:hover:text-(--destructive) [&_svg:not([class*='size-'])]:size-auto`}
          aria-label={t('停止')}
          onClick={onStop}
        >
          <span className="size-2.5 rounded-(--cds-radius-xs) bg-current" />
        </Button>
      )}
      <Button
        variant="ghost"
        className={`composer-send ${COMPOSER_SQUARE} right-3 transition-[background-color,color] duration-(--dur-fast) ease-[cubic-bezier(0.2,0,0,1)] ${
          draft.trim() === ''
            ? 'bg-transparent text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary)'
            : 'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button) hover:text-(--text-on-accent) dark:hover:bg-(--card-button) dark:hover:text-(--text-on-accent)'
        } [&_svg:not([class*='size-'])]:size-auto`}
        aria-label={t('发送')}
        onClick={send}
      >
        <ArrowUp width={14} height={14} />
      </Button>
      <MentionPicker
        open={pickerOpen}
        onClose={closePicker}
        groups={groups}
        onInsert={(tokens) => {
          insertTokens(tokens);
          closePicker();
        }}
      />
      <SlashHelp
        open={helpOpen}
        onClose={closeHelp}
        commands={helpRows}
        skillCount={helpSkillCount}
      />
    </div>
  );
}
