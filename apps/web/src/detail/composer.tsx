import { formatClock, useLiveSeconds } from '../components/chat/live-row.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { type QueuedCapsule, QueuedCapsules } from '../components/queued-capsules.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUp, Lock, Plus, SearchPlus } from '../icons/index.js';
import { ComposerAttachments } from '../overlay/composer-attachments.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { MENTION_TEXTAREA_CLS, MentionHighlight } from '../overlay/mention-highlight.js';
import { MentionInline } from '../overlay/mention-inline.js';
import type { FileMentionEntry, MentionGroups } from '../overlay/mention-token.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';

const COMPOSER_CARD =
  'composer relative mx-auto mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] flex w-[calc(100%-2rem)] max-w-(--chat-max-w) flex-none flex-col rounded-(--radius-composer) border-0 px-3.5 pt-3 pb-2.5 transition-[box-shadow] duration-[220ms] ease-(--ease-out-expo)';
const COMPOSER_CARD_EDITABLE =
  'bg-(--card) shadow-(--shadow-composer) hover:shadow-(--shadow-composer-hover) focus-within:shadow-(--shadow-composer-focus)';
const COMPOSER_CARD_READ_ONLY = 'bg-secondary shadow-(--shadow-composer)';
const COMPOSER_INPUT =
  "field-sizing-fixed h-9 min-h-0 max-h-(--composer-max-h) overflow-y-auto resize-none border-none bg-transparent px-0.5 pt-0.5 pb-2.5 [font-family:var(--font-inter),Inter,system-ui,-apple-system,'PingFang_SC','Microsoft_YaHei',sans-serif] text-card-title text-(--foreground) tabular-nums transition-none outline-none placeholder:text-(--text-tertiary) focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";
const COMPOSER_TOOL =
  "flex size-7 cursor-pointer items-center justify-center rounded-(--radius-control) border-none bg-transparent p-0 font-normal text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground active:not-aria-[haspopup]:translate-y-0 disabled:pointer-events-auto disabled:opacity-100 [&_svg:not([class*='size-'])]:size-auto";
const COMPOSER_SQUARE =
  "flex size-7 cursor-pointer items-center justify-center rounded-(--radius-control) border-none p-0 active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

interface ComposerProps {
  placeholder: string;
  aiReview: boolean;
  streaming: boolean;
  onSend?: (text: string) => void | Promise<void>;
  onQueue?: (text: string) => void | Promise<void>;
  onStopAndSend?: (text: string) => void | Promise<void>;
  editable?: boolean;
  readOnly?: boolean;
  onAttachment?: (files: File[]) => string[] | Promise<string[]>;
  draft?: string;
  onDraftChange?: (next: string) => void;
  mentionGroups?: MentionGroups;
  mentionFiles?: FileMentionEntry[];
  onStop?: () => void;
  onReview?: () => void;
  workingFor?: { startedAt?: number | undefined; seconds?: number | undefined } | undefined;
  queuedMessages?: QueuedCapsule[] | undefined;
  onSendQueuedNow?: ((id: string, content: string) => Promise<unknown>) | undefined;
  onRemoveQueued?: ((id: string, content: string) => Promise<unknown>) | undefined;
}

export function Composer({
  placeholder,
  aiReview,
  streaming,
  onSend,
  onQueue,
  onStopAndSend,
  editable,
  readOnly = false,
  onAttachment,
  draft: draftProp,
  onDraftChange,
  mentionGroups,
  mentionFiles,
  onStop,
  onReview,
  workingFor,
  queuedMessages,
  onSendQueuedNow,
  onRemoveQueued,
}: ComposerProps) {
  const { t } = useI18n();
  const tick = useLiveSeconds(streaming ? workingFor?.startedAt : null);
  const elapsed = tick ?? workingFor?.seconds ?? null;
  const {
    draft,
    tokens,
    removeToken,
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
    inlineOpen,
    inlineCaret,
    inlineQuery,
    inlineRows,
    inlineHighlight,
    setInlineHighlight,
    inlineListboxId,
    inlineListboxRef,
    acceptInlineRow,
    mentionRegistry,
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
    onQueue,
    onStopAndSend,
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

  const hasContent = draft.trim() !== '' || tokens.length > 0 || pendingAttachments.length > 0;

  return (
    <div
      className={`${COMPOSER_CARD} ${readOnly ? COMPOSER_CARD_READ_ONLY : COMPOSER_CARD_EDITABLE}`}
      data-testid="composer-card"
    >
      {editable ? (
        <>
          <QueuedCapsules
            messages={queuedMessages ?? []}
            onSendNow={onSendQueuedNow}
            onRemove={onRemoveQueued}
          />
          <ComposerAttachments
            tokens={tokens}
            pending={pendingAttachments}
            onRemove={removeToken}
          />
          <div className="relative">
            <Textarea
              ref={textareaRef}
              className={`composer-placeholder composer-input ${COMPOSER_INPUT} ${MENTION_TEXTAREA_CLS}`}
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
            <MentionHighlight text={draft} registry={mentionRegistry} textareaRef={textareaRef} />
          </div>
          <MentionInline
            open={inlineOpen}
            rows={inlineRows}
            caret={inlineCaret}
            query={inlineQuery}
            highlight={inlineHighlight}
            onHover={setInlineHighlight}
            onPick={acceptInlineRow}
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
        </>
      ) : (
        <div
          className="flex items-center gap-2 px-0.5 pb-2.5 text-card-title text-(--text-secondary)"
          data-testid="composer-placeholder"
        >
          {readOnly && <Lock width={16} height={16} className="flex-none" />}
          {t(placeholder)}
        </div>
      )}
      <Input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onPickFiles}
        accept="text/*,image/*,application/json,application/pdf,application/xml"
      />
      {!readOnly && (
        <div
          className="composer-toolbar -ml-1 flex items-center gap-0.5"
          data-testid="composer-toolbar"
        >
          <IconTooltip
            label={t('添加附件')}
            trigger={
              <Button
                variant="ghost"
                className={`composer-tool ${COMPOSER_TOOL}`}
                disabled={attaching || !onAttachment}
                onClick={openFilePicker}
              />
            }
          >
            <Plus width={16} height={16} />
          </IconTooltip>
          {aiReview && (
            <IconTooltip
              label={t('AI 审核')}
              trigger={
                <Button
                  variant="ghost"
                  className={`composer-tool ${COMPOSER_TOOL} w-auto gap-1.5 px-2 text-meta`}
                  onClick={onReview}
                />
              }
            >
              <SearchPlus width={16} height={16} />
              {t('审阅')}
            </IconTooltip>
          )}
          <div className="ml-auto flex items-center gap-2">
            {streaming && elapsed != null && (
              <span
                className="text-meta tabular-nums text-(--text-tertiary)"
                data-testid="composer-working"
              >
                {t('工作中 · {time}', { time: formatClock(elapsed) })}
              </span>
            )}
            {streaming && (
              <Button
                variant="ghost"
                className={`composer-stop ${COMPOSER_SQUARE} bg-secondary text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground`}
                aria-label={t('停止')}
                onClick={onStop}
              >
                <span className="size-2.25 rounded-(--cds-radius-xs) bg-current" />
              </Button>
            )}
            <Button
              variant="ghost"
              className={`composer-send ${COMPOSER_SQUARE} transition-[background-color,color] duration-(--dur-fast) ease-[cubic-bezier(0.2,0,0,1)] ${
                hasContent
                  ? 'bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:hover:bg-foreground/90 dark:hover:text-background'
                  : 'bg-secondary text-(--text-tertiary) hover:bg-secondary hover:text-(--text-tertiary) dark:hover:bg-secondary dark:hover:text-(--text-tertiary)'
              }`}
              aria-label={t('发送')}
              onClick={send}
            >
              <ArrowUp width={14} height={14} />
            </Button>
          </div>
        </div>
      )}
      <SlashHelp
        open={helpOpen}
        onClose={closeHelp}
        commands={helpRows}
        skillCount={helpSkillCount}
      />
    </div>
  );
}
