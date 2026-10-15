// Account route (issue #70, r7 13): avatar head, the setting rows
// (名称 + edit glyph, 语言 select, 推送通知 switch). Copy and row
// order verbatim from the 13 capture.
// #148 (台账 #136 account 行, local-first 裁决同 #129 先例): 删除 / 退出登录
// are SaaS surface a single-user self-host has no semantics for — removed.
// XMON-107 (用户裁决, 同 #148 先例): 邮箱 row removed — pacman 无邮箱账位面
// (单用户 seed 自动登录，无注册/邮件功能)，live 态占位破折号与 fixture 常量
// 均无信息量。
// #306 wontfix 出账（收编 #148 的占位裁定）: 头像更换钮 — the avatar is the
// static /avatar-user.png asset, no upload face exists or will（无
// PATCH /user/me 头像写路径），M7「已渲染的交互必须生效」底线不收死钮，
// 移除不渲染；r7 13 的更换 ink 是 SaaS 头像素残面，avatar 头保留。
// The 推送通知 switch (#1031) = user preference (persisted locally) layered
// over Notification.permission, not a bare mirror of it: clicking either way
// lands a preference (pacman.notifyEnabled, consumed by sse.ts's desktop-notif
// gate), and a non-granted "on" click also drives the #114 banner's
// requestPermission() path (shared useNotificationPermission). So granted+off
// is a real, persisting action (desktop notifs go quiet), and denied+on shows
// an inline 拦截 hint instead of silently doing nothing. Fixture mode freezes
// permission per scenario (ui.notificationPermission — granted/denied/default
// all expressible); absent that flag it defaults granted so the r7 13 baseline
// row keeps its on-state knob (headless chromium reports the real API 'denied').
// The 名称 row (#1031) is inline-editable via the shared ProfileNameRow (agent
// detail 同款); it used to be inert text + a decorative pencil (假可供性).
// #947 per-face 清零：secondary.css 退役；推送通知开关落 components/ui/Switch
// 正典默认档（spec/22 §2.5 冻结几何：32×18.4 / thumb 16，track 吃 --input /
// --primary，thumb 吃 --background）。
// #1005 registry 对齐（#983 floating-shell 族拆判决，锚定 absolute 族 →
// Popover）：语言 dropdown 从 FloatingShell+ClickCatcher 卡内锚定迁
// registry Popover（Portal + Positioner，触发钮 outline 默认档、盘皮肤走件
// 默认、选项行 ghost 默认档）；外点关闭随 Base UI 原生 outside-press 语义
// （2026-10-08 全局裁决：不恢复 ClickCatcher、不开 modal 档）。
// `account-card` / `account-avatar` 别名保留 = profile-card 共享模板家族的
// e2e 锚（profile-card.tsx 头注契约；#952 起模板几何住件上 PROFILE_* utility
// 常量，profile-card.css 已退役）；其余类名别名按 #910 裁定 1 退役，载体 =
// role/text。
//
// #74: the 语言 row is live — it reads/writes the workspace locale
// (zh-CN authoritative + en, 01 S6) through the i18n provider and persists
// to the r2 §1.5 dual keys. The dropdown open state is [设计]: the official
// option set was never observed (r2 §11 Q19), so the shape follows the
// plan-dropdown family and lists the two locales as endonyms.

import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useSession } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useNotificationPermission } from '../board/notify-banner.js';
import { type NotifyPref, persistNotifyPref, readNotifyPref } from '../board/notify-pref.js';
import {
  PROFILE_ROW_TALL_CLS,
  ProfileAvatar,
  ProfileCard,
  ProfileHead,
  ProfileNameRow,
  ProfileRow,
} from '../components/profile-card.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Switch } from '../components/ui/switch.js';
import { toastError } from '../components/ui/toaster.js';
import { applyDensity, type Density, readStoredDensity } from '../density.js';
import { USER_NAME } from '../fixtures/fixtures.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { LOCALE_NAMES, LOCALES } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import { Check, ChevronDown } from '../icons/index.js';
import { safeLocalStorage } from '../safe-storage.js';
import { SecondaryShell } from '../secondary/shell.js';

/* —— #1031 名称行内编辑面配方（account 面几何，与 agent 详情同构）——
   ProfileNameRow 是共享模板件，本面只注入自己的几何/皮肤 utility。值钮 =
   ghost 件默认形态 + 左对齐布局位（agent 面 #980 同款裁决：手写值墨档与
   hover 换墨配方退役，hover 涂底 = registry 可供性；hover 品牌墨另按
   #1055/#987 退役——品牌墨只做 spot 强调，不当文字色）；铅笔钮 tertiary 墨
   hover 回 foreground；编辑器 32 高带框盒、14px 值墨。
   account 面 e2e 载体走 role/text（#910 裁定 1，类名别名退役），故这里不再挂
   `.account-name*` 锚类，几何 utility 是唯一职责。 */

/** 名称值钮：ghost 件默认形态 + 左对齐布局位。 */
const ACCOUNT_NAME_CLS = 'h-auto justify-start p-0 text-left font-normal';

/** 编辑铅笔钮（tertiary 墨，hover 回 foreground；icon-only 只留 padding 盒）。 */
const ACCOUNT_ICON_EDIT_CLS =
  'p-0 text-(--text-tertiary) hover:bg-transparent hover:text-(--foreground) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--foreground) active:not-aria-[haspopup]:translate-y-0';

/** 名称编辑器（32 高带框盒，14px 值墨同显示态；focus 环走件底座 #855 律）。 */
const ACCOUNT_NAME_INPUT_CLS =
  'border-(--border) bg-(--card) text-[14px] text-(--foreground) md:text-[14px] dark:bg-(--card)';

export function AccountPage() {
  const { locale, setLocale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const [langOpen, setLangOpen] = useState(fixture.ui?.langDropdownOpen === true);
  // M5 live：名称 = GET /api/user/me（seed 单用户 displayName，02 §2.1）。
  // 邮箱行已删（XMON-107 用户裁决）：无邮箱账位面，占位无信息量。
  const { live, teamId } = useLiveData();
  const sessionQ = useSession(live);
  const mutations = useApiMutations(teamId);
  // #1031 改名：live 落 PATCH /api/user/me（既有资料更新通道，成功后 session
  // 读面失效重取回显）；fixture 面本地态覆写（scenario 无后端，改名只回显）。
  const [fixtureName, setFixtureName] = useState<string | null>(null);
  const userName = live ? (sessionQ.data?.displayName ?? USER_NAME) : (fixtureName ?? USER_NAME);
  const commitName = (next: string) => {
    if (!live) {
      setFixtureName(next);
      return;
    }
    mutations.patchUser.mutate(
      { displayName: next },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };
  // #1031 推送通知开关 = 用户偏好档（本地持久化）× 浏览器权限，两层分离：
  //  · 偏好档（pacman.notifyEnabled）：显示态主源。null（未表态）时跟随权限
  //    ——granted 显示开、其余显示关；一旦点过就以偏好为准，不再被权限推导。
  //  · 权限（Notification.permission）：只决定「真弹与否」（sse.ts 闸门）与
  //    非 granted 态点开时驱动一次 requestPermission（#114 banner 同一路径）。
  // 这样 granted 态点「关」落地为偏好 off（sse 停弹），denied 态点「开」落地
  // 为偏好 on + 拦截解释——两侧点击都有可解释结果，不再是单向空操作。
  // fixture 面权限由 scenario 冻结（可表达 granted/denied/default 三态，不再
  // 硬编 granted）；无 scenario 位时缺省 granted 保 r7 13 基线行的开态。
  const [notifyPref, setNotifyPref] = useState<NotifyPref | null>(() =>
    readNotifyPref(safeLocalStorage()),
  );
  const [density, setDensity] = useState<Density>(() => readStoredDensity(safeLocalStorage()));
  const selectDensity = (next: Density) => {
    applyDensity(next);
    setDensity(next);
  };
  const { permission, request } = useNotificationPermission(
    live ? null : (fixture.ui?.notificationPermission ?? 'granted'),
  );
  const notifyOn = notifyPref === null ? permission === 'granted' : notifyPref === 'on';
  // 开着但权限被拒 = 显示开而实际不弹，必须给出解释（不能裸奔成新的假可供性）。
  const notifyBlocked = notifyOn && permission === 'denied';
  return (
    <SecondaryShell route="account" fixture={fixture} sidebarSelected="team" title={t('帐号')}>
      {/* XMON-117：卡盒 / 头像头 / 行 / label / 值槽落 components/profile-card
          的模板件（本页正是模板的来源面）；`account-*` 类名原样留作 e2e
          定位锚（profile-card 家族契约），几何正本住件上 PROFILE_* 常量。
          卡的上边距是页面节奏（card top y60 = 头 44 + 16），归消费点，
          #947 起以 mt-4 utility 承载（原 secondary.css .account-card 规则）。 */}
      <ProfileCard className="account-card mt-4">
        <ProfileHead>
          <ProfileAvatar className="account-avatar">
            {/* XMON-105: the account head is the same identity avatar as the
                sidebar chip / chat user rows (seeded, avatarUrl override),
                not a per-surface static asset. */}
            <SeededAvatar
              className="size-16"
              name={userName}
              src={sessionQ.data?.avatarUrl ?? null}
              fallback="/avatar-user.png"
            />
          </ProfileAvatar>
        </ProfileHead>
        {/* #1031：名称行接共享 ProfileNameRow（agent 详情同款行内编辑）——
            旧面是纯文本 + 装饰铅笔（无 button/onClick 的假可供性），现在点
            文本或铅笔都进编辑态，Enter/失焦提交、Esc 放弃、空白不提交。 */}
        <ProfileNameRow
          value={userName}
          onCommit={commitName}
          nameClassName={ACCOUNT_NAME_CLS}
          editClassName={ACCOUNT_ICON_EDIT_CLS}
          inputClassName={ACCOUNT_NAME_INPUT_CLS}
        />
        <ProfileRow className={PROFILE_ROW_TALL_CLS} label={t('语言')}>
          {/* #1005：语言 dropdown = registry Popover（#983 判决：锚定
              absolute 族 → Popover Positioner 锚定）。触发钮 outline 默认档，
              aria-expanded 由 Base UI 承载；#666 toggle 面律（焦点留触发位）
              走 Popup initialFocus=false。盘宽 min 220 是 layout（内容宽
              自适应）；选项行 ghost 默认档 + role=option 行为契约保留，
              当前语言勾色走 --card-button 品牌槽（#991 Q10 激活态强调面）。
              listbox 语义载体 = 盘内 div（role/aria-label 原样）。 */}
          <Popover open={langOpen} onOpenChange={setLangOpen}>
            <PopoverTrigger render={<Button variant="outline" aria-haspopup="listbox" />}>
              {LOCALE_NAMES[locale]}
              <ChevronDown />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              initialFocus={false}
              className="w-fit min-w-[220px] gap-1 p-1.5"
            >
              <div role="listbox" aria-label={t('语言')} className="flex flex-col gap-1">
                {LOCALES.map((code) => (
                  <Button
                    key={code}
                    variant="ghost"
                    className="w-full justify-start text-left"
                    role="option"
                    aria-selected={code === locale}
                    onClick={() => {
                      setLocale(code);
                      setLangOpen(false);
                    }}
                  >
                    {LOCALE_NAMES[code]}
                    {code === locale && (
                      <span className="ml-auto flex text-(--card-button)">
                        <Check width={14} height={14} />
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </ProfileRow>

        <ProfileRow label={t('密度')} className="account-density-row">
          <span className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              className={`h-7 cursor-pointer rounded-[6px] px-2.5 text-[12px] leading-4 font-normal ${
                density === 'comfortable'
                  ? 'bg-(--seg-active) text-(--text-secondary)'
                  : 'text-(--text-tertiary) hover:bg-(--seg-hover)'
              }`}
              data-active={density === 'comfortable'}
              data-testid="account-density-comfortable"
              onClick={(e) => {
                e.currentTarget.dataset.clicked = String(Date.now());
                selectDensity('comfortable');
              }}
            >
              {t('舒适')}
            </Button>
            <Button
              variant="ghost"
              className={`h-7 cursor-pointer rounded-[6px] px-2.5 text-[12px] leading-4 font-normal ${
                density === 'compact'
                  ? 'bg-(--seg-active) text-(--text-secondary)'
                  : 'text-(--text-tertiary) hover:bg-(--seg-hover)'
              }`}
              data-active={density === 'compact'}
              data-testid="account-density-compact"
              onClick={(e) => {
                e.currentTarget.dataset.clicked = String(Date.now());
                selectDensity('compact');
              }}
            >
              {t('紧凑')}
            </Button>
          </span>
        </ProfileRow>
        <ProfileRow
          label={t('推送通知')}
          hint={notifyBlocked ? t('浏览器已拒绝通知权限，需到站点设置重新允许') : undefined}
        >
          {/* #947：Switch 正典默认档（spec/22 §2.5 冻结几何），role=switch 与
              aria-checked 由底座透出，e2e 载体 = getByRole('switch')。皮肤
              不再 per-face：track --input（off）/--primary（on），thumb
              --background——§4-1 记的亮模 thumb 1.52:1 是正典已知打磨项
              （状态可辨由 track 翻转 11.03:1 满足，WCAG 1.4.11），处置权在
              视觉方向票，本票不加描边/投影。
              #1031：checked = 偏好档（不再单向镜像权限）；点击一律落偏好，
              非 granted 态点开额外驱动一次 requestPermission（#114 同路径）。 */}
          <Switch
            aria-label={t('推送通知')}
            checked={notifyOn}
            onCheckedChange={(checked) => {
              const next: NotifyPref = checked ? 'on' : 'off';
              setNotifyPref(next);
              persistNotifyPref(next, safeLocalStorage());
              if (checked && permission !== 'granted') request();
            }}
          />
        </ProfileRow>
      </ProfileCard>
    </SecondaryShell>
  );
}
