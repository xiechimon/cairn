import { Ellipsis } from 'lucide-react';
import { useI18n } from '../../i18n/provider.js';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
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
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 flex-none"
            aria-label={t('PR #{n} 的菜单', { n: number })}
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-44">
        <DropdownMenuItem
          render={<a href={url} target="_blank" rel="noreferrer" />}
          nativeButton={false}
        >
          {t('在 GitHub 打开')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            toastSuccess(t('已复制链接'));
          }}
        >
          {t('复制链接')}
        </DropdownMenuItem>
        {(onViewChanges !== undefined || onResolve !== undefined) && <DropdownMenuSeparator />}
        {onViewChanges !== undefined && (
          <DropdownMenuItem onClick={onViewChanges}>{t('查看变更')}</DropdownMenuItem>
        )}
        {onResolve !== undefined && (
          <DropdownMenuItem onClick={onResolve}>{t('解决')}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
