import { cn } from 'cn';
import { Activity, ChevronDown, Settings } from 'lucide-react';
import { Link } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { useI18n } from '../i18n/provider.js';
import { ACTIVITY_PATH } from '../search/activity-href.js';
import { SETTINGS_HREF } from '../settings/settings-href.js';

export function SidebarUserMenu({ collapsed, search }: { collapsed: boolean; search: string }) {
  const { t } = useI18n();
  const { user } = useLiveData();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'default'}
            aria-label={t('用户菜单')}
            data-testid="sidebar-user-menu"
            className={cn('min-w-0', !collapsed && 'flex-1 justify-start gap-2')}
          />
        }
      >
        <SeededAvatar
          name={user.displayName}
          src={user.avatarUrl}
          fallback="/avatar-user.png"
          className="size-6"
        />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{user.displayName}</span>
            <ChevronDown data-icon="inline-end" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{user.displayName}</DropdownMenuLabel>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link to={{ pathname: SETTINGS_HREF, search }} />}
          >
            <Settings />
            {t('设置')}
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            data-testid="sidebar-activity"
            render={<Link to={{ pathname: ACTIVITY_PATH, search }} />}
          >
            <Activity />
            {t('活动')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
