import { cn } from 'cn';
import { ChevronLeft, FileDiff, ListChecks, X } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { contextPercentOf } from '../chief/context-meter-ring.js';
import { REPLY_SOURCE_ATTR } from '../chief/selection-reply-model.js';
import { TraceCard } from '../components/chat/trace-parts.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueuedCapsules } from '../components/queued-capsules.js';
import { SidePanel } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { toastError } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { Composer } from '../detail/composer.js';
import { DocPane } from '../detail/docpane.js';
import { taskStatusInk } from '../detail/segments.js';
import { SourceIssueLine } from '../detail/source-issue.js';
import { TranscriptColumn } from '../detail/transcript-column.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useServerDraft } from '../overlay/use-server-draft.js';
import { type EngineRunView, engineTranscript } from './engine-run.js';
import { EngineRawView, EngineRunTail } from './engine-run-view.js';
import { useOpenCoordinatorThread } from './open-composer.js';
import { joinMeta, relativeTime } from './rel-time.js';
import { STATUS_WORDS } from './status-words.js';
import { type ThreadActions, useThreadActions } from './thread-actions.js';
import { ThreadAutomations } from './thread-automations.js';
import type { ThreadChanges } from './thread-changes.js';
import { THREAD_PARAM, threadCopy, threadStatus, VIEW_PARAM } from './thread-copy.js';
import { ThreadLead } from './thread-lead.js';
import {
  type ThreadChatStream,
  type ThreadOrigin,
  type ThreadUpdates,
  threadOrigin,
  threadPurpose,
  threadUpdates,
} from './thread-panel-model.js';
import { ThreadPrPanel } from './thread-pr-panel.js';
import {
  ThreadUsageDetails,
  ThreadUsageRing,
  type ThreadUsageView,
  threadUsageShown,
} from './thread-usage-ring.js';
import { type ThreadChat, useThreadChat } from './use-thread-chat.js';
import { useThreadMentions } from './use-thread-mentions.js';
import { useThreadUsage } from './use-thread-usage.js';
import { PANE_PARAM } from './work-panel.js';

const OVERLAY_QUERY = '(max-width: 1100px)';

export const THREAD_HEAD_BUTTON =
  'size-9 flex-none text-foreground hover:text-foreground [&_svg]:size-5.5 max-[640px]:size-8';

const OPEN_SURFACE = '.overlay, [role="dialog"], [role="menu"], [role="listbox"]';

function StatusLine({
  todo,
  machineName,
  now,
  waitingOnChecks,
  updates,
  originText,
}: {
  todo: TodoRecord;
  machineName: string | null;
  now: number;
  waitingOnChecks: boolean;
  updates: ThreadUpdates | null;
  originText: string | null;
}) {
  const { t } = useI18n();
  const needsYou = threadStatus(todo) === 'needs-you';
  const stated = threadPurpose(todo);
  const purpose = stated === originText?.trim() ? '' : stated;
  const meta =
    needsYou && updates !== null
      ? t('{n} 条更新', { n: updates.lines.length })
      : purpose !== ''
        ? purpose
        : joinMeta([machineName, relativeTime(todo.phaseAt, now, t)]);
  return (
    <p
      data-testid="side-chat-status"
      className="m-0 flex min-w-0 items-center gap-1 text-meta text-content-tertiary"
    >
      <span
        className={cn(
          'flex-none',
          todo.quotaWait == null ? taskStatusInk(todo.phase) : 'text-content-secondary',
        )}
      >
        {todo.quotaWait != null
          ? t('等额度')
          : waitingOnChecks
            ? t(STATUS_WORDS.waitingChecks)
            : t(threadCopy(todo).state)}
      </span>
      {meta !== '' && (
        <>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{meta}</span>
        </>
      )}
    </p>
  );
}

function Unavailable({ chat }: { chat: ThreadChat }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="side-chat-unavailable"
      data-state={chat.load}
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p
        className={cn(
          'm-0 text-ui',
          chat.load === 'loading' ? 'text-content-tertiary' : 'text-foreground',
        )}
      >
        {chat.load === 'loading'
          ? t('加载中…')
          : chat.load === 'error'
            ? t('任务加载失败')
            : t('任务不存在或已被删除')}
      </p>
      {chat.load === 'error' && (
        <Button size="sm" onClick={chat.retry}>
          {t('重试')}
        </Button>
      )}
    </div>
  );
}

function SourceLine({
  wire,
  onLeave,
}: {
  wire: NonNullable<ThreadChat['wire']>;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const openChiefThread = useOpenCoordinatorThread();
  return (
    <SourceIssueLine
      todo={wire}
      onRetry={() =>
        mutations.retryGithubIssue.mutate(wire.id, {
          onError: (error) => toastError(t('重试失败，请稍后再试。'), error),
        })
      }
      retryPending={mutations.retryGithubIssue.isPending}
      onOpenThread={(threadId) => {
        onLeave();
        openChiefThread(threadId);
      }}
    />
  );
}

type ThreadView = 'chat' | 'changes' | 'raw';

function ChangesView({ chat, now }: { chat: ThreadChat; now: number }) {
  const { t } = useI18n();
  const { changes } = chat;
  if (changes.status === 'loading' || changes.status === 'error') {
    return (
      <div
        data-testid="side-chat-changes-view"
        data-state={changes.status}
        className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p
          className={cn(
            'm-0 text-ui',
            changes.status === 'loading' ? 'text-content-tertiary' : 'text-foreground',
          )}
        >
          {changes.status === 'loading' ? t('加载中…') : t('变更加载失败')}
        </p>
        {changes.status === 'error' && (
          <Button size="sm" onClick={chat.retryChanges}>
            {t('重试')}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div
      data-testid="side-chat-changes-view"
      data-state="ready"
      className="flex min-h-0 flex-1 flex-col"
    >
      <DocPane
        mode="changes"
        doc={undefined}
        changes={changes.content}
        now={now}
        onDocView={() => undefined}
        hideVersion
        onToggleExpand={chat.toggleChangesExpanded}
        buildId={chat.buildId}
      />
    </div>
  );
}

function ChangesCard({ changes, onOpen }: { changes: ThreadChanges; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <TraceCard className="mt-5 w-fit max-w-full">
      <Button
        variant="ghost"
        data-testid="side-chat-changes"
        data-state={changes.status}
        aria-description={t('查看变更')}
        onClick={onOpen}
        className="h-10 max-w-full justify-start gap-2 border-0 px-3 text-ui font-normal text-foreground hover:bg-(--menu-hover) pointer-coarse:h-11 dark:hover:bg-(--menu-hover)"
      >
        <FileDiff aria-hidden="true" className="size-5 flex-none text-content-secondary" />
        <span className="min-w-0 truncate">
          {changes.status === 'ready'
            ? t('改动 {n} 个文件', { n: changes.fileCount })
            : t('变更加载失败')}
        </span>
        {changes.status === 'ready' && (
          <span className="flex flex-none gap-2 pl-2 text-meta tabular-nums">
            <span className="text-(--diff-add-fg)">+{changes.added}</span>
            {changes.removed > 0 && <span className="text-destructive">−{changes.removed}</span>}
          </span>
        )}
      </Button>
    </TraceCard>
  );
}

function ThreadBody({
  chat,
  todo,
  actions,
  view,
  onViewChanges,
  onViewRaw,
  now,
  updates,
  origin,
  onJumpToOrigin,
  onOpenPlan,
  onClose,
  usage,
  engine,
}: {
  chat: ThreadChat;
  todo: TodoRecord;
  actions: ThreadActions;
  view: ThreadView;
  onViewChanges: () => void;
  onViewRaw: () => void;
  now: number;
  updates: ThreadUpdates | null;
  origin: ThreadOrigin | null;
  onJumpToOrigin: () => void;
  onOpenPlan: (() => void) | undefined;
  onClose: () => void;
  usage: ThreadUsageView | null;
  engine: EngineRunView | undefined;
}) {
  const { t } = useI18n();
  const mentions = useThreadMentions(todo.projectId);
  const archived = todo.archivedAt != null;
  const { live, teamId } = useLiveData();
  const [draft, setDraft] = useServerDraft({
    teamId,
    scope: `todo:${todo.id}`,
    localKey: `cairn.draft.todo:${todo.id}`,
    enabled: live,
  });
  return (
    <>
      {chat.wire?.sourceKind != null && <SourceLine wire={chat.wire} onLeave={onClose} />}
      {view === 'raw' && engine !== undefined ? (
        <EngineRawView run={engine.run} />
      ) : view === 'changes' ? (
        <ChangesView chat={chat} now={now} />
      ) : (
        <TranscriptColumn
          transcript={[
            ...chat.transcript.filter((item) => item.kind !== 'plan'),
            ...(engine === undefined ? [] : engineTranscript(engine.run)),
          ]}
          liveStep={null}
          agent={null}
          onOpenPlan={onOpenPlan}
          lead={
            <ThreadLead
              todo={todo}
              showSpec={!chat.hasEarlier}
              updates={updates}
              origin={origin}
              onJumpToOrigin={onJumpToOrigin}
            />
          }
          result={
            engine !== undefined ||
            chat.changes.status === 'ready' ||
            chat.changes.status === 'error' ? (
              <>
                {engine?.controls}
                {engine !== undefined && (
                  <EngineRunTail run={engine.run} actions={engine.actions} onViewRaw={onViewRaw} />
                )}
                {(chat.changes.status === 'ready' || chat.changes.status === 'error') && (
                  <ChangesCard changes={chat.changes} onOpen={onViewChanges} />
                )}
              </>
            ) : undefined
          }
          hasEarlier={chat.hasEarlier}
          {...(chat.earlier !== undefined ? { earlier: chat.earlier } : {})}
          autoScroll={chat.transcript.length > 0}
          running={threadStatus(todo) === 'running'}
          settled={chat.transcriptSettled}
          threadKey={todo.id}
          shortEnd={engine !== undefined}
        />
      )}
      {chat.sendError != null && (
        <p
          data-testid="side-chat-send-error"
          className="m-0 mx-4 mb-2 text-center text-meta text-destructive"
        >
          {chat.sendError}
        </p>
      )}
      {actions.card}
      {chat.send === undefined && (chat.queuedMessages?.length ?? 0) > 0 && (
        <div
          className="mx-auto mb-2 w-[calc(100%-2rem)] max-w-(--chat-max-w) flex-none"
          data-testid="queued-capsules-standalone"
        >
          <QueuedCapsules
            messages={chat.queuedMessages ?? []}
            onSendNow={chat.sendQueuedNow}
            onRemove={chat.removeQueued}
            onEdit={chat.editQueued}
          />
        </div>
      )}
      {!archived && (
        <Composer
          placeholder={
            todo.phase === 'closed'
              ? t('已关闭，不能再回复')
              : chat.started
                ? t('回复这个任务')
                : t('开始后才能回复')
          }
          aiReview={false}
          streaming={chat.running}
          editable={chat.send !== undefined}
          readOnly={chat.locked}
          draft={draft}
          onDraftChange={setDraft}
          {...(chat.send !== undefined ? { onSend: chat.send } : {})}
          {...(chat.queue !== undefined ? { onQueue: chat.queue } : {})}
          {...(chat.stopAndSend !== undefined ? { onStopAndSend: chat.stopAndSend } : {})}
          {...(chat.stop !== undefined ? { onStop: chat.stop } : {})}
          {...(chat.attach !== undefined ? { onAttachment: chat.attach } : {})}
          mentionGroups={mentions.groups}
          mentionFiles={mentions.files}
          queuedMessages={chat.queuedMessages}
          onSendQueuedNow={chat.sendQueuedNow}
          onRemoveQueued={chat.removeQueued}
          onEditQueued={chat.editQueued}
          {...(usage !== null
            ? {
                meter: <ThreadUsageRing key={todo.id} {...usage} />,
                menuMeter: <ThreadUsageDetails {...usage} className="px-2.5 py-2" />,
              }
            : {})}
        />
      )}
    </>
  );
}

export function SideChat({
  todoId,
  listed,
  now,
  chatStream,
  onClose,
}: {
  todoId: string;
  listed: TodoRecord | undefined;
  now: number;
  chatStream?: ThreadChatStream;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const chat = useThreadChat(todoId, listed);
  const todo = chat.todo;
  const [searchParams, setSearchParams] = useSearchParams();
  const closeAll = () =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete(THREAD_PARAM);
        params.delete(VIEW_PARAM);
        params.delete(PANE_PARAM);
        return params;
      },
      { replace: true },
    );
  const [chosenView, setView] = useState<ThreadView>(
    searchParams.get(VIEW_PARAM) === 'changes' ? 'changes' : 'chat',
  );
  const view = chosenView === 'changes' && chat.changes.status === 'none' ? 'chat' : chosenView;
  const showsSubView = view !== 'chat';
  const Stage = chat.engineStage;
  const thread = (engine: EngineRunView | undefined) =>
    todo == null ? null : (
      <ReadyThread
        todo={engine?.phase === undefined ? todo : { ...todo, phase: engine.phase }}
        chat={
          engine?.phase === undefined ? chat : { ...chat, running: engine.phase === 'building' }
        }
        engine={engine}
        now={now}
        view={view}
        onView={setView}
        chatStream={chatStream}
        onClose={onClose}
        onCloseAll={closeAll}
      />
    );

  const panelRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const releaseCovered = (target: EventTarget | null) => {
      const panel = panelRef.current;
      if (panel === null || !(target instanceof HTMLElement)) return;
      if (!window.matchMedia(OVERLAY_QUERY).matches || panel.contains(target)) return;
      if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null) return;
      target.blur();
    };
    releaseCovered(document.activeElement);
    const onFocusIn = (event: FocusEvent) => releaseCovered(event.target);
    const onKeyDown = () => releaseCovered(document.activeElement);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector(OPEN_SURFACE) !== null) return;
      if (showsSubView) setView('chat');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showsSubView]);

  return (
    <SidePanel
      ref={panelRef}
      label={todo?.title ?? t('任务')}
      onDismiss={onClose}
      testId="side-chat-panel"
    >
      {todo != null && chat.load === 'ready' ? (
        Stage !== undefined ? (
          <Stage>{thread}</Stage>
        ) : (
          thread(chat.engineRun === undefined ? undefined : { run: chat.engineRun })
        )
      ) : (
        <>
          <Head todoId={todoId} todo={null} onBack={onClose} onClose={closeAll} />
          <Unavailable chat={chat} />
        </>
      )}
    </SidePanel>
  );
}

function ReadyThread({
  todo,
  chat,
  engine,
  now,
  view,
  onView,
  chatStream,
  onClose,
  onCloseAll,
}: {
  todo: TodoRecord;
  chat: ThreadChat;
  engine: EngineRunView | undefined;
  now: number;
  view: ThreadView;
  onView: (view: ThreadView) => void;
  chatStream: ThreadChatStream | undefined;
  onClose: () => void;
  onCloseAll: () => void;
}) {
  const { t } = useI18n();
  const [planOpen, setPlanOpen] = useState(false);
  const openPlan = chat.planDoc !== undefined ? () => setPlanOpen(true) : undefined;
  const usage = useThreadUsage(todo);
  const actions = useThreadActions({ todo, chat, onGone: onClose, onViewPlan: openPlan });
  const { live, teamId } = useLiveData();
  const prs = usePrs(teamId, todo.id, live);
  const prRows = prs.data ?? [];
  const updates = threadUpdates(todo, chat.transcript);
  const origin = threadOrigin(todo.request, chatStream);
  const jumpToOrigin = () => {
    if (origin === null) return;
    const selector = `[data-testid="home-c"] [${REPLY_SOURCE_ATTR}="${CSS.escape(origin.messageId)}"]`;
    if (window.matchMedia(OVERLAY_QUERY).matches) onClose();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = document.querySelector(selector);
        if (target === null) toastError(t('主对话里没有加载这条消息'), null);
        else target.scrollIntoView({ block: 'center' });
      }),
    );
  };
  return (
    <>
      <Head
        todoId={todo.id}
        todo={todo}
        onBack={view !== 'chat' ? () => onView('chat') : onClose}
        backLabel={view !== 'chat' ? t('返回对话') : t('返回')}
        onClose={onCloseAll}
        menu={actions.menu}
        titleExtra={<ThreadAutomations key={todo.id} todo={todo} now={now} />}
        tooltip={todo.title}
      >
        <StatusLine
          todo={todo}
          machineName={chat.machineName}
          now={now}
          waitingOnChecks={chat.waitingOnChecks}
          updates={updates}
          originText={origin?.text ?? null}
        />
      </Head>
      <ThreadPrPanel
        status={prs.status}
        rows={prRows}
        onViewChanges={chat.changes.status !== 'none' ? () => onView('changes') : undefined}
        onRetry={() => void prs.refetch()}
      />
      <ThreadBody
        chat={chat}
        todo={todo}
        actions={actions}
        view={view}
        onViewChanges={() => onView('changes')}
        onViewRaw={() => onView('raw')}
        now={now}
        updates={updates}
        origin={origin}
        onJumpToOrigin={jumpToOrigin}
        onOpenPlan={openPlan}
        onClose={onClose}
        engine={engine}
        usage={
          (usage.hasRuns && threadUsageShown(usage.summary, usage.state)) ||
          contextPercentOf(todo.context) !== null
            ? {
                summary: usage.summary,
                state: usage.state,
                onRetry: usage.retry,
                context: todo.context,
              }
            : null
        }
      />
      <DialogShell
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        size="l"
        title={t('方案')}
        subtitle={todo.title}
      >
        <div data-testid="side-chat-plan" className="flex h-[min(70vh,720px)] min-h-0 flex-col">
          <DocPane
            mode="plan"
            doc={chat.planDoc}
            changes={undefined}
            now={now}
            onDocView={() => undefined}
            planVersions={chat.planVersions}
          />
        </div>
      </DialogShell>
    </>
  );
}

function Head({
  todoId,
  todo,
  onBack,
  onClose,
  menu,
  backLabel,
  titleExtra,
  tooltip,
  children,
}: {
  todoId: string;
  todo: TodoRecord | null;
  onBack: () => void;
  onClose: () => void;
  menu?: ReactNode;
  backLabel?: string;
  titleExtra?: ReactNode;
  tooltip?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const title = (
    <h2 className="m-0 min-w-0 truncate text-ui leading-5 font-normal text-foreground">
      {todo != null ? todo.title : t('任务')}
    </h2>
  );
  return (
    <header
      data-testid="side-chat"
      data-todo-id={todoId}
      data-phase={todo?.phase}
      className="flex min-h-17 flex-none items-center gap-0.5 py-3.5 pr-3.5 pl-1"
    >
      <IconTooltip
        label={backLabel ?? t('返回')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            data-testid="side-chat-back"
            onClick={onBack}
            className={THREAD_HEAD_BUTTON}
          />
        }
      >
        <ChevronLeft aria-hidden="true" />
      </IconTooltip>
      <span
        aria-hidden="true"
        data-slot="side-chat-glyph"
        className="ml-1.5 flex size-6 flex-none items-center justify-center rounded-(--cds-radius-md) bg-background shadow-(--e1-lift)"
      >
        <ListChecks className="size-4 text-content-secondary" />
      </span>
      <div
        data-slot="side-chat-titles"
        className="flex min-w-0 flex-1 flex-col gap-0.5 pr-1 pl-2.5"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {tooltip === undefined ? (
            title
          ) : (
            <Tooltip>
              <TooltipTrigger delay={600} render={title} />
              <TooltipContent side="bottom" align="start" sideOffset={6}>
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
          {titleExtra}
        </div>
        {children}
      </div>
      {menu}
      <IconTooltip
        label={t('关闭')}
        side="bottom"
        trigger={
          <Button variant="ghost" size="icon" onClick={onClose} className={THREAD_HEAD_BUTTON} />
        }
      >
        <X aria-hidden="true" />
      </IconTooltip>
    </header>
  );
}
