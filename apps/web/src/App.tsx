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

// Hand-written route table (issue #52): board + todo detail full page.
// #71 adds the schedules + project surfaces (r2 §2 route table; /new
// precedes :id so the literal wins); #70 the secondary batch B
// (team / account / api-keys); #69 the resources batch A. The feedback
// route is removed outright (#149 local-first 裁决，#129 先例）— the old
// path falls through to the catch-all redirect.
// Unmatched paths redirect to /app (01-stack §4.1 i18n row, [设计]).
// #74: every route rides the pathless PwaBridge layout (sw registration +
// notification-click deep links) and the app-level I18nProvider.
// #83 (M5): the LiveDataBridge pathless layout sits above PwaBridge — it
// resolves fixture-vs-live mode, the seed team/user and the global team
// stream; fully inert in fixture (fixture/dev-scenario) mode.
// ADR 0013 D6 (#1009 A0): the ChiefRoot pathless layout below PwaBridge is
// the chief surface's single persistent home — the floating window + FAB
// mount once for every route, route switches no longer remount the surface,
// and the five docked-era mount points are retired.
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
              // #485：Agent 详情编辑面（r3 §4 实测路由 `/app/resources/agents/<id>`）。
              // 非侧栏行——只从团队页的 Agent 卡进入（r2 §8.4 命令面板「前往」清单
              // 里没有 Agents 行）。
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
        {/* #1008（#983 判决：kbd-hint 退役换 Tooltip+Kbd 组合）：全站唯一
            Tooltip Provider——delay=0 复刻旧纯 CSS hover chip 的「悬停立现」，
            快捷键提示与后续 hover 信息气泡共用同一延迟档。 */}
        <TooltipProvider>
          <RouterProvider router={router} />
          {/* #253 token 门页：401 触发的全屏唯一面，鉴权关时恒不可见 */}
          <TokenGate />
        </TooltipProvider>
        {/* #631 toast 原语挂载：全站唯一 toaster（sonner，shadcn 官方配方），
            imperative toast.* 调用面由各 feature 自取。 */}
        <Toaster />
      </I18nProvider>
    </ApiProvider>
  );
}
