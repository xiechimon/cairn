import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router';
import { DemoBanner } from '../demo/demo-banner.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { USER_NAME } from '../fixtures/fixtures.js';
import { SCENARIO_PARAM, SCENARIOS_ENABLED } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { useMembers, useSession, useTeams } from './hooks.js';
import { isFixtureMode } from './mode.js';
import { useTeamStream } from './sse.js';

export interface CurrentUser {
  displayName: string;
  avatarUrl: string | null;
}

const FIXTURE_USER: CurrentUser = { displayName: USER_NAME, avatarUrl: null };

export interface LiveData {
  live: boolean;
  teamId: string | undefined;
  userName: string;
  user: CurrentUser;
}

const LiveDataContext = createContext<LiveData>({
  live: false,
  teamId: undefined,
  userName: '我',
  user: FIXTURE_USER,
});

export function useLiveData(): LiveData {
  return useContext(LiveDataContext);
}

export function useAgentAvatarUrlById(): Map<string, string | null> {
  const { live, teamId } = useLiveData();
  const members = useMembers(teamId, live);
  return useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of members.data ?? []) {
      if (m.memberType !== 'agent') continue;
      map.set(m.actorId, (m.actor as { avatarUrl?: string | null } | undefined)?.avatarUrl ?? null);
    }
    return map;
  }, [members.data]);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 2_000,
    },
  },
});

export function ApiProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function LiveDataBridge() {
  const { search } = useLocation();
  const live = useMemo(() => !isFixtureMode(new URLSearchParams(search)), [search]);
  const teams = useTeams(live);
  const session = useSession(live);
  const teamId = teams.data?.[0]?.id;
  useTeamStream(teamId, live);
  const value = useMemo<LiveData>(
    () => ({
      live,
      teamId,
      userName: session.data?.displayName ?? '我',
      user: live
        ? {
            displayName: session.data?.displayName ?? USER_NAME,
            avatarUrl: session.data?.avatarUrl ?? null,
          }
        : FIXTURE_USER,
    }),
    [live, teamId, session.data],
  );
  const scenarioId =
    live || !SCENARIOS_ENABLED ? null : new URLSearchParams(search).get(SCENARIO_PARAM);
  return (
    <LiveDataContext.Provider value={value}>
      {DEMO_MODE ? (
        <div className="flex h-full flex-col">
          <DemoBanner />
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </div>
      ) : (
        <>
          {scenarioId != null && <FixtureModeChip id={scenarioId} />}
          <Outlet />
        </>
      )}
    </LiveDataContext.Provider>
  );
}

function FixtureModeChip({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <div className="fixture-mode-chip pointer-events-none fixed bottom-2 left-1/2 z-40 -translate-x-1/2 rounded-full bg-popover px-3 py-1 text-xs text-muted-foreground ring-1 ring-foreground/10">
      {t('示例数据（scenario {id}）', { id })}
    </div>
  );
}
