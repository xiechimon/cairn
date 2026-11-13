import { readdirSync, readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { type BuiltSite, buildAndServe } from './demo-server';
import { pressOpenCoordinator } from './helpers.js';

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

const home = (page: Page) => page.getByTestId('home-c');

test('plain /app opens the demo Coordinator home; ?scenario= is ignored', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app`);
  await expect(home(page)).toBeVisible();
  await expect(home(page).getByText('购物车').first()).toBeVisible();

  await page.goto(`${demo.base}/app?scenario=chain`);
  await expect(home(page).getByText('购物车').first()).toBeVisible();
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

  await page.getByTestId('sidebar-settings').click();
  await page.getByRole('dialog', { name: '设置' }).getByRole('link', { name: '规则与策略' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/work-routing$/);
  await expect(banner).toBeVisible();
  await expect(banner).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(banner).toBeInViewport();
  const box = await banner.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(await banner.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
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

  await page.goto(`${demo.base}/app/todo/${DEMO.cartMerge}`);
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定');
  await expect(page.getByText('AI 审核', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('blocking').first()).toBeVisible();

  await page.goto(`${demo.base}/app/todo/${DEMO.rateLimit}`);
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定');
  await expect(page.getByText('验证未通过').first()).toBeVisible();
  await expect(page.getByText('验证通过').first()).toBeVisible();

  await page.goto(`${demo.base}/app/todo/${DEMO.search}`);
  await expect(page.getByTestId('side-chat-status')).toContainText('运行中');

  await page.goto(`${demo.base}/app/todo/${DEMO.migration}`);
  await expect(page.getByTestId('side-chat-status')).toContainText('失败');

  await page.goto(`${demo.base}/app/todo/${DEMO.coupon}`);
  await expect(page.getByTestId('side-chat-status')).toContainText('已完成');

  await page.goto(`${demo.base}/app`);
  await expect(home(page).getByText('购物车').first()).toBeVisible();

  await page.goto(`${demo.base}/app/resources/machines`);
  await expect(page.getByTestId('machine-item').filter({ hasText: 'dev-mac' })).toBeVisible();
  await expect(page.getByTestId('machine-item').filter({ hasText: 'build-box' })).toBeVisible();

  await page.goto(`${demo.base}/app/schedules`);
  await expect(page.getByRole('heading', { name: /定时/ }).first()).toBeVisible();

  expectQuiet(traffic);
});

test('write: a new task is blocked with the toast and nothing is added', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app`);
  await page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })
    .click();
  const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await input.fill('演示里不该落库的任务');
  await input.press('Enter');
  await expect(toast(page)).toBeVisible();
  await expect(home(page).getByText('演示里不该落库的任务')).toHaveCount(0);
  expectQuiet(traffic);
});

test('write: sending in the detail composer is blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/todo/${DEMO.cartMerge}`);
  await page.locator('.side-panel textarea').fill('请改成先合并再校验库存');
  await page.locator('.side-panel .composer-send').click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定');
  await expect(page.locator('.chat-streaming-label')).toHaveCount(0);
  expectQuiet(traffic);
});

test('write: the primary action and the delete confirm are blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/todo/${DEMO.cartMerge}`);
  await page.getByTestId('side-chat-action').getByRole('button').first().click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定');

  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]thread=${DEMO.cartMerge}$`));
  await page.reload();
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定');
  expectQuiet(traffic);
});

test('write: sending to the Coordinator is blocked', async ({ page }) => {
  const traffic = watchTraffic(page);
  await page.goto(`${demo.base}/app/schedules`);
  await pressOpenCoordinator(page);
  const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await input.fill('把购物车那张票提到最前面');
  await input.press('Enter');
  await expect(toast(page)).toBeVisible();
  expectQuiet(traffic);
});

test('the blocked toast is English under the en locale', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-locale', 'en');
  });
  await page.goto(`${demo.base}/app`);
  await page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })
    .click();
  const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await input.fill('not saved');
  await input.press('Enter');
  await expect(toast(page, BLOCKED_TOAST_EN)).toBeVisible();
});

test('the production build carries no demo content and ignores demo behaviour', async ({
  page,
}) => {
  await page.goto(`${production.base}/app`);
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await page.goto(`${production.base}/app?scenario=chain`);
  await expect(page.locator('.fixture-mode-chip')).toHaveCount(0);
  await expect(page.getByText('登录后合并游客购物车')).toHaveCount(0);

  const assets = readdirSync(`${production.dist}/assets`).filter((f) => f.endsWith('.js'));
  const bundle = assets.map((f) => readFileSync(`${production.dist}/assets/${f}`, 'utf8')).join('\n');
  expect(bundle).not.toContain(DEMO.cartMerge);
  expect(bundle).not.toContain('登录后合并游客购物车');
});
