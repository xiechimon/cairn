import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { ApiProvider, LiveDataBridge } from './api/provider.js';
import { ChiefRoot } from './chief/chief-root.js';
import { Toaster } from './components/ui/toaster.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { I18nProvider } from './i18n/provider.js';
import { TokenGate } from './overlay/token-gate.js';
import { ProjectNewPage } from './pages/project-new-page.js';
import { ProjectPage } from './pages/project-page.js';
import { ProjectHomeRedirect } from './pages/project-redirect.js';
import { ProjectSettingsPage } from './pages/project-settings-page.js';
import { SchedulesPage } from './pages/schedules-page.js';
import { PwaBridge } from './pwa/register.js';
import { MODEL_ROUTING_HREF, PROVIDERS_HREF } from './resources/hrefs.js';
import { MachineDetailPage } from './resources/machine-detail-page.js';
import { MACHINES_HREF } from './resources/machines-page.js';
import { MCP_HREF } from './resources/mcp-servers-page.js';
import { ROUTING_SETTINGS_HREF } from './resources/routing-settings-page.js';
import { SECRETS_HREF } from './resources/secrets-page.js';
import { SKILLS_HREF } from './resources/skills-page.js';
import { ActivityPage } from './routes/activity-page.js';
import { BoardPage } from './routes/board-page.js';
import { MachineAuthorizePage } from './routes/machine-authorize-page.js';
import { TodoRedirect } from './routes/todo-redirect.js';
import { ACTIVITY_PATH } from './search/activity-href.js';
import { SETTINGS_HREF } from './settings/settings-href.js';
import { SettingsPage } from './settings/settings-page.js';
import { SettingsRedirect } from './settings/settings-redirect.js';

export const router = createBrowserRouter([
  {
    element: <LiveDataBridge />,
    children: [
      {
        element: <PwaBridge />,
        children: [
          {
            element: <ChiefRoot />,
            children: [
              { path: '/app', element: <BoardPage /> },
              { path: '/app/todo/:id', element: <TodoRedirect /> },
              { path: '/app/schedules', element: <SchedulesPage /> },
              { path: ACTIVITY_PATH, element: <ActivityPage /> },
              { path: '/app/project/new', element: <ProjectNewPage /> },
              { path: '/app/project/:id', element: <ProjectHomeRedirect /> },
              { path: '/app/project/:id/files', element: <ProjectPage /> },
              { path: '/app/project/:id/settings', element: <ProjectSettingsPage /> },
              { path: '/app/team', element: <SettingsRedirect section="team" /> },
              { path: '/app/account', element: <SettingsRedirect section="account" /> },
              { path: '/app/api-keys', element: <SettingsRedirect section="api-keys" /> },
              { path: SKILLS_HREF, element: <SettingsRedirect section="skills" /> },
              { path: MCP_HREF, element: <SettingsRedirect section="mcp" /> },
              { path: SECRETS_HREF, element: <SettingsRedirect section="secrets" /> },
              { path: MACHINES_HREF, element: <SettingsRedirect section="machines" /> },
              { path: `${MACHINES_HREF}/:id`, element: <MachineDetailPage /> },
              { path: '/app/machines/authorize', element: <MachineAuthorizePage /> },
              { path: PROVIDERS_HREF, element: <SettingsRedirect section="providers" /> },
              { path: MODEL_ROUTING_HREF, element: <SettingsRedirect section="routing" /> },
              {
                path: ROUTING_SETTINGS_HREF,
                element: <SettingsRedirect section="work-routing" />,
              },
              { path: `${SETTINGS_HREF}/:section?`, element: <SettingsPage /> },
              { path: '*', element: <Navigate to="/app" replace /> },
            ],
          },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <ApiProvider>
      <I18nProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <TokenGate />
        </TooltipProvider>
        <Toaster />
      </I18nProvider>
    </ApiProvider>
  );
}
