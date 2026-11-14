import {
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_QUEUED,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
  encodeReplyQuote,
  parseReplyQuote,
  replyQuoteText,
} from '@cairn/shared';
import {
  type CSSProperties,
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
import type { ChiefContent, ChiefStreamItem } from '../fixtures/records.js';
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
import {
  foldTaskCards,
  placeReportCards,
  placeTaskRefs,
  type TaskRef,
  todoGlanceOf,
} from './chief-task-refs.js';
import { serverDraftBinding } from './composer-binding.js';
import { composerMode } from './composer-mode.js';
import { ComposerSurface, type ComposerSurfaceHandle } from './composer-surface.js';
import type { UnsentSends } from './outbox.js';
import { questionDockState } from './question-dock-state.js';
import { awaitingStream } from './question-lifecycle.js';
import { QuickReplies } from './quick-replies.js';
import { ReplyingToBar } from './reply-quote-block.js';
import { type ReplyQuoteDraft, ReplySourceHighlightContext } from './reply-source-highlight.js';
import {
  type GroupedRow,
  groupThreadEvents,
  type StreamRow,
  subThreadRowIds,
} from './thread-activity.js';
import { needsTimeDivider, timeDividerLabel } from './time-dividers.js';
import { VirtualStream } from './virtual-stream.js';

const SCROLLER_ROOT_CLS = 'h-auto min-h-0 min-w-0 flex-1 overscroll-none';
const SCROLLER_CONTENT_CLS =
  'mx-auto flex w-full max-w-chat-gutter min-w-0 flex-col justify-end gap-0 overflow-x-clip px-4 pt-8 in-data-[chat-top=under-header]:pt-20 [overflow-wrap:anywhere]';

const THREAD_COMPOSER = 'thread';
const VISIBLE_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

interface StreamLayout {
  grouped: GroupedRow[];
  keys: (string | number)[];
  runs: BubbleRun[];
  taskRefs: ReadonlyMap<GroupedRow['item'], readonly TaskRef[]>;
  reports: ReadonlyMap<GroupedRow['item'], readonly string[]>;
  dividers: (number | null)[];
  lastAt: number | null;
}

function layoutStream(
  list: readonly StreamRow[],
  subThreadRows: ReadonlySet<string>,
  glances: ReadonlyMap<string, TodoGlance>,
  previousAt: number | null,
  seen: Set<string>,
  reportSeen: Set<string>,
): StreamLayout {
  const { rows: grouped, startedBy } = foldTaskCards(
    groupThreadEvents(list, subThreadRows),
    glances,
  );
  let lastAt = previousAt;
  const dividers = grouped.map(({ item }) => {
    const at = 'createdAt' in item && typeof item.createdAt === 'number' ? item.createdAt : null;
    const divider = at !== null && needsTimeDivider(lastAt, at) ? at : null;
    if (at !== null) lastAt = at;
    return divider;
  });
  return {
    grouped,
    keys: grouped.map(({ item, i }) => chiefStreamRowKey(item, i)),
    runs: bubbleRuns(grouped, previousAt),
    taskRefs: placeTaskRefs(grouped, startedBy, glances, seen),
    reports: placeReportCards(grouped, startedBy, glances, reportSeen),
    dividers,
    lastAt,
  };
}

function workingRowLast(stream: readonly ChiefStreamItem[]): readonly ChiefStreamItem[] {
  const at = stream.findIndex((item) => item.kind === 'streaming');
  const working = stream[at];
  const after = stream.slice(at + 1);
  if (working === undefined || after.length === 0 || after.some((item) => item.kind !== 'user'))
    return stream;
  return [...stream.slice(0, at), ...after, working];
}

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

export function useMentionGroups(): MentionGroups {
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const machinesQ = useMachines(teamId, live);
  return {
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
}

export interface ChiefConversationProps {
  chief: ChiefContent;
  mentionGroups: MentionGroups;
  onSettings?: () => void;
  onSend?: (text: string) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  unsent?: UnsentSends | undefined;
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
  composerReplacement?: ReactNode;
  composerTools?: ReactNode;
  showBindGate?: boolean;
}

export function ChiefConversation({
  chief,
  mentionGroups,
  onSettings,
  onSend,
  onRewind,
  onWithdraw,
  unsent,
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
  composerReplacement,
  composerTools,
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
  const answerKey = useAnswerKey();
  const [threadOverride, setThreadOverride] = useState(false);
  const mode = composerMode({
    questionPending: answerKey !== null,
    threadClaimed: threadOverride,
    quoteStaged: replyQuote !== null,
  });
  const answerActive = mode === 'answer';
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
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
    () => todoGlances ?? new Map((todosQ.data ?? []).map((td) => [td.id, todoGlanceOf(td)])),
    [todoGlances, todosQ.data],
  );
  const empty = (chief.stream?.length ?? 0) === 0;
  const heroLayout = empty && !heroCollapsed && !questionPending;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canStop = chief.running === true && onStop != null;
  const connected = useConnected();
  const restoreSent = (text: string) => {
    followSentRef.current = false;
    const reply = parseReplyQuote(text);
    const body = reply?.body ?? text;
    if (reply !== null)
      setReplyQuote({ sourceMessageId: reply.sourceMessageId ?? '', quote: reply.quote });
    restoreToThread((cur) => (cur === '' ? body : `${cur}\n${body}`));
  };
  const restoreSentRef = useRef(restoreSent);
  restoreSentRef.current = restoreSent;
  useEffect(() => {
    for (const entry of unsent?.failed ?? []) {
      const text = unsent?.discard(entry.key) ?? null;
      if (text !== null) restoreSentRef.current(text);
    }
  }, [unsent]);
  const withdraw =
    onWithdraw == null
      ? undefined
      : (messageId: string, text: string) => {
          onWithdraw(messageId).then(
            () => restoreSent(text),
            () => {},
          );
        };
  const waitingTurn = chief.waitingTurn;
  const stopTurn =
    waitingTurn !== undefined && withdraw !== undefined
      ? () => withdraw(waitingTurn.messageId, waitingTurn.text)
      : onStop;
  stopTurnRef.current = stopTurn;
  const allRows = useMemo(
    () =>
      awaitingStream(workingRowLast(chief.stream ?? []), questionPending).map((item, i) => ({
        item,
        i,
      })),
    [chief.stream, questionPending],
  );
  const rows = useMemo(
    () => allRows.filter(({ item }) => item.kind !== 'user' || item.pending !== 'held'),
    [allRows],
  );
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
    item.kind === 'user' && item.pending === 'held' && item.id != null
      ? [
          {
            id: item.id,
            content: item.text,
            label: replyQuoteText(item.text),
            note: t('已存下，Coordinator 恢复后会处理'),
            held: true,
          },
        ]
      : [],
  );
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
  const dayEarlier = day?.earlier ?? 0;
  const [earlierLayout, streamLayout] = useMemo(() => {
    const subThreadRows = subThreadRowIds(
      rows.map(({ item }) => item),
      glances,
    );
    const seen = new Set<string>();
    const reportSeen = new Set<string>();
    const before = layoutStream(
      rows.slice(0, dayEarlier),
      subThreadRows,
      glances,
      null,
      seen,
      reportSeen,
    );
    return [
      before,
      layoutStream(rows.slice(dayEarlier), subThreadRows, glances, before.lastAt, seen, reportSeen),
    ] as const;
  }, [rows, glances, dayEarlier]);
  const row = (
    item: GroupedRow['item'],
    i: number,
    run: BubbleRun | undefined,
    taskRefs: readonly TaskRef[] | undefined,
    reports: readonly string[] | undefined,
  ) => (
    <ChiefStreamRow
      item={item}
      index={i}
      onCopy={copyText}
      onRewindRequest={requestRewind}
      entering={enteringKey !== null && chiefStreamRowKey(item, i) === enteringKey}
      onRetry={latestUser != null && i > latestUser.i ? retryLastUser : undefined}
      onReply={onSend != null && composerReplacement == null ? stageReply : undefined}
      joinsPrev={run?.joinsPrev === true}
      joinsNext={run?.joinsNext === true}
      {...(taskRefs !== undefined ? { taskRefs } : {})}
      {...(reports !== undefined ? { reports } : {})}
    />
  );
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
      hidden={questionPending || answerActive}
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
  const streamEntry = (layout: StreamLayout, n: number) => {
    const entry = layout.grouped[n];
    if (entry === undefined) return null;
    const at = layout.dividers[n];
    return (
      <>
        {at != null && (
          <MessageScrollerItem style={VISIBLE_ITEM_STYLE}>
            <div
              data-testid="chief-time-divider"
              className="mt-5 text-center text-caption text-(--text-tertiary)"
            >
              <time dateTime={new Date(at).toISOString()}>
                {timeDividerLabel(at, clock, locale, t)}
              </time>
            </div>
          </MessageScrollerItem>
        )}
        {row(
          entry.item,
          entry.i,
          layout.runs[n],
          layout.taskRefs.get(entry.item),
          layout.reports.get(entry.item),
        )}
        {quickAfter !== undefined && entry.item === quickAfter && quickReplies}
      </>
    );
  };
  const renderRows = (layout: StreamLayout) =>
    layout.keys.map((key, n) => <Fragment key={key}>{streamEntry(layout, n)}</Fragment>);
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
              className="scrollbar-gutter-both data-pending-scroll:visible data-pending-scroll:opacity-0 [--scroll-fade-size:32px] in-data-[chat-top=under-header]:[--scroll-fade-size-top:80px] [html[data-narrow-chrome]_&]:[--scroll-fade-size-top:80px]"
            >
              <MessageScrollerContent className={SCROLLER_CONTENT_CLS} data-testid="chief-stream">
                <TodoGlanceContext.Provider value={glances}>
                  <ReplySourceHighlightContext.Provider
                    value={highlightedSource === replyQuote ? highlightedSource : null}
                  >
                    {lead}
                    {day == null ? (
                      <VirtualStream
                        cacheKey={chief.threadId ?? ''}
                        keys={streamLayout.keys}
                        renderRow={(n) => streamEntry(streamLayout, n)}
                        viewportRef={viewportRef}
                      />
                    ) : (
                      <>
                        <div data-testid="chief-earlier" className="opacity-60">
                          {renderRows(earlierLayout)}
                        </div>
                        {day.today}
                        {renderRows(streamLayout)}
                      </>
                    )}
                    <ChiefQuestion />
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
              composerRef={answerActive ? undefined : composerRef}
              above={answerActive ? null : capsules}
              tools={answerActive ? null : composerTools}
              context={chief.context}
              running={chief.running}
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
                onAttachment={onAttachment}
                composerRef={answerActive ? composerRef : undefined}
                above={answerActive ? capsules : null}
                tools={answerActive ? composerTools : null}
                context={chief.context}
                running={chief.running}
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
