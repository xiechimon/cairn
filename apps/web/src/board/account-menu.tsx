import { Activity, Languages, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { ACTIVITY_PATH } from '../search/activity-href.js';
import { SETTINGS_HREF, settingsHref } from '../settings/settings-href.js';

export function AccountMenu() {
  const { t } = useI18n();
  const { user } = useLiveData();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  for (const key of ['project', 'chat', 'pane', 'thread', 'view']) params.delete(key);
  const plain = `?${params}`;
  const label = t('账号');
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  data-testid="account-menu-trigger"
                  className="size-9.5 rounded-full p-0 hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent"
                />
              }
            />
          }
        >
          <SeededAvatar
            className="size-8"
            name={user.displayName}
            src={user.avatarUrl}
            fallback="/avatar-user.png"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        aria-label={label}
        data-testid="account-menu"
        className="w-auto min-w-56"
      >
        <p
          data-testid="account-menu-name"
          className="m-0 truncate px-2.5 pt-2 pb-1 text-meta text-content-tertiary"
        >
          {user.displayName}
        </p>
        <DropdownMenuItem render={<Link to={{ pathname: SETTINGS_HREF, search: plain }} />}>
          <Settings />
          {t('设置')}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link to={{ pathname: settingsHref('account'), search: plain }} />}
        >
          <Languages />
          {t('语言')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to={{ pathname: ACTIVITY_PATH, search: plain }} />}>
          <Activity />
          {t('活动')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
