import { Archive, Ellipsis, FolderInput, FolderOutput, FolderPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

const NEW_GROUP_FORM = 'sidebar-new-group';

function NewGroupDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (group: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '') return;
    onCreate(trimmed);
    setName('');
  };
  return (
    <DialogShell
      title={t('新建分组')}
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
            form={NEW_GROUP_FORM}
            className={DIALOG_PRIMARY_BUTTON}
            disabled={trimmed === ''}
          >
            {t('移入')}
          </Button>
        </>
      }
    >
      <form id={NEW_GROUP_FORM} onSubmit={submit}>
        <Input
          autoFocus
          aria-label={t('分组名称')}
          placeholder={t('分组名称')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </DialogShell>
  );
}

export function SidebarProjectMenu({
  name,
  group,
  groups,
  onMove,
  onArchive,
}: {
  name: string;
  group: string | null;
  groups: readonly string[];
  onMove: (group: string | null) => void;
  onArchive: () => void;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const targets = groups.filter((candidate) => candidate !== group);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5.5 pointer-coarse:size-11"
              aria-label={t('{name} 的菜单', { name })}
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-36">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput />
              {t('移到分组')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto min-w-36">
              {targets.map((target) => (
                <DropdownMenuItem key={target} onClick={() => onMove(target)}>
                  {target}
                </DropdownMenuItem>
              ))}
              {targets.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => setCreating(true)}>
                <FolderPlus />
                {t('新建分组')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {group !== null && (
            <DropdownMenuItem onClick={() => onMove(null)}>
              <FolderOutput />
              {t('移出分组')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onArchive}>
            <Archive />
            {t('归档')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewGroupDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(created) => {
          setCreating(false);
          onMove(created);
        }}
      />
    </>
  );
}
