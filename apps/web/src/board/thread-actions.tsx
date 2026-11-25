import { canOrchestrate } from '@cairn/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '../api/client.js';
import { useApiMutations, useChiefThreads, useSchedules } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { notifyTodoDeleted } from '../api/team-stream-cache.js';
import { inflightOrchestrationFor } from '../chief/orchestration-inflight.js';
import { REPLY_CHIP_CLS } from '../chief/quick-replies.js';
import { useOrchestrateStart } from '../chief/use-orchestrate-start.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { StopConfirmDialog } from '../detail/stop-confirm-dialog.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { MoreMenu } from '../overlay/more-menu.js';
import { toastArchived } from './archive-toast.js';
import { RouteOverrideDialog } from './route-override-dialog.js';
import { MoveToProjectSub } from './task-move-menu.js';
import { deleteTaskDetailKey, RenameDialog } from './task-row-menu.js';
import { reviewOwnedByCoordinator } from './thread-copy.js';
import { canMarkDone, useMarkDone } from './use-mark-done.js';
import type { ThreadChat } from './use-thread-chat.js';

export type ThreadActionKind = 'start' | 'approve' | 'review' | 'retry' | 'unarchive';

export function completeMenuIntent(phase: TodoRecord['phase']): 'complete' | 'stop-and-done' {
  return phase === 'review' ? 'complete' : 'stop-and-done';
}

export function threadActionOf(todo: TodoRecord, running: boolean): ThreadActionKind | null {
  if (todo.archivedAt != null) return 'unarchive';
  if (todo.quotaWait != null || todo.waitingOn?.on === 'quota') return 'retry';
  if (todo.phase === 'needs_input' || running) return null;
  switch (todo.phase) {
    case 'todo':
      return 'start';
    case 'confirm':
      return 'approve';
    case 'review':
      return reviewOwnedByCoordinator(todo) ? null : 'review';
    case 'failed':
      return 'retry';
    default:
      return null;
  }
}

const ACTION_COPY: Record<ThreadActionKind, { reason: string; primary: string }> = {
  start: { reason: '尚未开始。', primary: '开始' },
  approve: { reason: '计划已就绪。要改计划，直接在下面回复。', primary: '批准计划' },
  review: { reason: '接受结果并结束这个任务，需要修改时直接在下面回复。', primary: '标记完成' },
  retry: { reason: '立即重新运行这个任务，或在下面回复说明怎么改。', primary: '立即重试' },
  unarchive: { reason: '这个任务已归档。取消归档后才能发消息。', primary: '取消归档' },
};

export interface EngineMenu {
  onViewRaw: () => void;
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
  hasOpenPr = false,
  engine,
}: {
  todo: TodoRecord;
  chat: ThreadChat;
  onGone: () => void;
  onViewPlan: (() => void) | undefined;
  hasOpenPr?: boolean;
  engine?: EngineMenu | undefined;
}): ThreadActions {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const qc = useQueryClient();
  const mutations = useApiMutations(teamId);
  const mergeBuild = useMutation({
    mutationFn: (id: string) => api.post<{ delegated: true }>(`/api/builds/${id}/merge`, {}),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
  const { markDone, dialogs: markDoneDialogs } = useMarkDone(todo);
  const orchestrateStart = useOrchestrateStart();
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'stop' | 'route-override' | 'rename' | null>(
    null,
  );
  const schedulesQ = useSchedules(live && dialog === 'delete');
  const hasSchedules = (schedulesQ.data ?? []).some((s) => s.todoId === todo.id);
  const deleteDetailKey = deleteTaskDetailKey(todo, hasSchedules);
  const { buildId, running } = chat;
  const phase = todo.phase;
  const archived = todo.archivedAt != null;

  const guard = (run: () => void) => () => {
    setMenuOpen(false);
    if (live) run();
    else blockDemoWrite();
  };
  const orchestrate = guard(() => orchestrateStart.orchestrate(todo));
  const retryNow = guard(() => {
    if (buildId == null) {
      orchestrateStart.orchestrate(todo);
      return;
    }
    mutations.retryBuildNow.mutate(
      { buildId },
      { onError: (error) => toastError(t('立即重试失败，请重试。'), error) },
    );
  });
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
            toastError(next ? t('无法归档任务。') : t('无法取消归档任务。'), error),
        },
      );
    });
  const complete = guard(() => {
    mutations.patchTodo.mutate(
      { id: todo.id, body: { phase: 'done' } },
      { onError: (error) => toastError(t('完成请求未送出，请重试。'), error) },
    );
  });
  const merge = guard(() => {
    if (buildId == null) return;
    mergeBuild.mutate(buildId, {
      onSuccess: () => toastSuccess(t('已发起合并。')),
      onError: (error) => toastError(t('合并请求未送出，请重试。'), error),
    });
  });
  const deleteTask = guard(() => {
    setDialog(null);
    mutations.deleteTodo.mutate(todo.id, {
      onSuccess: () => {
        notifyTodoDeleted(todo.id);
        onGone();
      },
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
    kind === 'start' &&
    live &&
    canOrchestrate(phase) &&
    inflightOrchestrationFor(chiefThreadsQ.data, todo) !== null;
  const pending =
    orchestrateStart.pendingId === todo.id ||
    mutations.stepAction.isPending ||
    mutations.retryBuildNow.isPending ||
    mutations.patchTodo.isPending ||
    mutations.setTodoArchived.isPending;
  const runPrimary: Record<ThreadActionKind, () => void> = {
    start: orchestrate,
    approve,
    review: complete,
    retry: retryNow,
    unarchive: setArchived(false),
  };
  const canMerge =
    kind === 'review' && buildId != null && !chat.infoOutput && (todo.hasChanges || hasOpenPr);

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
          className="h-7.5 border-border px-3 text-ui font-medium text-foreground"
        >
          {pending && <RingSpinner data-icon="inline-start" />}
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
            {(pending || orchestrating) && <RingSpinner data-icon="inline-start" />}
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
        {canMerge && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  onClick={merge}
                  disabled={pending || mergeBuild.isPending}
                  aria-description={t('将改动合并到目标分支并完成任务。')}
                  className={cn(REPLY_CHIP_CLS, 'w-auto')}
                />
              }
            >
              {mergeBuild.isPending && <RingSpinner data-icon="inline-start" />}
              {t('合并')}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {t('将改动合并到目标分支并完成任务。')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );

  const canComplete = canMarkDone(todo);
  const menu = (
    <>
      <MoreMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        trigger={
          <IconTooltip
            label={t('更多操作…')}
            side="bottom"
            trigger={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 flex-none text-foreground hover:text-foreground [&_svg]:size-5.5 max-[640px]:size-8 pointer-coarse:size-11"
                  />
                }
              />
            }
          >
            <Ellipsis aria-hidden="true" />
          </IconTooltip>
        }
        onDelete={() => {
          setMenuOpen(false);
          setDialog('delete');
        }}
        onComplete={() => {
          setMenuOpen(false);
          if (completeMenuIntent(phase) === 'complete') complete();
          else markDone();
        }}
        canComplete={canComplete}
        {...(!archived ? { onArchive: setArchived(true) } : {})}
        {...(!archived && running && buildId != null
          ? {
              onDiscard: () => {
                setMenuOpen(false);
                setDialog('stop');
              },
            }
          : {})}
        {...(!archived && phase !== 'closed'
          ? {
              onRouteOverride: () => {
                setMenuOpen(false);
                setDialog('route-override');
              },
            }
          : {})}
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
            }
          : {})}
        moveSub={<MoveToProjectSub todo={todo} />}
      />
      {dialog === 'rename' && <RenameDialog todo={todo} open onClose={() => setDialog(null)} />}
      <DeleteConfirm
        open={dialog === 'delete'}
        title={t('确定删除该任务？此操作不可撤销。')}
        summary={todo.title}
        {...(deleteDetailKey !== null ? { detail: t(deleteDetailKey) } : {})}
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
      <RouteOverrideDialog
        open={dialog === 'route-override'}
        onClose={() => setDialog(null)}
        todoId={todo.id}
        initial={todo.routeOverride}
        platformLocked={todo.phase !== 'todo' && todo.phase !== 'queued'}
      />
      {markDoneDialogs}
    </>
  );

  return { card, menu };
}
