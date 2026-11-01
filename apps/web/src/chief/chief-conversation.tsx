import {
  type AskUserAnswer,
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
} from '@cairn/shared';
import { cn } from 'cn';
import { CircleDashed, TriangleAlert } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMachines, useMembers, useProjects, useSkills, useTodos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useProjectMark } from '../board/project-mark.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { formatClock, useLiveSeconds } from '../components/chat/live-row.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueuedCapsules } from '../components/queued-capsules.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import {
  MessageScroller,
  MessageScrollerContent,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { Textarea } from '../components/ui/textarea.js';
import { type TodoGlance, TodoGlanceContext } from '../detail/segments.js';
import type { ChiefContent, ChiefStreamItem, Phase } from '../fixtures/records.js';
import { useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChiefFolder,
  ChiefGear,
  ChiefUserPlus,
  Grid2x2,
  Minus,
  Plus,
  RuntimeClaudeCode,
  RuntimePi,
} from '../icons/index.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { ComposerAttachments } from '../overlay/composer-attachments.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { MENTION_TEXTAREA_CLS, MentionHighlight } from '../overlay/mention-highlight.js';
import { MentionInline } from '../overlay/mention-inline.js';
import type { MentionGroups } from '../overlay/mention-token.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';
import { ChiefStreamRow, chiefStreamRowKey, TurnElapsedContext } from './chief-message-rows.js';
import { ChiefFallbackBanner, ChiefOutageBanner } from './chief-outage-banner.js';
import { ProjectMenu } from './project-menu.js';

const HEAD_ICON_BTN_CLS =
  "size-6 cursor-pointer justify-center rounded-none border-none bg-transparent p-0 text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const TOOL_BTN_CLS =
  "size-7 cursor-pointer rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const PROJECT_CHIP_CLS =
  "h-7 max-w-48 cursor-pointer gap-1.5 rounded-lg border-none bg-transparent px-2 text-meta font-normal text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--foreground) dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) data-[set]:bg-(--menu-hover) data-[set]:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const SEND_BTN_CLS =
  'ml-auto size-7 cursor-pointer rounded-(--radius-control) border-0 bg-secondary text-(--text-tertiary) hover:bg-secondary hover:text-(--text-tertiary) dark:hover:bg-secondary aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0';
const SEND_ON_CLS =
  'bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:hover:bg-foreground/90';
const STOP_CLS =
  'text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover)';

const SCROLLER_ROOT_CLS = 'h-auto min-h-0 flex-1';
const SCROLLER_CONTENT_CLS = 'block gap-0 px-4 pt-3.5';
const SCROLLER_CONTENT_HOME_CLS = 'mx-auto block w-full max-w-190 gap-0 px-4 pt-3.5 pb-4';
const HOME_COMPOSER_CLS =
  'mx-auto mt-2 mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] w-[calc(100%-2rem)] max-w-182 flex-none';

const EXAMPLE_ICONS = {
  'user-plus': ChiefUserPlus,
  folder: ChiefFolder,
  grid: Grid2x2,
  bars: BarChart3,
} as const;

export const CHIEF_DRAFT_STORAGE_KEY = 'cairn.chief-draft';
export const CHIEF_PROJECT_STORAGE_KEY = 'cairn.chief-project';

function readStoredChiefDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function ChiefFollowArmed({ onAtBottom }: { onAtBottom: (atBottom: boolean) => void }) {
  const scrollable = useMessageScrollerScrollable();
  useEffect(() => {
    onAtBottom(!scrollable.end);
  }, [scrollable.end, onAtBottom]);
  return null;
}

export type ChiefConversationVariant = 'drawer' | 'global';

export interface ChiefConversationProps {
  variant: ChiefConversationVariant;
  open?: boolean;
  chief: ChiefContent;
  onSettings?: () => void;
  onClose?: () => void;
  onSend?: (text: string, projectId: string | null) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancelQuestion?: (requestId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
  onNewTask?: () => void;
  hero?: ReactNode;
  below?: ReactNode;
  heroCollapsed?: boolean;
  todoGlances?: ReadonlyMap<string, TodoGlance>;
  composerRef?: (node: HTMLTextAreaElement | null) => void;
  day?: { earlier: number; today: ReactNode };
  lead?: ReactNode;
  draftStorageKey?: string;
  initialDraft?: string;
  prefill?: { text: string; key: number } | null;
  placeholder?: string;
  composerError?: string | null;
  composerReplacement?: ReactNode;
  aboveComposer?: ReactNode;
}

export function ChiefConversation({
  variant,
  chief,
  open = true,
  onSettings,
  onClose,
  onSend,
  onRewind,
  onAnswerQuestion,
  onCancelQuestion,
  onWithdraw,
  onSteer,
  onStop,
  onNewTask,
  hero,
  below,
  heroCollapsed = false,
  todoGlances,
  composerRef,
  day,
  lead,
  draftStorageKey = CHIEF_DRAFT_STORAGE_KEY,
  initialDraft = '',
  prefill = null,
  placeholder,
  composerError = null,
  composerReplacement,
  aboveComposer,
}: ChiefConversationProps) {
  const projectMark = useProjectMark();
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
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
  const projectOptions = useMemo(
    () =>
      (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name, description: p.description })),
    [projectsQ.data],
  );
  const [storedProjectId, setStoredProjectId] = useState(() => {
    if (!live) return null;
    try {
      return localStorage.getItem(CHIEF_PROJECT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const pickedProject = projectOptions.find((p) => p.id === storedProjectId) ?? null;
  const chipVisible = variant !== 'global' && onSend != null && projectOptions.length > 1;
  const pickProject = useCallback((projectId: string | null) => {
    setStoredProjectId(projectId);
    try {
      if (projectId === null) localStorage.removeItem(CHIEF_PROJECT_STORAGE_KEY);
      else localStorage.setItem(CHIEF_PROJECT_STORAGE_KEY, projectId);
    } catch {}
  }, []);
  const chipProjectId = chipVisible ? (pickedProject?.id ?? null) : null;
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
  const [liveDraft, setLiveDraft] = useState(() =>
    live ? readStoredChiefDraft(draftStorageKey) : initialDraft,
  );
  useEffect(() => {
    if (!live) return;
    try {
      if (liveDraft === '') localStorage.removeItem(draftStorageKey);
      else localStorage.setItem(draftStorageKey, liveDraft);
    } catch {}
  }, [live, liveDraft, draftStorageKey]);
  const wire = useComposerWire({
    editable: onSend != null,
    draft: onSend != null ? liveDraft : (chief.draft ?? ''),
    onDraftChange: onSend != null ? setLiveDraft : undefined,
    onSend:
      onSend == null
        ? undefined
        : (text: string) => {
            scrollToEnd();
            return onSend(text, chipProjectId);
          },
    onAttachment,
    mentionGroups,
    ...(chipVisible ? { onPickProject: (p: { id: string }) => pickProject(p.id) } : {}),
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
  } = wire;
  useEffect(() => {
    if (open) return;
    setRewindConfirm(null);
    closeInline();
    closeSlash();
    closeHelp();
  }, [open, closeInline, closeSlash, closeHelp]);
  const { textareaRef } = wire;
  const prefillKey = prefill?.key;
  const prefillText = prefill?.text;
  useEffect(() => {
    if (prefillKey == null || prefillText == null) return;
    setLiveDraft(prefillText);
    textareaRef.current?.focus({ preventScroll: true });
  }, [prefillKey, prefillText, textareaRef]);
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
  const home = variant !== 'drawer';
  const ownHeader = variant !== 'global';
  const glances = useMemo(
    () =>
      todoGlances ??
      new Map(
        (todosQ.data ?? []).map((td) => [
          td.id,
          { phase: td.phase as Phase, seq: td.seqNum, title: td.title },
        ]),
      ),
    [todoGlances, todosQ.data],
  );
  const empty = (chief.stream?.length ?? 0) === 0;
  const heroLayout = home && empty && !heroCollapsed;
  const heroScrollRef = useRef<HTMLDivElement | null>(null);
  useScrollFade(heroScrollRef, { enabled: heroLayout });
  const stopMode =
    chief.running === true && wire.draft === '' && wire.tokens.length === 0 && onStop != null;
  const liveTurn =
    chief.running === true
      ? chief.stream?.findLast((item) => item.kind === 'streaming')
      : undefined;
  const turnTick = useLiveSeconds(liveTurn?.kind === 'streaming' ? liveTurn.startedAt : null);
  const turnElapsed =
    turnTick ?? (liveTurn?.kind === 'streaming' ? liveTurn.seconds : undefined) ?? null;
  const withdraw =
    onWithdraw == null
      ? undefined
      : (messageId: string, text: string) => {
          onWithdraw(messageId).then(
            () => {
              setLiveDraft((cur) => (cur === '' ? text : `${cur}\n${text}`));
              textareaRef.current?.focus({ preventScroll: true });
            },
            () => {},
          );
        };
  const allRows = (chief.stream ?? []).map((item, i) => ({ item, i }));
  const rows = allRows.filter(({ item }) => item.kind !== 'user' || item.pending == null);
  const queuedCapsules = allRows.flatMap(({ item }) =>
    item.kind === 'user' && item.pending != null && item.id != null
      ? [
          {
            id: item.id,
            content: item.text,
            ...(item.pending === 'held' ? { note: t('已存下，总管恢复后会处理') } : {}),
            held: item.pending === 'held',
          },
        ]
      : [],
  );
  const streamRow = ({ item, i }: { item: ChiefStreamItem; i: number }) => (
    <ChiefStreamRow
      key={chiefStreamRowKey(item, i)}
      item={item}
      index={i}
      bound={chief.bound}
      agent={chief.agent}
      runningTool={chief.runningTool}
      copiedKey={copiedKey}
      onCopy={copyText}
      toolsOpen={toolsOpen}
      onToggleTools={toggleTools}
      onRewindRequest={(index, id) => setRewindConfirm({ index, id })}
      onAnswerQuestion={onAnswerQuestion}
      onCancelQuestion={onCancelQuestion}
    />
  );
  const intro = (
    <>
      {!chief.bound && (
        <div
          data-testid="chief-gate"
          className={`${home ? 'mx-auto mt-4 w-[calc(100%-2rem)] max-w-182' : 'mx-4'} flex h-14 flex-none items-center gap-3 rounded-(--radius-card) bg-(--card) pr-3 pl-4 text-ui text-(--text-secondary) ring-1 ring-(--border)`}
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
            className={`text-center font-heading text-heading font-title text-(--foreground) ${
              chief.bound ? 'mt-14' : 'mt-16'
            }`}
          >
            {t('选择一个主题开始')}
          </h2>
          <div
            className={`${home ? 'mx-auto w-[calc(100%-2rem)] max-w-182 grid-cols-1 sm:grid-cols-2' : 'mx-8 grid-cols-2'} mt-3 mb-4 grid gap-2.5`}
            data-testid="chief-examples"
          >
            {chief.examples.map((ex) => {
              const Icon = EXAMPLE_ICONS[ex.icon];
              return (
                <Button
                  variant="ghost"
                  className="h-auto min-h-16 w-full cursor-pointer justify-start gap-3 rounded-(--radius-card) border-none bg-(--card) px-3 py-3 text-left whitespace-normal font-normal ring-1 ring-(--border) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
                  key={ex.text}
                  onClick={onSend != null ? () => void onSend(ex.text, chipProjectId) : undefined}
                >
                  <span className="flex size-6 flex-none items-center justify-center text-(--text-secondary)">
                    <Icon width={18} height={18} />
                  </span>
                  <span className="text-ui leading-5 text-(--foreground)">{t(ex.text)}</span>
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
  return (
    <>
      {ownHeader && (
        <header
          className={
            home
              ? 'relative mx-auto w-full max-w-190 flex-none px-4 pt-3 pb-2'
              : 'relative px-4 pt-1 pb-3'
          }
        >
          <div className="flex items-center">
            <h2 className="m-0 min-w-0 truncate font-heading text-heading font-title text-(--foreground)">
              Coordinator
            </h2>
            <div className="ml-auto flex items-center gap-2.5">
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
              {onClose != null && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={HEAD_ICON_BTN_CLS}
                  aria-label={t('最小化')}
                  onClick={onClose}
                >
                  <Minus width={16} height={16} />
                </Button>
              )}
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
                {chief.fallbackModel != null ? (
                  <>
                    <span className="min-w-0 truncate">
                      {t('备用模型 {model}', { model: chief.fallbackModel })}
                    </span>
                    <span
                      aria-hidden="true"
                      data-testid="chief-fallback-dot"
                      className="ml-0.5 size-1.5 flex-none rounded-full bg-(--badge-attention)"
                    />
                    <span className="sr-only">{t('，主模型暂时用不了')}</span>
                  </>
                ) : (
                  <span className="min-w-0 truncate">{chief.modelSlot}</span>
                )}
              </span>
            </div>
          )}
        </header>
      )}

      {heroLayout ? (
        <div
          ref={heroScrollRef}
          data-testid="chief-home-scroll"
          className="scroll-fade min-h-0 flex-1 overflow-y-auto pb-6"
        >
          {hero}
          {intro}
          {below}
        </div>
      ) : (
        <>
          {intro}
          <MessageScroller className={SCROLLER_ROOT_CLS}>
            <FadeScrollerViewport data-testid="chief-body">
              <MessageScrollerContent
                className={home ? SCROLLER_CONTENT_HOME_CLS : SCROLLER_CONTENT_CLS}
                data-testid="chief-stream"
              >
                <TurnElapsedContext.Provider value={variant !== 'global'}>
                  <TodoGlanceContext.Provider value={glances}>
                    {lead}
                    {day == null ? (
                      rows.map(streamRow)
                    ) : (
                      <>
                        <div data-testid="chief-earlier" className="opacity-60">
                          {rows.slice(0, day.earlier).map(streamRow)}
                        </div>
                        {day.today}
                        {rows.slice(day.earlier).map(streamRow)}
                      </>
                    )}
                  </TodoGlanceContext.Provider>
                </TurnElapsedContext.Provider>
              </MessageScrollerContent>
            </FadeScrollerViewport>
            <JumpToLatestButton>
              <ArrowDown width={16} height={16} />
              <span className="sr-only">{t('滚动到最新')}</span>
            </JumpToLatestButton>
          </MessageScroller>
        </>
      )}

      {chief.outage != null ? (
        <ChiefOutageBanner outage={chief.outage} onSettings={onSettings} onNewTask={onNewTask} />
      ) : (
        chief.fallbackModel != null && (
          <ChiefFallbackBanner model={chief.fallbackModel} onSettings={onSettings} />
        )
      )}
      {aboveComposer}
      {composerReplacement ?? (
        <>
          {composerError != null && (
            <p
              role="alert"
              data-testid="chief-composer-error"
              className={`${home ? 'mx-auto w-[calc(100%-2rem)] max-w-182' : 'mx-4'} mt-2 mb-0 flex items-center gap-1.5 text-meta text-destructive`}
            >
              <TriangleAlert aria-hidden="true" className="size-3.5 flex-none" />
              {composerError}
            </p>
          )}
          <div
            data-invalid={composerError != null ? '' : undefined}
            className={`chief-composer ${home ? HOME_COMPOSER_CLS : 'mx-4 my-2.5'} data-invalid:ring-1 data-invalid:ring-destructive rounded-(--radius-composer) border-0 bg-card px-3.5 pt-3 pb-2.5 shadow-(--shadow-composer) transition-[box-shadow] duration-[220ms] ease-(--ease-out-expo) hover:shadow-(--shadow-composer-hover) focus-within:shadow-(--shadow-composer-focus)`}
            style={home ? { viewTransitionName: 'chief-composer' } : undefined}
          >
            <QueuedCapsules
              messages={queuedCapsules}
              onSendNow={onSteer ? (id) => onSteer(id) : undefined}
              onRemove={withdraw}
              removeLabel={t('撤回')}
            />
            <ComposerAttachments
              tokens={wire.tokens}
              pending={pendingAttachments}
              onRemove={wire.removeToken}
            />
            <div className="relative">
              <Textarea
                ref={attachComposer}
                data-testid="chief-composer-input"
                aria-invalid={composerError != null ? true : undefined}
                className={`h-9 max-h-30 min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent px-0.5 pt-0.5 pb-2.5 font-sans text-card-title md:text-card-title tabular-nums shadow-none field-sizing-fixed focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent ${MENTION_TEXTAREA_CLS} placeholder:text-(--text-tertiary)`}
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
                placeholder={
                  placeholder ??
                  t(
                    chief.outage != null
                      ? '可以继续说，总管恢复后会按顺序处理…'
                      : chief.running === true
                        ? CHIEF_INPUT_PLACEHOLDER_STEERING
                        : CHIEF_INPUT_PLACEHOLDER,
                  )
                }
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
              {chipVisible && (
                <ProjectMenu
                  title="发给哪个项目"
                  projects={projectOptions}
                  value={pickedProject?.id ?? null}
                  withAuto
                  side="top"
                  onPick={pickProject}
                  trigger={
                    <Button
                      variant="ghost"
                      data-testid="chief-project-chip"
                      data-set={pickedProject != null ? '' : undefined}
                      aria-label={t('发给哪个项目：{name}', {
                        name: pickedProject?.name ?? t('自动，由总管判断'),
                      })}
                      className={PROJECT_CHIP_CLS}
                    />
                  }
                >
                  {pickedProject != null ? (
                    <ProjectAvatar
                      name={pickedProject.name}
                      tone={projectOptions.indexOf(pickedProject)}
                      icon={projectMark(pickedProject.id).icon}
                      color={projectMark(pickedProject.id).color}
                      bare
                    />
                  ) : (
                    <CircleDashed className="size-4 flex-none" />
                  )}
                  <span className="truncate">{pickedProject?.name ?? t('自动')}</span>
                  <ChevronDown width={12} height={12} />
                </ProjectMenu>
              )}
              {chief.running === true && turnElapsed != null && (
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
                  aria-label={t('停止总管这次回复')}
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
                    (wire.draft !== '' ||
                      wire.tokens.length > 0 ||
                      pendingAttachments.length > 0) &&
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
        </>
      )}
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
