import {
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_QUEUED,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
  encodeReplyQuote,
  parseReplyQuote,
  replyQuoteText,
} from '@cairn/shared';
import { TriangleAlert } from 'lucide-react';
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useConnected } from '../api/connection-state.js';
import { useMachines, useProjects, useSkills, useTodos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EarlierLoader, type EarlierPages } from '../components/chat/earlier-loader.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { FOLLOW_THRESHOLD, JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { machineSecondary } from '../components/machine-label.js';
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
  MessageScrollerItem,
  MessageScrollerProvider,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { type TodoGlance, TodoGlanceContext } from '../detail/segments.js';
import type { ChiefContent, ChiefStreamItem, Phase } from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowDown } from '../icons/index.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { useFileDrop } from '../overlay/file-drop.js';
import type { MentionGroups } from '../overlay/mention-token.js';
import { useServerDraft } from '../overlay/use-server-draft.js';
import { AnswerComposer } from './answer-composer.js';
import { type BubbleRun, bubbleRuns } from './bubble-runs.js';
import { ChiefStreamRow, chiefStreamRowKey } from './chief-message-rows.js';
import {
  ChiefConnectionBanner,
  ChiefFallbackBanner,
  ChiefOutageBanner,
} from './chief-outage-banner.js';
import { ChiefQuestion, useAnswerKey, useQuestionPending } from './chief-question.js';
import { foldTaskCards } from './chief-task-refs.js';
import { serverDraftBinding } from './composer-binding.js';
import { composerMode } from './composer-mode.js';
import { ComposerSurface, type ComposerSurfaceHandle } from './composer-surface.js';
import { outstandingReportIds } from './outstanding-reports.js';
import { questionDockState } from './question-dock-state.js';
import { awaitingStream } from './question-lifecycle.js';
import { QuickReplies } from './quick-replies.js';
import { ReplyingToBar } from './reply-quote-block.js';
import { type ReplyQuoteDraft, ReplySourceHighlightContext } from './reply-source-highlight.js';
import { type GroupedRow, groupThreadEvents, type StreamRow } from './thread-activity.js';
import { needsTimeDivider, timeDividerLabel } from './time-dividers.js';

const SCROLLER_ROOT_CLS = 'h-auto min-h-0 min-w-0 flex-1 overscroll-none';
const SCROLLER_CONTENT_CLS =
  'mx-auto flex w-full max-w-chat-gutter min-w-0 flex-col justify-end gap-0 overflow-x-clip px-4 pt-8 in-data-[chat-top=under-header]:pt-20 [overflow-wrap:anywhere]';

const THREAD_COMPOSER = 'thread';

export const CHIEF_DRAFT_STORAGE_KEY = 'cairn.chief-draft';

export function ChiefFollowArmed({ onAtBottom }: { onAtBottom: (atBottom: boolean) => void }) {
  const scrollable = useMessageScrollerScrollable();
  useEffect(() => {
    onAtBottom(!scrollable.end);
  }, [scrollable.end, onAtBottom]);
  return null;
}

export function ChiefScrollProvider({ children }: { children: React.ReactNode }) {
  const [atBottom, setAtBottom] = useState(true);
  return (
    <MessageScrollerProvider
      autoScroll={atBottom}
      scrollEdgeThreshold={FOLLOW_THRESHOLD}
      defaultScrollPosition="end"
    >
      <ChiefFollowArmed onAtBottom={setAtBottom} />
      {children}
    </MessageScrollerProvider>
  );
}

export interface ChiefConversationProps {
  chief: ChiefContent;
  onSettings?: () => void;
  onSend?: (text: string) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
  earlier?: EarlierPages;
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
  composerTools?: ReactNode;
  composerMenu?: ReactNode;
  targetPlaceholder?: string | null;
  showBindGate?: boolean;
}

export function ChiefConversation({
  chief,
  onSettings,
  onSend,
  onRewind,
  onWithdraw,
  onSteer,
  onStop,
  earlier,
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
  composerTools,
  composerMenu,
  targetPlaceholder = null,
  showBindGate = true,
}: ChiefConversationProps) {
  const questionPending = useQuestionPending();
  const { t, locale } = useI18n();
  const [replyQuote, setReplyQuote] = useState<ReplyQuoteDraft | null>(null);
  const [highlightedSource, setHighlightedSource] = useState<ReplyQuoteDraft | null>(null);
  const quickKey = (chief.quickReplies ?? []).join('\n');
  const [preview, setPreview] = useState<{ key: string; text: string } | null>(null);
  const previewReply = preview !== null && preview.key === quickKey ? preview.text : null;
  const composerPlaceholder =
    previewReply ??
    targetPlaceholder ??
    (replyQuote !== null
      ? t('回复这条消息')
      : chief.outage != null
        ? t('可以继续说，Coordinator 恢复后会按顺序处理…')
        : chief.waitingTurn !== undefined
          ? t(CHIEF_INPUT_PLACEHOLDER_QUEUED)
          : chief.running === true
            ? t(CHIEF_INPUT_PLACEHOLDER_STEERING)
            : (placeholder ?? t(CHIEF_INPUT_PLACEHOLDER)));
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const answerHere = targetPlaceholder === null;
  const answerKey = useAnswerKey();
  const [threadOverride, setThreadOverride] = useState(false);
  const mode = composerMode({
    answerHere,
    questionPending: answerKey !== null,
    threadClaimed: threadOverride,
    quoteStaged: replyQuote !== null,
  });
  const answerActive = mode === 'answer';
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
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
    agent: [],
    project: (projectsQ.data ?? []).map((p) => ({ id: p.id, label: p.name })),
    skill: (skillsQ.data ?? []).map((s) => ({
      id: s.id,
      label: s.name,
      subtitle: s.description ?? undefined,
    })),
    machine: (machinesQ.data ?? []).map((m) => ({
      id: m.id,
      label: m.name,
      subtitle: machineSecondary(m, machinesQ.data ?? []) ?? undefined,
    })),
  };
  const onAttachment =
    onSend != null ? (files: File[]) => uploadMessageAttachments(files, t) : undefined;
  const { scrollToEnd } = useMessageScroller();
  const followSentRef = useRef(false);
  const [enteringKey, setEnteringKey] = useState<string | number | null>(null);
  const latestUserKeyRef = useRef<string | number | null>(null);
  const userKeyAtSendRef = useRef<string | number | null>(null);
  const prevThreadRef = useRef(chief.threadTitle);
  useEffect(() => {
    if (prevThreadRef.current === chief.threadTitle) return;
    prevThreadRef.current = chief.threadTitle;
    scrollToEnd();
  }, [chief.threadTitle, scrollToEnd]);
  const [rewindConfirm, setRewindConfirm] = useState<{ index: number; id: string | null } | null>(
    null,
  );
  const [toolsOpen, setToolsOpen] = useState<Set<number>>(() => new Set());
  const copyText = useCallback(
    (text: string) => {
      const clip = navigator.clipboard;
      if (!clip) return;
      void clip.writeText(text).then(
        () => toastSuccess(t('已复制')),
        () => {},
      );
    },
    [t],
  );
  const toggleTools = useCallback(
    (i: number) =>
      setToolsOpen((cur) => {
        const next = new Set(cur);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      }),
    [],
  );
  const requestRewind = useCallback(
    (index: number, id: string | null) => setRewindConfirm({ index, id }),
    [],
  );
  const [liveDraft, setLiveDraft] = useServerDraft({
    teamId,
    scope: 'chief',
    localKey: draftStorageKey,
    enabled: live,
    initial: initialDraft,
  });
  const stopTurnRef = useRef<(() => void) | undefined>(undefined);
  const surfaceRef = useRef<ComposerSurfaceHandle | null>(null);
  const answerSurfaceRef = useRef<ComposerSurfaceHandle | null>(null);
  const activeComposer = answerActive ? answerKey : THREAD_COMPOSER;
  const drop = useFileDrop(
    onAttachment === undefined || composerReplacement != null
      ? undefined
      : (files) => (answerActive ? answerSurfaceRef : surfaceRef).current?.attach(files),
  );
  const focusedComposerRef = useRef<string | null>(null);
  const leaveComposer = useCallback(() => {
    focusedComposerRef.current = null;
  }, []);
  const shownComposerRef = useRef(activeComposer);
  const threadFocusPendingRef = useRef(false);
  useLayoutEffect(() => {
    const previous = shownComposerRef.current;
    shownComposerRef.current = activeComposer;
    if (activeComposer === THREAD_COMPOSER && threadFocusPendingRef.current) {
      threadFocusPendingRef.current = false;
      surfaceRef.current?.focus({ preventScroll: true });
      return;
    }
    if (previous === activeComposer || focusedComposerRef.current !== previous) return;
    const incoming = activeComposer === THREAD_COMPOSER ? surfaceRef : answerSurfaceRef;
    incoming.current?.focus({ preventScroll: true });
  }, [activeComposer]);
  const restoreToThread = (update: (current: string) => string) => {
    setThreadOverride(true);
    setLiveDraft(update);
    if (shownComposerRef.current === THREAD_COMPOSER)
      surfaceRef.current?.focus({ preventScroll: true });
    else threadFocusPendingRef.current = true;
  };
  const composerBinding = serverDraftBinding(
    onSend != null ? liveDraft : (chief.draft ?? ''),
    onSend != null
      ? (value: string) => {
          setLiveDraft(value);
          if (value === '') setThreadOverride(false);
        }
      : undefined,
  );
  const sendFromComposer =
    onSend == null
      ? undefined
      : (text: string) => {
          followSentRef.current = true;
          userKeyAtSendRef.current = latestUserKeyRef.current;
          const quoted = replyQuote;
          const sent = onSend(quoted === null ? text : encodeReplyQuote(quoted, text));
          Promise.resolve(sent).then(
            () => setReplyQuote((current) => (current === quoted ? null : current)),
            () => {
              followSentRef.current = false;
            },
          );
          return sent;
        };
  const stageReply = useCallback((draft: ReplyQuoteDraft) => {
    setReplyQuote(draft);
    setThreadOverride(true);
    if (shownComposerRef.current === THREAD_COMPOSER)
      surfaceRef.current?.focus({ preventScroll: true });
    else threadFocusPendingRef.current = true;
  }, []);
  const prefillKey = prefill?.key;
  const prefillText = prefill?.text;
  useEffect(() => {
    if (prefillKey == null || prefillText == null) return;
    restoreToThread(() => prefillText);
  }, [prefillKey, prefillText]);
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
  const heroLayout = empty && !heroCollapsed && !questionPending;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canStop = targetPlaceholder === null && chief.running === true && onStop != null;
  const connected = useConnected();
  const withdraw =
    onWithdraw == null
      ? undefined
      : (messageId: string, text: string) => {
          onWithdraw(messageId).then(
            () => {
              followSentRef.current = false;
              const reply = parseReplyQuote(text);
              const body = reply?.body ?? text;
              if (reply !== null)
                setReplyQuote({ sourceMessageId: reply.sourceMessageId ?? '', quote: reply.quote });
              restoreToThread((cur) => (cur === '' ? body : `${cur}\n${body}`));
            },
            () => {},
          );
        };
  const waitingTurn = chief.waitingTurn;
  const stopTurn =
    waitingTurn !== undefined && withdraw !== undefined
      ? () => withdraw(waitingTurn.messageId, waitingTurn.text)
      : onStop;
  stopTurnRef.current = stopTurn;
  const allRows = awaitingStream(chief.stream ?? [], questionPending).map((item, i) => ({
    item,
    i,
  }));
  const rows = allRows.filter(({ item }) => item.kind !== 'user' || item.pending == null);
  const latestUser = rows.findLast(({ item }) => item.kind === 'user');
  const latestUserKey =
    latestUser == null ? null : chiefStreamRowKey(latestUser.item, latestUser.i);
  latestUserKeyRef.current = latestUserKey;
  const keyAtSend = userKeyAtSendRef.current;
  const sentRowPosition =
    keyAtSend == null
      ? -1
      : rows.findIndex(({ item, i }) => chiefStreamRowKey(item, i) === keyAtSend);
  const latestUserPosition = latestUser == null ? -1 : rows.indexOf(latestUser);
  useLayoutEffect(() => {
    if (!followSentRef.current || latestUserPosition < 0) return;
    if (keyAtSend != null && sentRowPosition < 0) {
      followSentRef.current = false;
      return;
    }
    if (latestUserPosition <= sentRowPosition) return;
    followSentRef.current = false;
    setEnteringKey(latestUserKey);
    scrollToEnd();
  }, [latestUserKey, keyAtSend, sentRowPosition, latestUserPosition, scrollToEnd]);
  const queuedCapsules = allRows.flatMap(({ item }) =>
    item.kind === 'user' && item.pending != null && item.id != null
      ? [
          {
            id: item.id,
            content: item.text,
            label: replyQuoteText(item.text),
            ...(item.pending === 'held' ? { note: t('已存下，Coordinator 恢复后会处理') } : {}),
            held: item.pending === 'held',
          },
        ]
      : [],
  );
  const outstandingReports = outstandingReportIds(chief.stream ?? []);
  const capsules = (
    <>
      {replyQuote !== null && (
        <ReplyingToBar
          quote={replyQuote.quote}
          onRemove={() => setReplyQuote(null)}
          onHighlight={(on) => setHighlightedSource(on ? replyQuote : null)}
        />
      )}
      <QueuedCapsules
        messages={queuedCapsules}
        onSendNow={onSteer ? (id) => onSteer(id) : undefined}
        onRemove={withdraw}
        removeLabel={t('撤回')}
      />
    </>
  );
  const lastUserText = latestUser?.item.kind === 'user' ? latestUser.item.text : null;
  const resend = useCallback(
    (text: string) => {
      if (onSend == null) return;
      followSentRef.current = true;
      Promise.resolve(onSend(text)).catch((error: unknown) => {
        followSentRef.current = false;
        toastError(t('没发出去，再试一次。'), error);
      });
    },
    [onSend, t],
  );
  const retryLastUser = useMemo(
    () => (onSend == null || lastUserText === null ? undefined : () => resend(lastUserText)),
    [onSend, lastUserText, resend],
  );
  const clock = useMinuteClock();
  const dividerClock = { previousAt: null as number | null };
  const streamRow = (
    { item, i }: GroupedRow,
    run: BubbleRun | undefined,
    startedTasks: readonly string[] | undefined,
  ) => {
    const at = 'createdAt' in item && typeof item.createdAt === 'number' ? item.createdAt : null;
    const divider =
      at !== null && needsTimeDivider(dividerClock.previousAt, at) ? (
        <MessageScrollerItem key={`divider-${chiefStreamRowKey(item, i)}`}>
          <div
            data-testid="chief-time-divider"
            className="mt-5 text-center text-caption text-(--text-tertiary)"
          >
            <time dateTime={new Date(at).toISOString()}>
              {timeDividerLabel(at, clock, locale, t)}
            </time>
          </div>
        </MessageScrollerItem>
      ) : null;
    if (at !== null) dividerClock.previousAt = at;
    return (
      <Fragment key={chiefStreamRowKey(item, i)}>
        {divider}
        {row(item, i, run, startedTasks)}
      </Fragment>
    );
  };
  const row = (
    item: GroupedRow['item'],
    i: number,
    run: BubbleRun | undefined,
    startedTasks: readonly string[] | undefined,
  ) => (
    <ChiefStreamRow
      item={item}
      index={i}
      replyable={item.kind === 'thread-report' && outstandingReports.has(item.id)}
      onCopy={copyText}
      toolsOpen={toolsOpen}
      onToggleTools={toggleTools}
      onRewindRequest={requestRewind}
      entering={enteringKey !== null && chiefStreamRowKey(item, i) === enteringKey}
      onRetry={latestUser != null && i > latestUser.i ? retryLastUser : undefined}
      onReply={onSend != null && composerReplacement == null ? stageReply : undefined}
      joinsPrev={run?.joinsPrev === true}
      joinsNext={run?.joinsNext === true}
      {...(startedTasks !== undefined ? { startedTasks } : {})}
    />
  );
  const keepsOwnRow = (item: ChiefStreamItem) =>
    item.kind === 'thread-report' && outstandingReports.has(item.id);
  const lastRobotIndex = rows.findLastIndex(
    ({ item }) => item.kind === 'robot' && item.typing !== true,
  );
  const quickAfter =
    lastRobotIndex >= 0 && !rows.slice(lastRobotIndex).some(({ item }) => item.kind === 'user')
      ? rows[lastRobotIndex]?.item
      : undefined;
  const quickReplies = (
    <QuickReplies
      replies={chief.quickReplies}
      hidden={questionPending || answerActive || !answerHere}
      onPreview={(text) => setPreview(text === null ? null : { key: quickKey, text })}
      onSend={
        onSend == null
          ? undefined
          : (text) => {
              followSentRef.current = true;
              userKeyAtSendRef.current = latestUserKeyRef.current;
              return onSend(text);
            }
      }
    />
  );
  const renderRows = (list: StreamRow[]) => {
    const { rows: grouped, startedBy } = foldTaskCards(
      groupThreadEvents(list, keepsOwnRow),
      glances,
    );
    const runs = bubbleRuns(grouped, dividerClock.previousAt);
    return grouped.map((entry, n) => (
      <Fragment key={chiefStreamRowKey(entry.item, entry.i)}>
        {streamRow(entry, runs[n], startedBy.get(entry.item))}
        {quickAfter !== undefined && entry.item === quickAfter && quickReplies}
      </Fragment>
    ));
  };
  const intro = !chief.bound && showBindGate && (
    <div
      data-testid="chief-gate"
      className="mx-auto mt-4 flex h-14 w-[calc(100%-2rem)] max-w-chat flex-none items-center gap-3 rounded-(--radius-card) bg-(--card) pr-3 pl-4 text-ui text-(--text-secondary) ring-1 ring-(--border)"
    >
      <span>{t('请先在工作路由里配置 Coordinator。')}</span>
      <Button className={`ml-auto cursor-pointer ${DIALOG_PRIMARY_BUTTON}`} onClick={onSettings}>
        {t('设置')}
      </Button>
    </div>
  );
  return (
    <>
      {heroLayout ? (
        <div
          {...drop.bind}
          data-testid="chief-home-scroll"
          className="min-h-0 min-w-0 flex-1 in-data-[chat-top=under-header]:pt-12 overflow-x-hidden overflow-y-auto overscroll-none pb-6"
        >
          {hero}
          {intro}
          {below}
        </div>
      ) : (
        <>
          {intro}
          <MessageScroller className={SCROLLER_ROOT_CLS} {...drop.bind}>
            <FadeScrollerViewport
              reserveEnd
              ref={viewportRef}
              data-testid="chief-body"
              fade={false}
              className="scrollbar-gutter-both"
            >
              <MessageScrollerContent className={SCROLLER_CONTENT_CLS} data-testid="chief-stream">
                <TodoGlanceContext.Provider value={glances}>
                  <ReplySourceHighlightContext.Provider
                    value={highlightedSource === replyQuote ? highlightedSource : null}
                  >
                    {lead}
                    {day == null ? (
                      renderRows(rows)
                    ) : (
                      <>
                        <div data-testid="chief-earlier" className="opacity-60">
                          {renderRows(rows.slice(0, day.earlier))}
                        </div>
                        {day.today}
                        {renderRows(rows.slice(day.earlier))}
                      </>
                    )}
                    <ChiefQuestion bound={answerHere} />
                  </ReplySourceHighlightContext.Provider>
                </TodoGlanceContext.Provider>
              </MessageScrollerContent>
            </FadeScrollerViewport>
            <JumpToLatestButton>
              <ArrowDown width={20} height={20} />
              <span className="sr-only">{t('滚动到最新')}</span>
            </JumpToLatestButton>
            {earlier != null && (
              <EarlierLoader
                earlier={earlier}
                hasEarlier={chief.hasEarlier === true}
                rowCount={rows.length}
                viewportRef={viewportRef}
              />
            )}
          </MessageScroller>
        </>
      )}

      {!connected ? (
        <ChiefConnectionBanner />
      ) : chief.outage != null ? (
        <ChiefOutageBanner outage={chief.outage} onSettings={onSettings} />
      ) : (
        chief.fallbackModel != null && (
          <ChiefFallbackBanner model={chief.fallbackModel} onSettings={onSettings} />
        )
      )}
      <div
        {...drop.bind}
        data-testid="chief-composer-block"
        className="group/composer flex max-h-[65%] min-h-0 flex-none flex-col"
      >
        {composerReplacement ?? (
          <>
            {composerError != null && (
              <p
                role="alert"
                data-testid="chief-composer-error"
                className={`mx-auto my-2 flex w-[calc(100%-2rem)] max-w-chat max-h-12 items-start gap-1.5 overflow-y-auto text-meta text-destructive`}
              >
                <TriangleAlert aria-hidden="true" className="size-4 flex-none" />
                {composerError}
              </p>
            )}
            <ComposerSurface
              key="thread"
              handleRef={surfaceRef}
              binding={composerBinding}
              editable={onSend != null}
              onSend={sendFromComposer}
              onAttachment={onAttachment}
              mentionGroups={mentionGroups}
              slash={{
                reviewAvailable: false,
                stopAvailable: canStop,
                onStop: () => stopTurnRef.current?.(),
              }}
              active={!answerActive}
              onFocusEnter={() => {
                focusedComposerRef.current = THREAD_COMPOSER;
              }}
              onFocusLeave={leaveComposer}
              onCancelReply={replyQuote === null ? undefined : () => setReplyQuote(null)}
              placeholder={composerPlaceholder}
              invalid={composerError != null}
              composerRef={answerActive ? undefined : composerRef}
              above={answerActive ? null : capsules}
              tools={answerActive ? null : composerTools}
              menu={answerActive ? null : composerMenu}
              canStop={canStop}
              onStop={stopTurn}
              context={chief.context}
              threadId={chief.threadId ?? null}
              dropActive={drop.active}
              seededFiles={live ? undefined : chief.composerFiles}
            />
            {answerKey !== null && (
              <AnswerComposer
                key={answerKey}
                answerKey={answerKey}
                handleRef={answerSurfaceRef}
                active={answerActive}
                onFocusEnter={() => {
                  focusedComposerRef.current = answerKey;
                }}
                onFocusLeave={leaveComposer}
                invalid={composerError != null}
                onAttachment={onAttachment}
                composerRef={answerActive ? composerRef : undefined}
                above={answerActive ? capsules : null}
                tools={answerActive ? composerTools : null}
                menu={answerActive ? composerMenu : null}
                context={chief.context}
                threadId={chief.threadId ?? null}
                dropActive={drop.active}
              />
            )}
          </>
        )}
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
            {t('恢复到此处？该条之后的 {n} 条消息会移除，Coordinator 从这条重发开新回合。', {
              n: Math.max(0, (chief.stream?.length ?? 0) - (rewindConfirm?.index ?? 0) - 1),
            })}
          </p>
        </div>
      </DialogShell>
    </>
  );
}
