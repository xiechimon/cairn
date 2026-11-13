import { ATTACHMENT_ACCEPT } from '@cairn/shared';
import { cn } from 'cn';
import { ArrowUp, CornerDownLeft } from 'lucide-react';
import {
  type ReactNode,
  type Ref,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useChief } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useNarrow } from '../board/use-narrow.js';
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
import type { ChiefContextUsage, ComposerFileSeed } from '../fixtures/records.js';
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
  ContextMeterLine,
  ContextMeterRing,
  contextPercentOf,
  contextResumeOf,
  MOCK_CONTEXT_PERCENT,
} from './context-meter-ring.js';

export const TOOL_BTN_CLS =
  "size-7 cursor-pointer rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-auto";

export const PROJECT_CHIP_CLS =
  "h-7 max-w-48 cursor-pointer gap-1.5 rounded-lg border-none bg-transparent px-2 text-meta font-normal text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--foreground) dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) data-[set]:bg-(--menu-hover) data-[set]:text-(--foreground) [&_svg:not([class*='size-'])]:size-auto";

export const SEND_BTN_CLS =
  'ml-auto size-7 cursor-pointer rounded-(--radius-control) border-0 bg-transparent text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--text-secondary) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent';
export const SEND_ON_CLS = 'text-foreground hover:text-foreground dark:hover:text-foreground';
export const STOP_CLS =
  'text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover)';
export const ROUND_HIT_CLS =
  'group/round -m-1.5 size-11 flex-none cursor-pointer rounded-full border-0 bg-transparent p-0 text-foreground hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent';
export const ROUND_FACE_CLS = 'grid size-8 place-items-center rounded-full';
export const HOME_COMPOSER_CLS =
  'mx-auto mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] w-[calc(100%-2rem)] max-w-chat flex-none';
export const MENU_CONTENT_CLS = 'w-auto max-w-80 min-w-56';
export const COMPOSER_FIELD_CLS =
  'shadow-(--shadow-composer) focus-within:shadow-(--shadow-composer-focus)';

export interface ComposerSurfaceHandle {
  focus: (options?: FocusOptions) => void;
  attach: (files: File[]) => void;
}

export interface ComposerSend {
  label: string;
  testId: string;
  enabled: boolean;
  onClick: () => void;
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
  send?: ComposerSend | undefined;
  active?: boolean;
  onFocusEnter?: (() => void) | undefined;
  onFocusLeave?: (() => void) | undefined;
  onCancelReply?: (() => void) | undefined;
  placeholder: string;
  invalid: boolean;
  composerRef?: ((node: HTMLTextAreaElement | null) => void) | undefined;
  above: ReactNode;
  tools: ReactNode;
  menu?: ReactNode;
  canStop: boolean;
  onStop?: (() => void) | undefined;
  context?: ChiefContextUsage | null | undefined;
  threadId?: string | null;
  handleRef?: Ref<ComposerSurfaceHandle>;
  dropActive?: boolean;
  seededFiles?: ComposerFileSeed[] | undefined;
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
  send,
  active = true,
  onFocusEnter,
  onFocusLeave,
  onCancelReply,
  placeholder,
  invalid,
  composerRef,
  above,
  tools,
  menu,
  canStop,
  onStop,
  context = null,
  threadId = null,
  handleRef,
  dropActive = false,
  seededFiles,
}: ComposerSurfaceProps) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const chiefQ = useChief(teamId, live, threadId);
  const shownContext = live ? chiefQ.data?.context : context;
  const contextPercent = contextPercentOf(shownContext);
  const contextResume = contextResumeOf(shownContext);
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
  const [seeded, setSeeded] = useState(seededFiles ?? []);
  const attachRef = useRef(wire.attachFiles);
  attachRef.current = wire.attachFiles;
  useImperativeHandle(
    handleRef,
    () => ({
      focus: (options) => textareaRef.current?.focus(options),
      attach: (files) => attachRef.current(files),
    }),
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
  const narrow = useNarrow();
  const hasDraft =
    send !== undefined
      ? send.enabled
      : wire.draft !== '' ||
        wire.tokens.length > 0 ||
        pendingAttachments.some((entry) => !entry.failed);
  const showMeter = !live || contextPercent != null;
  const plusMenu = (
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
                  className={narrow ? ROUND_HIT_CLS : cn(TOOL_BTN_CLS, 'text-foreground')}
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
        <DropdownMenuItem disabled={attaching || onAttachment == null} onClick={openFilePicker}>
          <Paperclip width={20} height={20} />
          {t('添加附件')}
        </DropdownMenuItem>
        {menu != null && (
          <>
            <DropdownMenuSeparator />
            {menu}
          </>
        )}
        {narrow && showMeter && (
          <>
            <DropdownMenuSeparator />
            <ContextMeterLine
              percent={contextPercent ?? MOCK_CONTEXT_PERCENT}
              mock={contextPercent == null}
              resume={contextResume}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div
      hidden={!active}
      inert={!active}
      aria-hidden={active ? undefined : true}
      data-narrow={narrow || undefined}
      className={HOME_COMPOSER_CLS}
      style={active ? { viewTransitionName: 'chief-composer' } : undefined}
    >
      <div
        data-invalid={invalid ? '' : undefined}
        data-drop-target={dropActive && active ? '' : undefined}
        className={cn(
          active && 'chief-composer',
          COMPOSER_FIELD_CLS,
          'data-invalid:ring-1 data-invalid:ring-destructive data-drop-target:ring-2 data-drop-target:ring-(--focus-ring) rounded-(--radius-composer) border-0 bg-(--composer-fill)',
          narrow ? 'px-2 py-2' : 'px-3.5 py-2.25',
        )}
      >
        {above}
        <ComposerAttachments
          tokens={wire.tokens}
          pending={pendingAttachments}
          onRemove={wire.removeToken}
          onDismissPending={wire.dismissPending}
          seeded={seeded}
          onDismissSeeded={(index) => setSeeded((current) => current.filter((_, i) => i !== index))}
        />
        {narrow && (
          <div
            data-slot="composer-tools"
            className="mb-1 flex flex-wrap items-center gap-1 empty:hidden"
          >
            {tools}
          </div>
        )}
        <div className={cn('flex gap-2', narrow ? 'items-center' : 'items-end')}>
          {narrow && plusMenu}
          <div className="relative min-w-0 flex-1">
            <Textarea
              ref={attachComposer}
              data-testid={active ? 'chief-composer-input' : undefined}
              data-compose-target=""
              data-question-answer={active && onAdvance !== undefined ? '' : undefined}
              aria-invalid={invalid ? true : undefined}
              className={`h-7 max-h-30 min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent px-0.5 py-1 font-sans text-ui leading-5 md:text-ui tabular-nums shadow-none field-sizing-fixed focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent ${MENTION_TEXTAREA_CLS} placeholder:text-(--text-tertiary) [&::placeholder]:whitespace-nowrap [&::placeholder]:opacity-0`}
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
                if (
                  onCancelReply !== undefined &&
                  event.key === 'Escape' &&
                  wire.draft === '' &&
                  wire.tokens.length === 0
                ) {
                  event.preventDefault();
                  onCancelReply();
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
                className="pointer-events-none absolute inset-x-0 top-0 truncate px-0.5 py-1 font-sans text-ui leading-5 tabular-nums text-(--text-tertiary)"
              >
                {dropActive ? t('松开即可添加附件') : placeholder}
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
          {stopMode && send === undefined ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('停止 Coordinator 这次回复')}
              className={narrow ? cn(ROUND_HIT_CLS, 'ml-auto') : cn(SEND_BTN_CLS, STOP_CLS)}
              onClick={onStop}
            >
              {narrow ? (
                <span className={`${ROUND_FACE_CLS} bg-(--hover-1)`}>
                  <span className="size-3 rounded-(--cds-radius-xs) bg-current" />
                </span>
              ) : (
                <span className="size-3 rounded-(--cds-radius-xs) bg-current" />
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={send?.label ?? t('发送')}
              data-testid={send?.testId}
              disabled={send !== undefined && !send.enabled}
              className={
                narrow ? cn(ROUND_HIT_CLS, 'ml-auto') : cn(SEND_BTN_CLS, hasDraft && SEND_ON_CLS)
              }
              onClick={send?.onClick ?? wire.send}
            >
              {narrow ? (
                <span
                  className={cn(
                    ROUND_FACE_CLS,
                    'bg-(--hover-1)',
                    hasDraft ? 'text-foreground' : 'text-content-tertiary',
                  )}
                >
                  <ArrowUp width={20} height={20} />
                </span>
              ) : (
                <CornerDownLeft width={20} height={20} />
              )}
            </Button>
          )}
        </div>
        {/* deliberate-native: hidden file picker trigger (display:none, opened programmatically); the visible skin is the attachment Button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onPickFiles}
          accept={ATTACHMENT_ACCEPT}
        />
      </div>
      {!narrow && (
        <div className="mt-1.5 flex items-center gap-0 px-1.5">
          {plusMenu}
          {tools}
          {showMeter && (
            <span className="ml-auto flex">
              <ContextMeterRing
                percent={contextPercent ?? MOCK_CONTEXT_PERCENT}
                mock={contextPercent == null}
                resume={contextResume}
              />
            </span>
          )}
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
