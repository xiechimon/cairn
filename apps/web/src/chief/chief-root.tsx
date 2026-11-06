import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { ChiefDrawer } from './chief-drawer.js';
import { questionDockState } from './question-dock-state.js';
import { questionDraftKey } from './question-drafts.js';
import { type OriginChiefQuestion, originChiefQuestions } from './question-origin.js';
import { type ChiefSurface, useChiefSurface } from './use-chief-surface.js';

export interface ChiefRootApi {
  surface: ChiefSurface;
  openChiefThread: (threadId: string) => void;
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

export function ChiefRoot() {
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
  const onHome = pathname === '/app';
  const { teamId } = useLiveData();
  const surface = useChiefSurface(fixture, deepLink, onHome);
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
  const onSettings = useCallback(() => {
    if (pathname === '/app') surface.setChiefView('settings');
    else navigate('/app?chief=settings');
  }, [pathname, surface, navigate]);
  const api = useMemo<ChiefRootApi>(
    () => ({
      surface,
      openChiefThread: setLinkThreadId,
      pendingQuestions,
    }),
    [surface, pendingQuestions],
  );
  const ownsConversation = onHome;
  const windowOpen = surface.chiefView === 'drawer' && !ownsConversation;
  return (
    <ChiefRootContext.Provider value={api}>
      <Outlet />
      {!ownsConversation && (
        <ChiefDrawer
          open={windowOpen}
          chief={surface.chiefData}
          onSettings={onSettings}
          onClose={() => surface.setChiefView('none')}
          onSend={surface.onSend}
          onRewind={surface.onRewind}
          onAnswerQuestion={surface.onAnswerQuestion}
          onCancelQuestion={surface.onCancelQuestion}
          onWithdraw={surface.onWithdraw}
          onSteer={surface.onSteer}
          onStop={surface.onStop}
          earlier={surface.earlier}
        />
      )}
    </ChiefRootContext.Provider>
  );
}
