import { readdirSync, readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { type BuiltSite, buildAndServe } from './demo-server';

const SITE_URL = 'https://cairn.xmon.me';

const DEMO = {
  cartMerge: 'demo-cart-merge',
  rateLimit: 'demo-rate-limit',
  search: 'demo-search-ranking',
  migration: 'demo-order-migration',
  coupon: 'demo-coupon-page',
} as const;

const BLOCKED_TOAST = '这是演示数据，改动不会保存';
const BLOCKED_TOAST_EN = 'Demo data: changes are not saved';

let demo: BuiltSite;
let production: BuiltSite;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  [demo, production] = await Promise.all([buildAndServe('demo'), buildAndServe('production')]);
});

test.afterAll(async () => {
  await Promise.all([demo, production].map((site) => site?.dispose()));
});

interface Traffic {
  backendRequests: string[];
  failures: string[];
  errors: string[];
}

function watchTraffic(page: Page): Traffic {
  const traffic: Traffic = { backendRequests: [], failures: [], errors: [] };
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api') || pathname.startsWith('/git')) {
      traffic.backendRequests.push(`${request.method()} ${pathname}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) traffic.failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') traffic.errors.push(message.text());
  });
  page.on('pageerror', (error) => traffic.errors.push(error.message));
  return traffic;
}

function expectQuiet(traffic: Traffic) {
  expect(traffic.backendRequests).toEqual([]);
  expect(traffic.failures).toEqual([]);
  expect(traffic.errors).toEqual([]);
}

const toast = (page: Page, text = BLOCKED_TOAST) =>
  page.locator('[data-sonner-toast]', { hasText: text });

const cards = (page: Page) => page.locator('[data-todo-id]');

test('plain /app opens demo home and links to the board; ?scenario= is ignored', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app`);
  await expect(page.getByTestId('chief-home')).toBeVisible();
  await expect(page.getByTestId('chief-home')).toContainText('购物车');
  await page.getByRole('link', { name: '看板', exact: true }).click();
  await expect(page.locator('section[data-column]')).toHaveCount(4);
  for (const column of ['todo', 'building', 'pending', 'done']) {
    await expect(page.locator(`section[data-column="${column}"] [data-todo-id]`).first()).toBeVisible();
  }
  expect(await cards(page).count()).toBeGreaterThanOrEqual(8);
  await expect(page.getByRole('link', { name: '登录后合并游客购物车' })).toBeVisible();

  await page.goto(`${demo.base}/app?scenario=chain`);
  await expect(page.getByTestId('chief-home')).toBeVisible();
  await page.getByRole('link', { name: '看板', exact: true }).click();
  await expect(page.getByRole('link', { name: '登录后合并游客购物车' })).toBeVisible();
  await expect(page.locator('.fixture-mode-chip')).toHaveCount(0);
  expectQuiet(traffic);
});

test('banner: 演示数据 + site and showcase links, bilingual, survives navigation and a phone', async ({
  page,
}) => {
  await page.goto(`${demo.base}/app`);
  const banner = page.getByTestId('demo-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('演示数据');
  await expect(banner.getByRole('link', { name: '官网' })).toHaveAttribute('href', SITE_URL);
  await expect(banner.getByRole('link', { name: '闭环录像' })).toHaveAttribute(
    'href',
    `${SITE_URL}/#showcase`,
  );

  await page.locator('.sidebar-team-name').click();
  await expect(page).toHaveURL(/\/app\/team$/);
  await expect(banner).toBeVisible();
  await expect(banner).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(banner).toBeInViewport();
  const box = await banner.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(await banner.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const menu = page.getByRole('button', { name: '展开侧边栏', exact: true });
  const menuBox = await menu.boundingBox();
  if (box == null || menuBox == null) throw new Error('mobile banner geometry missing');
  expect(menuBox.y).toBeGreaterThanOrEqual(box.y + box.height);
  expect(menuBox.width).toBeGreaterThanOrEqual(44);
  expect(menuBox.height).toBeGreaterThanOrEqual(44);
});

test('banner follows the locale', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-locale', 'en');
  });
  await page.goto(`${demo.base}/app`);
  const banner = page.getByTestId('demo-banner');
  await expect(banner).toContainText('Demo data');
  await expect(banner.getByRole('link', { name: 'Website' })).toHaveAttribute('href', SITE_URL);
  await expect(banner.getByRole('link', { name: 'Closed-loop video' })).toHaveAttribute(
    'href',
    `${SITE_URL}/#showcase`,
  );
});

test('the selling points browse end to end with no backend traffic', async ({ page }) => {
  const traffic = watchTraffic(page);

  await page.goto(`${demo.base}/app`);
  await page.getByRole('link', { name: '看板', exact: true }).click();
  await expect(page.locator('section[data-column="pending"] [data-todo-id]')).toHaveCount(3);

  await page.goto(`${demo.base}/app/todo/${DEMO.cartMerge}`);
  await expect(page.getByTestId('phase-chip')).toHaveText(/确认/);
  await expect(page.locator('.doc-pane-select').nth(1)).toHaveText(/v3/);
  await expect(page.getByText('AI 审核', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('blocking').first()).toBeVisible();
  await page.locator('.doc-range-wrap .doc-pane-select').click();
  await expect(page.locator('.version-menu-row')).toHaveCount(3);
  await page.keyboard.press('Escape');

  await page.goto(`${demo.base}/app/todo/${DEMO.rateLimit}`);
  await expect(page.getByTestId('phase-chip')).toHaveText(/审核/);
  await expect(page.locator('.doc-file-row').first()).toBeVisible();
  await expect(page.getByText('验证未通过').first()).toBeVisible();
  await expect(page.getByText('验证通过').first()).toBeVisible();

  await page.goto(`${demo.base}/app/todo/${DEMO.search}`);
  await expect(page.getByTestId('phase-chip')).toHaveText(/执行中/);

  await page.goto(`${demo.base}/app/todo/${DEMO.migration}`);
  await expect(page.getByTestId('phase-chip')).toHaveText(/失败/);

  await page.goto(`${demo.base}/app/todo/${DEMO.coupon}`);
  await expect(page.getByTestId('phase-chip')).toHaveText(/完成/);

  await page.goto(`${demo.base}/app?view=board`);
  await page.getByRole('button', { name: '总管', exact: true }).click();
  const chief = page.locator('.chief-drawer');
  await expect(chief).toBeVisible();
  await expect(chief.getByText('购物车').first()).toBeVisible();

  await page.goto(`${demo.base}/app/resources/machines`);
  await expect(page.getByRole('link', { name: 'dev-mac' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'build-box' })).toBeVisible();

  await page.goto(`${demo.base}/app/team`);
  await expect(page.getByText('reviewer-turing').first()).toBeVisible();

  await page.goto(`${demo.base}/app/schedules`);
  await expect(page.getByRole('heading', { name: /定时/ }).first()).toBeVisible();

  expectQuiet(traffic);
});

test('write: a new task is blocked with the toast, the board is unchanged', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app?view=board`);
  const before = await cards(page).count();
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await dialog.getByRole('textbox').fill('演示里不该落库的任务');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByText('演示里不该落库的任务', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await cards(page).count()).toBe(before);
  expectQuiet(traffic);
});

test('write: dragging a card to another column is blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app?view=board`);
  const card = page.locator(`section[data-column="done"] [data-todo-id="${DEMO.coupon}"]`);
  const target = page.locator('section[data-column="pending"] [data-column-list]');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (from == null || to == null) throw new Error('drag geometry missing');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 6, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await page.mouse.up();
  await expect(toast(page)).toBeVisible();
  await expect(
    page.locator(`section[data-column="done"] [data-todo-id="${DEMO.coupon}"]`),
  ).toBeVisible();
  expectQuiet(traffic);
});

test('write: sending in the detail composer is blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/todo/${DEMO.cartMerge}`);
  await page.getByPlaceholder('请求修改…').fill('请改成先合并再校验库存');
  await page.locator('.composer-send').click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByTestId('phase-chip')).toHaveText(/确认/);
  await expect(page.locator('.chat-streaming-label')).toHaveCount(0);
  expectQuiet(traffic);
});

test('write: the primary action and the delete confirm are blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/todo/${DEMO.cartMerge}`);
  await page.locator('.detail-head-action').click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByTestId('phase-chip')).toHaveText(/确认/);

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/todo/${DEMO.cartMerge}$`));
  await page.goto(`${demo.base}/app?view=board`);
  await expect(page.locator(`[data-todo-id="${DEMO.cartMerge}"]`)).toBeVisible();
  expectQuiet(traffic);
});

test('write: completing a review task from the menu shows the demo notice', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/todo/${DEMO.rateLimit}`);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '完成', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '完成任务', exact: true });
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(toast(page)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('phase-chip')).toHaveText(/审核/);
  expectQuiet(traffic);
});

test('a board card opens the panel and expands into its versioned detail', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app?view=board`);
  await page.getByRole('link', { name: '登录后合并游客购物车', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '任务面板', exact: true });
  await expect(panel.getByTestId('task-panel-title')).toHaveText('登录后合并游客购物车');
  await panel.getByRole('link', { name: '展开为整页', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/todo/${DEMO.cartMerge}`));
  await expect(page.getByTestId('phase-chip')).toHaveText(/确认/);
  await expect(page.getByText('blocking').first()).toBeVisible();
  await expect(page.locator('.doc-pane-select').nth(1)).toHaveText(/v3/);
  expectQuiet(traffic);
});

test('write: sending to the chief is blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app?view=board`);
  await page.getByRole('button', { name: '总管', exact: true }).click();
  const chief = page.locator('.chief-drawer');
  const input = chief.getByRole('textbox');
  await input.fill('把购物车那张票提到最前面');
  await input.press('Enter');
  await expect(toast(page)).toBeVisible();
  expectQuiet(traffic);
});

test('write: sending to the chief from home is blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app`);
  const home = page.getByTestId('chief-home');
  await expect(home).toContainText('购物车');
  const input = home.getByTestId('chief-composer-input');
  await input.fill('把购物车那张票提到最前面');
  await input.press('Enter');
  await expect(toast(page)).toBeVisible();
  expectQuiet(traffic);
});

test('write: the create dialog on the team page is blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/team`);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await dialog.getByLabel('名称').fill('demo-agent');
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'dev-mac' }).click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByText('demo-agent')).toHaveCount(0);
  expectQuiet(traffic);
});

test('write: machine evacuation is blocked before backend traffic', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/resources/machines/demo-machine-dev-mac`);
  await expect(page.getByTestId('team-agent-card')).toHaveCount(2);
  await page.locator('.machine-evacuate-select').click();
  await page.locator('.machine-evacuate-row', { hasText: 'build-box' }).click();
  await page.getByTestId('machine-evacuate-btn').click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByTestId('machine-evacuate-btn')).toBeEnabled();
  await expect(page.getByTestId('team-agent-card')).toHaveCount(2);
  expectQuiet(traffic);
});

test('write: browsing for a local project folder stays available after the demo notice', async ({
  page,
}) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/project/new`);
  await page.locator('#prj-new-repo').click();
  await page.getByRole('menuitemradio', { name: '本地文件夹', exact: true }).click();
  const browse = page.getByRole('button', { name: '浏览', exact: true });
  await browse.click();
  await expect(toast(page)).toBeVisible();
  await expect(browse).toBeEnabled();
  await expect(page.getByLabel('本地文件夹', { exact: true })).toHaveValue('');
  expectQuiet(traffic);
});

test('write: deleting the spare machine is blocked before backend traffic', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/resources/machines/demo-machine-spare`);
  await expect(page.getByTestId('team-agent-card')).toHaveCount(0);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除', exact: true })).toBeEnabled();
  await page.goto(`${demo.base}/app/resources/machines`);
  await expect(page.getByRole('link', { name: 'spare-machine', exact: true })).toBeVisible();
  expectQuiet(traffic);
});

test('write: secret creation explains that demo changes are not saved', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/resources/secrets`);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加密钥' });
  await dialog.getByLabel('名称（环境变量名）').fill('DEMO_ONLY');
  await dialog.getByLabel('值', { exact: true }).fill('nonsecret-demo-value');
  await dialog.getByRole('button', { name: '添加密钥', exact: true }).click();
  await expect(toast(page)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('DEMO_ONLY', { exact: true })).toHaveCount(0);
  expectQuiet(traffic);
});

test('write: provider creation explains that demo changes are not saved', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/resources/providers`);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await dialog.getByRole('button', { name: '自定义端点', exact: true }).click();
  await dialog.getByLabel('服务商 ID', { exact: true }).fill('demo-only');
  await dialog.getByLabel('名称', { exact: true }).fill('Demo only provider');
  await dialog.getByLabel('Base URL', { exact: true }).fill('https://example.com/v1');
  await dialog.getByRole('button', { name: '添加模型服务', exact: true }).click();
  await expect(toast(page)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Demo only provider', { exact: true })).toHaveCount(0);
  expectQuiet(traffic);
});

test('write: provider OAuth explains that demo changes are not saved', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/resources/providers`);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await dialog.locator('[data-preset-id="github-copilot"]').click();
  await expect(toast(page)).toBeVisible();
  await expect(dialog).toBeHidden();
  expectQuiet(traffic);
});

test('the blocked toast is English under the en locale', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-locale', 'en');
  });
  await page.goto(`${demo.base}/app`);
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('not saved');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast(page, BLOCKED_TOAST_EN)).toBeVisible();
});

test('the production build carries no demo content and ignores demo behaviour', async ({
  page,
}) => {
  await page.goto(`${production.base}/app`);
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(0);
  await page.goto(`${production.base}/app?scenario=chain`);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('.fixture-mode-chip')).toHaveCount(0);
  await expect(page.getByText('登录后合并游客购物车')).toHaveCount(0);

  const assets = readdirSync(`${production.dist}/assets`).filter((f) => f.endsWith('.js'));
  const bundle = assets.map((f) => readFileSync(`${production.dist}/assets/${f}`, 'utf8')).join('\n');
  expect(bundle).not.toContain(DEMO.cartMerge);
  expect(bundle).not.toContain('登录后合并游客购物车');
});
