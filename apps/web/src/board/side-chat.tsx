import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { FileDiff, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useChiefRoot } from '../chief/chief-root.js';
import { QueuedCapsules } from '../components/queued-capsules.js';
import { SidePanel } from '../components/side-panel.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { pillOf } from '../components/thread/pr-card.js';
import { PrLink } from '../components/thread/pr-link.js';
import { prCardModelOfRow } from '../components/thread/pr-panel-model.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { toastError } from '../components/ui/toaster.js';
import { Composer } from '../detail/composer.js';
import { DocPane } from '../detail/docpane.js';
import { SourceIssueLine } from '../detail/source-issue.js';
import { TranscriptColumn } from '../detail/transcript-column.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useServerDraft } from '../overlay/use-server-draft.js';
import { relativeTime } from './rel-time.js';
import { type ThreadActions, useThreadActions } from './thread-actions.js';
import { ThreadAutomations } from './thread-automations.js';
import type { ThreadChanges } from './thread-changes.js';
import { threadCopy, threadTone, VIEW_PARAM } from './thread-copy.js';
import { ThreadPrPanel } from './thread-pr-panel.js';
import { ThreadUsageFooter } from './thread-usage-footer.js';
import { type ThreadChat, useThreadChat } from './use-thread-chat.js';
import { useThreadMentions } from './use-thread-mentions.js';

const OVERLAY_QUERY = '(max-width: 1100px)';

const OPEN_SURFACE = '.overlay, [role="dialog"], [role="menu"], [role="listbox"]';

function StatusLine({
  todo,
  machineName,
  now,
  pr,
}: {
  todo: TodoRecord;
  machineName: string | null;
  now: number;
  pr: PrPanelRow | undefined;
}) {
  const { t } = useI18n();
  const meta = [machineName, relativeTime(todo.phaseAt, now, t)].filter((part) => part != null);
  return (
    <p
      data-testid="side-chat-status"
      className="m-0 flex min-w-0 items-center gap-1.5 pl-5 text-meta text-content-tertiary"
    >
      <span className="flex-none font-medium text-content-secondary">
        {todo.quotaWait != null ? t('等额度') : t(threadCopy(todo).state)}
      </span>
      <span aria-hidden="true">·</span>
      {pr !== undefined && (
        <>
          <PrLink number={pr.number} url={pr.url} />
          <span data-testid="side-chat-pr-status" className="flex-none">
            {pillOf(prCardModelOfRow(pr, now), t).label}
          </span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="min-w-0 truncate">{meta.join(' · ')}</span>
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
      <p className="m-0 text-ui text-content-tertiary">
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
  const { openChiefThread } = useChiefRoot();
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

type ThreadView = 'chat' | 'changes';

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
        <p className="m-0 text-ui text-content-tertiary">
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

function ChangesButton({
  changes,
  active,
  onToggle,
}: {
  changes: ThreadChanges;
  active: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={active}
      aria-label={active ? t('返回对话') : t('查看变更')}
      data-testid="side-chat-changes"
      onClick={onToggle}
      className={cn(
        'h-7 gap-1 px-1.5 text-meta text-content-secondary max-[640px]:h-8',
        active && 'bg-(--menu-hover) text-foreground',
      )}
    >
      <FileDiff aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      {changes.status === 'ready' && (
        <>
          <span className="text-(--diff-add-fg) tabular-nums">+{changes.added}</span>
          {changes.removed > 0 && (
            <span className="text-destructive tabular-nums">−{changes.removed}</span>
          )}
        </>
      )}
    </Button>
  );
}

function ThreadBody({
  chat,
  todo,
  actions,
  view,
  now,
  onOpenPlan,
  onClose,
}: {
  chat: ThreadChat;
  todo: TodoRecord;
  actions: ThreadActions;
  view: ThreadView;
  now: number;
  onOpenPlan: (() => void) | undefined;
  onClose: () => void;
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
      {view === 'changes' ? (
        <ChangesView chat={chat} now={now} />
      ) : (
        <TranscriptColumn
          transcript={chat.transcript}
          liveStep={null}
          agent={null}
          onOpenPlan={onOpenPlan}
          spec={todo.spec.trim() !== '' ? todo.spec : undefined}
          autoScroll={chat.transcript.length > 0}
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
      <ThreadUsageFooter key={todo.id} todo={todo} />
      <Composer
        placeholder={
          archived
            ? t('已归档，取消归档后才能继续')
            : todo.phase === 'closed'
              ? t('已关闭，不能再回复')
              : chat.started
                ? t('回复 #{seq}…', { seq: todo.seqNum })
                : t('开始后才能回复 #{seq}', { seq: todo.seqNum })
        }
        aiReview={false}
        streaming={chat.running}
        workingFor={chat.workingFor}
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
      />
    </>
  );
}

export function SideChat({
  todoId,
  listed,
  now,
  onClose,
}: {
  todoId: string;
  listed: TodoRecord | undefined;
  now: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const chat = useThreadChat(todoId, listed);
  const todo = chat.todo;
  const [searchParams] = useSearchParams();
  const [chosenView, setView] = useState<ThreadView>(
    searchParams.get(VIEW_PARAM) === 'changes' ? 'changes' : 'chat',
  );
  const view = chat.changes.status === 'none' ? 'chat' : chosenView;
  const showsChanges = view === 'changes';

  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector(OPEN_SURFACE) !== null) return;
      if (showsChanges) setView('chat');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showsChanges]);

  return (
    <SidePanel ref={panelRef} label={todo?.title ?? t('任务')} onDismiss={onClose}>
      {todo != null && chat.load === 'ready' ? (
        <ReadyThread
          todo={todo}
          chat={chat}
          now={now}
          view={view}
          onView={setView}
          onClose={onClose}
        />
      ) : (
        <>
          <Head todoId={todoId} todo={null} onClose={onClose} />
          <Unavailable chat={chat} />
        </>
      )}
    </SidePanel>
  );
}

function ReadyThread({
  todo,
  chat,
  now,
  view,
  onView,
  onClose,
}: {
  todo: TodoRecord;
  chat: ThreadChat;
  now: number;
  view: ThreadView;
  onView: (view: ThreadView) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [planOpen, setPlanOpen] = useState(false);
  const openPlan = chat.planDoc !== undefined ? () => setPlanOpen(true) : undefined;
  const actions = useThreadActions({ todo, chat, onGone: onClose, onViewPlan: openPlan });
  const { live, teamId } = useLiveData();
  const prs = usePrs(teamId, todo.id, live);
  const prRows = prs.data ?? [];
  return (
    <>
      <Head
        todoId={todo.id}
        todo={todo}
        onClose={onClose}
        menu={actions.menu}
        titleExtra={<ThreadAutomations key={todo.id} todo={todo} now={now} />}
        {...(chat.changes.status !== 'none'
          ? {
              changesButton: (
                <ChangesButton
                  changes={chat.changes}
                  active={view === 'changes'}
                  onToggle={() => onView(view === 'changes' ? 'chat' : 'changes')}
                />
              ),
            }
          : {})}
      >
        <StatusLine todo={todo} machineName={chat.machineName} now={now} pr={prRows[0]} />
      </Head>
      <ThreadPrPanel
        status={prs.status}
        rows={prRows}
        now={now}
        onViewChanges={chat.changes.status !== 'none' ? () => onView('changes') : undefined}
        onRetry={() => void prs.refetch()}
      />
      <ThreadBody
        chat={chat}
        todo={todo}
        actions={actions}
        view={view}
        now={now}
        onOpenPlan={openPlan}
        onClose={onClose}
      />
      <DialogShell
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        size="l"
        title={t('方案')}
        subtitle={`#${todo.seqNum} ${todo.title}`}
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
  onClose,
  menu,
  changesButton,
  titleExtra,
  children,
}: {
  todoId: string;
  todo: TodoRecord | null;
  onClose: () => void;
  menu?: ReactNode;
  changesButton?: ReactNode;
  titleExtra?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header
      data-testid="side-chat"
      data-todo-id={todoId}
      data-phase={todo?.phase}
      className="flex flex-none flex-col gap-0.5 border-b border-border pt-2.5 pr-2.5 pb-2.5 pl-4"
    >
      <div className="flex min-w-0 items-center gap-1">
        {todo != null && <ToneGlyph tone={threadTone(todo)} className="size-3.5 flex-none" />}
        <div className="ml-0.5 flex min-w-0 flex-1 items-center gap-1">
          <h2 className="m-0 min-w-0 truncate text-ui font-semibold text-foreground">
            {todo != null ? (
              <>
                <span className="font-normal text-content-tertiary tabular-nums">
                  #{todo.seqNum}
                </span>{' '}
                {todo.title}
              </>
            ) : (
              t('任务')
            )}
          </h2>
          {titleExtra}
        </div>
        {changesButton}
        {menu}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('关闭')}
          onClick={onClose}
          className="text-content-tertiary hover:text-foreground max-[640px]:size-8"
        >
          <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
        </Button>
      </div>
      {children}
    </header>
  );
}
