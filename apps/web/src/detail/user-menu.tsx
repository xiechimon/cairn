import { cn } from 'cn';
import { KeyRound, Plug, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { SegmentedRadio } from '../components/segmented.js';
import { MENU_ITEM_CLS, MENU_SEPARATOR_CLS, MENU_SURFACE_CLS } from '../components/ui/menu.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import {
  applyDensity,
  DENSITY_EVENT,
  type Density,
  readDomDensity,
  readStoredDensity,
} from '../density.js';
import { useI18n } from '../i18n/provider.js';
import { safeLocalStorage } from '../safe-storage.js';
import { applyTheme, type Theme } from '../theme.js';

interface UserMenuProps {
  theme: Theme;
  density?: Density;
  floating?: boolean;
  className?: string;
}

const ROWS = [
  { label: '帐号', href: '/app/account', Icon: User },
  { label: 'API 密钥', href: '/app/api-keys', Icon: KeyRound },
  { label: 'MCP', href: '/app/resources/mcp-servers', Icon: Plug },
];

const PANEL = `user-menu absolute bottom-12 left-2 z-10 flex w-60 flex-col ${MENU_SURFACE_CLS}`;
const PANEL_FLOATING = 'relative bottom-auto left-auto z-auto';

const SEG_ROW_CLS = 'user-menu-row flex flex-col gap-1.5 px-1 pt-1.5 pb-1';

const SEG_LABEL_CLS = 'px-1.5 text-caption font-medium text-content-tertiary';

const SEG_TRACK_CLS = 'user-menu-seg w-full';

const SEG_OPTION_CLS = 'min-w-0 flex-1 px-2';

const NAV_ROW_CLS = cn(
  MENU_ITEM_CLS,
  'user-menu-row cursor-pointer no-underline hover:bg-menu-hover focus-visible:bg-menu-hover',
);

export function UserMenu({
  theme: initialTheme,
  density: initialDensity,
  floating = false,
  className,
}: UserMenuProps) {
  const { t } = useI18n();
  const { user } = useLiveData();
  const { search } = useLocation();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const select = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };
  const [density, setDensity] = useState<Density>(
    () => initialDensity ?? readStoredDensity(safeLocalStorage()),
  );
  const selectDensity = (next: Density) => {
    applyDensity(next);
    setDensity(next);
  };
  useEffect(() => {
    const onDensity = (e: Event) => {
      const detail = (e as CustomEvent<Density>).detail;
      if (detail === 'comfortable' || detail === 'compact') setDensity(detail);
    };
    window.addEventListener(DENSITY_EVENT, onDensity);
    setDensity(readDomDensity());
    return () => window.removeEventListener(DENSITY_EVENT, onDensity);
  }, []);
  return (
    <div
      className={`${PANEL}${floating ? ` ${PANEL_FLOATING}` : ''}${
        className != null && className !== '' ? ` ${className}` : ''
      }`}
    >
      <div className="user-menu-head flex items-center gap-2 px-2.5 pt-2 pb-1 [&_img]:size-5 [&_img]:rounded-full">
        <SeededAvatar
          className="size-5"
          name={user.displayName}
          src={user.avatarUrl}
          fallback="/avatar-user.png"
        />
        <span className="min-w-0 truncate text-caption font-medium text-content-tertiary">
          {user.displayName}
        </span>
      </div>
      <div className={SEG_ROW_CLS}>
        <span className={SEG_LABEL_CLS}>{t('外观')}</span>
        <SegmentedRadio
          className={SEG_TRACK_CLS}
          optionHandle={SEG_OPTION_CLS}
          label={t('外观')}
          value={theme}
          onChange={select}
          options={[
            { value: 'light', label: t('浅色') },
            { value: 'dark', label: t('深色') },
          ]}
        />
      </div>
      <div className={SEG_ROW_CLS} data-testid="density-row">
        <span className={SEG_LABEL_CLS}>{t('密度')}</span>
        <SegmentedRadio
          className={SEG_TRACK_CLS}
          optionHandle={SEG_OPTION_CLS}
          label={t('密度')}
          value={density}
          onChange={selectDensity}
          options={[
            { value: 'comfortable', label: t('舒适'), testId: 'density-comfortable' },
            { value: 'compact', label: t('紧凑'), testId: 'density-compact' },
          ]}
        />
      </div>
      <div className={MENU_SEPARATOR_CLS} aria-hidden />
      {ROWS.map(({ label, href, Icon }) => (
        <Link key={label} className={NAV_ROW_CLS} to={{ pathname: href, search }}>
          <Icon aria-hidden />
          {t(label)}
        </Link>
      ))}
    </div>
  );
}
