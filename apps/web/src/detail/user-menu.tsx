// User-menu popover as the r7 17 / 16d captures include it (224-wide @ x8,
// r7 §3.5): identity head, 外观 row with the theme segmented control, then
// the item list — since #163 three real-navigation rows (帐号 / API 密钥 /
// MCP) instead of the frozen plain-text list (r7 §4.1.4). The 外观 row is
// live (#122): each segment drives applyTheme, so the switch repaints
// via the root .light class and persists under `pacman-theme`. The
// open/close trigger landed with #127 — the sidebar avatar chips (rail +
// expanded) toggle the popover through the anchored-overlay family
// wiring; the capture state still rides the fixture flag. #163: the panel
// is bottom-anchored above the avatar chip (detail.css `.user-menu`) —
// the frozen capture top covered the chip off the 732-tall viewport.
// XMON-107 (用户裁决): the capture's head mail line is removed — pacman
// 无邮箱账位面（单用户 seed 自动登录），live 态曾渲染 fixture 常量地址。

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
  /** CDS PR-9: comfortable | compact. Defaults to stored preference. */
  density?: Density;
  /** #127 sidebar-trigger render: the fixed variant escapes the 40px
   *  rail's overflow:hidden and stacks above the family click-catcher
   *  (detail.css `.user-menu--floating`); same anchoring law as the
   *  capture-frozen absolute variant (#163). */
  floating?: boolean;
  /** #656: 进出场工具类落位面（动画必须挂在定位面板本体上——挂在祖先
   *  会经 keyframe transform 拽走 fixed 子级的 containing block）。 */
  className?: string;
}

// 菜单行接真导航（#163）：有真实路由的行渲染为 SPA Link，载当前 search
// 过跳（#121 Link 全族纪律）。href 用字面量——路由常量散在各页面模块，
// import 会经 shell 家族成环（resources/shell → app-sidebar → sidebar →
// 本文件）；App.tsx 路由表为单源对照。
const ROWS = [
  { label: '帐号', href: '/app/account', Icon: User },
  { label: 'API 密钥', href: '/app/api-keys', Icon: KeyRound },
  { label: 'MCP', href: '/app/resources/mcp-servers', Icon: Plug },
];

// Paper menu（DESIGN.md 弹窗与菜单）：白底、10px 角、4px 内衬、1px 环 + 软
// 投影（--shadow-popover），与 DropdownMenu 同一张面。#163/#388/#610 锚定律
// 的底边 48px 不动（floating 变体交给 Popover Positioner，本壳只留触发形态
// 标记）。
const PANEL =
  'user-menu absolute bottom-12 left-2 z-10 flex w-56 flex-col rounded-(--radius-popover) bg-popover p-1 shadow-(--shadow-popover)';
const PANEL_FLOATING = 'relative bottom-auto left-auto z-auto';

/** 分段行（外观 / 密度）：36px，左标签右分段。 */
const SEG_ROW_CLS = 'user-menu-row flex h-9 items-center pr-1.5 pl-2.5 text-ui text-foreground';

/** 导航行 = DropdownMenuItem 同形：32px、6px 角、15px ink-3 图标、menu-hover。 */
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
  // Links carry the live query string across hops so the fixture scenario
  // survives client-side navigation (sidebar / todo-card convention).
  const { search } = useLocation();
  // the popover mounts per open state; the stored theme at mount is the
  // segment's initial value and applyTheme keeps storage the source of
  // truth across reloads
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
  // Keep segment face in sync with account page (Bugbot #1366 desync).
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
