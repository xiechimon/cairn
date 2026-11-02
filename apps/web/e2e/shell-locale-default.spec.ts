import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK } from './chief-home-mock';

const workbench = (page: Page, name: string) =>
  page.getByRole('complementary').locator('[data-slot="sidebar-nav-row"]', { hasText: name });

test.describe('a browser set to English', () => {
  test.use({ locale: 'en-US' });

  test('opens the workbench in English with no stored choice', async ({ page }) => {
    await page.goto('/app');
    await expect(workbench(page, 'Home')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('keeps a stored Chinese choice', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-locale', 'zh'));
    await page.goto('/app');
    await expect(workbench(page, '首页')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
});

test.describe('a browser set to Chinese', () => {
  test.use({ locale: 'zh-CN' });

  test('opens the workbench in Chinese with no stored choice', async ({ page }) => {
    await page.goto('/app');
    await expect(workbench(page, '首页')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });

  test('keeps a stored English choice', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-locale', 'en'));
    await page.goto('/app');
    await expect(workbench(page, 'Home')).toBeVisible();
  });
});

test.describe('English count grammar', () => {
  test.use({ locale: 'en-US' });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`one member and one running task at ${width}px in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
        await mockLive(page, { threads: [], messages: [], todos: [TASK] });
        await page.goto('/app');
        await expect(page.getByTestId('home-c-since')).toContainText('1 in progress');
        await page.screenshot({
          path: resolve(`../../docs/verify/2420/after-home-${width}-${theme}.png`),
          fullPage: true,
        });
        await page.goto('/app/team?scenario=team-org-chart-single');
        await expect(page.getByText('1 member', { exact: true })).toBeVisible();
        await page.screenshot({
          path: resolve(`../../docs/verify/2420/after-team-${width}-${theme}.png`),
          fullPage: true,
        });
      });
    }
  }

  test('renders plural members and independent running counts', async ({ page }) => {
    await mockLive(page, {
      threads: [],
      messages: [],
      todos: [TASK, { ...TASK, id: 'todo-2', seqNum: 10 }],
    });
    await page.goto('/app');
    await expect(page.getByTestId('home-c-since')).toContainText('2 in progress');
    await page.goto('/app/team?scenario=team-org-chart-pair');
    await expect(page.getByText('2 members', { exact: true })).toBeVisible();
  });

  test('retains Chinese count rendering', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-locale', 'zh'));
    await mockLive(page, { threads: [], messages: [], todos: [TASK] });
    await page.goto('/app');
    await expect(page.getByTestId('home-c-since')).toContainText('1 件在进行');
    await page.goto('/app/team?scenario=team-org-chart-single');
    await expect(page.getByText('1 个成员', { exact: true })).toBeVisible();
  });
});
