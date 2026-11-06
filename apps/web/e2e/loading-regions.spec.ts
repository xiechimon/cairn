import { expect, type Page, test } from '@playwright/test';

const DELAY_MS = 5000;

const CONCLUSIONS = [
  '请先为 Coordinator 选择一个 Agent',
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
    await expect(page.getByTestId('query-loading')).toBeVisible();
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
  '/app/team',
]) {
  test(`settings ${path}: skeleton and no conclusion while loading`, async ({ page }) => {
    await delayEveryApi(page);
    await page.goto(path);
    await expect(page.getByTestId('query-loading')).toBeVisible();
    await expectNoConclusion(page);
  });
}
