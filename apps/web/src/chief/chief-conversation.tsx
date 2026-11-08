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
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useConnected } from '../api/connection-state.js';
import { useMachines, useMembers, useProjects, useSkills, useTodos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { FOLLOW_THRESHOLD, JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { useLiveSeconds } from '../components/chat/live-row.js';
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
  MessageScrollerProvider,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { type TodoGlance, TodoGlanceContext } from '../detail/segments.js';
import type { ChiefContent, ChiefStreamItem, Phase } from '../fixtures/records.js';
import { useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowDown } from '../icons/index.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import type { MentionGroups } from '../overlay/mention-token.js';
import { useServerDraft } from '../overlay/use-server-draft.js';
import { ChiefEarlierLoader } from './chief-earlier-loader.js';
import { ChiefStreamRow, chiefStreamRowKey } from './chief-message-rows.js';
import {
  ChiefConnectionBanner,
  ChiefFallbackBanner,
  ChiefOutageBanner,
} from './chief-outage-banner.js';
import type { ChiefQuestionItem } from './chief-question-card.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { serverDraftBinding } from './composer-binding.js';
import { ComposerSurface, type ComposerSurfaceHandle } from './composer-surface.js';
import { outstandingReportIds } from './outstanding-reports.js';
import { awaitingStream } from './question-lifecycle.js';
import { ReplyQuoteBlock } from './reply-quote-block.js';
import { type ReplyQuoteDraft, SelectionReply } from './selection-reply.js';
import { type GroupedRow, groupThreadEvents, type StreamRow } from './thread-activity.js';
import type { ChiefEarlier } from './use-chief-surface.js';

const SCROLLER_ROOT_CLS = 'h-auto min-h-0 min-w-0 flex-1 overscroll-none';
const SCROLLER_CONTENT_CLS =
  'mx-auto block w-full max-w-190 min-w-0 gap-0 px-4 pt-3.5 [overflow-wrap:anywhere]';

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
  earlier?: ChiefEarlier;
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
  pendingQuestion?: (item: ChiefQuestionItem) => ReactNode;
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
  pendingQuestion,
  targetPlaceholder = null,
  showBindGate = true,
}: ChiefConversationProps) {
  const questionWaiting = (useOptionalChiefRoot()?.pendingQuestions.length ?? 0) > 0;
  const { t } = useI18n();
  const composerPlaceholder =
    targetPlaceholder ??
    (chief.outage != null
      ? t('可以继续说，Coordinator 恢复后会按顺序处理…')
      : chief.waitingTurn !== undefined
        ? t(CHIEF_INPUT_PLACEHOLDER_QUEUED)
        : chief.running === true
          ? t(CHIEF_INPUT_PLACEHOLDER_STEERING)
          : (placeholder ?? t(CHIEF_INPUT_PLACEHOLDER)));
  const [replyQuote, setReplyQuote] = useState<ReplyQuoteDraft | null>(null);
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyText = useCallback((key: string, text: string) => {
    const clip = navigator.clipboard;
    if (!clip) return;
    void clip.writeText(text).then(
      () => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
      },
      () => {},
    );
  }, []);
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
  const restoreToThread = (update: (current: string) => string) => {
    setLiveDraft(update);
    surfaceRef.current?.focus({ preventScroll: true });
  };
  const composerBinding = serverDraftBinding(
    onSend != null ? liveDraft : (chief.draft ?? ''),
    onSend != null ? (value: string) => setLiveDraft(value) : undefined,
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
    surfaceRef.current?.focus({ preventScroll: true });
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
  const heroLayout = empty && !heroCollapsed;
  const heroScrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  useScrollFade(heroScrollRef, { enabled: heroLayout });
  const canStop = targetPlaceholder === null && chief.running === true && onStop != null;
  const liveTurn =
    chief.running === true
      ? chief.stream?.findLast((item) => item.kind === 'streaming')
      : undefined;
  const connected = useConnected();
  const turnTick = useLiveSeconds(liveTurn?.kind === 'streaming' ? liveTurn.startedAt : null);
  const turnElapsed = questionWaiting
    ? null
    : (turnTick ?? (liveTurn?.kind === 'streaming' ? liveTurn.seconds : undefined) ?? null);
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
  const allRows = awaitingStream(chief.stream ?? [], questionWaiting).map((item, i) => ({
    item,
    i,
  }));
  const rows = allRows.filter(({ item }) => item.kind !== 'user' || item.pending == null);
  const latestMessage = rows.findLast(
    ({ item }) => item.kind === 'user' || (item.kind === 'robot' && item.typing !== true),
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
        <ReplyQuoteBlock quote={replyQuote.quote} onRemove={() => setReplyQuote(null)} />
      )}
      <QueuedCapsules
        messages={queuedCapsules}
        onSendNow={onSteer ? (id) => onSteer(id) : undefined}
        onRemove={withdraw}
        removeLabel={t('撤回')}
      />
    </>
  );
  const streamRow = ({ item, i }: GroupedRow) => (
    <ChiefStreamRow
      key={chiefStreamRowKey(item, i)}
      item={item}
      index={i}
      latest={i === latestMessage?.i}
      replyable={item.kind === 'thread-report' && outstandingReports.has(item.id)}
      runningTool={chief.runningTool}
      copiedKey={copiedKey}
      onCopy={copyText}
      toolsOpen={toolsOpen}
      onToggleTools={toggleTools}
      onRewindRequest={requestRewind}
      pendingQuestion={pendingQuestion}
    />
  );
  const keepsOwnRow = (item: ChiefStreamItem) =>
    item.kind === 'thread-report' && outstandingReports.has(item.id);
  const renderRows = (list: StreamRow[]) => groupThreadEvents(list, keepsOwnRow).map(streamRow);
  const intro = !chief.bound && showBindGate && (
    <div
      data-testid="chief-gate"
      className="mx-auto mt-4 flex h-14 w-[calc(100%-2rem)] max-w-182 flex-none items-center gap-3 rounded-(--radius-card) bg-(--card) pr-3 pl-4 text-ui text-(--text-secondary) ring-1 ring-(--border)"
    >
      <span>{t('请先为 Coordinator 选择一个 Agent。')}</span>
      <Button className={`ml-auto cursor-pointer ${DIALOG_PRIMARY_BUTTON}`} onClick={onSettings}>
        {t('设置')}
      </Button>
    </div>
  );
  return (
    <>
      {heroLayout ? (
        <div
          ref={heroScrollRef}
          data-testid="chief-home-scroll"
          className="scroll-fade min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none pb-6"
        >
          {hero}
          {intro}
          {below}
        </div>
      ) : (
        <>
          {intro}
          <MessageScroller className={SCROLLER_ROOT_CLS}>
            <FadeScrollerViewport reserveEnd ref={viewportRef} data-testid="chief-body">
              <MessageScrollerContent className={SCROLLER_CONTENT_CLS} data-testid="chief-stream">
                <TodoGlanceContext.Provider value={glances}>
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
                </TodoGlanceContext.Provider>
              </MessageScrollerContent>
            </FadeScrollerViewport>
            <JumpToLatestButton>
              <ArrowDown width={16} height={16} />
              <span className="sr-only">{t('滚动到最新')}</span>
            </JumpToLatestButton>
            <SelectionReply
              containerRef={viewportRef}
              enabled={onSend != null && composerReplacement == null}
              onReply={stageReply}
            />
            {earlier != null && (
              <ChiefEarlierLoader
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
        data-testid="chief-composer-block"
        className="flex max-h-[65%] min-h-0 flex-none flex-col"
      >
        {composerReplacement ?? (
          <>
            {composerError != null && (
              <p
                role="alert"
                data-testid="chief-composer-error"
                className={`mx-auto mt-2 mb-0 flex w-[calc(100%-2rem)] max-w-182 max-h-12 items-start gap-1.5 overflow-y-auto text-meta text-destructive`}
              >
                <TriangleAlert aria-hidden="true" className="size-3.5 flex-none" />
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
              placeholder={composerPlaceholder}
              invalid={composerError != null}
              composerRef={composerRef}
              above={capsules}
              tools={composerTools}
              canStop={canStop}
              onStop={stopTurn}
              running={chief.running === true}
              turnElapsed={turnElapsed}
            />
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
