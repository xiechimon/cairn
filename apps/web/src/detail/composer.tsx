import { ATTACHMENT_ACCEPT } from '@cairn/shared';
import { CornerDownLeft } from 'lucide-react';
import { formatClock, useLiveSeconds } from '../components/chat/live-row.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { type QueuedCapsule, QueuedCapsules } from '../components/queued-capsules.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { Lock, Paperclip, Plus, SearchPlus } from '../icons/index.js';
import { ComposerAttachments } from '../overlay/composer-attachments.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { useFileDrop } from '../overlay/file-drop.js';
import { MENTION_TEXTAREA_CLS, MentionHighlight } from '../overlay/mention-highlight.js';
import { MentionInline } from '../overlay/mention-inline.js';
import type { FileMentionEntry, MentionGroups } from '../overlay/mention-token.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';

const COMPOSER_CARD =
  'composer relative mx-auto mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] flex w-[calc(100%-2rem)] max-w-(--chat-max-w) flex-none flex-col rounded-(--radius-composer) border-0 px-2 py-2.25';
const COMPOSER_CARD_EDITABLE =
  'bg-(--composer-fill) shadow-(--shadow-composer) focus-within:shadow-(--shadow-composer-focus)';
const COMPOSER_CARD_READ_ONLY = 'bg-secondary shadow-(--shadow-composer)';
const COMPOSER_INPUT =
  'field-sizing-fixed h-7 min-h-0 max-h-(--composer-max-h) overflow-y-auto resize-none border-none bg-transparent px-0.5 py-1 max-[640px]:h-11 max-[640px]:py-3 font-sans text-ui leading-5 text-(--foreground) tabular-nums transition-none outline-none placeholder:text-(--text-tertiary) focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent';
const COMPOSER_TOOL =
  "flex size-7 flex-none cursor-pointer items-center justify-center rounded-(--radius-control) border-none bg-transparent p-0 font-normal text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground aria-expanded:bg-(--menu-hover) disabled:pointer-events-auto disabled:opacity-100 [&_svg:not([class*='size-'])]:size-auto";
const COMPOSER_SQUARE =
  "flex size-7 flex-none cursor-pointer items-center justify-center rounded-(--radius-control) border-none p-0 [&_svg:not([class*='size-'])]:size-auto";
const MENU_CONTENT_CLS = 'w-auto max-w-80 min-w-56';

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
  onEditQueued?: ((id: string, content: string) => Promise<unknown>) | undefined;
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
  onEditQueued,
}: ComposerProps) {
  const { t } = useI18n();
  const tick = useLiveSeconds(streaming ? workingFor?.startedAt : null);
  const elapsed = tick ?? workingFor?.seconds ?? null;
  const {
    draft,
    setDraft,
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
    attachFiles,
    dismissPending,
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

  const hasContent =
    draft.trim() !== '' || tokens.length > 0 || pendingAttachments.some((entry) => !entry.failed);
  const drop = useFileDrop(editable && onAttachment !== undefined ? attachFiles : undefined);

  const plusMenu = !readOnly && (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  aria-label={t('更多')}
                  data-testid="composer-plus"
                  className={`composer-tool ${COMPOSER_TOOL}`}
                />
              }
            />
          }
        >
          <Plus width={20} height={20} />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {t('更多')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        aria-label={t('更多')}
        finalFocus={textareaRef}
        className={MENU_CONTENT_CLS}
      >
        <DropdownMenuItem disabled={attaching || !onAttachment} onClick={openFilePicker}>
          <Paperclip width={20} height={20} />
          {t('添加附件')}
        </DropdownMenuItem>
        {aiReview && (
          <DropdownMenuItem onClick={onReview}>
            <SearchPlus width={20} height={20} />
            {t('审阅')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div
      {...drop.bind}
      className={`${COMPOSER_CARD} ${readOnly ? COMPOSER_CARD_READ_ONLY : COMPOSER_CARD_EDITABLE} data-drop-target:ring-2 data-drop-target:ring-(--focus-ring)`}
      data-drop-target={drop.active ? '' : undefined}
      data-testid="composer-card"
    >
      {editable && (
        <>
          <QueuedCapsules
            messages={queuedMessages ?? []}
            onSendNow={onSendQueuedNow}
            onRemove={onRemoveQueued}
            onEdit={onEditQueued}
            onEditSent={(content) =>
              setDraft((current) => (current.trim() === '' ? content : `${current}\n${content}`))
            }
          />
          <ComposerAttachments
            tokens={tokens}
            pending={pendingAttachments}
            onRemove={removeToken}
            onDismissPending={dismissPending}
          />
        </>
      )}
      <div className="composer-toolbar flex items-end gap-1" data-testid="composer-toolbar">
        {plusMenu}
        {editable ? (
          <div className="relative min-w-0 flex-1">
            <Textarea
              ref={textareaRef}
              data-compose-target=""
              aria-label={t(placeholder)}
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
          </div>
        ) : (
          <div
            className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-1.5 text-ui leading-5 text-(--text-secondary)"
            data-testid="composer-placeholder"
          >
            {readOnly && <Lock width={20} height={20} className="flex-none" />}
            {t(placeholder)}
          </div>
        )}
        {!readOnly && (
          <>
            {streaming && elapsed != null && (
              <span
                className="flex h-7 flex-none items-center px-1 text-meta tabular-nums text-(--text-tertiary)"
                data-testid="composer-working"
              >
                {t('工作中 · {time}', { time: formatClock(elapsed) })}
              </span>
            )}
            {streaming && (
              <IconTooltip
                label={t('停止')}
                trigger={
                  <Button
                    variant="ghost"
                    className={`composer-stop ${COMPOSER_SQUARE} text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground`}
                    onClick={onStop}
                  />
                }
              >
                <span className="size-2.25 rounded-(--cds-radius-xs) bg-current" />
              </IconTooltip>
            )}
            <IconTooltip
              label={t('发送')}
              trigger={
                <Button
                  variant="ghost"
                  className={`composer-send ${COMPOSER_SQUARE} transition-[background-color,color] duration-(--dur-fast) ease-[cubic-bezier(0.2,0,0,1)] ${
                    hasContent
                      ? 'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button) hover:text-(--text-on-accent) dark:hover:bg-(--card-button) dark:hover:text-(--text-on-accent)'
                      : 'bg-transparent text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--text-secondary) dark:hover:bg-(--menu-hover) dark:hover:text-(--text-secondary)'
                  }`}
                  onClick={send}
                />
              }
            >
              <CornerDownLeft width={20} height={20} />
            </IconTooltip>
          </>
        )}
      </div>
      <Input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onPickFiles}
        accept={ATTACHMENT_ACCEPT}
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
