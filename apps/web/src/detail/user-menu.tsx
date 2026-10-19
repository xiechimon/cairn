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
// 本文件）；App.tsx 路由表为单源对照。新功能/快捷键 隐去：local-first
// 无 whats-new 页、无快捷键面，死钮无对象即除（反馈 行 #149 同款裁决）。
const ROWS = [
  { label: '帐号', href: '/app/account' },
  { label: 'API 密钥', href: '/app/api-keys' },
  { label: 'MCP', href: '/app/resources/mcp-servers' },
];

// #945（detail.css 清零）：面板皮肤迁 token utilities。V2 弹层壳（#790
// P3）：12px 内边距 / 1px 墨线框 / --plate-shadow 盘投影（#854 三件套）；
// 圆角接 registry popover 依据 rounded-lg（#1054 消费点清点，ADR 0012 D1
// ——直角随 V2 骨架退役，plan-dropdown #1006 迁移同词汇；墨线/投影的
// registry 化归弹层重建票）。#163/#388/#610 锚定律的底边 48px 不动
// （floating 变体交给 Popover Positioner，本壳只留触发形态标记）。
// Arrow = before/after 双三角（描边 12×6 下指触发行左上，锚位 20px 避开
// 10px 圆角），伪元经 before:/after: 变体承载。
const PANEL =
  // CDS PR-5: border-0 + --shadow-popover hairline. Caret outline tracks the
  // ring token (light --border outer ring / dark --ring-inset-highlight inset)
  // and seats on the shadow edge (no 1px border offset).
  "user-menu absolute bottom-12 left-2 z-10 flex w-56 flex-col rounded-(--radius-popover) border-0 bg-(--popover) p-3 shadow-(--shadow-popover) before:absolute before:bottom-0 before:left-5 before:h-1.5 before:w-3 before:bg-(--border) before:[clip-path:polygon(0_0,50%_100%,100%_0)] before:content-[''] after:absolute after:bottom-px after:left-5.25 after:h-1.25 after:w-2.5 after:bg-(--popover) after:[clip-path:polygon(0_0,50%_100%,100%_0)] after:content-[''] dark:before:bg-(--ring-inset-highlight)";
const PANEL_FLOATING = 'relative bottom-auto left-auto z-auto';

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
      <div className="user-menu-head flex flex-none items-center gap-3 border-b border-(--border) py-3.5 [&_img]:size-7.5 [&_img]:rounded-full">
        <SeededAvatar
          className="size-7.5"
          name={user.displayName}
          src={user.avatarUrl}
          fallback="/avatar-user.png"
        />
        <div>
          <div className="text-ui leading-4 text-(--foreground)">{user.displayName}</div>
        </div>
      </div>
      <div className="flex flex-col gap-3 py-3">
        <div className="user-menu-row flex h-8 items-center text-meta text-(--text-secondary)">
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
        <div
          className="user-menu-row flex h-8 items-center text-meta text-(--text-secondary)"
          data-testid="density-row"
        >
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
        {ROWS.map(({ label, href }) => (
          <Link
            key={label}
            className="user-menu-row flex h-4 items-center text-meta text-(--text-secondary)"
            to={{ pathname: href, search }}
          >
            {t(label)}
          </Link>
        ))}
      </div>
    </div>
  );
}
