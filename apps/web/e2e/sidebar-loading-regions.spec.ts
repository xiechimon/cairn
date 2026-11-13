import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const DELAY_MS = 5000;

const CONCLUSIONS = [
  '请先在工作路由里配置 Coordinator',
  '没有在进行的任务',
  '还没有完成的工作',
  '尚无机器',
  '尚未添加服务商',
  '尚无技能',
  '没有等你的事',
  '早上好',
  '做个计划',
];

async function delayEveryApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    await route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } }).catch(() => undefined);
  });
}

async function expectNoConclusion(page: Page) {
  const text = await page.locator('body').innerText();
  for (const phrase of CONCLUSIONS) expect(text, `no "${phrase}" while loading`).not.toContain(phrase);
}

test('home: every region shows a skeleton and no conclusion while the APIs are slow', async ({ page }) => {
  await delayEveryApi(page);
  await page.goto('/app');
  await expect(page.getByTestId('conversation-skeleton')).toBeVisible();
  await expect(page.getByTestId('sidebar-projects-loading')).toBeVisible();
  await expectNoConclusion(page);
});

test('home: the tasks, results and computers panels show a skeleton while loading', async ({ page }) => {
  await delayEveryApi(page);
  await page.goto('/app');
  for (const name of ['任务', '成果', '电脑']) {
    await page.getByRole('button', { name }).first().click();
    await expect(page.getByTestId('query-loading').first()).toBeVisible();
    await expectNoConclusion(page);
  }
});

for (const path of [
  '/app/resources/machines',
  '/app/resources/providers',
  '/app/resources/skills',
  '/app/resources/mcp-servers',
  '/app/resources/secrets',
  '/app/api-keys',
]) {
  test(`settings ${path}: skeleton and no conclusion while loading`, async ({ page }) => {
    await delayEveryApi(page);
    await page.goto(path);
    await expect(page.getByTestId('query-loading')).toBeVisible();
    await expectNoConclusion(page);
  });
}

test('results panel shows loaded todos while the schedules query is still pending', async ({ page }) => {
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.abort();
    if (request.method() !== 'GET') return route.fallback();
    if (path === '/api/teams')
      return route.fulfill({
        json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } });
    if (path === '/api/todos')
      return route.fulfill({
        json: [
          {
            id: 'todo-1',
            teamId: 'team-1',
            projectId: 'proj-a',
            title: 'ship the loaded result',
            spec: 'ship the loaded result',
            phase: 'done',
            phaseAt: 1,
            seqNum: 1,
            orderIndex: 0,
            tagIds: [],
            assignment: null,
            agent: null,
            latestBuildId: null,
            lastRunAt: 0,
            hasChanges: false,
            hasPlan: false,
            buildHistory: [],
            sourceTodo: null,
            v: 1,
          },
        ],
      });
    if (path === '/api/schedules') return new Promise(() => undefined);
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: '成果' }).first().click();
  await expect(page.getByText('ship the loaded result')).toBeVisible();
  await expect(page.getByTestId('query-loading')).toHaveCount(0);
});

test('home: the composer stays usable while loading and send is disabled', async ({ page }) => {
  await delayEveryApi(page);
  await page.goto('/app');
  const composer = page.getByTestId('loading-composer');
  await expect(composer).toBeVisible();
  await composer.getByRole('textbox').fill('draft typed while loading');
  await composer.getByRole('textbox').press('Enter');
  await expect(composer.getByRole('textbox')).toHaveValue('draft typed while loading');
  await expect(composer.getByRole('button', { name: '发送' })).toBeDisabled();
});

test('home: text typed while loading is still in the composer after loading, and send then works', async ({
  page,
}) => {
  const sent = await mockLive(page, { threads: [THREAD], messages: [] });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/**', async (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    await gate;
    return route.fallback();
  });
  await page.goto('/app');
  const loading = page.getByTestId('loading-composer');
  await expect(loading).toBeVisible();
  await loading.getByRole('textbox').fill('hello');
  release();
  const composer = page.getByTestId('chief-composer-input');
  await expect(composer).toHaveValue('hello');
  await expect(page.getByTestId('loading-composer')).toHaveCount(0);
  await composer.press('Enter');
  await expect.poll(() => sent).toContain('hello');
});
