import {
  Archive,
  Check,
  CircleStop,
  ClipboardList,
  Copy,
  MessageSquare,
  Pencil,
  Route,
  ScrollText,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { DropdownMenu, DropdownMenuSeparator } from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';
import { writeClipboard } from '../lib/clipboard.js';

interface MoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  onDelete: () => void;
  onComplete: () => void;
  canComplete: boolean;
  onArchive?: () => void;
  onStop?: () => void;
  onReject?: () => void;
  onDiscard?: () => void;
  onRouteOverride?: () => void;
  onRename?: () => void;
  onViewPlan?: () => void;
  onViewRaw?: () => void;
  moveSub?: ReactNode;
}

const PANEL_CLS = 'more-menu w-[220px]';

export function MoreMenu({
  open,
  onOpenChange,
  trigger,
  onDelete,
  onComplete,
  canComplete,
  onArchive,
  onStop,
  onReject,
  onDiscard,
  onRouteOverride,
  onRename,
  onViewPlan,
  onViewRaw,
  moveSub,
}: MoreMenuProps) {
  const { t } = useI18n();
  const copyLink = () => {
    void writeClipboard(window.location.href);
    onOpenChange(false);
  };
  const rows = [
    {
      key: 'complete',
      shortcut: 'C',
      label: t('完成'),
      Icon: Check,
      disabled: !canComplete,
      onClick: onComplete,
    },
    ...(onRename !== undefined
      ? [
          {
            key: 'rename',
            shortcut: 'N',
            label: t('重命名'),
            Icon: Pencil,
            action: 'rename',
            disabled: false,
            onClick: onRename,
          },
        ]
      : []),
    ...(onViewPlan !== undefined
      ? [
          {
            key: 'view-plan',
            shortcut: 'P',
            label: t('计划'),
            Icon: ClipboardList,
            action: 'view-plan',
            disabled: false,
            onClick: onViewPlan,
          },
        ]
      : []),
    ...(onViewRaw !== undefined
      ? [
          {
            key: 'view-raw',
            shortcut: 'V',
            label: t('原始输出'),
            Icon: ScrollText,
            action: 'view-raw',
            disabled: false,
            onClick: onViewRaw,
          },
        ]
      : []),
    ...(onReject !== undefined
      ? [
          {
            key: 'reject',
            shortcut: 'R',
            label: t('请求修改'),
            Icon: MessageSquare,
            action: 'reject',
            disabled: false,
            onClick: onReject,
          },
        ]
      : []),
    ...(onStop !== undefined
      ? [
          {
            key: 'stop',
            shortcut: 'S',
            label: t('停止'),
            Icon: CircleStop,
            action: 'stop',
            disabled: false,
            onClick: onStop,
          },
        ]
      : []),
    ...(onRouteOverride !== undefined
      ? [
          {
            key: 'route-override',
            shortcut: 'O',
            label: t('路由覆盖'),
            Icon: Route,
            action: 'route-override',
            disabled: false,
            onClick: onRouteOverride,
          },
        ]
      : []),
    {
      key: 'copy',
      shortcut: 'L',
      label: t('复制链接'),
      Icon: Copy,
      disabled: false,
      onClick: copyLink,
    },
    ...(onArchive
      ? [
          {
            key: 'archive',
            shortcut: 'A',
            label: t('归档'),
            Icon: Archive,
            action: 'archive',
            disabled: false,
            onClick: onArchive,
          },
        ]
      : []),
    ...(onDiscard
      ? [
          {
            key: 'discard-changes',
            shortcut: 'G',
            confirms: true,
            label: t('丢弃修改'),
            Icon: Undo2,
            disabled: false,
            danger: true,
            onClick: onDiscard,
          },
        ]
      : []),
    {
      key: 'delete',
      shortcut: 'D',
      label: t('删除'),
      Icon: Trash2,
      action: 'delete',
      confirms: true,
      disabled: false,
      danger: true,
      onClick: onDelete,
    },
  ];
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {trigger}
      <KeyedMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        aria-label={t('更多')}
        className={PANEL_CLS}
      >
        {rows.map((row, index) => [
          row.danger === true && rows[index - 1]?.danger !== true && (
            <DropdownMenuSeparator key={`${row.key}-sep`} />
          ),
          <KeyedMenuItem
            key={row.key}
            shortcut={row.shortcut}
            confirms={'confirms' in row}
            variant={row.danger === true ? 'destructive' : 'default'}
            className="more-menu-item"
            {...('action' in row ? { 'data-action': row.action } : {})}
            data-testid={
              row.key === 'archive'
                ? 'archive-task'
                : row.key === 'discard-changes'
                  ? row.key
                  : undefined
            }
            disabled={row.disabled}
            onClick={row.onClick}
          >
            <row.Icon />
            {row.label}
          </KeyedMenuItem>,
          row.key === 'complete' && moveSub,
        ])}
      </KeyedMenuContent>
    </DropdownMenu>
  );
}
