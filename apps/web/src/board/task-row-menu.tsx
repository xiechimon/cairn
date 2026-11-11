import { Archive, ArrowUpRight, Check, Ellipsis, Pencil } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Trash2 } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { toastArchived } from './archive-toast.js';
import { MoveToProjectSub } from './task-move-menu.js';
import { canMarkDone } from './use-mark-done.js';

const RENAME_FORM = 'task-rename-form';

export function RenameDialog({
  todo,
  open,
  onClose,
}: {
  todo: TodoRecord;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [draft, setDraft] = useState(todo.title);
  const trimmed = draft.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '' || trimmed === todo.title) return;
    if (!live) {
      blockDemoWrite();
      onClose();
      return;
    }
    mutations.patchTodo.mutate(
      { id: todo.id, body: { title: trimmed } },
      {
        onSuccess: onClose,
        onError: (error) => toastError(t('重命名失败，请重试。'), error),
      },
    );
  };
  return (
    <DialogShell
      title={t('重命名任务')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            type="submit"
            form={RENAME_FORM}
            className={DIALOG_PRIMARY_BUTTON}
            disabled={trimmed === '' || trimmed === todo.title || mutations.patchTodo.isPending}
          >
            {t('保存')}
          </Button>
        </>
      }
    >
      <form id={RENAME_FORM} onSubmit={submit}>
        <Input
          autoFocus
          data-testid="task-rename-input"
          aria-label={t('任务名称')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
    </DialogShell>
  );
}

export function TaskRowMenu({
  todo,
  onOpen,
  onMarkDone,
}: {
  todo: TodoRecord;
  onOpen: () => void;
  onMarkDone: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const archive = () => {
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.setTodoArchived.mutate(
      { id: todo.id, archived: true },
      {
        onSuccess: () =>
          toastArchived(t, todo.title, (handlers) =>
            mutations.setTodoArchived.mutate({ id: todo.id, archived: false }, handlers),
          ),
        onError: (error) => toastError(t('Could not archive task.'), error),
      },
    );
  };
  const remove = () => {
    setDialog(null);
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.deleteTodo.mutate(todo.id, {
      onError: (error) => toastError(t('删除任务失败，请重试。'), error),
    });
  };
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-testid="task-row-menu-button"
                    className="size-6 text-content-tertiary pointer-coarse:size-11"
                    aria-label={t('{title} 的菜单', { title: todo.title })}
                  />
                }
              />
            }
          >
            <Ellipsis />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t('更多')}
          </TooltipContent>
        </Tooltip>
        <KeyedMenuContent
          align="end"
          sideOffset={4}
          aria-label={t('更多')}
          className="w-auto min-w-40"
        >
          <KeyedMenuItem shortcut="O" data-action="open" onClick={onOpen}>
            <ArrowUpRight />
            {t('打开任务')}
          </KeyedMenuItem>
          <MoveToProjectSub todo={todo} />
          {canMarkDone(todo) && (
            <KeyedMenuItem shortcut="C" data-action="done" onClick={onMarkDone}>
              <Check />
              {t('标记完成')}
            </KeyedMenuItem>
          )}
          <KeyedMenuItem shortcut="R" data-action="rename" onClick={() => setDialog('rename')}>
            <Pencil />
            {t('重命名')}
          </KeyedMenuItem>
          <DropdownMenuSeparator />
          {todo.archivedAt == null && (
            <KeyedMenuItem shortcut="A" data-action="archive" onClick={archive}>
              <Archive />
              {t('归档')}
            </KeyedMenuItem>
          )}
          <KeyedMenuItem
            shortcut="D"
            confirms
            variant="destructive"
            data-action="delete"
            onClick={() => setDialog('delete')}
          >
            <Trash2 />
            {t('删除')}
          </KeyedMenuItem>
        </KeyedMenuContent>
      </DropdownMenu>
      {dialog === 'rename' && <RenameDialog todo={todo} open onClose={() => setDialog(null)} />}
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
        onConfirm={remove}
      />
    </>
  );
}
