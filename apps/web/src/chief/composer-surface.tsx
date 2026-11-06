import { cn } from 'cn';
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { formatClock } from '../components/chat/live-row.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUp, Plus } from '../icons/index.js';
import { ComposerAttachments } from '../overlay/composer-attachments.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { MENTION_TEXTAREA_CLS, MentionHighlight } from '../overlay/mention-highlight.js';
import { MentionInline } from '../overlay/mention-inline.js';
import type { MentionGroups } from '../overlay/mention-token.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';
import type { ComposerBinding } from './composer-binding.js';

export const TOOL_BTN_CLS =
  "size-7 cursor-pointer rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-auto";

export const PROJECT_CHIP_CLS =
  "h-7 max-w-48 cursor-pointer gap-1.5 rounded-lg border-none bg-transparent px-2 text-meta font-normal text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--foreground) dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) data-[set]:bg-(--menu-hover) data-[set]:text-(--foreground) [&_svg:not([class*='size-'])]:size-auto";

const SEND_BTN_CLS =
  'ml-auto size-7 cursor-pointer rounded-(--radius-control) border-0 bg-secondary text-(--text-tertiary) hover:bg-secondary hover:text-(--text-tertiary) dark:hover:bg-secondary aria-expanded:bg-transparent';
const SEND_ON_CLS =
  'bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:hover:bg-foreground/90';
const STOP_CLS =
  'text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover)';
const HOME_COMPOSER_CLS =
  'mx-auto mt-2 mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] w-[calc(100%-2rem)] max-w-182 flex-none';

export interface ComposerSurfaceHandle {
  focus: (options?: FocusOptions) => void;
}

export interface ComposerSurfaceProps {
  binding: ComposerBinding;
  editable: boolean;
  onSend?: ((text: string) => void | Promise<void>) | undefined;
  onAttachment?: ((files: File[]) => string[] | Promise<string[]>) | undefined;
  mentionGroups: MentionGroups;
  onPickProject?: ((project: { id: string }) => void) | undefined;
  slash: { reviewAvailable: boolean; stopAvailable: boolean; onStop: () => void };
  placeholder: string;
  invalid: boolean;
  home: boolean;
  open: boolean;
  composerRef?: ((node: HTMLTextAreaElement | null) => void) | undefined;
  above: ReactNode;
  tools: ReactNode;
  canStop: boolean;
  onStop?: (() => void) | undefined;
  running: boolean;
  turnElapsed: number | null;
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
  placeholder,
  invalid,
  home,
  open,
  composerRef,
  above,
  tools,
  canStop,
  onStop,
  running,
  turnElapsed,
  handleRef,
}: ComposerSurfaceProps) {
  const { t } = useI18n();
  const wire = useComposerWire({
    editable,
    draft: binding.draft,
    onDraftChange: binding.setDraft,
    onSend,
    onAttachment,
    mentionGroups,
    ...(onPickProject !== undefined ? { onPickProject } : {}),
    slash,
    growCap: 120,
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
    closeInline,
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
    closeSlash,
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
  useEffect(() => {
    if (open) return;
    closeInline();
    closeSlash();
    closeHelp();
  }, [open, closeInline, closeSlash, closeHelp]);
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;
    let frames = 0;
    const tryFocus = () => {
      const node = textareaRef.current;
      if (node == null) return;
      const shell = node.closest('[hidden], [data-starting-style]');
      if (shell == null) {
        node.focus({ preventScroll: true });
        return;
      }
      if (frames < 12) {
        frames += 1;
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }, [open, textareaRef]);
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
      data-invalid={invalid ? '' : undefined}
      className={`chief-composer ${home ? HOME_COMPOSER_CLS : 'mx-4 my-2.5'} data-invalid:ring-1 data-invalid:ring-destructive rounded-(--radius-composer) border-0 bg-card px-3.5 pt-3 pb-2.5 shadow-(--shadow-composer) hover:shadow-(--shadow-composer-hover) focus-within:shadow-(--shadow-composer-focus)`}
      style={home ? { viewTransitionName: 'chief-composer' } : undefined}
    >
      {above}
      <ComposerAttachments
        tokens={wire.tokens}
        pending={pendingAttachments}
        onRemove={wire.removeToken}
      />
      <div className="relative">
        <Textarea
          ref={attachComposer}
          data-testid="chief-composer-input"
          data-compose-target=""
          aria-invalid={invalid ? true : undefined}
          className={`h-9 max-h-30 min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent px-0.5 pt-0.5 pb-2.5 font-sans text-card-title md:text-card-title tabular-nums shadow-none field-sizing-fixed focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent ${MENTION_TEXTAREA_CLS} placeholder:text-(--text-tertiary)`}
          readOnly={!editable}
          value={wire.draft}
          onChange={wire.handleChange}
          onKeyDown={wire.handleKeyDown}
          onPaste={handlePaste}
          onKeyUp={handleCaretMoved}
          onClick={handleCaretMoved}
          onSelect={handleCaretMoved}
          onCompositionEnd={handleCompositionEnd}
          onBlur={handleBlur}
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
      {/* deliberate-native: hidden file picker trigger (display:none, opened programmatically); the visible skin is the attachment Button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onPickFiles}
        accept="text/*,image/*,application/json,application/pdf,application/xml"
      />
      <div className="-ml-1 flex items-center gap-0.5">
        <IconTooltip
          label={t('添加附件')}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className={`${TOOL_BTN_CLS} disabled:pointer-events-auto`}
              disabled={attaching || onAttachment == null}
              onClick={openFilePicker}
            />
          }
        >
          <Plus width={16} height={16} />
        </IconTooltip>
        {tools}
        {running && turnElapsed != null && (
          <span
            className="ml-auto flex h-7 items-center text-meta tabular-nums text-(--text-tertiary)"
            data-testid="chief-composer-working"
          >
            {t('工作中 · {time}', { time: formatClock(turnElapsed) })}
          </span>
        )}
        {stopMode ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('停止 Coordinator 这次回复')}
            className={cn(SEND_BTN_CLS, STOP_CLS, turnElapsed != null && 'ml-2')}
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
              turnElapsed != null && 'ml-2',
            )}
            onClick={wire.send}
          >
            <ArrowUp width={16} height={16} />
          </Button>
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
