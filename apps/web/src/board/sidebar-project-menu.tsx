import { cn } from 'cn';
import {
  Archive,
  Check,
  Ellipsis,
  FolderInput,
  FolderMinus,
  FolderOutput,
  FolderPlus,
  Funnel,
  Pencil,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { SIDEBAR_ROW_ACTION } from '../components/shell/sidebar-project.js';
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteProjectConfirm } from '../overlay/delete-project-confirm.js';
import { isProjectFilter, PROJECT_FILTERS, type ProjectFilter } from './sidebar-projects.js';

const NAME_FORM = 'sidebar-name-form';

export const SIDEBAR_MENU_CLS = 'w-auto min-w-42 rounded-(--radius-tile) p-1.5';

export const SIDEBAR_MENU_ITEM_CLS =
  'h-6.75 gap-2.5 rounded-(--cds-radius-md) px-2.5 text-meta whitespace-nowrap focus:bg-(--sidebar-active) data-open:bg-(--sidebar-active) data-popup-open:bg-(--sidebar-active) [&_svg]:text-sidebar-ink [&_svg:not([class*=size-])]:size-5';

const DANGER_ITEM_CLS = 'text-destructive [&_svg]:text-destructive';

function NameDialog({
  open,
  title,
  label,
  confirmLabel,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  confirmLabel: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [pending, setPending] = useState(false);
  const fieldId = useId();
  const trimmed = name.trim();
  const close = () => {
    setName(initial);
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '' || trimmed === initial || pending) return;
    setPending(true);
    try {
      await onSubmit(trimmed);
      setName(initial);
    } catch {
      return;
    } finally {
      setPending(false);
    }
  };
  return (
    <DialogShell
      title={title}
      open={open}
      onClose={close}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={close}>
            {t('取消')}
          </Button>
          <Button
            type="submit"
            form={NAME_FORM}
            className={DIALOG_PRIMARY_BUTTON}
            disabled={trimmed === '' || trimmed === initial || pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={NAME_FORM} onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-ui text-foreground">
            {label}
          </label>
          <Input
            id={fieldId}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </form>
    </DialogShell>
  );
}

function RowMenuTrigger({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={<Button variant="ghost" className={SIDEBAR_ROW_ACTION} aria-label={label} />}
          >
            <Ellipsis />
          </DropdownMenuTrigger>
        }
      />
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function RowMenuContent({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuContent
      side="bottom"
      align="start"
      alignOffset={-1}
      sideOffset={5}
      className={SIDEBAR_MENU_CLS}
    >
      {children}
    </DropdownMenuContent>
  );
}

export interface ProjectMenuActions {
  onMove: (group: string | null) => void;
  onArchive: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSettings: () => void;
}

export function SidebarProjectMenu({
  name,
  group,
  groups,
  onMove,
  onArchive,
  onRename,
  onDelete,
  onSettings,
}: {
  name: string;
  group: string | null;
  groups: readonly string[];
} & ProjectMenuActions) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<'group' | 'delete' | null>(null);
  const close = () => setDialog(null);
  return (
    <>
      <DropdownMenu>
        <RowMenuTrigger label={t('{name} 的菜单', { name })} />
        <RowMenuContent>
          <DropdownMenuItem className={SIDEBAR_MENU_ITEM_CLS} onClick={onRename}>
            <Pencil />
            {t('重命名')}
          </DropdownMenuItem>
          <DropdownMenuItem className={SIDEBAR_MENU_ITEM_CLS} onClick={onSettings}>
            <Settings2 />
            {t('项目设置')}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={`${SIDEBAR_MENU_ITEM_CLS} [&>svg:last-child]:text-content-tertiary`}
            >
              <FolderInput />
              {t('移到分组')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent alignOffset={-7} sideOffset={2} className={SIDEBAR_MENU_CLS}>
              {groups.map((target) => (
                <DropdownMenuItem
                  key={target}
                  className={SIDEBAR_MENU_ITEM_CLS}
                  disabled={target === group}
                  onClick={() => onMove(target)}
                >
                  <span className="min-w-0 flex-1 truncate">{target}</span>
                  {target === group && <Check className="text-content-tertiary" />}
                </DropdownMenuItem>
              ))}
              {group !== null && (
                <DropdownMenuItem className={SIDEBAR_MENU_ITEM_CLS} onClick={() => onMove(null)}>
                  <FolderOutput />
                  {t('移出分组')}
                </DropdownMenuItem>
              )}
              {groups.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className={SIDEBAR_MENU_ITEM_CLS}
                onClick={() => setDialog('group')}
              >
                <FolderPlus />
                {t('新建分组')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem className={SIDEBAR_MENU_ITEM_CLS} onClick={onArchive}>
            <Archive />
            {t('归档')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className={`${SIDEBAR_MENU_ITEM_CLS} ${DANGER_ITEM_CLS}`}
            onClick={() => setDialog('delete')}
          >
            <Trash2 />
            {t('删除')}
          </DropdownMenuItem>
        </RowMenuContent>
      </DropdownMenu>
      <NameDialog
        open={dialog === 'group'}
        title={t('新建分组')}
        label={t('分组名称')}
        confirmLabel={t('移入')}
        initial=""
        onClose={close}
        onSubmit={(created) => {
          close();
          onMove(created);
        }}
      />
      <DeleteProjectConfirm
        projectName={name}
        open={dialog === 'delete'}
        onClose={close}
        onConfirm={() => {
          close();
          onDelete();
        }}
      />
    </>
  );
}

export function SidebarGroupMenu({
  name,
  onRename,
  onUngroup,
}: {
  name: string;
  onRename: () => void;
  onUngroup: () => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <RowMenuTrigger label={t('分组 {name} 的菜单', { name })} />
      <RowMenuContent>
        <DropdownMenuItem className={SIDEBAR_MENU_ITEM_CLS} onClick={onRename}>
          <Pencil />
          {t('重命名分组')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={SIDEBAR_MENU_ITEM_CLS} onClick={onUngroup}>
          <FolderMinus />
          {t('解散分组')}
        </DropdownMenuItem>
      </RowMenuContent>
    </DropdownMenu>
  );
}

export function SidebarArchivedProjectMenu({
  name,
  onUnarchive,
  onDelete,
}: {
  name: string;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <DropdownMenu>
        <RowMenuTrigger label={t('{name} 的菜单', { name })} />
        <RowMenuContent>
          <DropdownMenuItem className={SIDEBAR_MENU_ITEM_CLS} onClick={onUnarchive}>
            <RotateCcw />
            {t('取消归档')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className={`${SIDEBAR_MENU_ITEM_CLS} ${DANGER_ITEM_CLS}`}
            onClick={() => setDeleting(true)}
          >
            <Trash2 />
            {t('删除')}
          </DropdownMenuItem>
        </RowMenuContent>
      </DropdownMenu>
      <DeleteProjectConfirm
        projectName={name}
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          onDelete();
        }}
      />
    </>
  );
}

export const PROJECT_FILTER_LABELS: Record<ProjectFilter, string> = {
  active: '进行中',
  archived: '已归档',
  all: '全部',
};

export function ProjectFilterMenu({
  filter,
  onFilter,
  className,
}: {
  filter: ProjectFilter;
  onFilter: (next: ProjectFilter) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const label = t('筛选项目');
  const filtered = filter !== 'active';
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  data-testid="sidebar-project-filter"
                  data-filter={filter}
                  className={cn(SIDEBAR_ROW_ACTION, filtered && 'bg-(--sidebar-press)', className)}
                  aria-label={
                    filtered
                      ? t('筛选项目：{value}', { value: t(PROJECT_FILTER_LABELS[filter]) })
                      : label
                  }
                />
              }
            >
              <Funnel />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent side="top" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" align="end" sideOffset={5} className={SIDEBAR_MENU_CLS}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className={`${SIDEBAR_MENU_ITEM_CLS} [&>svg:last-child]:text-content-tertiary`}
          >
            <span className="flex-1">{t('状态')}</span>
            <span className="text-content-tertiary">{t(PROJECT_FILTER_LABELS[filter])}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent alignOffset={-7} sideOffset={2} className={SIDEBAR_MENU_CLS}>
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(next: unknown) => {
                if (isProjectFilter(next)) onFilter(next);
              }}
            >
              {PROJECT_FILTERS.map((option) => (
                <DropdownMenuRadioItem
                  key={option}
                  value={option}
                  closeOnClick
                  data-testid={`sidebar-project-filter-${option}`}
                  className={`${SIDEBAR_MENU_ITEM_CLS} pr-8`}
                >
                  {t(PROJECT_FILTER_LABELS[option])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
