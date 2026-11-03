import { Ellipsis } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useApiMutations, useBuildChanges } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useOrchestrateStart } from '../chief/use-orchestrate-start.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { AcceptDialog } from '../detail/accept-dialog.js';
import { substantiveChangesOf } from '../detail/empty-commit.js';
import { mergeRejectCopy, useMergeGate } from '../detail/merge-gate.js';
import { StopConfirmDialog } from '../detail/stop-confirm-dialog.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { MoreMenu } from '../overlay/more-menu.js';
import type { ThreadChat } from './use-thread-chat.js';

export type ThreadActionKind = 'start' | 'approve' | 'finish' | 'retry' | 'unarchive';

export function threadActionOf(todo: TodoRecord, running: boolean): ThreadActionKind | null {
  if (todo.archivedAt != null) return 'unarchive';
  if (todo.awaitingReply === true || running) return null;
  switch (todo.phase) {
    case 'todo':
      return 'start';
    case 'confirm':
      return 'approve';
    case 'review':
      return 'finish';
    case 'failed':
      return 'retry';
    default:
      return null;
  }
}

const ACTION_COPY: Record<ThreadActionKind, { reason: string; primary: string }> = {
  start: { reason: '还没开始。', primary: '开始' },
  approve: { reason: '计划已就绪。要改计划，直接在下面回复。', primary: '批准计划' },
  finish: { reason: '已就绪，等你审阅。要改，直接在下面回复。', primary: '完成…' },
  retry: { reason: '失败了。可以重试，或在下面回复说明怎么改。', primary: '重试' },
  unarchive: { reason: '已归档。', primary: '取消归档' },
};

export interface ThreadActions {
  card: ReactNode;
  menu: ReactNode;
}

export function useThreadActions({
  todo,
  chat,
  onGone,
}: {
  todo: TodoRecord;
  chat: ThreadChat;
  onGone: () => void;
}): ThreadActions {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const orchestrateStart = useOrchestrateStart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'accept' | 'delete' | 'stop' | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const { buildId, running } = chat;
  const missingTools = useMergeGate(live ? chat.buildAgentId : null);
  const phase = todo.phase;
  const archived = todo.archivedAt != null;
  const changesQ = useBuildChanges(
    buildId,
    live && (phase === 'review' || phase === 'failed' || dialog === 'accept'),
  );

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
              toastSuccess(t('Task archived'), {
                label: t('Undo'),
                onClick: () => mutations.setTodoArchived.mutate({ id: todo.id, archived: false }),
              });
          },
          onError: (error) =>
            toastError(next ? t('Could not archive task.') : t('Could not unarchive task.'), error),
        },
      );
    });
  const openAccept = () => {
    setMenuOpen(false);
    setAcceptError(null);
    setDialog('accept');
  };
  const confirmAccept = (merge: boolean) => {
    if (buildId == null) {
      setAcceptError(t('任务数据未就绪，完成请求未送出。请刷新页面后重试。'));
      return;
    }
    if (!merge) {
      mutations.patchTodo.mutate(
        { id: todo.id, body: { phase: 'done' } },
        {
          onSuccess: () => {
            setDialog(null);
            toastSuccess(t('任务已完成，改动保留在会话分支。'));
          },
          onError: (error) =>
            setAcceptError(mergeRejectCopy(error, t, t('完成请求未送出，请重试。'))),
        },
      );
      return;
    }
    mutations.mergeBuild.mutate(buildId, {
      onSuccess: () => {
        setDialog(null);
        toastSuccess(t('已发起合并，合并完成后任务进入已完成。'));
      },
      onError: (error) => setAcceptError(mergeRejectCopy(error, t)),
    });
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
  const pending =
    orchestrateStart.pendingId === todo.id ||
    mutations.stepAction.isPending ||
    mutations.setTodoArchived.isPending;
  const runPrimary: Record<ThreadActionKind, () => void> = {
    start: orchestrate,
    approve,
    finish: openAccept,
    retry: orchestrate,
    unarchive: setArchived(false),
  };
  const canFinishFailed = !archived && phase === 'failed' && chat.buildLegDone;

  const card =
    kind === null ? null : (
      <div
        data-testid="side-chat-action"
        data-action={kind}
        className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-(--chat-max-w) flex-none flex-wrap items-center gap-x-3 gap-y-2 rounded-(--radius-card) bg-card px-3.5 py-2.5 shadow-(--e1)"
      >
        <p className="m-0 min-w-0 flex-1 basis-48 text-meta text-content-secondary">
          {t(ACTION_COPY[kind].reason)}
        </p>
        <div className="flex flex-none gap-2">
          {canFinishFailed && (
            <Button size="sm" variant="outline" onClick={openAccept} className="h-7 px-2.5">
              {t('完成…')}
            </Button>
          )}
          <Button size="sm" onClick={runPrimary[kind]} disabled={pending} className="h-7 px-2.5">
            {pending && <Spinner data-icon="inline-start" />}
            {t(ACTION_COPY[kind].primary)}
          </Button>
        </div>
      </div>
    );

  const canComplete =
    phase === 'review' || phase === 'confirm' || (phase === 'failed' && chat.buildLegDone);
  const menu = (
    <>
      <Button
        ref={moreRef}
        variant="ghost"
        size="icon-sm"
        aria-label={t('更多操作…')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
        className="text-content-tertiary hover:text-foreground max-[640px]:size-8"
      >
        <Ellipsis aria-hidden="true" />
      </Button>
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
      />
      <DeleteConfirm
        open={dialog === 'delete'}
        title={t('确定删除该任务？此操作不可撤销。')}
        summary={
          <>
            <span className="text-(--text-tertiary)">#{todo.seqNum}</span>
            {todo.title}
          </>
        }
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
      <AcceptDialog
        open={dialog === 'accept'}
        onClose={() => setDialog(null)}
        rejectReason={acceptError}
        missingTools={missingTools}
        substantiveChanges={live ? substantiveChangesOf(changesQ.data, changesQ.isSuccess) : null}
        mergeLocked={phase === 'failed'}
        infoOutput={chat.infoOutput}
        confirming={mutations.mergeBuild.isPending || mutations.patchTodo.isPending}
        {...(live ? { onConfirm: confirmAccept } : {})}
      />
    </>
  );

  return { card, menu };
}
