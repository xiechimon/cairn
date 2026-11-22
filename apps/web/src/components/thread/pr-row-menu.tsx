import { Ellipsis } from 'lucide-react';
import { useI18n } from '../../i18n/provider.js';
import { IconTooltip } from '../icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../menu-keys.js';
import { Button } from '../ui/button.js';
import { DropdownMenu, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { toastSuccess } from '../ui/toaster.js';

export interface PrRowMenuProps {
  number: number;
  url: string;
  onViewChanges?: (() => void) | undefined;
  onResolve?: (() => void) | undefined;
}

export function PrRowMenu({ number, url, onViewChanges, onResolve }: PrRowMenuProps) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <IconTooltip
        label={t('PR #{n} 的菜单', { n: number })}
        trigger={
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" className="size-6 flex-none" />}
          />
        }
      >
        <Ellipsis />
      </IconTooltip>
      <KeyedMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-44">
        <KeyedMenuItem
          shortcut="O"
          render={<a href={url} target="_blank" rel="noreferrer" />}
          nativeButton={false}
        >
          {t('在 GitHub 打开')}
        </KeyedMenuItem>
        <KeyedMenuItem
          shortcut="L"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            toastSuccess(t('已复制链接'));
          }}
        >
          {t('复制链接')}
        </KeyedMenuItem>
        {(onViewChanges !== undefined || onResolve !== undefined) && <DropdownMenuSeparator />}
        {onViewChanges !== undefined && (
          <KeyedMenuItem shortcut="S" onClick={onViewChanges}>
            {t('查看变更')}
          </KeyedMenuItem>
        )}
        {onResolve !== undefined && (
          <KeyedMenuItem shortcut="R" onClick={onResolve}>
            {t('解决')}
          </KeyedMenuItem>
        )}
      </KeyedMenuContent>
    </DropdownMenu>
  );
}
