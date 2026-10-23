// 看板顶部通知引导条 (issue #114, 02 §9.1 / r2 §1.3 / r3 §7): the strip shows
// while Notification.permission === 'default'; 开启 calls
// Notification.requestPermission() and the bar hides on either resolution
// (granted → sse.ts fireDesktopNotification unlocks, denied → the in-app
// 未读面 stays the fallback, 04 §5 divergence). Copy single source = shared
// NOTIFICATION_BANNER_COPY canon (zh authoritative, en fallback via t()).
// Geometry/colors measured from the r2 01 (light) / 28 (dark) captures —
// the r7 board baselines predate the strip, so fixture scenarios opt in via
// ui.notificationBanner and the live board reads the real permission.

import { NOTIFICATION_BANNER_COPY } from '@cairn/shared';
import { useCallback, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

/** The 铃铛 glyph (r2 01/28: indigo bell on the tinted disc). Inline because
 *  apps/web/src/icons is generated (scripts/generate-icons.mjs) from the r7
 *  icon dump, which has no bell — the banner predates that capture batch. */
function Bell() {
  return (
    <svg
      aria-hidden="true"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export type NotificationPermissionState = NotificationPermission | 'unsupported';

function readPermission(): NotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Permission state machine, single source for the #114 banner and the
 *  #148 account 推送通知 switch. `fixtureState` non-null freezes the initial
 *  read (scenario mode): the fixture build's headless chromium reports
 *  Notification.permission as 'denied', and the r7-baselined surfaces were
 *  captured without either affordance, so the real API may never leak into
 *  the fixture data面. Null = live: read the real permission. request()
 *  always calls the real Notification.requestPermission() and settles the
 *  state either way (granted unlocks sse.ts fireDesktopNotification, denied
 *  leaves the in-app 未读面 the fallback, 04 §5 divergence). */
export function useNotificationPermission(fixtureState: NotificationPermissionState | null): {
  permission: NotificationPermissionState;
  request: () => void;
} {
  const [permission, setPermission] = useState<NotificationPermissionState>(
    () => fixtureState ?? readPermission(),
  );
  const request = useCallback(() => {
    if (typeof Notification === 'undefined') return;
    try {
      // promise form (modern browsers); a rejection still settles the state
      void Promise.resolve(Notification.requestPermission()).then(
        (next) => setPermission(next),
        () => setPermission('denied'),
      );
    } catch {
      setPermission('denied');
    }
  }, []);
  return { permission, request };
}

export function useNotificationBanner(
  fixtureFlag: boolean,
  live: boolean,
): { visible: boolean; enable: () => void } {
  const { permission, request } = useNotificationPermission(
    live ? null : fixtureFlag ? 'default' : 'granted',
  );
  return { visible: permission === 'default', enable: request };
}

export function NotificationBanner({ onEnable }: { onEnable: () => void }) {
  const { t } = useI18n();
  return (
    /* 几何/色出处（r2 01 亮 / 28 暗实测，原 board.css 规则族，#943 迁工具
       类）：64px 高卡片；顶栏下 12px 与 17px 内缩由 board.tsx 的横幅槽给，
       条带本身随文档流；发丝环 + 卡投影双层。圆角随卡族档
       （2026-10-12 dsh 对齐：rounded-2xl = 18px，与卡/列容器同）。 */
    <section
      className="board-notify-banner flex h-16 items-center rounded-2xl border-0 bg-(--secondary) px-4 [box-shadow:var(--edge-ring),var(--card-shadow)]"
      aria-label={t(NOTIFICATION_BANNER_COPY.title)}
    >
      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-(--notify-icon-bg) text-(--card-button)">
        <Bell />
      </span>
      <div className="ml-3.5 min-w-0">
        <div className="text-sm leading-5 font-medium text-foreground">
          {t(NOTIFICATION_BANNER_COPY.title)}
        </div>
        {/* 正文墨色（#943 better-colors 实测修正）：旧 --text-dim ×
            --surface-secondary 配对亮模 2.73:1 / 暗模 3.12:1，连 spec/22
            §1.7 给 --text-dim 定的 floor 3 都不到（正典门控对是 text-dim ×
            --background，本面底是 surface-secondary，配对是本文件自造的）。
            12px 正文按 AA 要 4.5：换次级文本的正角色 token
            --muted-foreground（仓内 todo-card 时间/列计数同款习语），双模
            实测 ≥6.9（docs/verify/943/contrast.json）。 */}
        <div className="text-xs leading-4 text-muted-foreground">
          {t(NOTIFICATION_BANNER_COPY.body)}
        </div>
      </div>
      {/* spec16 #414 试点片收口（#561）：切 components/ui Button——default 档
          = 轨 A3 primary 等价迁移位（同 --card-button 实底），sm = compact
          28px 档。像素纪律（零视觉重钉）：r2 实测 per-face 值（12px 内距 /
          13px 字号 / 400 字重）按 todo-card 口径以工具类钉回。件本体 B 配方
          差值（focus 环 #388 canon / 150ms 色过渡 / 1px 透明边）随全站
          shadcn 件统一，属该收的口，PR body 列明。board-notify-banner-action
          是 e2e(notify-banner.spec) 钉死的选择器别名；ml-auto/flex-none 的
          布局差值原住 board.css，#943 随文件清零迁到件上。 */}
      <Button
        size="sm"
        className="ml-auto flex-none px-3 text-[13px] font-normal"
        onClick={onEnable}
      >
        {t(NOTIFICATION_BANNER_COPY.action)}
      </Button>
    </section>
  );
}
