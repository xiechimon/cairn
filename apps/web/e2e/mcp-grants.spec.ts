import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';

interface GrantWorld {
  patches: Array<{ use: string; body: unknown }>;
}

function connectorRecord(id: string, slug: string, label: string, url: string) {
  return {
    id,
    teamId: TEAM_ID,
    slug,
    label,
    catalogId: slug,
    url,
    headerNames: [],
    authKind: 'static',
    status: 'connected',
    statusReason: null,
    toolCount: 12,
    checkedAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function policy(use: string, mcpServers: string[]) {
  return {
    id: `policy-${use}`,
    teamId: TEAM_ID,
    use,
    tools: [],
    mcpServers,
    skillsAllowlist: null,
    defaultSkill: null,
    secrets: [],
    seededFromAgentId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

async function stubGrants(page: Page, signedIn: string[] = []): Promise<GrantWorld> {
  const patches: GrantWorld['patches'] = [];
  const connectors = [
    connectorRecord('conn-context7', 'context7', 'Context7', 'https://mcp.context7.com/mcp'),
    ...signedIn.map((slug) => connectorRecord(`conn-${slug}`, slug, 'Linear', 'https://mcp.linear.app/mcp')),
  ];
  const policies = [policy('session', ['context7']), policy('review', [])];
  const github = connectorRecord(
    'conn-github',
    'github',
    'GitHub',
    'https://api.githubcopilot.com/mcp/',
  );
  const responses: Record<string, () => unknown> = {
    '/api/user/me': () => ({ id: 'user-1', displayName: 'Owner', avatarUrl: null }),
    '/api/teams': () => [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    '/api/projects': () => [],
    '/api/todos': () => [],
    [`/api/teams/${TEAM_ID}/machines`]: () => [],
    [`/api/teams/${TEAM_ID}/mcp-servers`]: () => [],
    [`/api/teams/${TEAM_ID}/mcp-connectors`]: () => connectors,
    [`/api/teams/${TEAM_ID}/routing-settings`]: () => ({ rules: [], policies }),
    [`/api/teams/${TEAM_ID}/chief`]: () => ({
      chief: { id: 'chief-1', teamId: TEAM_ID, agent: null },
      agentActor: null,
      context: null,
      watches: [],
      wakes: [],
      orchestration: { homeMachineId: null, activity: [] },
      outage: null,
    }),
    [`/api/teams/${TEAM_ID}/chief/threads`]: () => [],
    [`/api/teams/${TEAM_ID}/notifications`]: () => ({ unreadThreadIds: [] }),
    [`/api/teams/${TEAM_ID}/members`]: () => [],
    '/api/schedules': () => [],
    '/api/skills': () => [],
    '/api/server/backup': () => ({ status: 'healthy' }),
  };

  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path.endsWith('/stream'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (path === `/api/teams/${TEAM_ID}/presence` && method !== 'GET')
      return route.fulfill({ json: { ok: true } });
    if (path === `/api/teams/${TEAM_ID}/mcp-connectors` && method === 'POST') {
      connectors.push(github);
      return route.fulfill({ json: github });
    }
    const use = path.match(new RegExp(`^/api/teams/${TEAM_ID}/work-policies/(\\w+)$`))?.[1];
    if (use !== undefined && method === 'PATCH') {
      const body = request.postDataJSON() as { mcpServers: string[] };
      patches.push({ use, body });
      const row = policies.find((p) => p.use === use);
      if (row !== undefined) row.mcpServers = body.mcpServers;
      return route.fulfill({ json: row });
    }
    const respond = responses[path];
    if (method === 'GET' && respond !== undefined) return route.fulfill({ json: respond() });
    return route.fulfill({ status: 500, json: { error: `Unstubbed ${method} ${path}` } });
  });
  return { patches };
}

test('connecting a catalog server asks which work may use it and saves the grant', async ({
  page,
}) => {
  const world = await stubGrants(page);
  await page.goto('/app/resources/mcp-servers');
  await page.getByRole('button', { name: '接入 GitHub' }).click();
  await page.getByLabel('个人访问令牌').fill('ghp_example');
  await page.getByRole('dialog').getByRole('button', { name: '连接' }).click();

  const sheet = page.getByRole('dialog', { name: '让哪些工作用 GitHub' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('mcp-grant-session')).toBeChecked();
  await expect(sheet.getByTestId('mcp-grant-review')).not.toBeChecked();
  await sheet.getByTestId('mcp-grant-review').click();
  await sheet.getByRole('button', { name: '保存' }).click();

  await expect(sheet).toBeHidden();
  expect(world.patches.sort((a, b) => a.use.localeCompare(b.use))).toEqual([
    { use: 'review', body: { mcpServers: ['github'] } },
    { use: 'session', body: { mcpServers: ['context7', 'github'] } },
  ]);
  await expect(
    page.locator('[data-connector-card="github"]').getByTestId('mcp-grant-summary'),
  ).toHaveText('· 任务和评审可用');
});

test('leaving the grant sheet saves nothing', async ({ page }) => {
  const world = await stubGrants(page);
  await page.goto('/app/resources/mcp-servers');
  await page.getByRole('button', { name: '接入 GitHub' }).click();
  await page.getByLabel('个人访问令牌').fill('ghp_example');
  await page.getByRole('dialog').getByRole('button', { name: '连接' }).click();
  const sheet = page.getByRole('dialog', { name: '让哪些工作用 GitHub' });
  await sheet.getByRole('button', { name: '稍后再说' }).click();
  await expect(sheet).toBeHidden();
  expect(world.patches).toEqual([]);
  await expect(
    page.locator('[data-connector-card="github"]').getByTestId('mcp-grant-summary'),
  ).toHaveText('· 任务和评审都还不能用');
});

test('the manage dialog removes a connector from tasks and keeps other grants', async ({
  page,
}) => {
  const world = await stubGrants(page);
  await page.goto('/app/resources/mcp-servers');
  await page.getByRole('button', { name: '管理 Context7' }).click();
  const dialog = page.getByRole('dialog', { name: 'Context7' });
  const tasks = dialog.getByTestId('mcp-grant-session');
  await expect(tasks).toBeChecked();
  await tasks.click();
  await expect(tasks).not.toBeChecked();
  await expect.poll(() => world.patches).toEqual([{ use: 'session', body: { mcpServers: [] } }]);
});

test('returning from a browser sign-in opens the grant sheet for that connector', async ({
  page,
}) => {
  await stubGrants(page, ['linear']);
  await page.goto('/app/resources/mcp-servers?oauth=connected&connector=conn-linear');
  await expect(page.getByRole('dialog', { name: '让哪些工作用 Linear' })).toBeVisible();
  await expect(page).not.toHaveURL(/oauth=/);
});
