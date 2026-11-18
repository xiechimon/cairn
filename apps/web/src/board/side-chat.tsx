import { RUNNER_OS_LABELS } from '@cairn/shared';
import { cn } from 'cn';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ListChecks,
  UnfoldVertical,
  X,
} from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApiMutations, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { contextPercentOf } from '../chief/context-meter-ring.js';
import { REPLY_SOURCE_ATTR } from '../chief/reply-source-highlight.js';
import { isFinalReportPhase, ReportThreadContext } from '../chief/research-report.js';
import { TraceCard } from '../components/chat/trace-parts.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueuedCapsules } from '../components/queued-capsules.js';
import { SidePanel } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { toastError } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { Composer } from '../detail/composer.js';
import { DiffFileBody, DocPane } from '../detail/docpane.js';
import { taskStatusInk } from '../detail/segments.js';
import { SourceIssueLine } from '../detail/source-issue.js';
import { TranscriptColumn } from '../detail/transcript-column.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useServerDraft } from '../overlay/use-server-draft.js';
import { MACHINES_HREF } from '../resources/hrefs.js';
import {
  type EngineRunView,
  engineCanTakeOver,
  engineTranscript,
  engineUsageSummary,
} from './engine-run.js';
import { EngineQuestion, EngineRawView, TakeOverDialog } from './engine-run-view.js';
import { useOpenCoordinatorThread } from './open-composer.js';
import { joinMeta, relativeTime } from './rel-time.js';
import { STATUS_WORDS } from './status-words.js';
import { isWaiting, SECTION_LABEL } from './tasks-sections.js';
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
  threadUpdates,
} from './thread-panel-model.js';
import { ThreadPrPanel } from './thread-pr-panel.js';
import { ThreadUpdatesBlock } from './thread-updates-block.js';
import {
  ThreadUsageDetails,
  ThreadUsageRing,
  type ThreadUsageView,
  threadUsageShown,
} from './thread-usage-ring.js';
import { useEngineScreen } from './use-engine-screen.js';
import { type ThreadChat, useThreadChat } from './use-thread-chat.js';
import { useThreadMentions } from './use-thread-mentions.js';
import { useThreadUsage } from './use-thread-usage.js';
import { PANE_PARAM, TASKS_TAB_PARAM } from './work-panel.js';

const OVERLAY_QUERY = '(max-width: 1100px)';

export const THREAD_HEAD_BUTTON =
  'size-9 flex-none text-foreground hover:text-foreground [&_svg]:size-5.5 max-[640px]:size-8 pointer-coarse:size-11';

const OPEN_SURFACE = '.overlay, [role="dialog"], [role="menu"], [role="listbox"]';

function StatusLine({
  todo,
  platformWait,
  now,
  waitingOnChecks,
  updates,
}: {
  todo: TodoRecord;
  platformWait: ThreadChat['platformWait'];
  now: number;
  waitingOnChecks: boolean;
  updates: ThreadUpdates | null;
}) {
  const { t } = useI18n();
  const needsYou = threadStatus(todo) === 'needs-you';
  const need = platformWait?.platform ?? todo.routeOverride?.requiredCapabilities?.os;
  const needText =
    need === undefined ? null : t('需要 {platform}', { platform: RUNNER_OS_LABELS[need] });
  const meta =
    platformWait !== null
      ? platformWait.machine !== null
        ? (needText ?? '')
        : ''
      : needsYou && updates !== null
        ? t('{n} 条更新', { n: updates.lines.length })
        : joinMeta([needText, relativeTime(todo.phaseAt, now, t)]);
  return (
    <p
      data-testid="side-chat-status"
      className="m-0 flex min-w-0 items-center gap-1 text-meta text-content-tertiary"
    >
      <span
        className={cn(
          'flex-none',
          platformWait !== null
            ? 'text-tint-wait-ink'
            : todo.quotaWait == null
              ? taskStatusInk(todo.phase)
              : 'text-content-secondary',
        )}
      >
        {platformWait !== null
          ? platformWait.machine !== null
            ? t('等 {machine} 上线', { machine: platformWait.machine })
            : t('还没有 {platform} 执行机', { platform: RUNNER_OS_LABELS[platformWait.platform] })
          : todo.quotaWait != null
            ? t('等额度')
            : waitingOnChecks
              ? t(STATUS_WORDS.waitingChecks)
              : needsYou && todo.section != null && isWaiting(todo.section)
                ? t(SECTION_LABEL[todo.section])
                : t(threadCopy(todo).state)}
      </span>
      {meta !== '' && (
        <>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{meta}</span>
        </>
      )}
      {platformWait !== null && platformWait.machine === null && (
        <>
          <span aria-hidden="true">·</span>
          <Link to={MACHINES_HREF} className="flex-none text-(--chat-link) hover:underline">
            {t('添加执行机')}
          </Link>
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

type ThreadView = 'chat' | 'raw';

const CHANGES_ROW = 'flex min-h-11 items-center pointer-coarse:min-h-11';
const CHANGES_HEAD_BUTTON =
  'h-auto min-h-11 flex-1 justify-start gap-2 border-0 pr-2 pl-3 text-ui font-normal text-foreground hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent aria-expanded:hover:bg-(--menu-hover) dark:aria-expanded:hover:bg-(--menu-hover)';
const CHANGES_TOOL = 'mr-1.5 flex-none text-content-tertiary pointer-coarse:size-11';

function ChangeCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex flex-none gap-1.5 text-meta tabular-nums">
      <span className="text-(--diff-add-fg)">+{added}</span>
      {removed > 0 && <span className="text-destructive">−{removed}</span>}
    </span>
  );
}

function FullFileToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <IconTooltip
      label={t('显示完整文件')}
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={on}
          data-testid="side-chat-full-file"
          onClick={onToggle}
          className={cn(CHANGES_TOOL, on && 'bg-(--menu-hover) text-foreground')}
        />
      }
    >
      <UnfoldVertical aria-hidden="true" className="size-4" />
    </IconTooltip>
  );
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

function ChangesCard({
  changes,
  buildId,
  open,
  onOpenChange,
  onRetry,
}: {
  changes: ThreadChanges;
  buildId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(new Set());
  const [fullFiles, setFullFiles] = useState<ReadonlySet<string>>(new Set());
  if (changes.status === 'error') {
    return (
      <TraceCard className="mt-5" data-testid="side-chat-changes" data-state="error">
        <div className={cn(CHANGES_ROW, 'gap-2 pl-3 text-ui')}>
          <CircleAlert aria-hidden="true" className="size-4 flex-none text-destructive" />
          <span className="min-w-0 flex-1 truncate text-foreground">{t('改动没加载出来')}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="mr-1.5 pointer-coarse:h-11"
          >
            {t('重试')}
          </Button>
        </div>
      </TraceCard>
    );
  }
  const files = changes.content?.files ?? [];
  const single = files.length === 1 ? files[0] : undefined;
  const allOpen = files.every((file) => openFiles.has(file.path));
  return (
    <TraceCard className="mt-5" data-testid="side-chat-changes" data-state={changes.status}>
      <div className={CHANGES_ROW}>
        <Button
          variant="ghost"
          aria-expanded={open}
          data-testid="side-chat-changes-toggle"
          onClick={() => onOpenChange(!open)}
          className={CHANGES_HEAD_BUTTON}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('size-4 flex-none text-content-tertiary', open && 'rotate-90')}
          />
          <span className="min-w-0 truncate">
            {single !== undefined
              ? t('改动 {name}', { name: baseName(single.path) })
              : t('改动 {n} 个文件', { n: changes.fileCount })}
          </span>
          <ChangeCounts added={changes.added} removed={changes.removed} />
        </Button>
        {open &&
          (single !== undefined ? (
            <FullFileToggle
              on={fullFiles.has(single.path)}
              onToggle={() => setFullFiles((set) => toggled(set, single.path))}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setOpenFiles(allOpen ? new Set() : new Set(files.map((file) => file.path)))
              }
              className="mr-1.5 flex-none text-meta text-content-tertiary pointer-coarse:h-11"
            >
              {allOpen ? t('全部收起') : t('全部展开')}
            </Button>
          ))}
      </div>
      {open && (
        <div data-testid="side-chat-changes-body">
          {single !== undefined ? (
            <DiffFileBody
              file={single}
              buildId={buildId}
              showFull={fullFiles.has(single.path)}
              wrap
            />
          ) : (
            files.map((file) => {
              const fileOpen = openFiles.has(file.path);
              const dir = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')));
              return (
                <div key={file.path} className="border-t border-(--border) first:border-t-0">
                  <div className="flex min-h-9 items-center pointer-coarse:min-h-11">
                    <Button
                      variant="ghost"
                      aria-expanded={fileOpen}
                      data-testid="side-chat-file"
                      onClick={() => setOpenFiles((set) => toggled(set, file.path))}
                      className="h-auto min-h-9 flex-1 justify-start gap-1.5 border-0 pr-2 pl-3 text-ui font-normal text-content-tertiary hover:bg-(--menu-hover) pointer-coarse:min-h-11 dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent aria-expanded:hover:bg-(--menu-hover) dark:aria-expanded:hover:bg-(--menu-hover) aria-expanded:text-content-tertiary"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={cn('size-4 flex-none', fileOpen && 'rotate-90')}
                      />
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-foreground">{baseName(file.path)}</span>
                        {dir !== '' && <span className="ml-1.5">{dir}</span>}
                      </span>
                      <span className="ml-auto pl-2">
                        <ChangeCounts added={file.added} removed={file.removed ?? 0} />
                      </span>
                    </Button>
                    {fileOpen && (
                      <FullFileToggle
                        on={fullFiles.has(file.path)}
                        onToggle={() => setFullFiles((set) => toggled(set, file.path))}
                      />
                    )}
                  </div>
                  {fileOpen && (
                    <div className="border-t border-(--border)">
                      <DiffFileBody
                        file={file}
                        buildId={buildId}
                        showFull={fullFiles.has(file.path)}
                        wrap
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </TraceCard>
  );
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function ThreadBody({
  chat,
  todo,
  actions,
  view,
  changesOpen,
  onChangesOpen,
  origin,
  onJumpToOrigin,
  onClose,
  usage,
  engine,
}: {
  chat: ThreadChat;
  todo: TodoRecord;
  actions: ThreadActions;
  view: ThreadView;
  changesOpen: boolean;
  onChangesOpen: (open: boolean) => void;
  origin: ThreadOrigin | null;
  onJumpToOrigin: () => void;
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
  const reportThread = { title: todo.title, final: isFinalReportPhase(todo.phase) };
  return (
    <>
      {chat.wire?.sourceKind != null && <SourceLine wire={chat.wire} onLeave={onClose} />}
      {view === 'raw' && engine !== undefined ? (
        <EngineRawView run={engine.run} screen={engine.screen} />
      ) : (
        <ReportThreadContext.Provider value={reportThread}>
          <TranscriptColumn
            transcript={[
              ...chat.transcript,
              ...(engine === undefined || engine.eventsInTranscript === true
                ? []
                : engineTranscript(engine.run)),
            ]}
            lead={
              <ThreadLead
                todo={todo}
                showSpec={!chat.hasEarlier}
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
                    <div data-testid="engine-run" data-state={engine.run.state}>
                      <EngineQuestion run={engine.run} actions={engine.actions} />
                    </div>
                  )}
                  {(chat.changes.status === 'ready' || chat.changes.status === 'error') && (
                    <ChangesCard
                      key={todo.id}
                      changes={chat.changes}
                      buildId={chat.buildId}
                      open={changesOpen}
                      onOpenChange={onChangesOpen}
                      onRetry={chat.retryChanges}
                    />
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
        </ReportThreadContext.Provider>
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
          placeholder={chat.started ? t('回复这个任务') : t('开始后才能回复')}
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
                meter: <ThreadUsageRing key={todo.id} {...usage} running={chat.running} />,
                menuMeter: (
                  <ThreadUsageDetails {...usage} running={chat.running} className="px-2.5 py-2" />
                ),
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
        params.delete(TASKS_TAB_PARAM);
        return params;
      },
      { replace: true },
    );
  const [view, setView] = useState<ThreadView>('chat');
  const [changesOpenFor, setChangesOpenFor] = useState<string | null>(
    searchParams.get(VIEW_PARAM) === 'changes' ? todoId : null,
  );
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
        changesOpen={changesOpenFor === todo.id}
        onChangesOpen={(open) => setChangesOpenFor(open ? todo.id : null)}
        chatStream={chatStream}
        onClose={onClose}
        onCloseAll={closeAll}
      />
    );

  const { live } = useLiveData();
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
          thread(
            chat.engineRun === undefined
              ? undefined
              : {
                  run: chat.engineRun,
                  ...(live ? { eventsInTranscript: true } : {}),
                },
          )
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
  changesOpen,
  onChangesOpen,
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
  changesOpen: boolean;
  onChangesOpen: (open: boolean) => void;
  chatStream: ThreadChatStream | undefined;
  onClose: () => void;
  onCloseAll: () => void;
}) {
  const { t } = useI18n();
  const [planOpen, setPlanOpen] = useState(false);
  const updates = threadUpdates(todo, chat.transcript);
  const openPlan =
    chat.planDoc !== undefined || updates !== null ? () => setPlanOpen(true) : undefined;
  const usage = useThreadUsage(todo);
  const [takingOver, setTakingOver] = useState(false);
  const { live, teamId } = useLiveData();
  const screen = useEngineScreen(
    teamId,
    live && engine !== undefined ? (engine.run.stepId ?? null) : null,
    live &&
      engine !== undefined &&
      (view === 'raw' || takingOver || engine.run.state === 'taken_over'),
  );
  const engineView =
    engine === undefined
      ? undefined
      : {
          ...engine,
          run: {
            ...engine.run,
            state: screen.held ? ('taken_over' as const) : engine.run.state,
            rawOutput:
              (screen.status === 'live' || screen.status === 'ended') && screen.text !== ''
                ? screen.text
                : engine.run.rawOutput,
          },
          screen: {
            status: screen.status,
            held: screen.held,
            text: screen.text,
            send: screen.send,
          },
          actions:
            engine.run.stepId !== undefined && live
              ? {
                  answer: () => {},
                  takeOver: () => {
                    screen.takeOver();
                    onView('raw');
                  },
                  handBack: screen.handBack,
                }
              : engine.actions,
        };
  const engineActions = engineView?.actions;
  const actions = useThreadActions({
    todo,
    chat,
    onGone: onClose,
    onViewPlan: openPlan,
    engine:
      engineView === undefined
        ? undefined
        : {
            onViewRaw: () => onView('raw'),
            ...(engineActions === undefined
              ? {}
              : engineView.run.state === 'taken_over'
                ? { takeOver: { label: t('交还'), onClick: engineActions.handBack } }
                : engineCanTakeOver(engineView.run.state)
                  ? { takeOver: { label: t('接管'), onClick: () => setTakingOver(true) } }
                  : {}),
          },
  });
  const prs = usePrs(teamId, todo.id, live);
  const prRows = prs.data ?? [];
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
          platformWait={chat.platformWait}
          now={now}
          waitingOnChecks={chat.waitingOnChecks}
          updates={updates}
        />
      </Head>
      <ThreadPrPanel
        status={prs.status}
        rows={prRows}
        onViewChanges={
          chat.changes.status !== 'none'
            ? () => {
                onView('chat');
                onChangesOpen(true);
                requestAnimationFrame(() =>
                  document
                    .querySelector('.side-panel [data-testid="side-chat-changes"]')
                    ?.scrollIntoView({ block: 'nearest' }),
                );
              }
            : undefined
        }
        onRetry={() => void prs.refetch()}
      />
      <ThreadBody
        chat={chat}
        todo={todo}
        actions={actions}
        view={view}
        changesOpen={changesOpen}
        onChangesOpen={onChangesOpen}
        origin={origin}
        onJumpToOrigin={jumpToOrigin}
        onClose={onClose}
        engine={engineView}
        usage={
          engineView !== undefined ||
          (usage.hasRuns && threadUsageShown(usage.summary, usage.state)) ||
          contextPercentOf(todo.context) !== null
            ? {
                summary:
                  engineView === undefined
                    ? usage.summary
                    : engineUsageSummary(usage.summary, engineView.run),
                state: usage.state,
                onRetry: usage.retry,
                context: todo.context,
              }
            : null
        }
      />
      <TakeOverDialog
        open={takingOver}
        onClose={() => setTakingOver(false)}
        onConfirm={() => engineActions?.takeOver()}
      />
      <DialogShell
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        size="l"
        title={t('计划')}
        subtitle={todo.title}
      >
        <div data-testid="side-chat-plan" className="flex h-[min(70vh,720px)] min-h-0 flex-col">
          {updates !== null && (
            <div className="flex-none border-b border-border px-3.5 pt-1 pb-4">
              <ThreadUpdatesBlock updates={updates} />
            </div>
          )}
          {chat.planDoc !== undefined && <DocPane doc={chat.planDoc} />}
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
              <TooltipTrigger render={title} />
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
