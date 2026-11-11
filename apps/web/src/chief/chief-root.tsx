import { createContext, useContext, useEffect, useLayoutEffect, useMemo } from 'react';
import { type RouteObject, useNavigate, useRoutes } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { useOpenComposer } from '../board/open-composer.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { isEditableTarget } from '../overlay/hotkeys.js';
import { SettingsDialog } from '../settings/settings-page.js';
import { useSettingsOverlay } from '../settings/use-settings-overlay.js';
import { questionDockState } from './question-dock-state.js';
import { questionDraftKey } from './question-drafts.js';
import { type OriginChiefQuestion, originChiefQuestions } from './question-origin.js';
import { type ChiefSurface, useChiefSurface } from './use-chief-surface.js';

export interface ChiefRootApi {
  surface: ChiefSurface;
  pendingQuestions: OriginChiefQuestion[];
}

const ChiefRootContext = createContext<ChiefRootApi | null>(null);

export function useOptionalChiefRoot(): ChiefRootApi | null {
  return useContext(ChiefRootContext);
}

export function useChiefRoot(): ChiefRootApi {
  const api = useContext(ChiefRootContext);
  if (api === null)
    throw new Error('useChiefRoot must be consumed under the ChiefRoot layout route');
  return api;
}

function useOpenCoordinatorKey(): void {
  const openComposer = useOpenComposer();
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || event.repeat) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'j') return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      openComposer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openComposer]);
}

export function ChiefRoot({ routes }: { routes: RouteObject[] }) {
  const settings = useSettingsOverlay();
  const { pathname = '/app', search = '' } = settings.pageLocation;
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const page = useRoutes(routes, settings.pageLocation);
  const navigate = useNavigate();
  const fixture = resolveScenario(searchParams);
  const onHome = pathname === '/app';
  const chiefParam = searchParams.get('chief');
  useEffect(() => {
    if (!onHome && chiefParam !== null) navigate({ pathname: '/app', search }, { replace: true });
  }, [onHome, chiefParam, search, navigate]);
  const deepLink = useMemo(
    () => ({
      threadId: onHome ? chiefParam : null,
      onConsumed: () => {
        if (!onHome || chiefParam === null) return;
        const rest = new URLSearchParams(searchParams);
        rest.delete('chief');
        navigate(`?${rest.toString()}`, { replace: true });
      },
    }),
    [onHome, chiefParam, searchParams, navigate],
  );
  const { teamId } = useLiveData();
  const surface = useChiefSurface(fixture, deepLink);
  useOpenCoordinatorKey();
  const pendingQuestions = useMemo(
    () =>
      originChiefQuestions(surface.chiefData.stream ?? [], {
        teamId: teamId ?? 'local',
        conversationId: surface.chiefData.threadId ?? 'chief',
        title: surface.chiefData.threadTitle,
      }),
    [surface.chiefData.stream, surface.chiefData.threadId, surface.chiefData.threadTitle, teamId],
  );
  const conversationId = surface.chiefData.threadId ?? 'chief';
  const stream = surface.chiefData.stream;
  useEffect(() => {
    for (const item of stream ?? []) {
      if (item.kind !== 'question' || item.status === 'pending') continue;
      questionDockState.clearAnswers(
        questionDraftKey({ teamId: teamId ?? 'local', conversationId, requestId: item.requestId }),
      );
    }
  }, [stream, conversationId, teamId]);
  const api = useMemo<ChiefRootApi>(
    () => ({ surface, pendingQuestions }),
    [surface, pendingQuestions],
  );
  return (
    <ChiefRootContext.Provider value={api}>
      <div className="contents" inert={settings.section !== null}>
        {page}
      </div>
      {settings.section !== null && (
        <SettingsDialog section={settings.section} onClose={settings.close} />
      )}
    </ChiefRootContext.Provider>
  );
}
