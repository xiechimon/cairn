import { type ReactNode, useSyncExternalStore } from 'react';
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
  RouterProvider,
  useLocation,
} from 'react-router';
import { ApiProvider, LiveDataBridge } from './api/provider.js';
import { sidePanelOpen } from './board/app-sidebar.js';
import { THREAD_PARAM } from './board/thread-copy.js';
import { useNarrow, usePanelDocked } from './board/use-narrow.js';
import { ChiefRoot } from './chief/chief-root.js';
import { retryableLazy, SubtreeErrorBoundary } from './components/subtree-error-boundary.js';
import { Toaster } from './components/ui/toaster.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { I18nProvider } from './i18n/provider.js';
import { PairingRequestBanner } from './overlay/pairing-request-banner.js';
import { TokenGate } from './overlay/token-gate.js';
import { ProjectHomeRedirect } from './pages/project-redirect.js';
import { PwaBridge } from './pwa/register.js';
import {
  MACHINES_HREF,
  MCP_HREF,
  MODEL_ROUTING_HREF,
  PROVIDERS_HREF,
  ROUTING_SETTINGS_HREF,
  RUN_PATH,
  SECRETS_HREF,
  SKILLS_HREF,
  USAGE_PATH,
} from './resources/hrefs.js';
import { MachineDetailRedirect } from './resources/machine-detail-page.js';
import { BoardPage } from './routes/board-page.js';
import { TodoRedirect } from './routes/todo-redirect.js';
import { RunRedirect } from './runs/run-redirect.js';
import { SETTINGS_HREF } from './settings/settings-href.js';
import { LegacyModelRoutingRedirect, SettingsRedirect } from './settings/settings-redirect.js';
import { TrayPage } from './tray/tray-page.js';

function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  return <SubtreeErrorBoundary resetKey={`${pathname}${search}`}>{children}</SubtreeErrorBoundary>;
}

function withBoundary(routes: RouteObject[]): RouteObject[] {
  return routes.map((route) => ({
    ...route,
    element: route.element === null ? null : <RouteBoundary>{route.element}</RouteBoundary>,
  }));
}

const UsagePage = retryableLazy(() =>
  import('./routes/usage-page.js').then((m) => ({ default: m.UsagePage })),
);
const ProjectNewPage = retryableLazy(() =>
  import('./pages/project-new-page.js').then((m) => ({ default: m.ProjectNewPage })),
);
const ProjectSettingsPage = retryableLazy(() =>
  import('./pages/project-settings-page.js').then((m) => ({ default: m.ProjectSettingsPage })),
);
const MachineAuthorizePage = retryableLazy(() =>
  import('./routes/machine-authorize-page.js').then((m) => ({
    default: m.MachineAuthorizePage,
  })),
);

const DIALOG_ROUTES = withBoundary([
  { path: USAGE_PATH, element: <UsagePage /> },
  { path: RUN_PATH, element: <RunRedirect /> },
  { path: '/app/project/new', element: <ProjectNewPage /> },
  { path: '/app/project/:id/settings', element: <ProjectSettingsPage /> },
]);

const PAGE_ROUTES = withBoundary([
  { path: '/app', element: <BoardPage /> },
  { path: '/app/todo/:id', element: <TodoRedirect /> },
  { path: '/app/schedules', element: <ProjectHomeRedirect pane="tasks" tab="scheduled" /> },
  { path: '/app/project/:id', element: <ProjectHomeRedirect /> },
  { path: '/app/project/:id/tasks', element: <ProjectHomeRedirect pane="tasks" /> },
  { path: '/app/team', element: <SettingsRedirect section="routing" /> },
  { path: `${SETTINGS_HREF}/team`, element: <SettingsRedirect section="routing" /> },
  { path: '/app/account', element: <SettingsRedirect section="account" /> },
  { path: '/app/api-keys', element: <SettingsRedirect section="api-keys" /> },
  { path: SKILLS_HREF, element: <SettingsRedirect section="skills" /> },
  { path: MCP_HREF, element: <SettingsRedirect section="mcp" /> },
  { path: SECRETS_HREF, element: <SettingsRedirect section="secrets" /> },
  { path: MACHINES_HREF, element: <SettingsRedirect section="machines" /> },
  { path: `${MACHINES_HREF}/:id`, element: <MachineDetailRedirect /> },
  { path: '/app/machines/authorize', element: <MachineAuthorizePage /> },
  { path: PROVIDERS_HREF, element: <SettingsRedirect section="routing" /> },
  { path: MODEL_ROUTING_HREF, element: <LegacyModelRoutingRedirect /> },
  { path: ROUTING_SETTINGS_HREF, element: <SettingsRedirect section="routing" /> },
  { path: `${SETTINGS_HREF}/:section?`, element: null },
  { path: '*', element: <Navigate to="/app" replace /> },
]);

export const router = createBrowserRouter([
  {
    element: <LiveDataBridge />,
    children: [
      { path: '/tray', element: <TrayPage /> },
      {
        element: <PwaBridge />,
        children: [
          {
            element: <ChiefRoot routes={PAGE_ROUTES} dialogRoutes={DIALOG_ROUTES} />,
            children: [{ path: '*', element: null }],
          },
        ],
      },
    ],
  },
]);

const PANEL_TOAST_INSET = 16;
const COMPOSER_CLEARANCE = 112;

function PanelAwareToaster() {
  const location = useSyncExternalStore(router.subscribe, () => router.state.location);
  const docked = usePanelDocked();
  const narrow = useNarrow();
  if (narrow) return <Toaster />;
  const panelOnly =
    docked &&
    sidePanelOpen(location.pathname, location.search) &&
    new URLSearchParams(location.search).get(THREAD_PARAM) === null;
  return (
    <Toaster
      position="bottom-right"
      offset={{
        right: PANEL_TOAST_INSET,
        bottom: panelOnly ? PANEL_TOAST_INSET : COMPOSER_CLEARANCE,
      }}
    />
  );
}

export function App() {
  return (
    <ApiProvider>
      <I18nProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <PairingRequestBanner />
          <TokenGate />
        </TooltipProvider>
        <PanelAwareToaster />
      </I18nProvider>
    </ApiProvider>
  );
}
