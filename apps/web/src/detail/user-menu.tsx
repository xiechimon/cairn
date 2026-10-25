import { KeyRound, Plug, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { SegmentedRadio } from '../components/segmented.js';
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

const PANEL =
  'user-menu absolute bottom-12 left-2 z-10 flex w-56 flex-col rounded-(--radius-popover) bg-popover p-1 shadow-(--shadow-popover)';
const PANEL_FLOATING = 'relative bottom-auto left-auto z-auto';

const SEG_ROW_CLS = 'user-menu-row flex h-9 items-center pr-1.5 pl-2.5 text-ui text-foreground';

const NAV_ROW_CLS =
  'user-menu-row flex h-8 items-center gap-2.5 rounded-(--cds-radius-md) px-2.5 text-ui text-foreground no-underline outline-none hover:bg-menu-hover focus-visible:bg-menu-hover [&_svg]:size-3.75 [&_svg]:flex-none [&_svg]:text-content-tertiary';

const SEPARATOR_CLS = 'mx-1.5 my-1 h-px bg-border';

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
        {t('外观')}
        <SegmentedRadio
          className="user-menu-seg ml-auto"
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
        {t('密度')}
        <SegmentedRadio
          className="user-menu-seg ml-auto"
          label={t('密度')}
          value={density}
          onChange={selectDensity}
          options={[
            { value: 'comfortable', label: t('舒适'), testId: 'density-comfortable' },
            { value: 'compact', label: t('紧凑'), testId: 'density-compact' },
          ]}
        />
      </div>
      <div className={SEPARATOR_CLS} aria-hidden />
      {ROWS.map(({ label, href, Icon }) => (
        <Link key={label} className={NAV_ROW_CLS} to={{ pathname: href, search }}>
          <Icon aria-hidden />
          {t(label)}
        </Link>
      ))}
    </div>
  );
}
