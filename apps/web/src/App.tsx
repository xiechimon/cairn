import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { ApiProvider, LiveDataBridge } from './api/provider.js';
import { ChiefRoot } from './chief/chief-root.js';
import { Toaster } from './components/ui/toaster.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { I18nProvider } from './i18n/provider.js';
import { TokenGate } from './overlay/token-gate.js';
import { ProjectNewPage } from './pages/project-new-page.js';
import { ProjectPage } from './pages/project-page.js';
import { ProjectSettingsPage } from './pages/project-settings-page.js';
import { SchedulesPage } from './pages/schedules-page.js';
import { PwaBridge } from './pwa/register.js';
import { MachineDetailPage } from './resources/machine-detail-page.js';
import { MACHINES_HREF, MachinesPage } from './resources/machines-page.js';
import { MCP_HREF, McpServersPage } from './resources/mcp-servers-page.js';
import { PROVIDERS_HREF, ProvidersPage } from './resources/providers-page.js';
import { SECRETS_HREF, SecretsPage } from './resources/secrets-page.js';
import { SKILLS_HREF, SkillsPage } from './resources/skills-page.js';
import { AccountPage } from './routes/account-page.js';
import { AGENTS_HREF, AgentDetailPage } from './routes/agent-detail-page.js';
import { ApiKeysPage } from './routes/api-keys-page.js';
import { BoardPage } from './routes/board-page.js';
import { MachineAuthorizePage } from './routes/machine-authorize-page.js';
import { TeamPage } from './routes/team-page.js';
import { TodoDetailPage } from './routes/todo-detail-page.js';

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
              { path: '/app/todo/:id', element: <TodoDetailPage /> },
              { path: '/app/schedules', element: <SchedulesPage /> },
              { path: '/app/project/new', element: <ProjectNewPage /> },
              { path: '/app/project/:id', element: <ProjectPage /> },
              { path: '/app/project/:id/settings', element: <ProjectSettingsPage /> },
              { path: '/app/team', element: <TeamPage /> },
              { path: `${AGENTS_HREF}/:id`, element: <AgentDetailPage /> },
              { path: '/app/account', element: <AccountPage /> },
              { path: '/app/api-keys', element: <ApiKeysPage /> },
              { path: SKILLS_HREF, element: <SkillsPage /> },
              { path: MCP_HREF, element: <McpServersPage /> },
              { path: SECRETS_HREF, element: <SecretsPage /> },
              { path: MACHINES_HREF, element: <MachinesPage /> },
              { path: `${MACHINES_HREF}/:id`, element: <MachineDetailPage /> },
              { path: '/app/machines/authorize', element: <MachineAuthorizePage /> },
              { path: PROVIDERS_HREF, element: <ProvidersPage /> },
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
