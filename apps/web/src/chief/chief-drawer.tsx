import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  type AskUserAnswer,
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
} from '@cairn/shared';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useMachines, useMembers, useProjects, useSkills, useTodos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { FOLLOW_THRESHOLD, JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Kbd } from '../components/ui/kbd.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { ChiefContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChiefFolder,
  ChiefGear,
  ChiefHash,
  ChiefUserPlus,
  Grid2x2,
  Minus,
  Paperclip,
  Plus,
  RuntimeClaudeCode,
  RuntimePi,
} from '../icons/index.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { AttachmentStrip } from '../overlay/attachment-strip.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { type MentionGroups, MentionInline, MentionPicker } from '../overlay/mention-picker.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';
import { useChiefNewThreadHotkey } from '../overlays/hotkeys.js';
import { ChiefStreamRow, chiefStreamRowKey } from './chief-message-rows.js';

const WINDOW_CLS =
  'chief-drawer fixed right-2 bottom-2 z-(--z-floating) flex h-150 max-h-[calc(100dvh-1rem)] w-95 max-w-[calc(100dvw-1rem)] flex-col overflow-hidden rounded-(--radius-window) bg-(--card) shadow-[var(--edge-ring),var(--floating-shadow)]';

const WINDOW_MOTION_CLS =
  'origin-[calc(100%-1.25rem)_calc(100%-1.25rem)] transition-none ease-(--ease-drawer) data-closed:fill-mode-forwards data-open:animate-in data-open:fade-in-0 data-open:zoom-in-40 data-open:duration-(--dur-window) data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-40 data-closed:duration-(--dur-overlay)';

const HEAD_ICON_BTN_CLS =
  "size-5 cursor-pointer justify-center rounded-none border-none bg-transparent p-0 text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const TOOL_BTN_CLS =
  "size-5 cursor-pointer text-(--text-tertiary) hover:text-(--text-secondary) dark:hover:text-(--text-secondary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const SEND_BTN_CLS =
  'ml-auto cursor-pointer rounded-md border-0 bg-transparent text-(--text-tertiary) hover:bg-transparent hover:text-(--text-secondary) dark:hover:bg-transparent aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0';
const SEND_ON_CLS =
  'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button) hover:text-(--text-on-accent)';

const SCROLLER_ROOT_CLS = 'h-auto min-h-0 flex-1';
const SCROLLER_CONTENT_CLS = 'block gap-0 px-4 pt-3.5';

const EXAMPLE_ICONS = {
  'user-plus': ChiefUserPlus,
  folder: ChiefFolder,
  grid: Grid2x2,
  bars: BarChart3,
} as const;

export const CHIEF_DRAFT_STORAGE_KEY = 'cairn.chief-draft';

function readStoredChiefDraft(): string {
  try {
    return localStorage.getItem(CHIEF_DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

interface DrawerProps {
  open?: boolean;
  chief: ChiefContent;
  onSettings?: () => void;
  onClose: () => void;
  onSend?: (text: string) => void | Promise<void>;
  onThread?: (title: string, index: number) => void;
  onNewThread?: () => void;
  onRewind?: (messageId: string) => void;
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancelQuestion?: (requestId: string) => void;
}

interface InnerProps extends DrawerProps {
  threadsOpen: boolean;
  setThreadsOpen: Dispatch<SetStateAction<boolean>>;
}

export function ChiefDrawer(props: DrawerProps) {
  const { open = true, chief } = props;
  const { t } = useI18n();
  const [threadsOpen, setThreadsOpen] = useState(chief.threadsOpen ?? false);
  const [atBottom, setAtBottom] = useState(true);
  return (
    <DialogPrimitive.Root
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(next: boolean, details?: { reason?: string }) => {
        if (next) return;
        if (details?.reason === 'escape-key' && threadsOpen) setThreadsOpen(false);
      }}
    >
      <DialogPrimitive.Portal keepMounted>
        <DialogPrimitive.Popup
          render={<aside className={`${WINDOW_CLS} ${WINDOW_MOTION_CLS}`} aria-label={t('总管')} />}
          initialFocus={false}
          finalFocus={false}
        >
          <MessageScrollerProvider
            autoScroll={open && atBottom}
            scrollEdgeThreshold={FOLLOW_THRESHOLD}
            defaultScrollPosition="end"
          >
            <ChiefFollowArmed onAtBottom={setAtBottom} />
            <ChiefDrawerInner
              {...props}
              threadsOpen={threadsOpen}
              setThreadsOpen={setThreadsOpen}
            />
          </MessageScrollerProvider>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ChiefFollowArmed({ onAtBottom }: { onAtBottom: (atBottom: boolean) => void }) {
  const scrollable = useMessageScrollerScrollable();
  useEffect(() => {
    onAtBottom(!scrollable.end);
  }, [scrollable.end, onAtBottom]);
  return null;
}

function ChiefDrawerInner({
  chief,
  open = true,
  onSettings,
  onClose,
  onSend,
  onThread,
  onNewThread,
  onRewind,
  onAnswerQuestion,
  onCancelQuestion,
  threadsOpen,
  setThreadsOpen,
}: InnerProps) {
  const { t } = useI18n();
  const { live, teamId, user } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const membersQ = useMembers(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mentionGroups: MentionGroups = {
    todo: (todosQ.data ?? []).map((td) => ({
      id: td.id,
      label: `#${td.seqNum} ${td.title}`,
      seq: td.seqNum,
      subtitle: td.phase,
    })),
    agent: (membersQ.data ?? [])
      .filter((m) => m.memberType === 'agent')
      .map((m) => ({
        id: m.actorId,
        label: (m.actor as { displayName?: string } | undefined)?.displayName ?? m.actorId,
        subtitle:
          (m.actor as { description?: string | null } | undefined)?.description ?? undefined,
      })),
    project: (projectsQ.data ?? []).map((p) => ({ id: p.id, label: p.name })),
    skill: (skillsQ.data ?? []).map((s) => ({
      id: s.id,
      label: s.name,
      subtitle: s.description ?? undefined,
    })),
    machine: (machinesQ.data ?? []).map((m) => ({ id: m.id, label: m.name })),
  };
  const onAttachment =
    onSend != null ? (files: File[]) => uploadMessageAttachments(files, t) : undefined;
  const { scrollToEnd } = useMessageScroller();
  const prevThreadRef = useRef(chief.threadTitle);
  useEffect(() => {
    if (prevThreadRef.current === chief.threadTitle) return;
    prevThreadRef.current = chief.threadTitle;
    if (open) scrollToEnd();
  }, [chief.threadTitle, open, scrollToEnd]);
  const [rewindConfirm, setRewindConfirm] = useState<{ index: number; id: string | null } | null>(
    null,
  );
  const [toolsOpen, setToolsOpen] = useState<Set<number>>(() => new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyText = (key: string, text: string) => {
    const clip = navigator.clipboard;
    if (!clip) return;
    void clip.writeText(text).then(
      () => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
      },
      () => {},
    );
  };
  const toggleTools = (i: number) =>
    setToolsOpen((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const [liveDraft, setLiveDraft] = useState(() => (live ? readStoredChiefDraft() : ''));
  useEffect(() => {
    if (!live) return;
    try {
      if (liveDraft === '') localStorage.removeItem(CHIEF_DRAFT_STORAGE_KEY);
      else localStorage.setItem(CHIEF_DRAFT_STORAGE_KEY, liveDraft);
    } catch {}
  }, [live, liveDraft]);
  const wire = useComposerWire({
    editable: onSend != null,
    draft: onSend != null ? liveDraft : (chief.draft ?? ''),
    onDraftChange: onSend != null ? setLiveDraft : undefined,
    onSend:
      onSend == null
        ? undefined
        : (text: string) => {
            scrollToEnd();
            return onSend(text);
          },
    onAttachment,
    mentionGroups,
    slash: {
      reviewAvailable: false,
      stopAvailable: false,
    },
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
    pickerOpen,
    togglePicker,
    closePicker,
    closeInline,
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
    closeSlash,
    acceptSlashRow,
    helpOpen,
    closeHelp,
    helpRows,
    helpSkillCount,
  } = wire;
  useEffect(() => {
    if (open) return;
    setThreadsOpen(false);
    setRewindConfirm(null);
    closePicker();
    closeInline();
    closeSlash();
    closeHelp();
  }, [open, closePicker, closeInline, closeSlash, closeHelp]);
  const { textareaRef } = wire;
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
    },
    [textareaRef],
  );
  const newThread = useCallback(() => {
    if (onNewThread == null) return;
    onNewThread();
    setThreadsOpen(false);
  }, [onNewThread]);
  useChiefNewThreadHotkey(open && onNewThread != null, newThread);
  return (
    <>
      <header className="relative px-4 pt-1 pb-3">
        <div className="flex items-center">
          <Button
            variant="ghost"
            className="h-auto min-w-0 shrink cursor-pointer gap-1.5 rounded-none border-none bg-transparent p-0 leading-[inherit] text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
            aria-label={t('主题')}
            onClick={() => setThreadsOpen((v) => !v)}
          >
            <ChiefHash />
            <span className="max-w-52 truncate font-heading text-heading font-medium text-(--foreground)">
              {t(chief.threadTitle)}
            </span>
            <ChevronDown width={12} height={12} />
          </Button>
          <div className="ml-auto flex items-center gap-3.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`relative ${HEAD_ICON_BTN_CLS}`}
                    aria-label={t('新主题')}
                    aria-keyshortcuts="N"
                    onClick={onNewThread != null ? newThread : undefined}
                  />
                }
              >
                <Plus width={18} height={18} />
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                <Kbd>N</Kbd>
              </TooltipContent>
            </Tooltip>
            {onSettings != null && (
              <Button
                variant="ghost"
                size="icon"
                className={HEAD_ICON_BTN_CLS}
                aria-label={t('总管设置')}
                onClick={onSettings}
              >
                <ChiefGear />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={HEAD_ICON_BTN_CLS}
              aria-label={t('最小化')}
              onClick={onClose}
            >
              <Minus width={16} height={16} />
            </Button>
          </div>
        </div>
        {chief.bound && (
          <div
            className="mt-1 flex items-center gap-1 text-meta text-(--text-tertiary)"
            data-testid="chief-model-row"
          >
            <span className="flex min-w-0 items-center gap-1 px-1">
              <span className="inline-flex flex-none items-center">
                {(chief.modelProvider ?? 'pi') === 'claude-code' ? (
                  <RuntimeClaudeCode width={12} height={12} />
                ) : (
                  <RuntimePi width={12} height={12} />
                )}
              </span>
              <span className="min-w-0 truncate">{chief.modelSlot}</span>
            </span>
          </div>
        )}
        {threadsOpen && (
          <div
            className="absolute top-8 left-3 z-[5] max-h-55 w-66 overflow-y-auto rounded-(--radius-popover) bg-(--popover) p-1 shadow-(--shadow-popover)"
            role="menu"
          >
            {(chief.threads ?? []).map((thread, index) => (
              <Button
                variant="ghost"
                role="menuitem"
                key={thread.title}
                aria-current={thread.active ? 'true' : undefined}
                className="h-8 w-full cursor-pointer justify-start gap-2 rounded-sm border-none bg-transparent px-2 text-left text-ui font-normal text-(--text-secondary) hover:bg-(--menu-hover) hover:text-(--foreground) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent aria-[current=true]:bg-(--menu-hover) aria-[current=true]:font-medium aria-[current=true]:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
                onClick={
                  onThread != null
                    ? () => {
                        onThread(thread.title, index);
                        setThreadsOpen(false);
                      }
                    : undefined
                }
              >
                <ChiefHash width={11} height={11} className="flex-none text-(--text-tertiary)" />
                <span className="truncate">{t(thread.title)}</span>
              </Button>
            ))}
          </div>
        )}
      </header>

      {!chief.bound && (
        <div
          data-testid="chief-gate"
          className="mx-4 flex h-14 flex-none items-center gap-3 rounded-(--radius-card) bg-(--card) pr-3 pl-4 text-ui text-(--text-secondary) ring-1 ring-(--border)"
        >
          <span>{t('请先为总管选择一个 Agent。')}</span>
          <Button
            className={`ml-auto cursor-pointer ${DIALOG_PRIMARY_BUTTON}`}
            onClick={onSettings}
          >
            {t('设置')}
          </Button>
        </div>
      )}
      {chief.examples && (
        <div className="flex-none">
          <h2
            className={`text-center font-heading text-heading font-medium text-(--foreground) ${
              chief.bound ? 'mt-14' : 'mt-16'
            }`}
          >
            {t('选择一个主题开始')}
          </h2>
          <div className="mx-8 mt-3 grid grid-cols-2 gap-2.5" data-testid="chief-examples">
            {chief.examples.map((ex) => {
              const Icon = EXAMPLE_ICONS[ex.icon];
              return (
                <Button
                  variant="ghost"
                  className="h-16 w-full cursor-pointer justify-start gap-3 rounded-(--radius-card) border-none bg-(--card) px-3 text-left whitespace-normal font-normal ring-1 ring-(--border) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
                  key={ex.text}
                  onClick={onSend != null ? () => void onSend(ex.text) : undefined}
                >
                  <span className="flex size-6 flex-none items-center justify-center text-(--text-tertiary)">
                    <Icon width={16} height={16} />
                  </span>
                  <span className="text-meta leading-5 text-(--text-secondary)">{t(ex.text)}</span>
                </Button>
              );
            })}
          </div>
        </div>
      )}
      <MessageScroller className={SCROLLER_ROOT_CLS}>
        <FadeScrollerViewport data-testid="chief-body">
          <MessageScrollerContent className={SCROLLER_CONTENT_CLS} data-testid="chief-stream">
            {chief.stream?.map((item, i) => (
              <ChiefStreamRow
                key={chiefStreamRowKey(item, i)}
                item={item}
                index={i}
                bound={chief.bound}
                agent={chief.agent}
                runningTool={chief.runningTool}
                user={user}
                copiedKey={copiedKey}
                onCopy={copyText}
                toolsOpen={toolsOpen}
                onToggleTools={toggleTools}
                onRewindRequest={(index, id) => setRewindConfirm({ index, id })}
                onAnswerQuestion={onAnswerQuestion}
                onCancelQuestion={onCancelQuestion}
              />
            ))}
          </MessageScrollerContent>
        </FadeScrollerViewport>
        <JumpToLatestButton>
          <ArrowDown width={16} height={16} />
          <span className="sr-only">{t('滚动到最新')}</span>
        </JumpToLatestButton>
      </MessageScroller>

      <div className="chief-composer [&>.attachment-strip]:mt-2 mx-4 my-2.5 rounded-(--radius-composer) border-0 bg-(--secondary) px-3 pt-3 pb-2.5 shadow-(--shadow-composer) transition-[box-shadow] duration-[220ms] ease-(--ease-out-expo) hover:shadow-(--shadow-composer-hover) focus-within:shadow-(--shadow-composer-focus)">
        <div className="relative">
          <Textarea
            ref={attachComposer}
            data-testid="chief-composer-input"
            className="h-15 max-h-30 min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent p-0 font-sans text-ui leading-5 text-(--foreground) md:text-ui tabular-nums shadow-none field-sizing-fixed placeholder:text-(--text-secondary) focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent"
            readOnly={onSend == null}
            value={wire.draft}
            onChange={wire.handleChange}
            onKeyDown={wire.handleKeyDown}
            onPaste={handlePaste}
            onKeyUp={handleCaretMoved}
            onClick={handleCaretMoved}
            onSelect={handleCaretMoved}
            onCompositionEnd={handleCompositionEnd}
            onBlur={handleBlur}
            placeholder={t(
              chief.running === true ? CHIEF_INPUT_PLACEHOLDER_STEERING : CHIEF_INPUT_PLACEHOLDER,
            )}
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
        <AttachmentStrip draft={wire.draft} pending={pendingAttachments} />
        {/* deliberate-native: hidden file picker trigger (display:none, opened programmatically); the visible skin is the attachment Button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onPickFiles}
          accept="text/*,image/*,application/json,application/pdf,application/xml"
        />
        <div className="mt-2.5 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('添加附件')}
            className={TOOL_BTN_CLS}
            disabled={attaching || onAttachment == null}
            onClick={openFilePicker}
          >
            <Paperclip width={16} height={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('提及')}
            className={TOOL_BTN_CLS}
            onClick={togglePicker}
          >
            <Grid2x2 width={16} height={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('发送')}
            className={wire.draft !== '' ? `${SEND_BTN_CLS} ${SEND_ON_CLS}` : SEND_BTN_CLS}
            onClick={wire.send}
          >
            <ArrowUp width={16} height={16} />
          </Button>
        </div>
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
      <DialogShell
        title={t('恢复到此处')}
        open={rewindConfirm !== null}
        onClose={() => setRewindConfirm(null)}
        size="s"
        footer={
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={() => setRewindConfirm(null)}
            >
              {t('取消')}
            </Button>
            <Button
              className={DIALOG_PRIMARY_BUTTON}
              onClick={() => {
                const anchor = rewindConfirm;
                setRewindConfirm(null);
                if (anchor?.id != null) onRewind?.(anchor.id);
              }}
            >
              {t('恢复到此处')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-ui text-foreground">
            {t('恢复到此处？该条之后的 {n} 条消息会移除，总管从这条重发开新回合。', {
              n: Math.max(0, (chief.stream?.length ?? 0) - (rewindConfirm?.index ?? 0) - 1),
            })}
          </p>
        </div>
      </DialogShell>
    </>
  );
}
