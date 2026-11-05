import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { ChiefDrawer } from './chief-drawer.js';
import { type OriginChiefQuestion, originChiefQuestions } from './question-origin.js';
import { type ChiefSurface, useChiefSurface } from './use-chief-surface.js';

export interface ChiefRootApi {
  surface: ChiefSurface;
  openChiefThread: (threadId: string) => void;
  pendingQuestions: OriginChiefQuestion[];
  questionsOpen: boolean;
  setQuestionsOpen: (open: boolean) => void;
  openQuestionOrigin: (conversationId: string) => void;
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
  const [questionsOpen, setQuestionsOpenState] = useState(false);
  const pendingQuestions = useMemo(
    () =>
      originChiefQuestions(surface.chiefData.stream ?? [], {
        teamId: teamId ?? 'local',
        conversationId: surface.chiefData.threadId ?? 'chief',
        title: surface.chiefData.threadTitle,
      }),
    [surface.chiefData.stream, surface.chiefData.threadId, surface.chiefData.threadTitle, teamId],
  );
  const setQuestionsOpen = useCallback(
    (open: boolean) => {
      if (open) surface.setChiefView('none');
      setQuestionsOpenState(open);
    },
    [surface],
  );
  useEffect(() => {
    if (pendingQuestions.length === 0) setQuestionsOpenState(false);
  }, [pendingQuestions.length]);
  useEffect(() => {
    if (surface.chiefView === 'drawer') setQuestionsOpenState(false);
  }, [surface.chiefView]);
  const openQuestionOrigin = useCallback(
    (conversationId: string) => {
      if (pathname === '/app') {
        setQuestionsOpen(false);
        return;
      }
      setLinkThreadId(conversationId);
      navigate('/app');
    },
    [pathname, navigate],
  );
  const onSettings = useCallback(() => {
    if (pathname === '/app') surface.setChiefView('settings');
    else navigate('/app?chief=settings');
  }, [pathname, surface, navigate]);
  const api = useMemo<ChiefRootApi>(
    () => ({
      surface,
      openChiefThread: setLinkThreadId,
      pendingQuestions,
      questionsOpen,
      setQuestionsOpen,
      openQuestionOrigin,
    }),
    [surface, pendingQuestions, questionsOpen, setQuestionsOpen, openQuestionOrigin],
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
