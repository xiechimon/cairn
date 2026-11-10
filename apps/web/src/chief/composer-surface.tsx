import { cn } from 'cn';
import { CornerDownLeft } from 'lucide-react';
import { type ReactNode, type Ref, useCallback, useImperativeHandle } from 'react';
import { useChief } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { formatClock } from '../components/chat/live-row.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { Paperclip, Plus } from '../icons/index.js';
import { ComposerAttachments } from '../overlay/composer-attachments.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { MENTION_TEXTAREA_CLS, MentionHighlight } from '../overlay/mention-highlight.js';
import { MentionInline } from '../overlay/mention-inline.js';
import type { MentionGroups } from '../overlay/mention-token.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';
import type { ComposerBinding } from './composer-binding.js';
import {
  ContextMeterMenuRow,
  contextPercentOf,
  contextResumeOf,
  MOCK_CONTEXT_PERCENT,
} from './context-meter-ring.js';

export const TOOL_BTN_CLS =
  "size-7 cursor-pointer rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-auto";

export const PROJECT_CHIP_CLS =
  "h-7 max-w-48 cursor-pointer gap-1.5 rounded-lg border-none bg-transparent px-2 text-meta font-normal text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--foreground) dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) data-[set]:bg-(--menu-hover) data-[set]:text-(--foreground) [&_svg:not([class*='size-'])]:size-auto";

const SEND_BTN_CLS =
  'ml-auto size-7 cursor-pointer rounded-(--radius-control) border-0 bg-secondary text-(--text-tertiary) hover:bg-secondary hover:text-(--text-tertiary) dark:hover:bg-secondary aria-expanded:bg-transparent';
const SEND_ON_CLS =
  'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button)/90 hover:text-(--text-on-accent) dark:hover:bg-(--card-button)/90 dark:hover:text-(--text-on-accent)';
const STOP_CLS =
  'text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover)';
const HOME_COMPOSER_CLS =
  'mx-auto mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] w-[calc(100%-2rem)] max-w-182 flex-none';
const MENU_CONTENT_CLS = 'w-auto max-w-80 min-w-56';
const ATTACHED_COMPOSER_CLS =
  'mt-0 shadow-(--shadow-composer-attached) focus-within:shadow-(--shadow-composer-attached-focus)';
const FREE_COMPOSER_CLS =
  'rounded-t-(--radius-composer) shadow-(--shadow-composer) focus-within:shadow-(--shadow-composer-focus)';

export interface ComposerSurfaceHandle {
  focus: (options?: FocusOptions) => void;
}

export interface ComposerSurfaceProps {
  binding: ComposerBinding;
  editable: boolean;
  onSend?: ((text: string) => void | Promise<void>) | undefined;
  onAttachment?: ((files: File[]) => string[] | Promise<string[]>) | undefined;
  mentionGroups?: MentionGroups | undefined;
  onPickProject?: ((project: { id: string }) => void) | undefined;
  slash?: { reviewAvailable: boolean; stopAvailable: boolean; onStop: () => void } | undefined;
  onAdvance?: (() => void) | undefined;
  primary?: ReactNode;
  active?: boolean;
  attached?: boolean;
  onFocusEnter?: (() => void) | undefined;
  onFocusLeave?: (() => void) | undefined;
  placeholder: string;
  invalid: boolean;
  composerRef?: ((node: HTMLTextAreaElement | null) => void) | undefined;
  above: ReactNode;
  tools: ReactNode;
  menu?: ReactNode;
  canStop: boolean;
  onStop?: (() => void) | undefined;
  running: boolean;
  turnElapsed: number | null;
  threadId?: string | null;
  handleRef?: Ref<ComposerSurfaceHandle>;
}

export function ComposerSurface({
  binding,
  editable,
  onSend,
  onAttachment,
  mentionGroups,
  onPickProject,
  slash,
  onAdvance,
  primary,
  active = true,
  attached = false,
  onFocusEnter,
  onFocusLeave,
  placeholder,
  invalid,
  composerRef,
  above,
  tools,
  menu,
  canStop,
  onStop,
  running,
  turnElapsed,
  threadId = null,
  handleRef,
}: ComposerSurfaceProps) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const chiefQ = useChief(teamId, live, threadId);
  const contextPercent = contextPercentOf(chiefQ.data?.context);
  const contextResume = contextResumeOf(chiefQ.data?.context);
  const wire = useComposerWire({
    editable,
    draft: binding.draft,
    onDraftChange: binding.setDraft,
    ...(binding.readDraft !== undefined ? { readDraft: binding.readDraft } : {}),
    onSend,
    onAttachment,
    ...(mentionGroups !== undefined ? { mentionGroups } : {}),
    ...(onPickProject !== undefined ? { onPickProject } : {}),
    ...(slash !== undefined ? { slash } : {}),
    growCap: 120,
    active,
  });
  const {
    handlePaste,
    handleCaretMoved,
    handleCompositionEnd,
    handleBlur,
    fileInputRef,
    openFilePicker,
    attaching,
    pendingAttachments,
    onPickFiles,
    inlineOpen,
    inlineCaret,
    inlineQuery,
    inlineRows,
    inlineHighlight,
    setInlineHighlight,
    inlineListboxId,
    inlineListboxRef,
    acceptInlineRow,
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
    textareaRef,
  } = wire;
  useImperativeHandle(
    handleRef,
    () => ({ focus: (options) => textareaRef.current?.focus(options) }),
    [textareaRef],
  );
  const attachComposer = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      composerRef?.(node);
    },
    [textareaRef, composerRef],
  );
  const stopMode = canStop && wire.draft === '' && wire.tokens.length === 0;
  return (
    <div
      hidden={!active}
      inert={!active}
      aria-hidden={active ? undefined : true}
      className={`${HOME_COMPOSER_CLS} ${attached ? 'mt-0' : 'mt-2'}`}
      style={active ? { viewTransitionName: 'chief-composer' } : undefined}
    >
      <div
        data-invalid={invalid ? '' : undefined}
        className={`${active ? 'chief-composer ' : ''}${attached ? ATTACHED_COMPOSER_CLS : FREE_COMPOSER_CLS} data-invalid:ring-1 data-invalid:ring-destructive rounded-b-(--radius-composer) border-0 bg-card px-3.5 py-2.5`}
      >
        {above}
        <ComposerAttachments
          tokens={wire.tokens}
          pending={pendingAttachments}
          onRemove={wire.removeToken}
        />
        <div className="flex items-end gap-2">
          <div className="relative min-w-0 flex-1">
            <Textarea
              ref={attachComposer}
              data-testid={active ? 'chief-composer-input' : undefined}
              data-compose-target=""
              data-question-answer={active && onAdvance !== undefined ? '' : undefined}
              aria-invalid={invalid ? true : undefined}
              className={`h-7.25 max-h-30 min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent px-0.5 py-1 font-sans text-card-title md:text-card-title tabular-nums shadow-none field-sizing-fixed focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent ${MENTION_TEXTAREA_CLS} placeholder:text-(--text-tertiary) [&::placeholder]:whitespace-nowrap [&::placeholder]:opacity-0`}
              readOnly={!editable}
              value={wire.draft}
              onChange={wire.handleChange}
              onKeyDown={(event) => {
                if (
                  onAdvance !== undefined &&
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  if (!attaching) onAdvance();
                  return;
                }
                wire.handleKeyDown(event);
              }}
              onPaste={handlePaste}
              onKeyUp={handleCaretMoved}
              onClick={handleCaretMoved}
              onSelect={handleCaretMoved}
              onCompositionEnd={handleCompositionEnd}
              onFocus={onFocusEnter}
              onBlur={(event) => {
                handleBlur();
                const node = event.currentTarget;
                if (node.isConnected && node.checkVisibility()) onFocusLeave?.();
              }}
              placeholder={placeholder}
              {...(inlineOpen
                ? {
                    role: 'combobox',
                    'aria-expanded': true,
                    'aria-controls': inlineListboxId,
                    'aria-autocomplete': 'list' as const,
                  }
                : slashOpen
                  ? {
                      role: 'combobox',
                      'aria-expanded': true,
                      'aria-controls': slashListboxId,
                      'aria-autocomplete': 'list' as const,
                    }
                  : {})}
              {...(inlineOpen && inlineHighlight != null
                ? { 'aria-activedescendant': `${inlineListboxId}-opt-${inlineHighlight}` }
                : slashOpen && slashHighlight != null
                  ? { 'aria-activedescendant': `${slashListboxId}-opt-${slashHighlight}` }
                  : {})}
            />
            {wire.draft === '' && (
              <span
                aria-hidden
                data-testid={active ? 'chief-composer-placeholder' : undefined}
                className="pointer-events-none absolute inset-x-0 top-0 truncate px-0.5 py-1 font-sans text-card-title tabular-nums text-(--text-tertiary)"
              >
                {placeholder}
              </span>
            )}
            <MentionHighlight
              text={wire.draft}
              registry={wire.mentionRegistry}
              textareaRef={wire.textareaRef}
            />
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
          {primary ??
            (stopMode ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('停止 Coordinator 这次回复')}
                className={cn(SEND_BTN_CLS, STOP_CLS)}
                onClick={onStop}
              >
                <span className="size-2.25 rounded-(--cds-radius-xs) bg-current" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('发送')}
                className={cn(
                  SEND_BTN_CLS,
                  (wire.draft !== '' || wire.tokens.length > 0 || pendingAttachments.length > 0) &&
                    SEND_ON_CLS,
                )}
                onClick={wire.send}
              >
                <CornerDownLeft width={16} height={16} />
              </Button>
            ))}
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
      </div>
      <div className="mt-1.5 flex items-center gap-0.5 px-1">
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
                      className={TOOL_BTN_CLS}
                    />
                  }
                />
              }
            >
              <Plus width={16} height={16} />
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
            <DropdownMenuItem disabled={attaching || onAttachment == null} onClick={openFilePicker}>
              <Paperclip width={16} height={16} />
              {t('添加附件')}
            </DropdownMenuItem>
            {(!live || contextPercent != null) && (
              <ContextMeterMenuRow
                percent={contextPercent ?? MOCK_CONTEXT_PERCENT}
                mock={contextPercent == null}
                resume={contextResume}
              />
            )}
            {menu != null && (
              <>
                <DropdownMenuSeparator />
                {menu}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {tools}
        {running && turnElapsed != null && (
          <span
            className="ml-auto flex h-7 items-center text-meta tabular-nums text-(--text-tertiary)"
            data-testid="chief-composer-working"
          >
            {t('工作中 · {time}', { time: formatClock(turnElapsed) })}
          </span>
        )}
      </div>
      <SlashHelp
        open={helpOpen}
        onClose={closeHelp}
        commands={helpRows}
        skillCount={helpSkillCount}
      />
    </div>
  );
}
