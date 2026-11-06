import { Archive, ArchiveRestore, Ellipsis } from 'lucide-react';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';

export function SidebarProjectMenu({
  name,
  archived,
  onToggleArchive,
}: {
  name: string;
  archived: boolean;
  onToggleArchive: () => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5.5"
            aria-label={t('{name} 的菜单', { name })}
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-36">
        <DropdownMenuItem onClick={onToggleArchive}>
          {archived ? <ArchiveRestore /> : <Archive />}
          {archived ? t('取消归档') : t('归档')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
