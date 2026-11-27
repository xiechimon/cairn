import {
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_QUEUED,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
  encodeReplyQuotes,
  replySummary,
} from '@cairn/shared';
import { ArrowDown } from 'lucide-react';
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
} from 'react';
import { useConnected, useConnectionOutage } from '../api/connection-state.js';
import {
  useApiMutations,
  useArchivedTodos,
  useMachines,
  useProjects,
  useSkills,
  useTodos,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import type { PendingComments } from '../board/design/design-composer.js';
import { useUnreadThreadIds } from '../board/use-thread-unread.js';
import { EarlierLoader, type EarlierPages } from '../components/chat/earlier-loader.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { FOLLOW_THRESHOLD, JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { TimeDivider } from '../components/chat/message-time.js';
import { machineSecondary } from '../components/machine-label.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { toastError } from '../components/ui/toaster.js';
import { ThreadUnreadContext, type TodoGlance, TodoGlanceContext } from '../detail/segments.js';
import type { ChiefContent, ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { useFileDrop } from '../overlay/file-drop.js';
import type { MentionGroups } from '../overlay/mention-token.js';
import { useServerDraft } from '../overlay/use-server-draft.js';
import { type BubbleRun, bubbleRuns } from './bubble-runs.js';
import { ChiefStreamRow, chiefStreamRowKey, chiefStreamRowKeys } from './chief-message-rows.js';
import {
  BANNER_CLS,
  ChiefConnectionBanner,
  ChiefFallbackBanner,
  ChiefOutageBanner,
} from './chief-outage-banner.js';
import { QuestionArrivals, useQuestionPending } from './chief-question.js';
import { foldTaskCards, placeReportCards, todoGlanceOf } from './chief-task-refs.js';
import { serverDraftBinding } from './composer-binding.js';
import { ComposerSurface, type ComposerSurfaceHandle } from './composer-surface.js';
import type { UnsentSends } from './outbox.js';
import { type LateArrival, withoutReturnedText } from './outbox.js';
import { awaitingStream } from './question-lifecycle.js';
import { type QueuedMessage, QueueTabs } from './queue-tabs.js';
import { QuickReplies } from './quick-replies.js';
import { useQuoteMarks } from './quote-mark.js';
import { ReaderFollowContext, useReaderFollow } from './reader-follow.js';
import { StagedQuotes } from './reply-quote-block.js';
import {
  draftFromSent,
  type ReplyQuoteDraft,
  ReplySourceHighlightContext,
  type StagedQuote,
  stagedQuote,
} from './reply-source-highlight.js';
import { SelectionReply } from './selection-reply.js';
import {
  collapseThinkingRuns,
  type GroupedRow,
  groupThreadEvents,
  type StreamRow,
} from './thread-activity.js';
import { streamDividers } from './time-dividers.js';
import { CardFailureContext, QueueWaitCard, TurnFailureCard } from './turn-failure.js';
import { VirtualStream } from './virtual-stream.js';

const SCROLLER_ROOT_CLS = 'h-auto min-h-0 min-w-0 flex-1 pointer-fine:overscroll-none';
const SCROLLER_CONTENT_CLS =
  'mx-auto flex w-full max-w-chat-gutter min-w-0 flex-col justify-end gap-0 overflow-x-clip px-4 pt-8 in-data-[chat-top=under-header]:pt-20 [overflow-wrap:anywhere]';

const VISIBLE_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

interface StreamLayout {
  grouped: GroupedRow[];
  keys: (string | number)[];
  pinned: number[];
  runs: BubbleRun[];
  started: ReadonlyMap<GroupedRow['item'], readonly string[]>;
  reports: ReadonlyMap<GroupedRow['item'], readonly string[]>;
  dividers: (number | null)[];
  lastAt: number | null;
}

function layoutStream(
  list: readonly StreamRow[],
  glances: ReadonlyMap<string, TodoGlance>,
  previousAt: number | null,
  reportSeen: Set<string>,
  cardFailure: string | null,
): StreamLayout {
  const { rows: folded, startedBy } = foldTaskCards(groupThreadEvents(list), glances);
  const grouped = collapseThinkingRuns(folded);
  const { dividers, lastAt } = streamDividers(grouped, previousAt, cardFailure);
  return {
    grouped,
    keys: chiefStreamRowKeys(grouped),
    pinned: grouped.flatMap(({ item }, n) =>
      item.kind === 'question' && item.status === 'pending' ? [n] : [],
    ),
    runs: bubbleRuns(grouped, previousAt, { cardFailure, startedBy }),
    started: startedBy,
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
  const [readerLeft, setReaderLeft] = useState(false);
  const readerFollow = useMemo(() => ({ readerLeft, setReaderLeft }), [readerLeft]);
  return (
    <MessageScrollerProvider
      autoScroll={atBottom && !readerLeft}
      scrollEdgeThreshold={FOLLOW_THRESHOLD}
      defaultScrollPosition="end"
    >
      <ChiefFollowArmed onAtBottom={setAtBottom} />
      <ReaderFollowContext.Provider value={readerFollow}>{children}</ReaderFollowContext.Provider>
    </MessageScrollerProvider>
  );
}

export function useMentionGroups(): MentionGroups {
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const machinesQ = useMachines(teamId, live);
  return {
    todo: [],
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
      capabilities: m.capabilities ?? undefined,
    })),
  };
}

export interface ChiefConversationProps {
  chief: ChiefContent;
  mentionGroups: MentionGroups;
  onSettings?: () => void;
  onSend?: (text: string) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onRetryGreeting?: () => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  unsent?: UnsentSends | undefined;
  onStop?: (messageId?: string) => void;
  earlier?: EarlierPages;
  hero?: ReactNode;
  below?: ReactNode;
  heroCollapsed?: boolean;
  todoGlances?: ReadonlyMap<string, TodoGlance>;
  composerRef?: (node: HTMLTextAreaElement | null) => void;
  day?: { earlier: number; today: ReactNode };
  lead?: ReactNode;
  draftScope?: string;
  draftStorageKey?: string;
  initialDraft?: string;
  prefill?: { text: string; key: number; merge?: boolean } | null;
  placeholder?: string;
  composerReplacement?: ReactNode;
  notice?: ReactNode;
  showBindGate?: boolean;
  pendingComments?: PendingComments | null;
}

export function ChiefConversation({
  chief,
  mentionGroups,
  onSettings,
  onSend,
  onRewind,
  onRetryGreeting,
  onWithdraw,
  unsent,
  onStop,
  earlier,
  hero,
  below,
  heroCollapsed = false,
  todoGlances,
  composerRef,
  day,
  lead,
  draftScope = 'chief',
  draftStorageKey = CHIEF_DRAFT_STORAGE_KEY,
  initialDraft = '',
  prefill = null,
  placeholder,
  composerReplacement,
  notice,
  showBindGate = true,
  pendingComments,
}: ChiefConversationProps) {
  const questionPending = useQuestionPending();
  const { t } = useI18n();
  const [replyQuotes, setReplyQuotes] = useState<readonly StagedQuote[]>([]);
  const replyQuotesRef = useRef(replyQuotes);
  replyQuotesRef.current = replyQuotes;
  const [highlightedSource, setHighlightedSource] = useState<StagedQuote | null>(null);
  const markedRanges = useMemo(
    () => replyQuotes.flatMap((quote) => (quote.range === undefined ? [] : [quote.range])),
    [replyQuotes],
  );
  useQuoteMarks(markedRanges);
  const quickKey = (chief.quickReplies ?? []).join('\n');
  const [preview, setPreview] = useState<{ key: string; text: string } | null>(null);
  const previewReply = preview !== null && preview.key === quickKey ? preview.text : null;
  const composerPlaceholder =
    previewReply ??
    (chief.outage != null
      ? t('可以继续说，恢复后按顺序处理')
      : chief.waitingTurn !== undefined || (chief.running === true && chief.noRunningTurn === true)
        ? t(CHIEF_INPUT_PLACEHOLDER_QUEUED)
        : chief.running === true
          ? t(CHIEF_INPUT_PLACEHOLDER_STEERING)
          : (placeholder ?? t(CHIEF_INPUT_PLACEHOLDER)));
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const onAttachment =
    onSend != null ? (files: File[]) => uploadMessageAttachments(files, t) : undefined;
  const { scrollToEnd } = useMessageScroller();
  const reader = useReaderFollow();
  const followSentRef = useRef(false);
  const [enteringKey, setEnteringKey] = useState<string | number | null>(null);
  const latestUserKeyRef = useRef<string | number | null>(null);
  const userKeyAtSendRef = useRef<string | number | null>(null);
  const prevThreadRef = useRef(chief.threadTitle);
  useEffect(() => {
    if (prevThreadRef.current === chief.threadTitle) return;
    prevThreadRef.current = chief.threadTitle;
    reader.follow();
    scrollToEnd();
  }, [chief.threadTitle, scrollToEnd, reader]);
  const [typing, setTyping] = useState(false);
  const [liveDraft, setLiveDraft] = useServerDraft({
    teamId,
    scope: draftScope,
    localKey: draftStorageKey,
    enabled: live,
    initial: initialDraft,
  });
  useEffect(() => {
    if (liveDraft.trim() === '') setTyping(false);
  }, [liveDraft]);
  const liveDraftRef = useRef(liveDraft);
  liveDraftRef.current = liveDraft;
  const stopTurnRef = useRef<(() => void) | undefined>(undefined);
  const surfaceRef = useRef<ComposerSurfaceHandle | null>(null);
  const drop = useFileDrop(
    onAttachment === undefined || composerReplacement != null
      ? undefined
      : (files) => surfaceRef.current?.attach(files),
  );
  const restoreToThread = (update: (current: string) => string) => {
    setLiveDraft(update);
    surfaceRef.current?.focus({ preventScroll: true });
  };
  const composerBinding = serverDraftBinding(
    onSend != null ? liveDraft : (chief.draft ?? ''),
    onSend != null
      ? (value: string) => {
          setLiveDraft(value);
          setTyping(value.trim() !== '');
        }
      : undefined,
  );
  const sendQuoted =
    onSend == null
      ? undefined
      : (quoted: readonly StagedQuote[], text: string) => {
          followSentRef.current = true;
          userKeyAtSendRef.current = latestUserKeyRef.current;
          const sent = onSend(quoted.length === 0 ? text : encodeReplyQuotes(quoted, text));
          const clearSent = () =>
            setReplyQuotes((current) => current.filter((quote) => !quoted.includes(quote)));
          if (sent instanceof Promise) {
            Promise.resolve(sent).then(clearSent, () => {
              followSentRef.current = false;
            });
          } else {
            clearSent();
          }
          return sent;
        };
  const sendFromComposer =
    sendQuoted === undefined
      ? undefined
      : (text: string) => sendQuoted(replyQuotesRef.current, text);
  const stageQuote = useCallback((draft: ReplyQuoteDraft, reply: string) => {
    setReplyQuotes((current) => [...current, stagedQuote(draft, reply)]);
    surfaceRef.current?.focus({ preventScroll: true });
  }, []);
  const prefillKey = prefill?.key;
  const prefillText = prefill?.text;
  const prefillMerge = prefill?.merge === true;
  useEffect(() => {
    if (prefillKey == null || prefillText == null) return;
    restoreToThread((cur) =>
      prefillMerge
        ? cur.trim() === ''
          ? prefillText
          : `${cur.trimEnd()}\n${prefillText}`
        : prefillText,
    );
  }, [prefillKey, prefillText, prefillMerge]);
  const archivedQ = useArchivedTodos(teamId, live);
  const glances = useMemo(() => {
    const active =
      todoGlances ?? new Map((todosQ.data ?? []).map((td) => [td.id, todoGlanceOf(td)]));
    const archived = (archivedQ.data ?? []).filter((td) => !active.has(td.id));
    if (archived.length === 0) return active;
    return new Map([...active, ...archived.map((td) => [td.id, todoGlanceOf(td)] as const)]);
  }, [todoGlances, todosQ.data, archivedQ.data]);
  const glancesReady = !live || todoGlances !== undefined || todosQ.isSuccess || todosQ.isError;
  const unread = useUnreadThreadIds(glances);
  const empty = (chief.stream?.length ?? 0) === 0;
  const heroLayout = empty && !heroCollapsed && !questionPending;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const connected = useConnected();
  const outage = useConnectionOutage();
  const restoredQuotesRef = useRef(new Map<string, readonly StagedQuote[]>());
  const restoreSent = (text: string, outboxKey?: string) => {
    followSentRef.current = false;
    const { quotes, body } = draftFromSent(text);
    if (outboxKey !== undefined) restoredQuotesRef.current.set(outboxKey, quotes);
    if (quotes.length > 0) setReplyQuotes((current) => [...current, ...quotes]);
    if (body !== '') restoreToThread((cur) => (cur === '' ? body : `${cur}\n${body}`));
  };
  const restoreSentRef = useRef(restoreSent);
  restoreSentRef.current = restoreSent;
  const activeThreadId = chief.threadId ?? null;
  const scopeProjectId = draftScope.startsWith('chief:') ? draftScope.slice('chief:'.length) : null;
  useEffect(() => {
    for (const entry of unsent?.failed ?? []) {
      if (entry.threadId !== null) {
        if (activeThreadId === null || entry.threadId !== activeThreadId) continue;
      } else if (entry.projectId !== scopeProjectId) {
        continue;
      }
      const text = unsent?.discard(entry.key) ?? null;
      if (text !== null) restoreSentRef.current(text, entry.key);
    }
  }, [unsent, activeThreadId, scopeProjectId]);
  const clearArrivedRef = useRef<LateArrival>(() => false);
  clearArrivedRef.current = (entry) => {
    const here =
      entry.threadId !== null
        ? entry.threadId === activeThreadId
        : entry.projectId === scopeProjectId;
    if (!here) return false;
    const { body } = draftFromSent(entry.text);
    if (body !== '' && withoutReturnedText(liveDraft, body) !== liveDraft)
      restoreToThread((cur) => withoutReturnedText(cur, body));
    const restored = restoredQuotesRef.current.get(entry.key) ?? [];
    restoredQuotesRef.current.delete(entry.key);
    if (restored.length > 0)
      setReplyQuotes((current) => current.filter((quote) => !restored.includes(quote)));
    return true;
  };
  useEffect(() => unsent?.onArrivedLate((entry) => clearArrivedRef.current(entry)), [unsent]);
  const withdraw =
    onWithdraw == null
      ? undefined
      : (messageId: string, text: string) => {
          onWithdraw(messageId).then(
            () => restoreSent(text),
            () => {},
          );
        };
  const withdrawRef = useRef(withdraw);
  withdrawRef.current = withdraw;
  const withdrawSteer = useCallback(
    (messageId: string, text: string) => withdrawRef.current?.(messageId, text),
    [],
  );
  const waitingRerun = chief.waitingRerun === true;
  const waitingMessageId = waitingRerun ? undefined : chief.waitingTurn?.messageId;
  const stoppable = waitingRerun || waitingMessageId !== undefined || chief.noRunningTurn !== true;
  const stopTurn = onStop === undefined || !stoppable ? undefined : () => onStop(waitingMessageId);
  stopTurnRef.current = stopTurn;
  const canStop = stopTurn !== undefined && (waitingRerun || chief.running === true);
  const allRows = useMemo(
    () =>
      awaitingStream(workingRowLast(chief.stream ?? [])).map((item, i) => ({
        item,
        i,
      })),
    [chief.stream],
  );
  const rows = useMemo(
    () =>
      allRows.filter(
        ({ item }) =>
          item.kind !== 'user' || (item.pending !== 'held' && item.pending !== 'queued'),
      ),
    [allRows],
  );
  const latestUser = rows.findLast(({ item }) => item.kind === 'user');
  const latestError = rows.findLast(({ item }) => item.kind === 'error');
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
    reader.follow();
    scrollToEnd();
  }, [latestUserKey, keyAtSend, sentRowPosition, latestUserPosition, scrollToEnd, reader]);
  const queuedMessages: QueuedMessage[] = allRows.flatMap(({ item }) =>
    item.kind === 'user' && (item.pending === 'queued' || item.pending === 'held')
      ? [
          {
            id: item.id ?? item.outboxKey ?? '',
            text: replySummary(item.text),
            held: item.pending === 'held',
            sending: item.id == null,
          },
        ]
      : [],
  );
  const rawQueuedText = (message: QueuedMessage) => {
    const row = allRows.find(({ item }) => item.kind === 'user' && item.id === message.id);
    return row?.item.kind === 'user' ? row.item.text : message.text;
  };
  const capsules = (
    <StagedQuotes
      quotes={replyQuotes}
      onRemove={(removed) => {
        setReplyQuotes((current) => current.filter((quote) => quote !== removed));
        setHighlightedSource((current) => (current === removed ? null : current));
      }}
      onHighlight={setHighlightedSource}
    />
  );
  const queueTab = (
    <QueueTabs
      messages={queuedMessages}
      onRemove={
        onWithdraw === undefined
          ? undefined
          : (message) => {
              const raw = rawQueuedText(message);
              if (message.held) {
                withdraw?.(message.id, raw);
                return;
              }
              onWithdraw(message.id).then(
                () => restoreSent(raw),
                () => {},
              );
            }
      }
    />
  );
  const lastUserId = latestUser?.item.kind === 'user' ? (latestUser.item.id ?? null) : null;
  const retryLastUser = useMemo(
    () =>
      onRewind == null || lastUserId === null
        ? undefined
        : () => {
            followSentRef.current = true;
            onRewind(lastUserId);
          },
    [onRewind, lastUserId],
  );
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const failure = useMemo(() => {
    if (latestError === undefined || latestError.item.kind !== 'error') return null;
    if (latestUser != null && latestUser.i > latestError.i) return null;
    const key = String(latestError.item.id ?? latestError.i);
    if (key === dismissedFailure) return null;
    return {
      key,
      id: latestError.item.id ?? null,
      error: latestError.item.error ?? { message: latestError.item.text },
      retry: latestUser == null ? onRetryGreeting : retryLastUser,
    };
  }, [latestError, latestUser, dismissedFailure, onRetryGreeting, retryLastUser]);
  const [dismissedWait, setDismissedWait] = useState<string | null>(null);
  const { switchChiefStepMachine } = useApiMutations(teamId);
  const handleSwitchMachine = useCallback(
    (stepId: string, machineId: string) => {
      switchChiefStepMachine.mutate(
        { stepId, machineId },
        { onError: (error) => toastError(t('切换执行机失败，请重试。'), error) },
      );
    },
    [switchChiefStepMachine, t],
  );
  const liveWait = rows.findLast(({ item }) => item.kind === 'streaming')?.item;
  const waitNow = liveWait?.kind === 'streaming' ? (liveWait.queueWait ?? null) : null;
  useEffect(() => {
    if (waitNow === null) setDismissedWait(null);
  }, [waitNow]);
  const queueWait = waitNow !== null && waitNow.kind !== dismissedWait ? waitNow : null;
  const cardFailure =
    connected && chief.outage == null && queueWait === null ? (failure?.id ?? null) : null;
  const dayEarlier = day?.earlier ?? 0;
  const [earlierLayout, streamLayout] = useMemo(() => {
    const reportSeen = new Set<string>();
    const before = layoutStream(rows.slice(0, dayEarlier), glances, null, reportSeen, cardFailure);
    return [
      before,
      layoutStream(rows.slice(dayEarlier), glances, before.lastAt, reportSeen, cardFailure),
    ] as const;
  }, [rows, glances, dayEarlier, cardFailure]);
  const lastRobotIndex = rows.findLastIndex(
    ({ item }) => item.kind === 'robot' && item.typing !== true,
  );
  const row = (
    item: GroupedRow['item'],
    i: number,
    run: BubbleRun | undefined,
    started: readonly string[] | undefined,
    reports: readonly string[] | undefined,
  ) => (
    <ChiefStreamRow
      item={item}
      entering={enteringKey !== null && chiefStreamRowKey(item, i) === enteringKey}
      onWithdraw={onWithdraw != null ? withdrawSteer : undefined}
      joinsPrev={run?.joinsPrev === true}
      joinsNext={run?.joinsNext === true}
      {...(started !== undefined ? { started } : {})}
      {...(reports !== undefined ? { reports } : {})}
      glancesReady={glancesReady}
    />
  );
  const quickAfter =
    lastRobotIndex >= 0 && !rows.slice(lastRobotIndex).some(({ item }) => item.kind === 'user')
      ? rows[lastRobotIndex]?.item
      : undefined;
  const quickReplies = (
    <QuickReplies
      replies={chief.quickReplies}
      hidden={questionPending || typing}
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
            <TimeDivider at={at} className="mt-5" />
          </MessageScrollerItem>
        )}
        {row(
          entry.item,
          entry.i,
          layout.runs[n],
          layout.started.get(entry.item),
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
      <span>{t('请先在「设置 → 模型」中配置 Coordinator。')}</span>
      <Button className={`ml-auto cursor-pointer ${DIALOG_PRIMARY_BUTTON}`} onClick={onSettings}>
        {t('设置')}
      </Button>
    </div>
  );
  return (
    <QuestionArrivals>
      {heroLayout ? (
        <div
          {...drop.bind}
          data-testid="chief-home-scroll"
          className="min-h-0 min-w-0 flex-1 in-data-[chat-top=under-header]:pt-12 overflow-x-hidden overflow-y-auto pointer-fine:overscroll-none pb-6"
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
              reserveEnd={false}
              ref={viewportRef}
              {...reader.viewportProps}
              data-testid="chief-body"
              className="pb-8 scrollbar-gutter-both data-pending-scroll:visible data-pending-scroll:opacity-0 [--scroll-fade-size:32px] in-data-[chat-top=under-header]:[--scroll-fade-size-top:128px] in-data-[chat-top=under-header]:[--scroll-fade-inset-top:80px] [html[data-narrow-chrome]_&]:[--scroll-fade-size-top:120px] [html[data-narrow-chrome]_&]:[--scroll-fade-inset-top:72px]"
            >
              <MessageScrollerContent className={SCROLLER_CONTENT_CLS} data-testid="chief-stream">
                <TodoGlanceContext.Provider value={glances}>
                  <ThreadUnreadContext.Provider value={unread}>
                    <ReplySourceHighlightContext.Provider
                      value={
                        highlightedSource !== null && replyQuotes.includes(highlightedSource)
                          ? highlightedSource
                          : null
                      }
                    >
                      <CardFailureContext.Provider value={cardFailure}>
                        {lead}
                        {day == null ? (
                          <VirtualStream
                            cacheKey={chief.threadId ?? ''}
                            keys={streamLayout.keys}
                            pinned={streamLayout.pinned}
                            renderRow={(n) => streamEntry(streamLayout, n)}
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
                      </CardFailureContext.Provider>
                    </ReplySourceHighlightContext.Provider>
                  </ThreadUnreadContext.Provider>
                </TodoGlanceContext.Provider>
              </MessageScrollerContent>
            </FadeScrollerViewport>
            <JumpToLatestButton label={t('滚动到最新')} onClick={reader.follow}>
              <ArrowDown className="size-5" />
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
          <SelectionReply
            containerRef={viewportRef}
            enabled={sendQuoted !== undefined && composerReplacement == null}
            onAddQuote={stageQuote}
            onSendQuote={(draft, text) => {
              const item = stagedQuote(draft, text);
              Promise.resolve(sendQuoted?.([item], '')).catch(() =>
                setReplyQuotes((current) => [...current, item]),
              );
            }}
          />
        </>
      )}

      {chief.outage != null ? (
        <ChiefOutageBanner outage={chief.outage} onSettings={onSettings} />
      ) : queueWait !== null ? (
        <QueueWaitCard
          key={queueWait.kind}
          wait={queueWait}
          className={BANNER_CLS}
          onDismiss={() => setDismissedWait(queueWait.kind)}
          onSwitchMachine={handleSwitchMachine}
          switching={switchChiefStepMachine.isPending}
        />
      ) : failure !== null ? (
        <TurnFailureCard
          key={failure.key}
          error={failure.error}
          className={BANNER_CLS}
          onRetry={failure.retry}
          onDismiss={() => setDismissedFailure(failure.key)}
        />
      ) : chief.fallbackModel != null ? (
        <ChiefFallbackBanner model={chief.fallbackModel} onSettings={onSettings} />
      ) : (
        notice
      )}
      <div
        {...drop.bind}
        data-testid="chief-composer-block"
        className="group/composer relative flex max-h-[65%] min-h-0 flex-none flex-col"
      >
        {(outage.phase === 'reconnecting' || outage.phase === 'long-outage') && (
          <div className="pointer-events-none absolute inset-x-0 bottom-full z-(--z-floating)">
            <ChiefConnectionBanner phase={outage.phase} onRetry={outage.retryNow} />
          </div>
        )}
        {composerReplacement ?? (
          <ComposerSurface
            key="thread"
            handleRef={surfaceRef}
            binding={composerBinding}
            editable={onSend != null}
            onSend={sendFromComposer}
            send={
              pendingComments != null && pendingComments.count > 0
                ? {
                    label: t('发送（含 {n} 条评论）', { n: pendingComments.count }),
                    text: t('发送（含 {n} 条评论）', { n: pendingComments.count }),
                    testId: 'chief-send-comments',
                    enabled: onSend != null,
                    ...(liveDraft.trim() === '' && sendFromComposer !== undefined
                      ? {
                          onClick: () => void sendFromComposer(pendingComments.emptyDraftText),
                        }
                      : {}),
                  }
                : undefined
            }
            onAttachment={onAttachment}
            mentionGroups={mentionGroups}
            stop={{
              available: canStop,
              onStop: () => stopTurnRef.current?.(),
            }}
            onCancelReply={replyQuotes.length === 0 ? undefined : () => setReplyQuotes([])}
            sendEmpty={replyQuotes.length > 0}
            placeholder={composerPlaceholder}
            composerRef={composerRef}
            tab={queueTab}
            above={
              <>
                {pendingComments?.chips}
                {capsules}
              </>
            }
            context={chief.context}
            running={chief.running}
            threadId={chief.threadId ?? null}
            dropActive={drop.active}
            seededFiles={live ? undefined : chief.composerFiles}
          />
        )}
      </div>
    </QuestionArrivals>
  );
}
