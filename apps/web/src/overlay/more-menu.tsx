import { CircleStop } from 'lucide-react';
import type { ComponentProps } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';
import { Ban, Check, Copy, MessageSquare, Trash2 } from '../icons/index.js';

interface MoreMenuProps {
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  onComplete: () => void;
  canComplete: boolean;
  onCloseTask: () => void;
  canClose: boolean;
  onStop?: () => void;
  onReject?: () => void;
  anchor?: ComponentProps<typeof DropdownMenuContent>['anchor'];
}

const PANEL_CLS = 'more-menu w-[220px]';

export function MoreMenu({
  open,
  onClose,
  onDelete,
  onComplete,
  canComplete,
  onCloseTask,
  canClose,
  onStop,
  onReject,
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
      label: t('完成'),
      Icon: Check,
      disabled: !canComplete,
      onClick: onComplete,
    },
    ...(onReject !== undefined
      ? [
          {
            key: 'reject',
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
      label: t('复制链接'),
      Icon: Copy,
      disabled: false,
      onClick: copyLink,
    },
    {
      key: 'close',
      label: t('关闭'),
      Icon: Ban,
      disabled: !canClose,
      onClick: onCloseTask,
    },
    {
      key: 'delete',
      label: t('删除'),
      Icon: Trash2,
      action: 'delete',
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
      <DropdownMenuContent
        anchor={anchor}
        align="end"
        side="bottom"
        sideOffset={4}
        aria-label={t('更多')}
        className={PANEL_CLS}
      >
        {rows.map((row) => [
          row.danger === true && <DropdownMenuSeparator key={`${row.key}-sep`} />,
          <DropdownMenuItem
            key={row.key}
            variant={row.danger === true ? 'destructive' : 'default'}
            className="more-menu-item"
            {...('action' in row ? { 'data-action': row.action } : {})}
            disabled={row.disabled}
            onClick={row.onClick}
          >
            <row.Icon />
            {row.label}
          </DropdownMenuItem>,
        ])}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
