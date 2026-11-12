import { ATTACHMENT_ACCEPT } from '@cairn/shared';
import { cn } from 'cn';
import { ArrowUp, CornerDownLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNarrow } from '../board/use-narrow.js';
import {
  COMPOSER_FIELD_CLS,
  HOME_COMPOSER_CLS,
  MENU_CONTENT_CLS,
  ROUND_FACE_CLS,
  ROUND_HIT_CLS,
  SEND_BTN_CLS,
  SEND_ON_CLS,
  STOP_CLS,
  TOOL_BTN_CLS,
} from '../chief/composer-surface.js';
import { formatClock, useLiveSeconds } from '../components/chat/live-row.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { type QueuedCapsule, QueuedCapsules } from '../components/queued-capsules.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

const COMPOSER_FIELD =
  'composer relative flex flex-col rounded-(--radius-composer) border-0 data-drop-target:ring-2 data-drop-target:ring-(--focus-ring)';
const COMPOSER_FIELD_READ_ONLY = 'bg-secondary shadow-(--shadow-composer)';
const COMPOSER_INPUT =
  'field-sizing-fixed h-7 min-h-0 max-h-(--composer-max-h) overflow-y-auto resize-none rounded-none border-none bg-transparent px-0.5 py-1 font-sans text-ui leading-5 md:text-ui text-(--foreground) tabular-nums shadow-none transition-none outline-none placeholder:text-(--text-tertiary) focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent';

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
  meter?: ReactNode;
  menuMeter?: ReactNode;
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
  meter,
  menuMeter,
}: ComposerProps) {
  const { t } = useI18n();
  const narrow = useNarrow();
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
                  size="icon"
                  aria-label={t('更多')}
                  data-testid="composer-plus"
                  className={cn(
                    'composer-tool',
                    narrow ? ROUND_HIT_CLS : cn(TOOL_BTN_CLS, 'text-foreground'),
                  )}
                />
              }
            />
          }
        >
          {narrow ? (
            <span
              className={`${ROUND_FACE_CLS} group-hover/round:bg-(--menu-hover) group-aria-expanded/round:bg-(--menu-hover)`}
            >
              <Plus width={20} height={20} />
            </span>
          ) : (
            <Plus width={20} height={20} />
          )}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {t('更多')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
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
        {narrow && menuMeter != null && (
          <>
            <DropdownMenuSeparator />
            {menuMeter}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div data-narrow={narrow || undefined} className={cn(HOME_COMPOSER_CLS, 'mt-2')}>
      <div
        {...drop.bind}
        className={cn(
          COMPOSER_FIELD,
          readOnly ? COMPOSER_FIELD_READ_ONLY : `bg-(--composer-fill) ${COMPOSER_FIELD_CLS}`,
          narrow ? 'px-2 py-2' : 'px-3.5 py-2.25',
        )}
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
        <div
          className={cn('composer-toolbar flex gap-2', narrow ? 'items-center' : 'items-end')}
          data-testid="composer-toolbar"
        >
          {narrow && plusMenu}
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
              className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-0.5 text-ui leading-5 text-(--text-secondary)"
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
                      size="icon"
                      className={cn(
                        'composer-stop',
                        narrow ? ROUND_HIT_CLS : cn(SEND_BTN_CLS, STOP_CLS),
                      )}
                      onClick={onStop}
                    />
                  }
                >
                  {narrow ? (
                    <span className={`${ROUND_FACE_CLS} bg-(--hover-1)`}>
                      <span className="size-2.25 rounded-(--cds-radius-xs) bg-current" />
                    </span>
                  ) : (
                    <span className="size-2.25 rounded-(--cds-radius-xs) bg-current" />
                  )}
                </IconTooltip>
              )}
              <IconTooltip
                label={t('发送')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'composer-send',
                      narrow ? ROUND_HIT_CLS : cn(SEND_BTN_CLS, hasContent && SEND_ON_CLS),
                    )}
                    onClick={send}
                  />
                }
              >
                {narrow ? (
                  <span
                    className={cn(
                      ROUND_FACE_CLS,
                      'bg-(--hover-1)',
                      hasContent ? 'text-foreground' : 'text-content-tertiary',
                    )}
                  >
                    <ArrowUp width={20} height={20} />
                  </span>
                ) : (
                  <CornerDownLeft width={20} height={20} />
                )}
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
      </div>
      {!narrow && (!readOnly || meter != null) && (
        <div data-slot="composer-tools" className="mt-1.5 flex items-center gap-0 px-1.5">
          {plusMenu}
          {meter != null && <span className="ml-auto flex">{meter}</span>}
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
