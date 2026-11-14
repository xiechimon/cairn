import { canOrchestrate } from '@cairn/shared';
import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useApiMutations, useChiefThreads } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { inflightOrchestrationFor } from '../chief/orchestration-inflight.js';
import { REPLY_CHIP_CLS } from '../chief/quick-replies.js';
import { useOrchestrateStart } from '../chief/use-orchestrate-start.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { substantiveChangesOf } from '../detail/empty-commit.js';
import { StopConfirmDialog } from '../detail/stop-confirm-dialog.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { MoreMenu } from '../overlay/more-menu.js';
import { AcceptTaskDialog } from './accept-task-dialog.js';
import { toastArchived } from './archive-toast.js';
import { RouteOverrideDialog } from './route-override-dialog.js';
import { MoveToProjectSub } from './task-move-menu.js';
import { RenameDialog } from './task-row-menu.js';
import type { ThreadChat } from './use-thread-chat.js';

export type ThreadActionKind = 'start' | 'approve' | 'retry' | 'unarchive';

export function threadActionOf(todo: TodoRecord, running: boolean): ThreadActionKind | null {
  if (todo.archivedAt != null) return 'unarchive';
  if (todo.phase === 'needs_input' || running) return null;
  switch (todo.phase) {
    case 'todo':
      return 'start';
    case 'confirm':
      return 'approve';
    case 'failed':
      return 'retry';
    default:
      return null;
  }
}

const ACTION_COPY: Record<ThreadActionKind, { reason: string; primary: string }> = {
  start: { reason: '还没开始。', primary: '开始' },
  approve: { reason: '计划已就绪。要改计划，直接在下面回复。', primary: '批准计划' },
  retry: { reason: '失败了。可以重试，或在下面回复说明怎么改。', primary: '重试' },
  unarchive: { reason: '这个任务已归档。取消归档后才能发消息。', primary: '取消归档' },
};

export interface EngineMenu {
  onViewRaw: () => void;
  takeOver?: { label: string; onClick: () => void };
}

export interface ThreadActions {
  card: ReactNode;
  menu: ReactNode;
}

export function useThreadActions({
  todo,
  chat,
  onGone,
  onViewPlan,
  engine,
}: {
  todo: TodoRecord;
  chat: ThreadChat;
  onGone: () => void;
  onViewPlan: (() => void) | undefined;
  engine?: EngineMenu | undefined;
}): ThreadActions {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const orchestrateStart = useOrchestrateStart();
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<
    'accept' | 'delete' | 'stop' | 'route-override' | 'rename' | null
  >(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const { buildId, running } = chat;
  const phase = todo.phase;
  const archived = todo.archivedAt != null;

  const guard = (run: () => void) => () => {
    setMenuOpen(false);
    if (live) run();
    else blockDemoWrite();
  };
  const orchestrate = guard(() => orchestrateStart.orchestrate(todo));
  const approve = guard(() => {
    if (buildId == null) return;
    mutations.stepAction.mutate(
      { buildId, body: { action: 'confirm' } },
      { onError: (error) => toastError(t('批准失败，请重试。'), error) },
    );
  });
  const setArchived = (next: boolean) =>
    guard(() => {
      setMenuOpen(false);
      mutations.setTodoArchived.mutate(
        { id: todo.id, archived: next },
        {
          onSuccess: () => {
            if (next)
              toastArchived(t, todo.title, (handlers) =>
                mutations.setTodoArchived.mutate({ id: todo.id, archived: false }, handlers),
              );
          },
          onError: (error) =>
            toastError(next ? t('Could not archive task.') : t('Could not unarchive task.'), error),
        },
      );
    });
  const openAccept = () => {
    setMenuOpen(false);
    setDialog('accept');
  };
  const closeTask = guard(() => {
    setMenuOpen(false);
    mutations.patchTodo.mutate(
      { id: todo.id, body: { phase: 'closed' } },
      {
        onSuccess: onGone,
        onError: (error) => toastError(t('关闭任务失败，请重试。'), error),
      },
    );
  });
  const deleteTask = guard(() => {
    setDialog(null);
    mutations.deleteTodo.mutate(todo.id, {
      onSuccess: onGone,
      onError: (error) => toastError(t('删除任务失败，请重试。'), error),
    });
  });
  const stop = (discard: boolean) =>
    guard(() => {
      setDialog(null);
      if (buildId == null) return;
      mutations.stopBuild.mutate(
        { buildId, discard },
        { onError: (error) => toastError(t('停止失败，请重试。'), error) },
      );
    })();

  const kind = threadActionOf(todo, running);
  const orchestrating =
    (kind === 'start' || kind === 'retry') &&
    live &&
    canOrchestrate(phase) &&
    inflightOrchestrationFor(chiefThreadsQ.data, todo) !== null;
  const pending =
    orchestrateStart.pendingId === todo.id ||
    mutations.stepAction.isPending ||
    mutations.setTodoArchived.isPending;
  const runPrimary: Record<ThreadActionKind, () => void> = {
    start: orchestrate,
    approve,
    retry: orchestrate,
    unarchive: setArchived(false),
  };

  const card =
    kind === null ? null : kind === 'unarchive' ? (
      <div
        data-testid="side-chat-action"
        data-action="unarchive"
        className="mx-4 mb-4 flex flex-none flex-col items-start gap-2 rounded-(--radius-tile) border border-border px-4 py-3"
      >
        <p className="m-0 text-ui text-foreground">{t(ACTION_COPY.unarchive.reason)}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={runPrimary.unarchive}
          disabled={pending}
          className="h-7.5 px-3 text-ui font-normal"
        >
          {pending && <Spinner data-icon="inline-start" />}
          {t(ACTION_COPY.unarchive.primary)}
        </Button>
      </div>
    ) : (
      <div
        data-testid="side-chat-action"
        data-action={kind}
        className="mx-auto mb-4 flex w-[calc(100%-2rem)] max-w-(--chat-max-w) flex-none flex-wrap gap-3"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                onClick={runPrimary[kind]}
                disabled={pending || orchestrating}
                data-orchestrating={orchestrating ? 'true' : undefined}
                aria-description={t(ACTION_COPY[kind].reason)}
                className={cn(REPLY_CHIP_CLS, 'w-auto')}
              />
            }
          >
            {(pending || orchestrating) && <Spinner data-icon="inline-start" />}
            {orchestrating ? t('编排中') : t(ACTION_COPY[kind].primary)}
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {t(ACTION_COPY[kind].reason)}
          </TooltipContent>
        </Tooltip>
        {kind === 'approve' && onViewPlan !== undefined && (
          <Button variant="ghost" onClick={onViewPlan} className={cn(REPLY_CHIP_CLS, 'w-auto')}>
            {t('查看计划')}
          </Button>
        )}
      </div>
    );

  const canComplete =
    phase === 'review' || phase === 'confirm' || (phase === 'failed' && chat.buildLegDone);
  const menu = (
    <>
      <IconTooltip
        label={t('更多操作…')}
        side="bottom"
        trigger={
          <Button
            ref={moreRef}
            variant="ghost"
            size="icon"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            className="size-9 flex-none text-foreground hover:text-foreground [&_svg]:size-5.5 max-[640px]:size-8"
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </IconTooltip>
      <MoreMenu
        open={menuOpen}
        anchor={moreRef}
        onClose={() => setMenuOpen(false)}
        onDelete={() => {
          setMenuOpen(false);
          setDialog('delete');
        }}
        onComplete={phase === 'confirm' ? approve : openAccept}
        canComplete={!archived && canComplete}
        onCloseTask={closeTask}
        canClose={!archived && (phase === 'todo' || phase === 'failed' || phase === 'queued')}
        {...(!archived ? { onArchive: setArchived(true) } : {})}
        {...(!archived && running && buildId != null
          ? {
              onDiscard: () => {
                setMenuOpen(false);
                setDialog('stop');
              },
            }
          : {})}
        onRouteOverride={() => {
          setMenuOpen(false);
          setDialog('route-override');
        }}
        onRename={() => {
          setMenuOpen(false);
          setDialog('rename');
        }}
        {...(onViewPlan !== undefined
          ? {
              onViewPlan: () => {
                setMenuOpen(false);
                onViewPlan();
              },
            }
          : {})}
        {...(engine !== undefined
          ? {
              onViewRaw: () => {
                setMenuOpen(false);
                engine.onViewRaw();
              },
              ...(engine.takeOver !== undefined
                ? {
                    takeOver: {
                      label: engine.takeOver.label,
                      onClick: () => {
                        setMenuOpen(false);
                        engine.takeOver?.onClick();
                      },
                    },
                  }
                : {}),
            }
          : {})}
        moveSub={<MoveToProjectSub todo={todo} />}
      />
      {dialog === 'rename' && <RenameDialog todo={todo} open onClose={() => setDialog(null)} />}
      <DeleteConfirm
        open={dialog === 'delete'}
        title={t('确定删除该任务？此操作不可撤销。')}
        summary={todo.title}
        ariaLabel={t('删除任务')}
        onClose={() => setDialog(null)}
        onConfirm={deleteTask}
      />
      <StopConfirmDialog
        open={dialog === 'stop'}
        queued={phase === 'queued'}
        onClose={() => setDialog(null)}
        onConfirm={stop}
      />
      <AcceptTaskDialog
        todo={todo}
        buildId={buildId}
        open={dialog === 'accept'}
        onClose={() => setDialog(null)}
        substantiveChanges={substantiveChangesOf(chat.changes.reported, chat.changes.settled)}
        mergeLocked={phase === 'failed'}
        infoOutput={chat.infoOutput}
      />
      <RouteOverrideDialog
        open={dialog === 'route-override'}
        onClose={() => setDialog(null)}
        todoId={todo.id}
        initial={todo.routeOverride}
      />
    </>
  );

  return { card, menu };
}
