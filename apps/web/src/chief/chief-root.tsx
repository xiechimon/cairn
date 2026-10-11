// Chief root host (ADR 0013 D6): the single persistent chief surface for
// the whole app. The five mount points of the docked era (pages/resources/
// secondary shells' ChiefWake + board's inline pair + detail's split pair)
// are retired — this pathless layout route below PwaBridge owns the one
// useChiefSurface instance, renders the floating window and its FAB, and
// hands route-level consumers (board's settings swap, detail's #640
// in-page deep link) the surface through context. Route switches no longer
// remount the surface: the window state (view, thread, unread) survives
// navigation, and minimize keeps the draft/scroll inside the keepMounted
// popup (chief-drawer.tsx).
//
// Coverage is site-wide (#1141): every route renders the FAB/window and
// keeps ⌘J registered — the two-route suppression of the docked era
// (agent detail, machine authorize) is retired per the 2026-10-10 ruling
// that the chief surface must be summonable from any page.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefDrawer } from './chief-drawer.js';
import { ChiefFabIcon } from './chief-fab-icon.js';
import { type ChiefSurface, useChiefSurface } from './use-chief-surface.js';

export interface ChiefRootApi {
  surface: ChiefSurface;
  /** #640 页内深链（detail 来源面板「总管编排会话」）：hook 实例上收到根
   *  layout 后，页面侧的线程定位改经这里——set 后由 useChiefSurface 的
   *  XMON-106 深链消费机制开窗定位线程（消费即清，一次性）。 */
  openChiefThread: (threadId: string) => void;
}

const ChiefRootContext = createContext<ChiefRootApi | null>(null);

export function useChiefRoot(): ChiefRootApi {
  const api = useContext(ChiefRootContext);
  if (api === null)
    throw new Error('useChiefRoot must be consumed under the ChiefRoot layout route');
  return api;
}

/** #443：detail 族的 FAB 以未读为门（unreadOnly——有意背离「全站各族恒挂
 *  FAB」的 #129 裁决，按 ADR 0002 D7 之律记录在案；ADR 0013 D4 明文保留
 *  该行为面差异）。 */
function isDetailRoute(pathname: string): boolean {
  return pathname.startsWith('/app/todo/');
}

export function ChiefRoot() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const fixture = resolveScenario(searchParams);
  // XMON-106 `?chief=<threadId>` 深链（通知点击落地 `/app?chief=…`）——随
  // hook 一起上收：消费后剥参（replace 不积历史，其余参原样保留）。参数只
  // 会落在 /app，但消费机制自此路由无关。
  const chiefParam = searchParams.get('chief');
  const consumeChiefParam = useCallback(() => {
    const rest = new URLSearchParams(searchParams);
    rest.delete('chief');
    navigate(`?${rest.toString()}`, { replace: true });
  }, [searchParams, navigate]);
  // #640 页内深链的 layout 侧等价物（原 detail 页面级 useState）。
  const [linkThreadId, setLinkThreadId] = useState<string | null>(null);
  const deepLink = useMemo(
    () => ({
      threadId: chiefParam ?? linkThreadId,
      onConsumed: () => {
        if (chiefParam !== null) consumeChiefParam();
        setLinkThreadId(null);
      },
    }),
    [chiefParam, linkThreadId, consumeChiefParam],
  );
  const surface = useChiefSurface(fixture, deepLink);
  // #615 gear 路由律：board = 设置视图内容交换（r5 101–104）；非 board =
  // 落 board 设置视图深链。D9：设置面承载不变（不进悬浮窗）。
  const onSettings = useCallback(() => {
    if (pathname === '/app') surface.setChiefView('settings');
    else navigate('/app?chief=settings');
  }, [pathname, surface, navigate]);
  const api = useMemo<ChiefRootApi>(
    () => ({ surface, openChiefThread: setLinkThreadId }),
    [surface],
  );
  const windowOpen = surface.chiefView === 'drawer';
  // D4：窗开 = FAB 不渲染（互斥，Multica `if (isOpen) return null` 同律）。
  const fabVisible = !windowOpen && (!isDetailRoute(pathname) || surface.chiefUnread > 0);
  return (
    <ChiefRootContext.Provider value={api}>
      <Outlet />
      {fabVisible && (
        // XMON-23 收编沿旧：ghost/icon 原语 + FAB 皮肤 utility。几何对齐
        // Multica（ADR 0013 D4）：40px 正圆、距内容区右/下各 8px——替换
        // 48×48/16px 旧族律，与窗同角同心（「窗从 FAB 角长出」的动画心智
        // 成立，D7 origin bottom-right）；detail 特例位（right 504/bottom
        // 104，为躲 488 右栏而生）随 0004 D7 退役。皮肤 = Multica 原配方
        // （raised 卡底 + --floating-shadow + 发丝环——环走仓内 #139
        // --edge-ring 正典，分数缩放不断线）。中和件沿旧族：font-normal
        // （badge 10px 字）、active 位移；字形收进 size-6（30.8 属性尺寸
        // 对 48 圆的 0.64 占比，等比落 40 圆）；头像面 size-full 自铺满
        // （ChiefFabIcon 单源）。chief-fab / fab-badge 类名 = 零规则载体
        // 钩子（spec 定位面，重钉账见 #1009 A0 ⑨）。z 走 --z-floating
        // 新 rung（与窗互斥共存，同档无竞争）。
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('总管')}
                onClick={() => surface.setChiefView('drawer')}
                className="chief-fab fixed right-2 bottom-2 z-(--z-floating) size-10 cursor-pointer rounded-full border-none bg-(--card) font-normal shadow-[var(--edge-ring),var(--floating-shadow)] hover:bg-(--card) dark:hover:bg-(--card) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-6"
              >
                <ChiefFabIcon chief={surface.chiefData} />
                {surface.chiefUnread > 0 && (
                  <span className="fab-badge absolute -top-1 right-0 h-4 min-w-4 rounded-[8px] bg-(--card-button) px-[3px] text-center text-[10px] leading-4 text-(--text-on-accent)">
                    {surface.chiefUnread}
                  </span>
                )}
              </Button>
            }
          />
          {/* #468: ⌘J 悬浮提示（点击维持 open-only）。#983/#1004：
              kbd-hint 退役回 registry Tooltip + Kbd——该消费点原在
              board-page 内联钮，#1009 A0 把 FAB 迁到根 host，形态随迁。 */}
          <TooltipContent side="top" sideOffset={8}>
            <Kbd>⌘J</Kbd>
          </TooltipContent>
        </Tooltip>
      )}
      <ChiefDrawer
        open={windowOpen}
        chief={surface.chiefData}
        onSettings={onSettings}
        onClose={() => surface.setChiefView('none')}
        onSend={surface.onSend}
        onThread={surface.onThread}
        onNewThread={surface.onNewThread}
        modelValue={surface.modelValue}
        modelOptions={surface.modelOptions}
        onPickModel={surface.onPickModel}
        onRewind={surface.onRewind}
        onAnswerQuestion={surface.onAnswerQuestion}
        onCancelQuestion={surface.onCancelQuestion}
      />
    </ChiefRootContext.Provider>
  );
}
