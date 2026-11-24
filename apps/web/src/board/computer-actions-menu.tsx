import { Ellipsis } from 'lucide-react';
import { useNavigate } from 'react-router';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';

export function MachineMenu({
  machineName,
  settingsHref,
  onRename,
  onWatch,
}: {
  machineName: string;
  settingsHref: string | null;
  onRename: (() => void) | null;
  onWatch: (() => void) | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <IconTooltip
        label={t('{name} 的操作', { name: machineName })}
        trigger={
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="machine-menu"
                className="flex-none pointer-coarse:size-11"
              />
            }
          />
        }
      >
        <Ellipsis aria-hidden strokeWidth={1.75} />
      </IconTooltip>
      <KeyedMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-40">
        {onWatch !== null && (
          <KeyedMenuItem shortcut="V" data-testid="machine-watch" onClick={onWatch}>
            {t('查看屏幕')}
          </KeyedMenuItem>
        )}
        {onRename !== null && (
          <KeyedMenuItem shortcut="N" data-testid="machine-rename" onClick={onRename}>
            {t('重命名')}
          </KeyedMenuItem>
        )}
        {settingsHref !== null && (
          <KeyedMenuItem
            shortcut="E"
            data-testid="machine-settings"
            onClick={() => void navigate(settingsHref)}
          >
            {t('执行机设置')}
          </KeyedMenuItem>
        )}
      </KeyedMenuContent>
    </DropdownMenu>
  );
}
