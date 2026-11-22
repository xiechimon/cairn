import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { MachineIdentityContext } from '../components/machine-label.js';
import { DemoBanner } from '../demo/demo-banner.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { USER_NAME } from '../fixtures/core.js';
import {
  loadScenarioFixtures,
  resolveScenario,
  SCENARIO_PARAM,
  SCENARIOS_ENABLED,
} from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { useNotificationsSync } from '../pwa/push-device.js';
import { useMachines, useSession, useTeams } from './hooks.js';
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
  teamsQuery: { isError: boolean; isFetching: boolean; refetch: () => unknown } | undefined;
}

const LiveDataContext = createContext<LiveData>({
  live: false,
  teamId: undefined,
  userName: '我',
  user: FIXTURE_USER,
  teamsQuery: undefined,
});

export function useLiveData(): LiveData {
  return useContext(LiveDataContext);
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
  const [fixturesReady, setFixturesReady] = useState(false);
  useEffect(() => {
    if (live || fixturesReady) return;
    let on = true;
    void loadScenarioFixtures().then(() => {
      if (on) setFixturesReady(true);
    });
    return () => {
      on = false;
    };
  }, [live, fixturesReady]);
  const teams = useTeams(live);
  const session = useSession(live);
  const teamId = teams.data?.[0]?.id;
  const machines = useMachines(teamId, live);
  useTeamStream(teamId, live);
  useNotificationsSync(teamId, live, teamId === undefined && teams.isFetching);
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
      teamsQuery: live ? teams : undefined,
    }),
    [live, teamId, session.data, teams],
  );
  const scenarioId =
    live || !SCENARIOS_ENABLED ? null : new URLSearchParams(search).get(SCENARIO_PARAM);
  return (
    <LiveDataContext.Provider value={value}>
      <MachineIdentityContext.Provider
        value={
          live
            ? (machines.data ?? [])
            : (resolveScenario(new URLSearchParams(search)).resources?.machines ?? [])
        }
      >
        {DEMO_MODE ? (
          <div className="flex h-full flex-col">
            <DemoBanner />
            <div data-slot="demo-body" className="relative min-h-0 flex-1 contain-layout">
              {fixturesReady ? <Outlet /> : null}
            </div>
          </div>
        ) : (
          <>
            {scenarioId != null && <FixtureModeChip id={scenarioId} />}
            {live || fixturesReady ? <Outlet /> : null}
          </>
        )}
      </MachineIdentityContext.Provider>
    </LiveDataContext.Provider>
  );
}

function FixtureModeChip({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <div className="fixture-mode-chip pointer-events-none fixed hidden md:block top-2 right-3 z-40 rounded-full bg-popover px-3 py-1 text-xs text-muted-foreground ring-1 ring-foreground/10">
      {t('示例数据（场景 {id}）', { id })}
    </div>
  );
}
