import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { COLUMN_PARAM, parseColumnParam } from '../board/columns.js';
import { BOARD_VIEW_PARAM } from '../board/home.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { TaskPanelRoot } from '../task-panel/task-panel-root.js';
import { ChiefDrawer } from './chief-drawer.js';
import { ChiefFabIcon } from './chief-fab-icon.js';
import { type ChiefSurface, useChiefSurface } from './use-chief-surface.js';

export interface ChiefRootApi {
  surface: ChiefSurface;
  openChiefThread: (threadId: string) => void;
}

const ChiefRootContext = createContext<ChiefRootApi | null>(null);

export function useChiefRoot(): ChiefRootApi {
  const api = useContext(ChiefRootContext);
  if (api === null)
    throw new Error('useChiefRoot must be consumed under the ChiefRoot layout route');
  return api;
}

function isDetailRoute(pathname: string): boolean {
  return pathname.startsWith('/app/todo/');
}

export function isChiefHome(pathname: string, searchParams: URLSearchParams): boolean {
  return (
    pathname === '/app' &&
    searchParams.get(BOARD_VIEW_PARAM) !== 'board' &&
    parseColumnParam(searchParams.get(COLUMN_PARAM)) === null
  );
}

export function ChiefRoot() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const fixture = resolveScenario(searchParams);
  const chiefParam = searchParams.get('chief');
  const consumeChiefParam = useCallback(() => {
    const rest = new URLSearchParams(searchParams);
    rest.delete('chief');
    navigate(`?${rest.toString()}`, { replace: true });
  }, [searchParams, navigate]);
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
  const onHome = isChiefHome(pathname, searchParams);
  const surface = useChiefSurface(fixture, deepLink, onHome);
  const onSettings = useCallback(() => {
    if (pathname === '/app') surface.setChiefView('settings');
    else navigate('/app?chief=settings');
  }, [pathname, surface, navigate]);
  const api = useMemo<ChiefRootApi>(
    () => ({ surface, openChiefThread: setLinkThreadId }),
    [surface],
  );
  const windowOpen = surface.chiefView === 'drawer' && !onHome;
  const fabVisible =
    !onHome && !windowOpen && (!isDetailRoute(pathname) || surface.chiefUnread > 0);
  const fabExpanded = surface.chiefUnread > 0 || surface.chiefBusy;
  return (
    <ChiefRootContext.Provider value={api}>
      <TaskPanelRoot onTaskOpen={windowOpen ? () => surface.setChiefView('none') : undefined}>
        <Outlet />
        {fabVisible && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('总管')}
                  onClick={() => surface.setChiefView('drawer')}
                  data-busy={surface.chiefBusy || undefined}
                  data-expanded={fabExpanded || undefined}
                  className="chief-fab fixed right-2 bottom-2 z-(--z-floating) size-10 cursor-pointer gap-1 rounded-full border-none bg-card font-normal text-foreground shadow-(--fab-shadow) transition-shadow duration-(--dur-fast) ease-(--ease-standard) hover:bg-card hover:text-foreground hover:shadow-(--e3) dark:hover:bg-card active:not-aria-[haspopup]:translate-y-0 data-expanded:w-auto data-expanded:pr-3.5 data-expanded:pl-1"
                >
                  {surface.chiefUnread > 0 && (
                    <span
                      aria-hidden="true"
                      className="ml-1.5 size-1.5 flex-none rounded-full bg-(--card-button)"
                    />
                  )}
                  <ChiefFabIcon
                    chief={surface.chiefData}
                    busy={surface.chiefBusy}
                    expanded={fabExpanded}
                  />
                  {surface.chiefUnread > 0 ? (
                    <span className="text-ui whitespace-nowrap text-content-secondary">
                      <span className="fab-badge">
                        {surface.chiefUnread > 99 ? '99+' : surface.chiefUnread}
                      </span>{' '}
                      {t('条新消息')}
                    </span>
                  ) : (
                    surface.chiefBusy && (
                      <span className="text-ui whitespace-nowrap text-content-secondary">
                        {t('思考中…')}
                      </span>
                    )
                  )}
                </Button>
              }
            />
            <TooltipContent side="top" sideOffset={8}>
              {surface.chiefUnread > 0 && (
                <span>{t('{n} 个总管会话有未读', { n: surface.chiefUnread })}</span>
              )}
              <Kbd>⌘J</Kbd>
            </TooltipContent>
          </Tooltip>
        )}
        {!onHome && (
          <ChiefDrawer
            open={windowOpen}
            chief={surface.chiefData}
            onSettings={onSettings}
            onClose={() => surface.setChiefView('none')}
            onSend={surface.onSend}
            onThread={surface.onThread}
            onNewThread={surface.onNewThread}
            onRewind={surface.onRewind}
            onAnswerQuestion={surface.onAnswerQuestion}
            onCancelQuestion={surface.onCancelQuestion}
            onWithdraw={surface.onWithdraw}
            onSteer={surface.onSteer}
            onStop={surface.onStop}
          />
        )}
      </TaskPanelRoot>
    </ChiefRootContext.Provider>
  );
}
