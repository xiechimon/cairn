import { Archive, CircleStop, Undo2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { DropdownMenu, DropdownMenuSeparator } from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';
import { Ban, Check, Copy, MessageSquare, Trash2 } from '../icons/index.js';

interface MoreMenuProps {
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  onComplete: () => void;
  canComplete: boolean;
  onArchive?: () => void;
  onCloseTask: () => void;
  canClose: boolean;
  onStop?: () => void;
  onReject?: () => void;
  onDiscard?: () => void;
  anchor?: ComponentProps<typeof KeyedMenuContent>['anchor'];
}

const PANEL_CLS = 'more-menu w-[220px]';

export function MoreMenu({
  open,
  onClose,
  onDelete,
  onComplete,
  canComplete,
  onArchive,
  onCloseTask,
  canClose,
  onStop,
  onReject,
  onDiscard,
  anchor,
}: MoreMenuProps) {
  const { t } = useI18n();
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    onClose();
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
            label: t('Archive'),
            Icon: Archive,
            action: 'archive',
            disabled: false,
            onClick: onArchive,
          },
        ]
      : []),
    {
      key: 'close',
      shortcut: 'X',
      label: t('关闭'),
      Icon: Ban,
      disabled: !canClose,
      onClick: onCloseTask,
    },
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
    <DropdownMenu
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <KeyedMenuContent
        anchor={anchor}
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
        ])}
      </KeyedMenuContent>
    </DropdownMenu>
  );
}
