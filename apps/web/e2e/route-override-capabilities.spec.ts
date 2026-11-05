import { expect, type Page, test } from '@playwright/test';

const THREAD_ID = 'r3-legacy-1';
const TEAM_ID = 'team-1';
const PROJECT_ID = 'project-route-override';
const MCP_UUID = 'mcp-record-uuid';
const MCP_SLUG = 'r3-mcp';
const MCP_LABEL = 'R3 MCP';

interface OverrideWorld {
  patches: Record<string, unknown>[];
}

function liveTodo(routeOverride: Record<string, unknown>) {
  return {
    id: THREAD_ID,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: 'Route override probe',
    spec: 'Live route override data',
    phase: 'todo',
    phaseAt: 0,
    archivedAt: null,
    seqNum: 1,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
    createdBy: 'user-1',
    ownerId: 'user-1',
    sourceBuildId: null,
    sourceKind: null,
    sourceRef: null,
    routeOverride,
  };
}

async function stubLiveRouteOverride(page: Page, initialModels?: string[]): Promise<OverrideWorld> {
  const patches: Record<string, unknown>[] = [];
  const todo = liveTodo(
    initialModels === undefined
      ? {}
      : { requiredCapabilities: { models: initialModels } },
  );
  const mcpServer = {
    teamId: TEAM_ID,
    label: MCP_LABEL,
    slug: MCP_SLUG,
    transport: 'http',
    url: 'https://example.invalid/mcp',
    hasCredential: false,
    credentialKeys: [],
    createdBy: 'user-1',
    id: MCP_UUID,
    createdAt: 0,
    updatedAt: 0,
  };
  const routingSettings = { enabled: true, rules: [], policies: [] };
  const responses: Record<string, unknown> = {
    '/api/user/me': { id: 'user-1', displayName: 'Owner', avatarUrl: null },
    '/api/teams': [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    '/api/projects': [{ id: PROJECT_ID, teamId: TEAM_ID, name: 'Route project' }],
    '/api/todos': [todo],
    [`/api/todos/${THREAD_ID}`]: todo,
    [`/api/teams/${TEAM_ID}/machines`]: [],
    [`/api/teams/${TEAM_ID}/mcp-servers`]: [mcpServer],
    [`/api/teams/${TEAM_ID}/routing-settings`]: routingSettings,
    [`/api/teams/${TEAM_ID}/chief`]: {
      chief: { id: 'chief-1', teamId: TEAM_ID, agent: null },
      agentActor: null,
      context: null,
      watches: [],
      wakes: [],
      orchestration: { homeMachineId: null, activity: [] },
      outage: null,
    },
    [`/api/teams/${TEAM_ID}/chief/threads`]: [],
    [`/api/teams/${TEAM_ID}/notifications`]: { unreadThreadIds: [] },
    [`/api/teams/${TEAM_ID}/members`]: [],
    '/api/schedules': [],
    '/api/skills': [],
    '/api/server/backup': { status: 'healthy' },
    [`/api/projects/${PROJECT_ID}/files`]: {
      files: [],
      truncated: false,
      ref: 'main',
      commit: 'a'.repeat(40),
    },
  };

  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/stream'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (path === `/api/todos/${THREAD_ID}` && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      return route.fulfill({ json: { ...todo, ...body } });
    }
    if (path === `/api/teams/${TEAM_ID}/presence` && request.method() !== 'GET')
      return route.fulfill({ json: { ok: true } });
    if (request.method() === 'GET' && Object.hasOwn(responses, path))
      return route.fulfill({ json: responses[path] });
    return route.fulfill({ status: 500, json: { error: `Unstubbed ${request.method()} ${path}` } });
  });
  return { patches };
}

async function openRouteOverrideDialog(page: Page) {
  await page.goto(`/app/todo/${THREAD_ID}`);
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await page
    .getByRole('menu', { name: '更多' })
    .getByRole('menuitem', { name: '路由覆盖' })
    .click();
  return page.getByRole('dialog', { name: '路由覆盖' });
}

test('live MCP requirements save the slug used by machine capability dispatch', async ({ page }) => {
  const world = await stubLiveRouteOverride(page);
  const dialog = await openRouteOverrideDialog(page);
  await expect(dialog).toBeVisible();
  const mcpSwitch = dialog.getByTestId(`route-override-mcp-${MCP_SLUG}`);
  await expect(mcpSwitch).toBeVisible();
  await mcpSwitch.click();
  await expect(mcpSwitch).toBeChecked();

  await dialog.getByTestId('route-override-save').click();
  await expect
    .poll(() => world.patches)
    .toEqual([
      {
        routeOverride: {
          requiredCapabilities: { mcpServers: [MCP_SLUG] },
        },
      },
    ]);
});

test('saving a route override keeps the existing model requirements', async ({ page }) => {
  const world = await stubLiveRouteOverride(page, ['claude-opus-5-5']);
  const dialog = await openRouteOverrideDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId(`route-override-mcp-${MCP_SLUG}`)).toBeVisible();

  await dialog.getByTestId('route-override-save').click();
  await expect
    .poll(() => world.patches)
    .toEqual([
      {
        routeOverride: {
          requiredCapabilities: { models: ['claude-opus-5-5'] },
        },
      },
    ]);
});
